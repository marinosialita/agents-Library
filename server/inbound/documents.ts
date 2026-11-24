// «Send work from anywhere» (7 Nov 2026): the text of the files a user e-mails or sends by WhatsApp, read on the
// server. Text, Markdown and CSV as they are; Word (.docx) from word/document.xml through a small zip reader (stored
// or deflated entries, node:zlib); PDF through pdf.js (the legacy build runs on Node 22) up to a page cap. Photos
// (JPEG, PNG, WebP) are kept as bytes for the model to look at. Anything else is skipped with a note for the reply.
// The limits are the run request's (shared/agents.ts AGENT_LIMITS): ten documents, 400,000 characters in all.
import { inflateRawSync } from 'node:zlib';
import { AGENT_LIMITS } from '../../shared/agents.ts';

export type InboundAttachment = { name: string; type: string; bytes: Uint8Array };
export type InboundImage = { name: string; type: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Uint8Array };
export type ReadAttachments = { documents: { name: string; text: string }[]; images: InboundImage[]; notes: string[] };

export const DOCUMENT_LIMITS = {
  /** One file, before it is read. */
  fileBytes: 15_000_000,
  /** Pages of one PDF that are read. */
  pdfPages: 300,
  /** What a .docx part may inflate to: a zip bomb stops here. */
  inflatedBytes: 60_000_000,
  images: 4, imageBytes: 8_000_000,
} as const;

type Kind = 'text' | 'docx' | 'pdf' | 'image' | 'old-word' | null;
/** The kind by file name first, then by the type the channel gave, then by the first bytes (WhatsApp photos have no name). */
export function attachmentKind(file: Pick<InboundAttachment, 'name' | 'type' | 'bytes'>): Kind {
  const name = file.name.toLowerCase(); const type = file.type.toLowerCase().split(';')[0].trim();
  if (/\.(txt|md|markdown|csv)$/.test(name)) return 'text';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.pdf')) return 'pdf';
  if (/\.(jpe?g|png|webp)$/.test(name)) return 'image';
  if (name.endsWith('.doc')) return 'old-word';
  if (['text/plain', 'text/markdown', 'text/csv', 'text/x-markdown'].includes(type)) return 'text';
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (type === 'application/pdf') return 'pdf';
  if (['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(type)) return 'image';
  if (type === 'application/msword') return 'old-word';
  return imageType(file.bytes) ? 'image' : null;
}
/** The photo's real type by its signature; the declared one is not trusted. */
export function imageType(bytes: Uint8Array): InboundImage['type'] | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const tidy = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[ \t ]+\n/g, '\n').replace(/[ \t ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** Text files: UTF-8 (with or without its mark), UTF-16 by its mark, otherwise Windows-1252, as old exports are. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

/** One entry of a zip archive (a .docx is one), by its central directory: stored or deflated, never zip64. */
export function zipEntry(bytes: Uint8Array, wanted: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extra + comment;
    if (name !== wanted) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return null;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > bytes.length) return null;
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) return data;
    if (method !== 8) return null;
    return new Uint8Array(inflateRawSync(data, { maxOutputLength: DOCUMENT_LIMITS.inflatedBytes }));
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (value: string) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
  if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
  const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  try { return String.fromCodePoint(code); } catch { return ''; }
});
/** The paragraphs of word/document.xml as lines: text runs, tabs and breaks; paragraph and run properties (where tab
 *  stops live) and deleted text are not the text. */
