// Builds shared/official-sources-catalogue.ts: for every place Nomos can research live, its official websites
// (legislation, gazette, courts, parliament, regulators, government). Inputs in data/official-sources/:
//   collected.json  name → [{ name, url, desc }]  the public official websites, by place, as collected on 4–5 Nov 2026
//   places.json     name → { code, flag, region, parent?, eu?, local?, short? }
//   additions.json  name → { place, sources }      places added by hand (Europe's micro-states and the Balkans)
//   extra-sources.json code → [{ name, url, kind }] more official websites for a place already listed
// Only each body's name, its URL and a kind travel into the app; descriptions are used here to choose the kind.
// Run: node scripts/build-official-sources.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL(`../data/official-sources/${name}`, import.meta.url), 'utf8'));
const collected = read('collected.json'); const places = read('places.json'); const additions = read('additions.json');
const extra = read('extra-sources.json');

const STATES = { Alabama: 'al', Alaska: 'ak', Arizona: 'az', Arkansas: 'ar', California: 'ca', Colorado: 'co', Connecticut: 'ct', Delaware: 'de',
  Florida: 'fl', Georgia: 'ga', Hawaii: 'hi', Idaho: 'id', Illinois: 'il', Indiana: 'in', Iowa: 'ia', Kansas: 'ks', Louisiana: 'la', Maine: 'me',
  Maryland: 'md', Michigan: 'mi', Minnesota: 'mn', Mississippi: 'ms', Missouri: 'mo', Montana: 'mt', Nebraska: 'ne', Nevada: 'nv',
  'New Hampshire': 'nh', 'New Jersey': 'nj', 'New Mexico': 'nm', 'New York': 'ny', 'North Carolina': 'nc', 'North Dakota': 'nd', Ohio: 'oh',
  Oklahoma: 'ok', Oregon: 'or', 'Rhode Island': 'ri', 'South Carolina': 'sc', 'South Dakota': 'sd', Tennessee: 'tn', Texas: 'tx', Utah: 'ut',
  Vermont: 'vt', Washington: 'wa', 'West Virginia': 'wv', Wisconsin: 'wi', Wyoming: 'wy' };
const placeOf = name => {
  if (places[name]) return places[name];
  const state = /^State of (.+)$/.exec(name)?.[1];
  if (state && STATES[state]) return { code: `us-${STATES[state]}`, flag: '🇺🇸', region: 'americas', parent: 'us', short: state };
  throw new Error(`No place for «${name}»: add it to data/official-sources/places.json`);
};

/** The kind of body, from its name and description: what a lawyer looks for first. */
function kindOf(name, desc) {
  const text = `${name} ${desc || ''}`.toLowerCase();
  if (/gazette|journal officiel|boletín oficial|boletin oficial|bollettino|gazzetta|staatsblad|moniteur|amtsblatt|bundesgesetzblatt|bgbl|φεκ|τυπογραφείο|diário|diario oficial|monitorul|narodne novine|dziennik ustaw|sbírka|lovtidend|official journal|state gazette|държавен вестник|ελληνικ.*εφημερ/.test(text)) return 'gazette';
  if (/court|tribunal|cassation|gerichtshof|gericht|cour |corte|tribunale|ἄρειος|άρειος|συμβούλιο της επικρατείας|raad van state|conseil d'état|case law|caselaw|jurisprud|judgment|rechtspraak|högsta domstolen|domstol|sąd|soud|sud |sodišče|kúria|legfelsőbb|consiglio di stato|bundesverfassungs|verfassungsgerichtshof|curia|privy council|jcpc/.test(text)) return 'courts';
  if (/parliament|parlament|bundestag|bundesrat|assembl|congress|senate|senat|chamber of|chambre|kamer|cortes|βουλή|riksdag|folketing|storting|eduskunta|sejm|sabor|knesset|seimas|saeima|riigikogu|national council|nationalrat|landtag|camera dei|legislature|house of/.test(text)) return 'parliament';
  if (/legislation|legislat|laws? |statute|codex|code |légifrance|legifrance|normattiva|boe |rechtsinformationssystem|\bris\b|eur-lex|lex\b|zakon|pravo|lovdata|finlex|retsinformation|wetten|gesetze|portal jur|legal (information|portal|database)|consolidated/.test(text)) return 'legislation';
  if (/authority|autorit|commission|commissie|kommission|regulat|supervis|aufsicht|inspector|inspectorate|ombuds|bank|banque|banca|banco|data protection|datenschutz|competition|wettbewerb|financial|finanz|securities|cyber|telecom|energy|consumer|agency|agence|agentur|office|amt |behörde|επιτροπή|αρχή/.test(text)) return 'regulator';
  if (/ministr|minist|department|government|gouvernement|regierung|bundesministerium|federal public service|fod |spf |portal|cabinet|presiden|chancell|υπουργείο/.test(text)) return 'government';
  return 'other';
}

const out = [];
const seen = new Set();
const add = (name, place, sources) => {
  if (seen.has(place.code)) throw new Error(`Duplicate place code ${place.code}`);
  seen.add(place.code);
  const unique = []; const hosts = new Set();
  for (const source of sources) {
    let url; try { url = new URL(source.url.trim()); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    const key = url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '');
    if (hosts.has(key)) continue; hosts.add(key);
    unique.push({ name: source.name.trim(), url: url.href.replace(/\/$/, ''), kind: source.kind || kindOf(source.name, source.desc) });
  }
  out.push({ code: place.code, name: place.short || name, ...(place.local && place.local !== name ? { local: place.local } : {}), flag: place.flag,
    region: place.region, ...(place.parent ? { parent: place.parent } : {}), ...(place.eu ? { eu: true } : {}), sources: unique });
};
for (const [name, sources] of Object.entries(collected)) add(name, placeOf(name), sources);
for (const [name, value] of Object.entries(additions)) add(name, value.place, value.sources);
// More official websites for a place already listed, by its code (extra-sources.json).
for (const [code, sources] of Object.entries(extra)) {
  if (code.startsWith('_')) continue;
  const place = out.find(item => item.code === code);
  if (!place) throw new Error(`extra-sources.json: no place ${code}`);
  const hosts = new Set(place.sources.map(source => new URL(source.url).hostname.replace(/^www\./, '') + new URL(source.url).pathname.replace(/\/$/, '')));
  for (const source of sources) {
    const url = new URL(source.url); const key = url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '');
    if (!hosts.has(key)) { hosts.add(key); place.sources.push({ name: source.name, url: url.href.replace(/\/$/, ''), kind: source.kind }); }
  }
}
for (const place of out) if (place.parent && !seen.has(place.parent)) throw new Error(`${place.code}: parent ${place.parent} missing`);
out.sort((a, b) => a.name.localeCompare(b.name, 'en'));

const body = `// Generated by scripts/build-official-sources.mjs from data/official-sources/. Do not edit by hand.
import type { SourcePlace } from './official-sources.ts';

export const OFFICIAL_SOURCE_PLACES: readonly SourcePlace[] = ${JSON.stringify(out, null, 1)};
`;
writeFileSync(new URL('../shared/official-sources-catalogue.ts', import.meta.url), body);
const total = out.reduce((n, place) => n + place.sources.length, 0);
console.log(`official sources: ${out.length} places, ${total} sources`);
