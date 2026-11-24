// Contract edits as Word tracked changes. An agent that proposes edits writes them after its answer in a ```redline
// block: a JSON array of { find, replace, note? } («replace: ""» deletes). parseEdits reads that block forgivingly
// (trailing commas, curly quotes, a cut-off end); redlineDocx lays the original text out as paragraphs and marks
// each edit as a Word revision (w:del / w:ins, word by word where the wording overlaps), its note as a real comment
// on the changed words. Edits whose text is not in the original come back in `missed`, never silently dropped.
import { type Brand, dateOr, isoDate, xml } from './brand.ts';
import { LinkRels, run, textXml, W_NS, wordPackage } from './docx.ts';

export type Edit = { find: string; replace: string; note?: string };

// Reading the edits.
const EOF = Symbol('end of text');
/** JSON, and what models write when they mean JSON: curly or single quotes, unquoted keys, trailing commas, a cut-off end. */
class LenientJson {
  private i = 0;
  constructor(private readonly s: string) {}
  private space() { while (this.i < this.s.length && /[\s﻿]/.test(this.s[this.i])) this.i++; }
  read(): unknown { this.space(); return this.value(); }
  private value(): unknown {
    this.space();
    if (this.i >= this.s.length) throw EOF;
    const c = this.s[this.i];
    if (c === '[') return this.array();
    if (c === '{') return this.object();
    if ('"\'“”‘’„'.includes(c)) return this.string();
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?=[\s,\]}]|$)/.exec(this.s.slice(this.i));
    if (literal) { this.i += literal[0].length; return JSON.parse(literal[0]); }
    const bare = /^[^,\]}\n]+/.exec(this.s.slice(this.i));
    if (bare) { this.i += bare[0].length; return bare[0].trim(); }
    throw new SyntaxError(`Unexpected «${c}»`);
  }
  private array(): unknown[] {
    this.i++;
    const out: unknown[] = [];
    for (;;) {
      this.space();
      if (this.i >= this.s.length) return out; // cut off: keep the complete items
      const c = this.s[this.i];
      if (c === ']') { this.i++; return out; }
      if (c === ',') { this.i++; continue; }
      const before = this.i;
      try { out.push(this.value()); }
      catch (error) {
        if (error === EOF) return out;
        // A broken item: skip to the next one.
        const next = this.s.indexOf('{', before + 1);
        if (next < 0) return out;
        this.i = next;
      }
    }
  }
  private object(): Record<string, unknown> {
    this.i++;
    const out: Record<string, unknown> = {};
    for (;;) {
      this.space();
      if (this.i >= this.s.length) throw EOF;
      const c = this.s[this.i];
      if (c === '}') { this.i++; return out; }
      if (c === ',') { this.i++; continue; }
      let key: string;
      if ('"\'“”‘’„'.includes(c)) key = this.string();
      else { const bare = /^[A-Za-z_$][\w$-]*/.exec(this.s.slice(this.i)); if (!bare) throw new SyntaxError('Bad key'); key = bare[0]; this.i += key.length; }
      this.space();
      if (this.s[this.i] !== ':' && this.s[this.i] !== '=') { if (this.i >= this.s.length) throw EOF; throw new SyntaxError('Expected «:»'); }
      this.i++;
      out[key] = this.value();
    }
  }
  /** A quoted string. A closing quote counts only when structure follows it, so «"the "Seller" shall"» survives. */
  private string(): string {
    const open = this.s[this.i];
    const closers = open === '“' || open === '”' || open === '„' ? '”“"' : open === '‘' || open === '’' ? '’\'' : open;
    this.i++;
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === '\\' && this.i + 1 < this.s.length) {
        const e = this.s[this.i + 1];
        if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(this.s.slice(this.i + 2, this.i + 6))) { out += String.fromCharCode(parseInt(this.s.slice(this.i + 2, this.i + 6), 16)); this.i += 6; continue; }
        out += ({ n: '\n', t: '\t', r: '', b: '', f: '' } as Record<string, string>)[e] ?? e;
        this.i += 2; continue;
      }
      if (closers.includes(c)) {
        let j = this.i + 1;
        while (j < this.s.length && /\s/.test(this.s[j])) j++;
        if (j >= this.s.length || ',:}]'.includes(this.s[j])) { this.i++; return out; }
      }
      out += c; this.i++;
    }
    throw EOF;
  }
}

