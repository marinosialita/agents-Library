// Official sources by jurisdiction. Every place the platform researches live has its official websites —
// legislation, gazette, courts, parliament, regulators, government — and a live search for that place reads only
// those websites. A member state's search also reads the EU's own sources; a region's, its country's.
import { OFFICIAL_SOURCE_PLACES } from './official-sources-catalogue.ts';

export type SourceKind = 'legislation' | 'gazette' | 'courts' | 'parliament' | 'regulator' | 'government' | 'other';
export type SourceRegion = 'eu' | 'europe' | 'americas' | 'middle-east' | 'asia' | 'africa' | 'oceania' | 'international';
export type OfficialSource = { name: string; url: string; kind: SourceKind };
export type SourcePlace = {
  code: string; name: string; local?: string; flag: string; region: SourceRegion;
  /** A region or state inside a country: its country's sources are searched too. */
  parent?: string;
  /** An EU member state (or a region of one): the EU's own sources are searched too. */
  eu?: boolean;
  sources: OfficialSource[];
};

export { OFFICIAL_SOURCE_PLACES };
const BY_CODE = new Map(OFFICIAL_SOURCE_PLACES.map(place => [place.code, place]));
export const sourcePlace = (code: unknown): SourcePlace | undefined => typeof code === 'string' ? BY_CODE.get(code) : undefined;
export const isSourcePlaceCode = (code: unknown): code is string => typeof code === 'string' && BY_CODE.has(code);
/** Every catalogue place with at least one official website can be chosen for an agent; a place without sources is
 *  listed as unsupported and never searched. */
export const isSearchablePlace = (code: unknown): code is string => isSourcePlaceCode(code) && (sourcePlace(code)?.sources.length ?? 0) > 0;

