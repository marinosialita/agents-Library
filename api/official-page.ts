import { innerBlocks, stripBlocks, stripComments } from '../shared/html-scan.ts';
import sanitizeHtml from 'sanitize-html';
import { isCatalogueUrl, sourceHost } from '../shared/official-sources.ts';
import { allowedIn, pageScope } from '../server/public-web.ts';

// An official page opened inside the app. Official websites are many and different — script-built pages, old
// encodings, frames — so the page is shown as it reads: its title and main text in the app's own reader, with the
// original one click away. Only pages of the catalogue's official
// websites (shared/official-sources.ts) are fetched; no cookies or credentials are ever sent; at most 3 redirects,
// each to an official host; 3 MB; PDFs are passed through for the browser's own text reader.
// The catalogue's hosts and their subdomains (shared/official-sources.ts, also used by the app to decide what opens here).
export { isCatalogueUrl };
// 12 Nov 2026: news front pages (CNBC, CNN) run 3–6 MB of HTML; 8 MB lets them open in the panel.
const MAX_BYTES = 8_000_000;
/** A PDF (a gazette issue, a report) is often 4–20 MB; pages are read one by one in the viewer. */
const PDF_MAX_BYTES = 25_000_000;
/** The open viewer asks as an ordinary browser would; many news sites answer a bare client with an error page. */
const BROWSER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const charsetOf = (contentType: string, head: string) =>
  /charset=([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
/** The page's main part: <main>, <article> or role=main when the page has one, otherwise its body. */
function mainPart(html: string): string {
  // Named content blocks come before the body: legislation.gov.uk's «#content», WordPress «#primary», GOV.UK's «#main-content».
  // Linear: a block's inside by indexOf, an opening tag matched without crossing another «<» (13 Nov 2026, code review).
  const rest = (pattern: RegExp) => { const match = pattern.exec(html); return match ? html.slice(match.index + match[0].length) : undefined; };
  for (const find of [() => innerBlocks(html, ['main'], 1)[0], () => innerBlocks(html, ['article'], 1)[0], () => rest(/<[a-z][a-z0-9]*\b[^<>]*\brole=["']main["'][^<>]*>/i),
    () => rest(/<(?:div|section)\b[^<>]*\bid=["'](?:content|main|main-content|maincontent|primary|page-content|viewLegContents)["'][^<>]*>/i), () => innerBlocks(html, ['body'], 1)[0]]) {
    const found = find();
    if (found && found.replace(/<[^>]+>/g, '').trim().length > 200) return found;
  }
  return html;
}
// Cookie and consent banners, pop-ups and hidden parts are not the page.
// 13 Nov 2026: tested per class name, not on the joined attribute («cky-» matched «sticky-»), and never on the page's
// own wrappers (Wikipedia's <html> carries «…-popup…» feature classes, so the whole article vanished).
const CHROME = /^(?:.*(?:cookie|consent|gdpr|cmplz|onetrust|didomi|iubenda).*|cc-window|cky-.*|moove.*|privacy-(?:banner|bar|popup).*|.*(?:modal|popup|overlay|newsletter).*|sr-only|visually-hidden|skip-link)$/i;
const WRAPPERS = new Set(['html', 'body', 'main', 'article']);
// Side columns by their own names, word for word (WordPress «widget_…», Elementor's sidebar), never a page wrapper.
const SIDE = /^(?:sidebar|widget-area|secondary|breadcrumbs?|related-posts|sharedaddy|social-share|elementor-widget-sidebar|elementor-widget-breadcrumbs|widget_[a-z_]+|(?:recent-posts|calendar|archives|categories|meta|search)-\d+)$/i;
const PLACEHOLDER = /\{[a-z][\w.-]*\}/i;
type Frame = { tag: string; text: string; attribs: Record<string, string> };
function withoutChrome(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: false, allowedAttributes: false, allowVulnerableTags: true,
    exclusiveFilter: (frame: Frame) => {
      const a = frame.attribs || {};
      if (WRAPPERS.has(frame.tag)) return false;
      if (`${a.id ?? ''} ${a.class ?? ''}`.split(/\s+/).some(token => token && CHROME.test(token))) return true;
      if (`${a.id ?? ''} ${a.class ?? ''}`.split(/\s+/).some(token => SIDE.test(token))) return true;
      if (a.role === 'dialog' || a.role === 'alertdialog' || a['aria-modal'] === 'true' || a.hidden !== undefined || a['aria-hidden'] === 'true') return true;
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style ?? '')) return true;
      return ['a', 'li', 'span', 'button', 'label', 'p', 'h2', 'h3', 'h4'].includes(frame.tag) && frame.text.length < 300 && PLACEHOLDER.test(frame.text);
    },
  });
}
export function readablePage(html: string, base: string): { title: string; html: string } {
  const named = (innerBlocks(html, ['title'], 1)[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  // A file name («L_2011304EL.01006401.xml», CELLAR's) is no title: the reader keeps the answer's own.
  const title = /^[\w.-]+\.(?:xml|x?html?|pdf)$/i.test(named) ? '' : named;
  // 13 Nov 2026 (code review): linear scans instead of lazy «<x>…</x>» patterns, which ran in quadratic time on a page
  // of unclosed tags.
  const cleaned = stripBlocks(withoutChrome(stripComments(stripBlocks(html, ['script', 'style', 'noscript', 'template', 'svg'], ''), '')), ['head'], '');
  const body = sanitizeHtml(stripBlocks(stripBlocks(mainPart(cleaned), ['select', 'textarea', 'button'], '')
    // A form is unwrapped, not removed: ASP.NET sites (the Bank of Greece, many ministries) put the whole page in one.
    .replace(/<\/?form\b[^>]*>/gi, ''), ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'svg', 'title'], ''), {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'pre', 'code', 'hr', 'dl', 'dt', 'dd'],
    allowedAttributes: { a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['https', 'http', 'mailto'], allowProtocolRelative: false,
    transformTags: { a: (tag: string, attributes: Record<string, string>) => {
      let href = ''; try { href = attributes.href ? new URL(attributes.href, base).href : ''; } catch { /* dropped */ }
      const attribs: Record<string, string> = href && /^https?:/.test(href) ? { href } : {};
      return { tagName: 'a', attribs };
    } },
    exclusiveFilter: (frame: { tag: string; text: string }) => ['p', 'li', 'td', 'a'].includes(frame.tag) && !frame.text.trim() && frame.tag !== 'td',
  });
  return { title, html: body.slice(0, 600_000) };
}

// EUR-Lex pages answer a server with a script check and no text. The same act is read from CELLAR, the Publications
// Office's repository, by its CELEX number, in the reader's language. An ELI link (eli/reg/2016/679) is turned into
// its CELEX number.
const ELI_TYPES: Record<string, string> = { reg: 'R', reg_impl: 'R', reg_del: 'R', dir: 'L', dir_impl: 'L', dir_del: 'L', dec: 'D', dec_impl: 'D', dec_del: 'D' };
export function cellarCelex(value: string): string | null {
  let url: URL; try { url = new URL(value); } catch { return null; }
  if (url.hostname.replace(/^www\./, '') !== 'eur-lex.europa.eu') return null;
  const uri = url.searchParams.get('uri') ?? '';
  const celex = /^celex:([0-9a-z().]+)$/i.exec(uri)?.[1];
  if (celex) return celex.toUpperCase();
  // 11 Nov 2026: a CELLAR id (uri=CELLAR:41547fa8-20a8-…) is read from the same repository by that id.
  const cellar = /^cellar:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(uri)?.[1];
  if (cellar) return `cellar:${cellar.toLowerCase()}`;
  const eli = /^\/eli\/([a-z_]+)\/(\d{4})\/(\d+)/.exec(url.pathname);
  if (eli && ELI_TYPES[eli[1]]) return `3${eli[2]}${ELI_TYPES[eli[1]]}${eli[3].padStart(4, '0')}`;
  return null;
}
export async function readCellar(celex: string, language: 'el' | 'en', signal: AbortSignal): Promise<{ type: string; bytes: Uint8Array }> {
  let url = celex.startsWith('cellar:') ? `https://publications.europa.eu/resource/cellar/${celex.slice(7)}`
    : `https://publications.europa.eu/resource/celex/${encodeURIComponent(celex).replace(/[()]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`;
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal,
      headers: { Accept: 'application/xhtml+xml, text/html;q=0.9, application/pdf;q=0.5', 'Accept-Language': language === 'el' ? 'ell, eng;q=0.5' : 'eng', 'User-Agent': 'AgentPlatform-SourceReader/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = new URL(response.headers.get('location') || '', url);
      if (next.hostname !== 'publications.europa.eu' || next.username || next.password || (next.port && next.port !== '80' && next.port !== '443') || !next.pathname.startsWith('/resource/')) throw new Error('cellar_redirect');
      next.protocol = 'https:'; next.port = ''; url = next.href; continue;
    }
    // The repository answers 5xx now and then (11 Nov 2026): one more try after a second before giving up.
    if (response.status >= 500 && hop < 4) { await response.body?.cancel(); await new Promise(resolve => setTimeout(resolve, 1_000)); hop++; continue; }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('cellar_unavailable'); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES * 2) throw new Error('cellar_too_large');
    return { type: response.headers.get('content-type')?.toLowerCase() || '', bytes };
  }
  throw new Error('cellar_redirects');
}

export type OfficialFetch = { kind: 'html'; text: string; url: string } | { kind: 'pdf'; bytes: Uint8Array; url: string } | { kind: 'failed'; error: string; url: string };
/** One official page as its site serves it (shared by the text reader and the web viewer, api/official-web.ts): only
 *  catalogue hosts, no cookies or credentials, at most 3 redirects each to an official host, 3 MB; the page's own
 *  encoding (old Greek sites) is honoured. */
export async function fetchOfficial(start: string, signal: AbortSignal, accept = 'text/html,application/pdf;q=0.9,*/*;q=0.5',
  /** What a redirect may lead to: official pages by default; any public page in the open viewer (server/public-web.ts). */
  allow: (url: string) => boolean | Promise<boolean> = isCatalogueUrl, open = false,
  /** Only the kind is needed (the web viewer): a PDF is answered as soon as its type is known, without reading it. */
  peek = false): Promise<OfficialFetch> {
  let target = start;
  // 12 Nov 2026, with the owner's yes: gov.cy answers the reader's own name with 403 and a browser with the page, so on
  // 401/403 the reader asks once more as a browser. A site that refuses browsers too (a bot check) stays refused.
  let asBrowser = open;
  for (let redirects = 0; redirects <= 3; redirects++) {
    let response = await fetch(target, { redirect: 'manual', credentials: 'omit', signal, headers: { Accept: accept, 'User-Agent': asBrowser ? BROWSER_AGENT : 'AgentPlatform-SourceReader/1.0', ...(asBrowser ? { 'Accept-Language': 'en-GB,en;q=0.9,el;q=0.8' } : {}) } });
    if ((response.status === 403 || response.status === 401) && !asBrowser) {
      await response.body?.cancel(); asBrowser = true;
      response = await fetch(target, { redirect: 'manual', credentials: 'omit', signal, headers: { Accept: accept, 'User-Agent': BROWSER_AGENT, 'Accept-Language': 'en-GB,en;q=0.9,el;q=0.8' } });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      const next = location ? new URL(location, target).href : '';
      if (!next || !(await allow(next)) || redirects === 3) return { kind: 'failed', error: 'redirect_outside', url: next || target };
      target = next; continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel(); console.warn('official-page', { host: sourceHost(target), status: response.status });
      // Why, so the viewer can say it: gone from the site, the site busy, or the site refusing readers.
      const error = response.status === 404 || response.status === 410 ? 'not_found' : response.status === 429 || response.status === 503 ? 'busy' : response.status === 401 || response.status === 403 ? 'refused' : 'unavailable';
      return { kind: 'failed', error, url: target };
    }
    const type = response.headers.get('content-type')?.toLowerCase() || '';
    const pdf = type.includes('application/pdf') || (!type.includes('html') && /\.pdf($|\?)/i.test(target));
    if (pdf && peek) { await response.body.cancel(); return { kind: 'pdf', bytes: new Uint8Array(0), url: target }; }
    const limit = pdf ? PDF_MAX_BYTES : MAX_BYTES;
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); return { kind: 'failed', error: 'too_large', url: target }; }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); return { kind: 'failed', error: 'too_large', url: target }; } chunks.push(value); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    if (pdf) return { kind: 'pdf', bytes, url: target };
    if (!type.includes('html')) return { kind: 'failed', error: 'unsupported', url: target };
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
    let text: string; try { text = new TextDecoder(charsetOf(type, head)).decode(bytes); } catch { text = new TextDecoder().decode(bytes); }
    return { kind: 'html', text, url: target };
  }
  return { kind: 'failed', error: 'unavailable', url: target };
}