function toEdit(item: unknown): Edit | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const { find, replace, note } = item as Record<string, unknown>;
  if (typeof find !== 'string' || typeof replace !== 'string') return null;
  const from = find.normalize('NFC').trim(); const to = replace.normalize('NFC').trim();
  if (!from || from === to) return null;
  const comment = typeof note === 'string' ? note.trim() : '';
  return comment ? { find: from, replace: to, note: comment } : { find: from, replace: to };
}
function readEdits(text: string): Edit[] {
  const start = text.search(/[[{]/);
  if (start < 0) return [];
  const source = text.slice(start).trim();
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { try { value = new LenientJson(source).read(); } catch { return []; } }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const edits = (value as Record<string, unknown>).edits;
    value = Array.isArray(edits) ? edits : [value];
  }
  return Array.isArray(value) ? value.map(toEdit).filter((edit): edit is Edit => !!edit) : [];
}

/** The edits of every ```redline block in an answer; a block cut off before its closing fence still counts. */
export function parseEdits(markdown: string): Edit[] {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const edits: Edit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s{0,3}(`{3,}|~{3,})\s*redline\b/i.exec(lines[i]);
    if (!open) continue;
    const close = new RegExp(`^\\s{0,3}${open[1][0] === '`' ? '`' : '~'}{${open[1].length},}\\s*$`);
    const body: string[] = [];
    for (i++; i < lines.length && !close.test(lines[i]); i++) body.push(lines[i]);
    edits.push(...readEdits(body.join('\n')));
  }
  return edits;
}

// Finding an edit's text.
const SINGLE_QUOTES = /[‘’‚‛′‵`´]/; const DOUBLE_QUOTES = /[“”„‟″«»]/; const DASHES = /[‐‑‒–—―−]/; const INVISIBLE = /[​-‍⁠­﻿]/;
/** Text folded for a tolerant match (one space for any whitespace, straight quotes, plain hyphens), with the original
 *  start and end of every folded character. */
function fold(source: string): { text: string; start: number[]; end: number[] } {
  let text = ''; const start: number[] = []; const end: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (INVISIBLE.test(c)) continue;
    if (/\s/.test(c)) {
      if (text.endsWith(' ')) end[end.length - 1] = i + 1; else { text += ' '; start.push(i); end.push(i + 1); }
      continue;
    }
    const folded = SINGLE_QUOTES.test(c) ? "'" : DOUBLE_QUOTES.test(c) ? '"' : DASHES.test(c) ? '-' : c === '…' ? '...' : c;
    for (const char of folded) { text += char; start.push(i); end.push(i + 1); }
  }
  return { text, start, end };
}
type Range = { start: number; end: number };
const overlaps = (a: Range, taken: Range[]) => taken.some(b => a.start < b.end && b.start < a.end);
const WORD = /[\p{L}\p{N}]/u;
/** Whether a match stands as whole words: «30 days» in «within 30 days», not in «130 days». */
const whole = (text: string, range: Range, find: string) => (!WORD.test(find[0]) || !WORD.test(text[range.start - 1] ?? '')) && (!WORD.test(find.at(-1)!) || !WORD.test(text[range.end] ?? ''));
/** The first place of `find` not inside an earlier edit: exact, then tolerant; whole words before word parts. */
function locate(full: string, folded: ReturnType<typeof fold>, find: string, taken: Range[]): Range | null {
  const needle = fold(find).text.trim();
  for (const wholeOnly of [true, false]) {
    for (let at = full.indexOf(find); at >= 0; at = full.indexOf(find, at + 1)) {
      const range = { start: at, end: at + find.length };
      if (!overlaps(range, taken) && (!wholeOnly || whole(full, range, find))) return range;
    }
    if (!needle) continue;
    for (let at = folded.text.indexOf(needle); at >= 0; at = folded.text.indexOf(needle, at + 1)) {
      const range = { start: folded.start[at], end: folded.end[at + needle.length - 1] };
      if (!overlaps(range, taken) && (!wholeOnly || whole(full, range, find))) return range;
    }
  }
  return null;
}

// Planning one change: only the words that differ are deleted and inserted.
type Change = Range & { delStart: number; delEnd: number; insertAt: number; insert: string; comment?: { id: number; note: string } };
const words = (text: string) => [...text.matchAll(/\S+/g)].map(match => ({ text: match[0], index: match.index! }));
function plan(full: string, range: Range, find: string, replace: string): Omit<Change, 'comment'> {
  const doc = words(full.slice(range.start, range.end)).map(word => ({ ...word, index: word.index + range.start }));
  const from = words(find); const to = words(replace);
  const whole = { ...range, delStart: range.start, delEnd: range.end, insertAt: range.end, insert: replace };
  if (doc.length !== from.length || !doc.length) return whole;
  let p = 0; while (p < from.length && p < to.length && from[p].text === to[p].text) p++;
  let s = 0; while (s < from.length - p && s < to.length - p && from[from.length - 1 - s].text === to[to.length - 1 - s].text) s++;
  const delFrom = p; const delTo = from.length - s; const insFrom = p; const insTo = to.length - s;
  const insert = insTo > insFrom ? replace.slice(to[insFrom].index, to[insTo - 1].index + to[insTo - 1].text.length) : '';
  const wordEnd = (k: number) => doc[k].index + doc[k].text.length;
  if (delTo > delFrom) {
    let delStart = doc[delFrom].index; let delEnd = wordEnd(delTo - 1);
    if (!insert) {
      // A deletion takes one neighbouring space with it, so no double space is left.
      if (delTo < doc.length) delEnd = doc[delTo].index;
      else if (delFrom > 0) delStart = wordEnd(delFrom - 1);
      else if (full[delEnd] === ' ' && (delStart === 0 || /\s/.test(full[delStart - 1]))) delEnd++;
      else if (full[delStart - 1] === ' ' && /[.,;:!?)]/.test(full[delEnd] ?? '')) delStart--;
    }
    return { ...range, start: Math.min(range.start, delStart), end: Math.max(range.end, delEnd), delStart, delEnd, insertAt: delEnd, insert };
  }
  if (!insert) return { ...range, delStart: range.end, delEnd: range.end, insertAt: range.end, insert: '' };
  if (delFrom < doc.length) return { ...range, delStart: doc[delFrom].index, delEnd: doc[delFrom].index, insertAt: doc[delFrom].index, insert: `${insert} ` };
  const at = wordEnd(doc.length - 1);
  return { ...range, delStart: at, delEnd: at, insertAt: at, insert: ` ${insert}` };
}