export function docxXmlText(xml: string): string {
  const body = xml.replace(/<w:pPr(?:\s[^>]*)?(?<!\/)>[\s\S]*?<\/w:pPr>/g, '').replace(/<w:rPr(?:\s[^>]*)?(?<!\/)>[\s\S]*?<\/w:rPr>/g, '');
  const paragraphs: string[] = []; let line = '';
  for (const token of body.matchAll(/<\/w:p>|<w:p(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/g)) {
    const tag = token[0];
    if (tag === '</w:p>' || /^<w:p[\s/]/.test(tag)) { paragraphs.push(line); line = ''; }
    else if (tag.startsWith('<w:tab')) line += '\t';
    else if (tag.startsWith('<w:br') || tag.startsWith('<w:cr')) line += '\n';
    else line += unescapeXml(token[1] ?? '');
  }
  if (line) paragraphs.push(line);
  return paragraphs.join('\n');
}

export function docxText(bytes: Uint8Array): string {
  const part = zipEntry(bytes, 'word/document.xml');
  if (!part) throw new Error('unreadable_docx');
  return docxXmlText(new TextDecoder().decode(part));
}

/** A PDF's text layer, page by page («[p. 3]» as the app's own reader marks it), up to the page and character caps. */
export async function pdfText(bytes: Uint8Array, limit: number): Promise<{ text: string; pages: number; read: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js may take over the buffer it is given: it gets a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const document = await task.promise;
    const parts: string[] = []; let length = 0; let read = 0;
    for (let number = 1; number <= Math.min(document.numPages, DOCUMENT_LIMITS.pdfPages) && length < limit; number++) {
      const page = await document.getPage(number);
      try {
        const content = await page.getTextContent();
        let line = ''; const lines: string[] = [];
        for (const item of content.items) {
          if (!('str' in item)) continue;
          if (line && item.str && !/\s$/.test(line) && !/^[\s,.;:·)\]»%]/.test(item.str)) line += ' ';
          line += item.str;
          if (item.hasEOL) { lines.push(line); line = ''; }
        }
        if (line) lines.push(line);
        read = number;
        const text = lines.join('\n').trim();
        if (!text) continue;
        const block = `[p. ${number}]\n${text}`;
        parts.push(block); length += block.length;
      } finally { page.cleanup(); }
    }
    return { text: parts.join('\n\n'), pages: document.numPages, read };
  } finally { await task.destroy().catch(() => undefined); }
}

/** Text out of an old binary Word file (.doc, Word 97–2003), without a Word library (12 Nov 2026: his court and
 *  timesheet files arrive as .doc). The text sits in the file as runs of UTF-16 (Greek, accents) or of single-byte
 *  characters; the longest readable runs are kept, in order, and the shorter decoding loses. Formatting is lost, the
 *  words are kept; a few stray fragments of the file's own tables may slip in. */
export function oldWordText(bytes: Uint8Array): string {
  // Letters of the scripts a document is likely written in, and ordinary punctuation; not the filler bytes (ÿ, control
  // marks) the file's own structures are full of.
  const letter = (code: number) => (code >= 0x20 && code < 0x7f) || code === 0xa0 || code === 0xa7 || code === 0xab || code === 0xb0 || code === 0xbb
    || (code >= 0xc0 && code <= 0xfe && code !== 0xd7 && code !== 0xf7) || (code >= 0x0370 && code <= 0x03ff) || (code >= 0x0400 && code <= 0x04ff) || (code >= 0x2010 && code <= 0x2027) || code === 0x20ac;
  // A run made mostly of one character (ÿÿÿ…, ————) is padding, not text.
  const real = (run: number[]) => { const count = new Map<number, number>(); for (const code of run) count.set(code, (count.get(code) ?? 0) + 1); return Math.max(...count.values()) <= run.length * 0.4; };
  const runs = (codes: number[], min: number) => {
    const out: string[] = []; let run: number[] = [];
    const flush = () => { if (run.length >= min && real(run)) { const text = String.fromCharCode(...run).trim(); if (/[\p{L}]{3}/u.test(text)) out.push(text); } run = []; };
    for (const code of codes) { if (letter(code) || code === 0x0d || code === 0x09) run.push(code === 0x0d ? 0x0a : code); else flush(); }
    flush(); return out;
  };
  // UTF-16 text may start on an odd byte: both alignments are read and the richer kept.
  const wideAt = (start: number) => { const codes: number[] = []; for (let at = start; at + 1 < bytes.length; at += 2) codes.push(bytes[at] | (bytes[at + 1] << 8)); return runs(codes, 6).join('\n'); };
  const narrow = new TextDecoder('windows-1252').decode(bytes); const narrowCodes: number[] = []; for (const char of narrow) narrowCodes.push(char.charCodeAt(0));
  const size = (text: string) => text.replace(/\s/g, '').length;
  return tidy([wideAt(0), wideAt(1), runs(narrowCodes, 12).join('\n')].reduce((best, next) => size(next) > size(best) ? next : best));
}