/** A website's host as a search filter takes it: lower case, no «www.». */
export function sourceHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}
/** The host of a web page that may be opened as official: http or https only, no credentials, the default port. */
export function webPageHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port && !['80', '443'].includes(parsed.port)) return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
}
/** Hosts a live search for this place may read, its own first, then its country's, then the EU's. At most `limit`. */
export function placeDomains(code: string, limit = 100): string[] {
  const place = sourcePlace(code); if (!place) return [];
  const chain = [place, ...(place.parent ? [sourcePlace(place.parent)!] : []), ...(place.eu && place.code !== 'eu' ? [sourcePlace('eu')!] : [])].filter(Boolean);
  const hosts: string[] = [];
  for (const item of chain) for (const source of item.sources) {
    const host = sourceHost(source.url);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts.slice(0, limit);
}
/** Every source a live search for this place may read, with the place it belongs to. */
export function placeSourceList(code: string): (OfficialSource & { place: string })[] {
  const place = sourcePlace(code); if (!place) return [];
  const chain = [place, ...(place.parent ? [sourcePlace(place.parent)!] : []), ...(place.eu && place.code !== 'eu' ? [sourcePlace('eu')!] : [])].filter(Boolean);
  return chain.flatMap(item => item.sources.map(source => ({ ...source, place: item.name })));
}
/** Whether a page belongs to one of the place's sources (its host or a subdomain of one). */
export function isOfficialUrl(code: string, url: string): boolean {
  const host = webPageHost(url); if (!host) return false;
  return placeDomains(code).some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}
/** Whether a page belongs to any official source in the catalogue (any place): what the official-page routes will open. */
let catalogueHosts: Set<string> | null = null;
export function isCatalogueUrl(value: string): boolean {
  const host = webPageHost(value); if (!host) return false;
  catalogueHosts ??= new Set(OFFICIAL_SOURCE_PLACES.flatMap(place => place.sources.map(source => sourceHost(source.url)).filter((item): item is string => !!item)));
  for (let at: string | undefined = host; at; at = at.includes('.') ? at.slice(at.indexOf('.') + 1) : undefined) if (catalogueHosts.has(at)) return true;
  return false;
}
// Greek names for the places Intl cannot name: the EU, the international bodies, and every state and region inside a country.
const GREEK_NAMES: Record<string, string> = {
  eu: 'Ευρωπαϊκή Ένωση', hk: 'Χονγκ Κονγκ', int: 'Διεθνείς οργανισμοί', cy: 'Κύπρος', ew: 'Αγγλία & Ουαλία',
  'gb-sct': 'Σκωτία', 'gb-nir': 'Βόρεια Ιρλανδία', 'ca-qc': 'Κεμπέκ',
  'be-bru': 'Περιφέρεια Βρυξελλών-Πρωτεύουσας', 'be-vlg': 'Φλαμανδική Περιφέρεια', 'be-wal': 'Περιφέρεια Βαλλονίας',
  'de-bw': 'Βάδη-Βυρτεμβέργη', 'de-by': 'Βαυαρία', 'de-be': 'Βερολίνο', 'de-bb': 'Βρανδεμβούργο', 'de-hb': 'Βρέμη', 'de-hh': 'Αμβούργο',
  'de-he': 'Έσση', 'de-ni': 'Κάτω Σαξονία', 'de-mv': 'Μεκλεμβούργο-Πομερανία', 'de-nw': 'Βόρεια Ρηνανία-Βεστφαλία',
  'de-rp': 'Ρηνανία-Παλατινάτο', 'de-sl': 'Σάαρλαντ', 'de-sn': 'Σαξονία', 'de-st': 'Σαξονία-Άνχαλτ', 'de-sh': 'Σλέσβιχ-Χολστάιν', 'de-th': 'Θουριγγία',
  'us-al': 'Αλαμπάμα', 'us-ak': 'Αλάσκα', 'us-az': 'Αριζόνα', 'us-ar': 'Αρκάνσας', 'us-ca': 'Καλιφόρνια', 'us-co': 'Κολοράντο',
  'us-ct': 'Κονέκτικατ', 'us-de': 'Ντέλαγουερ', 'us-dc': 'Περιφέρεια της Κολούμπια', 'us-fl': 'Φλόριντα', 'us-ga': 'Τζόρτζια',
  'us-hi': 'Χαβάη', 'us-id': 'Αϊντάχο', 'us-il': 'Ιλινόι', 'us-in': 'Ιντιάνα', 'us-ia': 'Αϊόβα', 'us-ks': 'Κάνσας', 'us-ky': 'Κεντάκι',
  'us-la': 'Λουιζιάνα', 'us-me': 'Μέιν', 'us-md': 'Μέριλαντ', 'us-ma': 'Μασαχουσέτη', 'us-mi': 'Μίσιγκαν', 'us-mn': 'Μινεσότα',
  'us-ms': 'Μισισίπι', 'us-mo': 'Μιζούρι', 'us-mt': 'Μοντάνα', 'us-ne': 'Νεμπράσκα', 'us-nv': 'Νεβάδα', 'us-nh': 'Νιου Χάμσαϊρ',
  'us-nj': 'Νιου Τζέρσεϊ', 'us-nm': 'Νέο Μεξικό', 'us-ny': 'Νέα Υόρκη', 'us-nc': 'Βόρεια Καρολίνα', 'us-nd': 'Βόρεια Ντακότα',
  'us-oh': 'Οχάιο', 'us-ok': 'Οκλαχόμα', 'us-or': 'Όρεγκον', 'us-pa': 'Πενσυλβάνια', 'us-ri': 'Ρόουντ Άιλαντ', 'us-sc': 'Νότια Καρολίνα',
  'us-sd': 'Νότια Ντακότα', 'us-tn': 'Τενεσί', 'us-tx': 'Τέξας', 'us-ut': 'Γιούτα', 'us-vt': 'Βερμόντ', 'us-va': 'Βιρτζίνια',
  'us-wa': 'Ουάσιγκτον', 'us-wv': 'Δυτική Βιρτζίνια', 'us-wi': 'Ουισκόνσιν', 'us-wy': 'Ουαϊόμινγκ',
};
let greekRegions: Intl.DisplayNames | null | undefined;
/** The place's name in Greek: Intl for countries, the list above for the rest, the English name when neither has one. */
export function greekPlaceName(place: SourcePlace): string {
  if (GREEK_NAMES[place.code]) return GREEK_NAMES[place.code];
  if (/^[a-z]{2}$/.test(place.code)) {
    if (greekRegions === undefined) { try { greekRegions = new Intl.DisplayNames(['el'], { type: 'region' }); } catch { greekRegions = null; } }
    const name = greekRegions?.of(place.code.toUpperCase());
    if (name && name.toUpperCase() !== place.code.toUpperCase()) return name;
  }
  return place.name;
}
/** The place's name in the reader's language. */
export const placeName = (place: SourcePlace, english: boolean) => english ? place.name : greekPlaceName(place);
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/ς/g, 'σ');
/** Places matching a search, by name, local name or code. */
export function findSourcePlaces(query: string): SourcePlace[] {
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return [...OFFICIAL_SOURCE_PLACES];
  return OFFICIAL_SOURCE_PLACES.filter(place => {
    const parent = place.parent ? sourcePlace(place.parent) : undefined;
    const text = fold(`${place.name} ${greekPlaceName(place)} ${place.local ?? ''} ${place.code} ${parent ? `${parent.name} ${greekPlaceName(parent)}` : ''}`);
    return words.every(word => text.includes(word));
  });
}
