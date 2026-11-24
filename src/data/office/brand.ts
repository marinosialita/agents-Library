// A firm's look for exported Office files (name, address, footer line, accent colour, logo) and the small XML and
// package helpers the Word, Excel and PowerPoint writers share. Pure functions: browser, Node and server alike.
import { buildZip } from '../../../shared/zip-writer.ts';

export type Brand = { name: string; address?: string; footer?: string; color?: string /* '#RRGGBB' accent */; logo?: { bytes: Uint8Array; type: 'png' | 'jpeg'; width: number; height: number } };
export type Logo = NonNullable<Brand['logo']>;

/** The accent without a brand colour: a calm dark blue that prints well in colour and in grey. */
// The product's lavender (10 Nov 2026): a file without a letterhead still carries the brand, not a navy.
export const DEFAULT_ACCENT = '7352E8';
/** The typeface of every file. Readers without it substitute: Word a sans (Calibri), PowerPoint and LibreOffice a
 *  sans by family; Apple's previews and Keynote a serif. Changing this one name changes all three formats. */
// Arial (7 Nov 2026): installed on every Windows, Mac and phone, so a file looks the same wherever it is opened; Inter,
// the app's own font, is missing on most computers and Mac previews swapped in a serif.
export const FONT = 'Arial';
export const FONT_PANOSE = '020B0604020202020204';
export const INK = '1F2328';
export const MUTED = '6B7280';
export const LINE = 'D0D5DD';
export const EMU_PER_CM = 360000;
export const EMU_PER_INCH = 914400;

/** The text without what XML 1.0 forbids: control characters, lone surrogates, U+FFFE and U+FFFF. */
export const xmlSafe = (value: string) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
/** Text or attribute value escaped for XML. */
export const xml = (value: string) => xmlSafe(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** «#RRGGBB», «RRGGBB» or «#RGB» as upper-case RRGGBB; anything else gives the fallback. */
export function hexColor(value: string | undefined, fallback = DEFAULT_ACCENT): string {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const hex = match[1].length === 3 ? match[1].split('').map(char => char + char).join('') : match[1];
  return hex.toUpperCase();
}
export const accentOf = (brand?: Brand) => hexColor(brand?.color);

const channels = (hex: string) => [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16));
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);
/** Two colours blended: amount 0 is the first, 1 the second. */
export function mix(hex: string, other: string, amount: number): string {
  const a = channels(hex); const b = channels(other);
  return a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** Text colour on an accent fill: white, or near-black when the accent is light. */
export const onAccent = (hex: string) => (contrastWithWhite(hex) >= 3 ? 'FFFFFF' : '1A1A1A');
/** The accent, darkened until it reads as text on white (contrast at least 4.5:1). */
export function inkAccent(hex: string): string {
  let out = hex;
  for (let step = 0; step < 12 && contrastWithWhite(out) < 4.5; step++) out = mix(out, '000000', 0.15);
  return out;
}

/** The brand's logo when its bytes really are a PNG or JPEG of a known size; the bytes decide the type. */
export function usableLogo(brand?: Brand): Logo | undefined {
  const logo = brand?.logo;
  if (!logo || !(logo.bytes instanceof Uint8Array) || !(logo.width > 0) || !(logo.height > 0) || !Number.isFinite(logo.width) || !Number.isFinite(logo.height)) return undefined;
  const b = logo.bytes;
  const png = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (png) return { ...logo, type: 'png' };
  if (jpeg) return { ...logo, type: 'jpeg' };
  return undefined;
}
/** The logo's size in EMU inside a box, keeping its aspect ratio. */
export function fitLogo(logo: Logo, maxWidth: number, maxHeight: number): { cx: number; cy: number } {
  const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
  return { cx: Math.max(1, Math.round(logo.width * scale)), cy: Math.max(1, Math.round(logo.height * scale)) };
}
export const logoFile = (logo: Logo) => (logo.type === 'png' ? 'logo.png' : 'logo.jpeg');

/** An http(s) or mailto address fit for a relationship target (spaces and non-ASCII percent-encoded), or null. */
export function safeUrl(url: string): string | null {
  const value = xmlSafe(url).trim();
  if (!/^(?:https?:\/\/[^\s/?#]+|mailto:\S+)/i.test(value)) return null;
  const encoded = value.replace(/[^\x21-\x7e]|["<>\\^`{|}]/gu, char => encodeURIComponent(char));
  return encoded.length <= 2000 ? encoded : null;
}

/** A usable date: the given one, or now. */
export const dateOr = (date?: Date) => (date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date());
/** W3C date-time without milliseconds, as Office writes it. */
export const isoDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** «7 November 2026». */
export const longDate = (date: Date) => `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

// Package parts every Office file carries.
export const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const REL = {
  officeDocument: `${NS_REL}/officeDocument`, core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: `${NS_REL}/extended-properties`, hyperlink: `${NS_REL}/hyperlink`, image: `${NS_REL}/image`, styles: `${NS_REL}/styles`, theme: `${NS_REL}/theme`,
  settings: `${NS_REL}/settings`, fontTable: `${NS_REL}/fontTable`, numbering: `${NS_REL}/numbering`, header: `${NS_REL}/header`, footer: `${NS_REL}/footer`, comments: `${NS_REL}/comments`,
};
export type Rel = { id: string; type: string; target: string; external?: boolean };
export const relsXml = (rels: Rel[]) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(rel => `<Relationship Id="${xml(rel.id)}" Type="${rel.type}" Target="${xml(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
/** The package's root relationships: the main part and the two property parts. */
export const rootRels = (main: string) => relsXml([{ id: 'rId1', type: REL.officeDocument, target: main }, { id: 'rId2', type: REL.core, target: 'docProps/core.xml' }, { id: 'rId3', type: REL.app, target: 'docProps/app.xml' }]);
/** [Content_Types].xml: defaults for rels, xml and images, an override for every other part. */
export function contentTypesXml(overrides: [string, string][]): string {
  const defaults = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/>';
  const all: [string, string][] = [['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'], ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'], ...overrides];
  return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${all.map(([part, type]) => `<Override PartName="${xml(part)}" ContentType="${type}"/>`).join('')}</Types>`;
}
export function corePropsXml(title: string, creator: string, date: Date): string {
  const when = isoDate(date);
  return `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>${xml(creator)}</dc:creator><cp:lastModifiedBy>${xml(creator)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`;
}
export const appPropsXml = (company?: string) => `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${company ? `<Company>${xml(company)}</Company>` : ''}<Application>Agents</Application></Properties>`;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** Packs Office parts in order ([Content_Types].xml first): strings are XML and get the declaration, bytes go as they are. */
export function officeZip(parts: [string, string | Uint8Array][], date: Date): Uint8Array {
  const encoder = new TextEncoder();
  return buildZip(parts.map(([name, data]) => ({ name, data: typeof data === 'string' ? encoder.encode(XML_HEAD + data) : data })), date);
}
