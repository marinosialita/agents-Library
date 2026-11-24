// Citations as small pills (11 Nov 2026, his «citations like Montesquilex»): a source link written as its site name —
// «(cylaw.org)», «[eur-lex.europa.eu](…)» — becomes a pill with the place's flag (a building for a court's site) and the
// site name, without the brackets. The link itself is unchanged, so it still opens in the side reader.
import { OFFICIAL_SOURCE_PLACES } from '../../shared/official-sources.ts';

type Mark = { flag: string; court: boolean };
let byHost: Map<string, Mark> | null = null;
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** The flag (or 🏛 for a court) of the catalogue site a URL belongs to; '' when it is not a catalogue site. */
export function sourceMark(url: string): Mark | null {
  if (!byHost) {
    byHost = new Map();
    for (const place of OFFICIAL_SOURCE_PLACES) for (const source of place.sources) { const host = hostOf(source.url); if (host && !byHost.has(host)) byHost.set(host, { flag: place.flag, court: source.kind === 'courts' }); }
  }
  const host = hostOf(url);
  // A law on a site that also publishes judgments (CyLaw's «/nomoi/», an ELI or «legislation» path) carries the flag, not 🏛.
  const law = /\/(?:nomoi|eli|legislation|laws?|statutes?|acts?)\//i.test((() => { try { return new URL(url).pathname; } catch { return ''; } })());
  for (let at = host; at.includes('.'); at = at.slice(at.indexOf('.') + 1)) { const found = byHost.get(at); if (found) return law ? { ...found, court: false } : found; }
  return null;
}

const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** A link whose text is a site name (no spaces, a dot, no more than 60 characters) — the way answers cite. */
const SITE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?$/i;

export function sourceChipsHtml(html: string): string {
  // «(<a>site</a>)», «(<a>site</a>; <a>site</a>)» and a bare «<a>site</a>».
  const chip = (attrs: string, text: string) => {
    const href = /href="([^"]+)"/.exec(attrs)?.[1]?.replace(/&amp;/g, '&') ?? '';
    const mark = sourceMark(href);
    const icon = mark ? (mark.court ? '🏛' : mark.flag) : '🔗';
    return `<a${attrs.replace(/\sclass="[^"]*"/, '')} class="mn-source-chip"><i aria-hidden="true">${icon}</i><span>${escape(text.replace(/^www\./, ''))}</span></a>`;
  };
  const link = /<a(\s[^>]*)>([^<]{3,60})<\/a>/g;
  return html
    .replace(/\(\s*((?:<a\s[^>]*>[^<]{3,60}<\/a>\s*[;,]?\s*)+)\)/g, (whole, inner: string) => {
      const links = [...inner.matchAll(link)];
      return links.length && links.every(match => SITE.test(match[2].trim())) ? links.map(match => chip(match[1], match[2].trim())).join(' ') : whole;
    })
    .replace(link, (whole, attrs: string, text: string) => SITE.test(text.trim()) && !whole.includes('mn-source-chip') ? chip(attrs, text.trim()) : whole);
}