/** One file's text for an agent that opened an e-mail attachment: PDF, Word (.docx and old .doc), text. */
export async function readOneFile(file: InboundAttachment, limit: number, transcribe?: (file: InboundAttachment) => Promise<string>): Promise<{ text: string; note: string }> {
  const kind = attachmentKind(file);
  if (file.bytes.length > DOCUMENT_LIMITS.fileBytes) return { text: '', note: `files are read up to ${DOCUMENT_LIMITS.fileBytes / 1_000_000} MB` };
  try {
    if (kind === 'text') return { text: tidy(decodeText(file.bytes)).slice(0, limit), note: '' };
    if (kind === 'docx') return { text: tidy(docxText(file.bytes)).slice(0, limit), note: '' };
    if (kind === 'old-word') return { text: oldWordText(file.bytes).slice(0, limit), note: 'an old Word (.doc) file: its words were read, not its formatting' };
    if (kind === 'pdf') {
      const pdf = await pdfText(file.bytes, limit); const text = tidy(pdf.text);
      // A scan has no text layer: the model reads the page images (12 Nov 2026: his court indictment was a scan).
      if (text.length < 40 && transcribe) { const read = tidy(await transcribe(file).catch(() => '')); return read ? { text: read.slice(0, limit), note: 'a scanned PDF: its text was read from the page images and may contain reading errors' } : { text: '', note: 'a scanned PDF that could not be read' }; }
      return { text, note: !text ? 'no text layer (a scan?)' : pdf.read < pdf.pages ? `${pdf.read} of ${pdf.pages} pages read` : '' };
    }
    if (kind === 'image') return { text: '', note: 'a picture: it cannot be read as text' };
  } catch { return { text: '', note: 'it could not be read (damaged or password-protected?)' }; }
  return { text: '', note: 'only PDF, Word and text files are read' };
}

const shortName = (name: string) => (name.trim() || 'file').replace(/[\u0000-\u001f]/g, '').slice(0, 200);

/** Every attachment read or set aside, in the order received, within the run request's limits. */
export async function readAttachments(files: InboundAttachment[]): Promise<ReadAttachments> {
  const documents: { name: string; text: string }[] = []; const images: InboundImage[] = []; const notes: string[] = [];
  let left: number = AGENT_LIMITS.documentChars;
  for (const file of files) {
    const name = shortName(file.name);
    const kind = attachmentKind(file);
    if (kind === 'image') {
      const type = imageType(file.bytes);
      if (!type) { notes.push(`«${name}» was skipped: it is not a JPEG, PNG or WebP photo.`); continue; }
      if (file.bytes.length > DOCUMENT_LIMITS.imageBytes) { notes.push(`«${name}» was skipped: photos are read up to ${DOCUMENT_LIMITS.imageBytes / 1_000_000} MB.`); continue; }
      if (images.length >= DOCUMENT_LIMITS.images) { notes.push(`«${name}» was skipped: at most ${DOCUMENT_LIMITS.images} photos are read at a time.`); continue; }
      images.push({ name, type, bytes: file.bytes }); continue;
    }
    if (kind === 'old-word') { notes.push(`«${name}» was skipped: save it as .docx (or PDF) and send it again.`); continue; }
    if (!kind) { notes.push(`«${name}» was skipped: only PDF, Word (.docx), text, Markdown and CSV files and JPEG, PNG or WebP photos are read.`); continue; }
    if (file.bytes.length > DOCUMENT_LIMITS.fileBytes) { notes.push(`«${name}» was skipped: files are read up to ${DOCUMENT_LIMITS.fileBytes / 1_000_000} MB.`); continue; }
    if (documents.length >= AGENT_LIMITS.documents) { notes.push(`«${name}» was skipped: at most ${AGENT_LIMITS.documents} documents are read at a time.`); continue; }
    if (left <= 0) { notes.push(`«${name}» was skipped: the documents before it already fill the ${AGENT_LIMITS.documentChars.toLocaleString('en')} characters an agent reads.`); continue; }
    let text = '';
    try {
      if (kind === 'text') text = tidy(decodeText(file.bytes));
      else if (kind === 'docx') text = tidy(docxText(file.bytes));
      else {
        const pdf = await pdfText(file.bytes, left);
        text = tidy(pdf.text);
        if (text && pdf.read < pdf.pages) notes.push(`«${name}»: ${pdf.read} of its ${pdf.pages} pages were read.`);
        if (!text) { notes.push(`«${name}» has no text layer (a scan?): send a copy with text (OCR) or a Word file.`); continue; }
      }
    } catch { notes.push(`«${name}» could not be read${kind === 'pdf' ? ' (damaged or password-protected?)' : kind === 'docx' ? ' (damaged? save it again as .docx)' : ''}.`); continue; }
    if (!text) { notes.push(`«${name}» is empty.`); continue; }
    if (text.length > left) { notes.push(`«${name}» was cut to fit the ${AGENT_LIMITS.documentChars.toLocaleString('en')} characters an agent reads.`); text = text.slice(0, left); }
    documents.push({ name, text }); left -= text.length;
  }
  return { documents, images, notes };
}
