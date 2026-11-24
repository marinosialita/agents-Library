// Any public website in the right-hand viewer (12 Nov 2026, his «all needs to open in the right panel … with the same
// layout as the original»). Official sources open for everyone (shared/official-sources.ts); any other public page
// opens only for a signed-in person, and never an address inside a network: no localhost, no private or link-local
// ranges, no cloud metadata, no odd ports, no user:password in the address. Every redirect is checked again.
// The name is resolved and checked before each request; fetch resolves it once more, so a name that changes its
// answer between the two (DNS rebinding) is the remaining gap, kept small by the short time between them.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isCatalogueUrl } from '../shared/official-sources.ts';
import { actorOf, liveComposioDeps } from './connections.ts';

const BLOCKED_NAMES = /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/i;

/** True for an address that belongs to a private, local or special network. */
export function privateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (kind === 6) {
    // 13 Nov 2026 (review): Node writes [::ffff:127.0.0.1] as «::ffff:7f00:1», which a dotted-quad test never saw. The
    // address is expanded to its eight groups and any IPv4 inside it (mapped, compatible, 6to4) is judged as IPv4.
    const groups = ipv6Groups(address.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, ''));
    if (!groups) return true;
    const v4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    if (groups.slice(0, 5).every(group => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) return groups[5] === 0 && groups[6] === 0 && groups[7] <= 1 ? true : privateAddress(v4(groups[6], groups[7]));
    if (groups[0] === 0x2002) return privateAddress(v4(groups[1], groups[2]));
    const first = groups[0];
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || first === 0 || (first === 0x64 && groups[1] === 0xff9b)
      || (first === 0x2001 && (groups[1] === 0 || groups[1] === 0xdb8)) || (first === 0x100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0);
  }
  return true;
}

/** An IPv6 address as its eight 16-bit groups (a final dotted IPv4 counts as two), or null when it cannot be read. */
function ipv6Groups(value: string): number[] | null {
  let text = value;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) { const [a, b, c, d] = dotted.slice(1).map(Number); if ([a, b, c, d].some(n => n > 255)) return null; text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`; }
  const halves = text.split('::'); if (halves.length > 2) return null;
  const part = (half: string) => half ? half.split(':') : [];
  const head = part(halves[0]), tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || all.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return all.map(group => parseInt(group, 16));
}

/** The address itself: http(s), a public-looking name, the usual ports, no credentials. */
export function publicWebUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host || BLOCKED_NAMES.test(host)) return null;
    if (isIP(host)) return privateAddress(host) ? null : url;
    return host.includes('.') ? url : null;
  } catch { return null; }
}

/** The address, and every address its name resolves to, are public. */
export async function reachablePublicUrl(value: string): Promise<boolean> {
  const url = publicWebUrl(value);
  if (!url) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return true;
  try {
    const answers = await lookup(host, { all: true, verbatim: true });
    return answers.length > 0 && answers.every(answer => !privateAddress(answer.address));
  } catch { return false; }
}

export type PageScope = 'official' | 'open';
/** What a reader request may open: official pages always; with «open=1», any public page for a signed-in person. */
export async function pageScope(request: Request, url: string): Promise<PageScope | null> {
  if (isCatalogueUrl(url)) return 'official';
  if (new URL(request.url).searchParams.get('open') !== '1') return null;
  if (!publicWebUrl(url) || !(await actorOf(request, liveComposioDeps))) return null;
  return (await reachablePublicUrl(url)) ? 'open' : null;
}
/** The check for each redirect and onward page, in that scope. */
export const allowedIn = (scope: PageScope) => async (url: string) => scope === 'official' ? isCatalogueUrl(url) : await reachablePublicUrl(url);