/** The original as tracked changes. Paragraphs are the original's lines (blank lines dropped). */
export function redlineDocx(input: { title: string; original: string; edits: Edit[]; author?: string; date?: Date; brand?: Brand }): { bytes: Uint8Array; applied: number; missed: Edit[] } {
  const date = dateOr(input.date); const when = isoDate(date);
  const author = String(input.author ?? '').trim() || 'Agents';
  const title = String(input.title ?? '').trim() || 'Redline';
  const paragraphs = String(input.original ?? '').normalize('NFC').replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/\s+$/, '')).filter(line => line.trim());
  const full = paragraphs.join('\n');
  const folded = fold(full);
  const taken: Range[] = []; const changes: Change[] = []; const missed: Edit[] = [];
  let ids = 0; let applied = 0;
  for (const raw of input.edits ?? []) {
    const edit = toEdit(raw);
    if (!edit) { if (raw) missed.push(raw); continue; }
    const range = locate(full, folded, edit.find, taken);
    if (!range) { missed.push(raw); continue; }
    const change: Change = plan(full, range, edit.find, edit.replace);
    taken.push({ start: change.start, end: change.end });
    applied++;
    if (change.delStart === change.delEnd && !change.insert) continue; // already reads that way
    if (edit.note) change.comment = { id: ++ids, note: edit.note };
    changes.push(change);
  }
  const revision = () => `w:id="${++ids}" w:author="${xml(author)}" w:date="${when}"`;
  const commentEnd = (id: number) => `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;
  const insXml = (text: string) => `<w:ins ${revision()}><w:r>${textXml(text)}</w:r></w:ins>`;
  const body: string[] = [];
  let offset = 0;
  paragraphs.forEach((text, index) => {
    const pStart = offset; const pEnd = offset + text.length; offset = pEnd + 1;
    const inside = (pos: number) => pos >= pStart && pos <= pEnd;
    // Events at a position: insertions and comment ends of changes ending there, then starts of the next.
    const events: { pos: number; rank: number; xml?: string; insert?: string }[] = [];
    for (const change of changes) {
      if (change.comment && inside(change.start)) events.push({ pos: change.start, rank: 2, xml: `<w:commentRangeStart w:id="${change.comment.id}"/>` });
      if (change.insert && inside(change.insertAt)) events.push({ pos: change.insertAt, rank: change.insertAt === change.start ? 3 : 0, insert: change.insert });
      if (change.comment && inside(change.end)) events.push({ pos: change.end, rank: 1, xml: commentEnd(change.comment.id) });
    }
    const cuts = new Set<number>([pStart, pEnd, ...events.map(event => event.pos)]);
    for (const change of changes) for (const pos of [change.delStart, change.delEnd]) if (pos > pStart && pos < pEnd) cuts.add(pos);
    const sorted = [...cuts].sort((a, b) => a - b);
    const out: string[] = [];
    const emit = (pos: number) => {
      // Insertions are written here, in document order, so revision ids rise through the document.
      for (const event of events.filter(item => item.pos === pos).sort((a, b) => a.rank - b.rank)) out.push(event.xml ?? insXml(event.insert ?? ''));
    };
    for (let k = 0; k < sorted.length; k++) {
      const a = sorted[k];
      emit(a);
      const b = sorted[k + 1];
      if (b === undefined || b <= a) continue;
      const piece = full.slice(a, b);
      const deleted = changes.some(change => change.delStart <= a && b <= change.delEnd);
      out.push(deleted ? `<w:del ${revision()}><w:r>${textXml(piece, 'w:delText')}</w:r></w:del>` : `<w:r>${textXml(piece)}</w:r>`);
    }
    // A deletion running on into the next paragraph deletes this paragraph's mark too.
    const markDeleted = index < paragraphs.length - 1 && changes.some(change => change.delStart <= pEnd && pEnd < change.delEnd);
    body.push(`<w:p>${markDeleted ? `<w:pPr><w:rPr><w:del ${revision()}/></w:rPr></w:pPr>` : ''}${out.join('')}</w:p>`);
  });
  if (!body.length) body.push('<w:p/>');
  const initials = author.split(/\s+/).map(word => [...word][0] ?? '').join('').slice(0, 3).toUpperCase() || 'A';
  const notes = changes.filter(change => change.comment).map(change => change.comment!);
  const comments = notes.length
    ? `<w:comments ${W_NS}>${notes.map(note => `<w:comment w:id="${note.id}" w:author="${xml(author)}" w:date="${when}" w:initials="${xml(initials)}"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>${run(note.note)}</w:p></w:comment>`).join('')}</w:comments>`
    : undefined;
  const bytes = wordPackage({ title, body: body.join(''), brand: input.brand, date, links: new LinkRels(), comments, trackRevisions: true });
  return { bytes, applied, missed };
}
