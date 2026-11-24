// The script files a public page loads as modules, passed through for the right-hand viewer (12 Nov 2026).
// The viewer's sandbox has an opaque origin, and a browser loads a module script from another site only if that site
// allows it (CORS); most sites do not, so modern pages (Astro, Vite, Next) stayed blank. The page's own module files
// come through here instead, with «anyone may load this» added.
//   GET /api/web-asset/<ticket>/<https|http>/<host>/<path>?<query>
// The ticket is signed by the server when it sends the page and names that page's host and an expiry (1 hour): this
// is never an open relay. Only public addresses (server/public-web.ts), only scripts, styles, JSON and WebAssembly,
// at most 5 MB, never with cookies. Relative imports inside a module resolve to the same path, so they come here too.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readAuthConfig } from './auth/auth.ts';
import { reachablePublicUrl } from './public-web.ts';

const TICKET_MS = 60 * 60_000;
const MAX_BYTES = 5_000_000;
const TYPES = /^(?:text\/javascript|application\/(?:x-)?javascript|application\/ecmascript|text\/css|application\/json|application\/wasm|application\/manifest\+json)/i;
const BROWSER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function key(): string | null {
  const config = readAuthConfig();
  return 'secret' in config ? config.secret : null;
}
const sign = (secret: string, host: string, expires: number) => createHmac('sha256', secret).update(`web-asset|${host.toLowerCase()}|${expires}`).digest('base64url').slice(0, 32);

/** A ticket for one host, or null when the server has no secret (then module scripts simply do not load). */
export function assetTicket(host: string, now = Date.now()): string | null {
  const secret = key(); if (!secret) return null;
  const expires = Math.floor((now + TICKET_MS) / 1000);
  return `${expires}.${sign(secret, host, expires)}`;
}
export function ticketValid(ticket: string, host: string, now = Date.now(), secret = key()): boolean {
  const match = /^(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(ticket);
  if (!match || !secret || Number(match[1]) * 1000 < now) return false;
  const expected = Buffer.from(sign(secret, host, Number(match[1]))), given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
/** The address a page's module file is loaded from, through this route. */
export function assetPath(ticket: string, url: URL): string {
  return `/api/web-asset/${ticket}/${url.protocol.replace(':', '')}/${url.host}${url.pathname}${url.search}`;
}

/** Imports that start at the site's root («/_astro/x.js») point at this route instead; relative ones need nothing. */
export function rebaseImports(code: string, prefix: string): string {
  return code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])\/(?!\/)/g, (_whole, keyword: string, quote: string) => `${keyword}${quote}${prefix}/`);
}

export async function handleWebAsset(request: Request): Promise<Response> {
  const headers = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  const fail = (status: number) => new Response(null, { status, headers });
  // On this Mac the app is a «private network» address, which Chrome lets a sandboxed page reach only after asking.
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Private-Network': 'true' } });
  if (request.method !== 'GET') return fail(405);
  const url = new URL(request.url);
  const match = /^\/api\/web-asset\/([^/]+)\/(https?)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!match) return fail(400);
  const [, ticket, scheme, host, rest] = match;
  if (!ticketValid(ticket, host)) return fail(403);
  let target = `${scheme}://${host}${rest ?? '/'}${url.search}`;
  try {
    for (let hop = 0; hop <= 2; hop++) {
      if (!(await reachablePublicUrl(target))) return fail(400);
      const response = await fetch(target, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': BROWSER_AGENT, Accept: '*/*' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location'); await response.body?.cancel();
        if (!next) return fail(502);
        target = new URL(next, target).href;
        if (new URL(target).host !== host) return fail(400);
        continue;
      }
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !response.body) { await response.body?.cancel(); return fail(response.status || 502); }
      if (!TYPES.test(type)) { await response.body.cancel(); return fail(415); }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); return fail(413); }
      let bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) return fail(413);
      if (/javascript|ecmascript/i.test(type)) bytes = new TextEncoder().encode(rebaseImports(new TextDecoder().decode(bytes), `${url.origin}/api/web-asset/${ticket}/${scheme}/${host}`));
      return new Response(bytes, { status: 200, headers: { ...headers, 'Content-Type': type, 'Cache-Control': 'private, max-age=300' } });
    }
    return fail(502);
  } catch { return fail(502); }
}