export default { async fetch(request: Request): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const target = new URL(request.url).searchParams.get('url') || '';
  const scope = await pageScope(request, target);
  if (!scope) return json({ error: 'not_official' }, 400);
  // 45 s: a large PDF from a slow government site (a 4 MB gazette issue) took longer than 15 s.
  const signal = AbortSignal.timeout(45_000);
  const celex = scope === 'official' ? cellarCelex(target) : null;
  if (celex) {
    try {
      const language = new URL(request.url).searchParams.get('lang') === 'el' ? 'el' : 'en';
      const { type, bytes } = await readCellar(celex, language, AbortSignal.timeout(20_000));
      if (type.includes('pdf')) return new Response(bytes.slice().buffer as ArrayBuffer, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Source-Url': new URL(target).href } });
      return json({ url: target, ...readablePage(new TextDecoder().decode(bytes), target) });
    } catch (error) {
      console.warn('official-page', { host: 'publications.europa.eu', celex, failure: error instanceof Error ? error.message : 'unknown' });
    }
  }
  try {
    const page = await fetchOfficial(target, signal, undefined, allowedIn(scope), scope === 'open');
    if (page.kind === 'failed') return json({ error: page.error, url: page.url }, 502);
    if (page.kind === 'pdf') return new Response(page.bytes.slice().buffer as ArrayBuffer, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Source-Url': new URL(page.url).href } });
    return json({ url: page.url, ...readablePage(page.text, page.url) });
  } catch (error) {
    // Which host failed and how (a timeout, a refused or reset connection), so a site that turns the reader away can be seen.
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code || error.name : 'unknown';
    console.warn('official-page', { host: sourceHost(target), failure: cause });
    return json({ error: 'unavailable', url: target }, 502);
  }
} };
