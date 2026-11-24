// «Proof on every sentence». The agent marks each sentence it takes from a source with [^n] and, at the very end of
// the answer, gives every mark the source's own words in one block (the rules: server/proof.ts):
//   <proofs>
//   [^1]: doc "Lease.pdf" | "the exact words of the document"
//   [^2]: ref "Positions.docx" | "the exact words of the reference material"
//   [^3]: page https://www.legislation.gov.uk/ukpga/1980/58/section/5 | "the exact words of the page"
//   </proofs>
// Here the block is read back (tolerant of a block still streaming and of a model writing it slightly wrong), each
// quote is found in the document or page it names, and the sentences that state something without a proof are
// counted. Pure TypeScript, no DOM: runs in Node (server, tests) and in the browser.

export type ProofKind = 'doc' | 'ref' | 'page';
export type ProofMark = { n: number; kind: ProofKind; target: string; quote: string };
/** checked: the quote is in the source word for word; close: nearly (≥ 85 % of its words in order); missing: not
 *  found, or the source is not there; pending: not checked yet; none: the mark has no proof line. */
export type ProofState = 'checked' | 'close' | 'missing' | 'pending' | 'none';
/** The names of the files the answer may quote, so a line without its kind word still lands on the right one. */
export type ProofNames = { documents?: readonly string[]; reference?: readonly string[] };
export const PROOF_LIMITS = { proofs: 120, quote: 400, target: 300 } as const;

const MARK = /\[\^\s*(\d{1,3})\s*\]/g;
const URL_START = /^https?:\/\//i;

// ---------------------------------------------------------------------------------------------------------------
// Reading the block

const KIND = /^(reference\s+material|official\s+page|documents?|docs?|attachments?|attached|files?|uploads?|uploaded|references?|refs?|knowledge|materials?|webpages?|websites?|pages?|web|urls?|links?|official|sites?|sources?)(?=[\s:=]|$)[\s:=]*/i;
function kindOf(word: string): ProofKind | undefined {
  const value = word.toLowerCase();
  if (/^(doc|attach|file|upload)/.test(value)) return 'doc';
  if (/^(ref|knowledge|material)/.test(value)) return 'ref';
  if (/^(page|web|url|link|official|site)/.test(value)) return 'page';
  return undefined;
}
const OPENERS = '"\'“‘«„‚`”';
const CLOSERS: Record<string, string> = { '"': '"”“', "'": "'’‘", '“': '”"“', '‘': '’\'', '«': '»"', '„': '“”"', '‚': '‘’\'', '`': '`', '”': '”"' };
const QUOTE_END = '"\'”’»“‘`';
const LINE = /^(?:[-*+]\s+)?\[\s*\^?\s*(\d{1,3})\s*\]\s*[:.)\-–—]?\s*([\s\S]*)$/;

/** The quote without its quotation marks, ellipses at its ends or doubled spaces. */
function unquote(value: string): string {
  let text = value.trim();
  if (text && OPENERS.includes(text[0])) {
    const closers = CLOSERS[text[0]] ?? QUOTE_END; let last = -1;
    for (let at = text.length - 1; at > 0; at--) if (closers.includes(text[at])) { last = at; break; }
    // The closing mark ends the quote when only punctuation or a short note («(p. 3)») follows it; otherwise it is
    // an apostrophe inside the words of a quote that was never closed.
    const tail = last > 0 ? text.slice(last + 1) : '';
    text = last > 0 && (/^[\s.,;:]*$/.test(tail) || /^\s*[([][^)\]]{0,40}[)\]][\s.,;:]*$/.test(tail)) ? text.slice(1, last) : text.slice(1);
  }
  return text.replace(/^\s*(?:\.{3}|…)\s*|\s*(?:\.{3}|…)\s*$/g, '').replace(/\s+/g, ' ').trim();
}

const words = (text: string) => (text.match(/[\p{L}\p{N}]+(?:[.,'’-][\p{L}\p{N}]+)*/gu) ?? []).length;

function proofLine(line: string, names: ProofNames): ProofMark | null {
  const head = LINE.exec(line); if (!head) return null;
  const n = Number(head[1]); if (!n) return null;
  let rest = head[2].trim(); let kind: ProofKind | undefined;
  const word = KIND.exec(rest);
  if (word && rest.length > word[0].length) { kind = kindOf(word[1]); rest = rest.slice(word[0].length).trim(); }
  let target = ''; let quoted = false;
  const link = /^\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/.exec(rest);
  if (rest && CLOSERS[rest[0]]) {
    // The name ends at the closing mark that a separator follows («'Owner's lease.pdf' | …» keeps its apostrophe).
    const closers = CLOSERS[rest[0]]; let end = -1;
    for (let at = 1; at < rest.length; at++) if (closers.includes(rest[at])) {
      if (end < 0) end = at;
      if (/^\s*(?:\||—|–|-\s|:|,|$)/.test(rest.slice(at + 1))) { end = at; break; }
    }
    quoted = true;
    if (end < 0) { target = rest.slice(1); rest = ''; } else { target = rest.slice(1, end); rest = rest.slice(end + 1); }
  } else if (/^<https?:\/\//i.test(rest)) {
    const end = rest.indexOf('>'); target = rest.slice(1, end < 0 ? undefined : end); rest = end < 0 ? '' : rest.slice(end + 1);
  } else if (link) { target = link[2]; rest = rest.slice(link[0].length); }
  else if (URL_START.test(rest)) {
    const address = /^[^\s|]+/.exec(rest)![0]; target = address.replace(/[.,;:]+$/, ''); rest = rest.slice(address.length);
  } else {
    // An unquoted name runs to the separator: «|», a dash or a colon before the quote, or the quote itself.
    const separator = /\s*\|\s*|\s+[—–-]\s+(?=["'“‘«„])|\s*:\s+(?=["'“‘«„])|\s+(?=["“«„][^"”»]{8,})/.exec(rest);
    target = separator ? rest.slice(0, separator.index) : rest; rest = separator ? rest.slice(separator.index) : '';
  }
  let quote = unquote(rest.replace(/^\s*(?:\||—|–|-|:|,|=)\s*/, ''));
  target = target.replace(/\s+/g, ' ').trim();
  // «[^1]: "the words only"»: a long quoted «name» with nothing after it is the quote.
  if (!quote && quoted && words(target) >= 5) { quote = unquote(`"${target}"`); target = ''; }
  if (URL_START.test(target)) kind = 'page';
  else if (kind !== 'page') kind = nameKind(target, names) ?? kind ?? 'doc';
  return { n, kind, target: target.slice(0, PROOF_LIMITS.target), quote: quote.slice(0, 2_000) };
}

function nameKind(target: string, names: ProofNames): ProofKind | undefined {
  if (!target) return undefined;
  const document = !!proofSource(target, (names.documents ?? []).map(name => ({ name })));
  const reference = !!proofSource(target, (names.reference ?? []).map(name => ({ name })));
  return document && !reference ? 'doc' : reference && !document ? 'ref' : undefined;
}

/** The answer without its proofs, and the proofs. Everything from «<proofs» on is hidden from the body even before
 *  the block closes; footnote-style lines («[^1]: …» at a line start) are read as proofs too. The first line of a
 *  number wins; a line that does not start with a mark continues the quote above it. */
export function splitProofs(answer: string, names: ProofNames = {}): { body: string; marks: ProofMark[] } {
  const text = typeof answer === 'string' ? answer : '';
  let body = text; let block = ''; let found = false;
  const open = /<\s*proofs?\b/i.exec(text);
  if (open) {
    found = true;
    const after = text.slice(open.index); const start = after.indexOf('>');
    const inner = start < 0 ? '' : after.slice(start + 1);
    const close = /<\s*\/\s*proofs?\s*>/i.exec(inner);
    block = (close ? inner.slice(0, close.index) : inner).replace(/<\/?[a-z]*$/i, '');
    const rest = close ? inner.slice(close.index + close[0].length).trim() : '';
    body = text.slice(0, open.index) + (rest && !/^(?:```|~~~)$/.test(rest) ? `\n\n${rest}` : '');
  }
  // The start of a block still arriving («<pro»), and a mark still arriving («[^1»).
  body = body.replace(/(?:^|\n)[ \t]*<(?:p(?:r(?:o(?:o(?:f)?)?)?)?)?$/i, '').replace(/\[\^[\s\d]*$/, '');
  const kept: string[] = []; const loose: string[] = []; let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^\s{0,3}\[\^\s*\d{1,3}\s*\]\s*:/.test(line)) { loose.push(line); found = true; continue; }
    kept.push(line);
  }
  body = kept.join('\n').replace(/\s+$/, '');
  if (found) body = tidyTail(body);
  const marks = new Map<number, ProofMark>(); const raw = new Map<number, string>(); let last: ProofMark | undefined;
  for (const item of [...block.split('\n'), ...loose]) {
    const line = item.trim(); if (!line) continue;
    const proof = proofLine(line, names);
    if (proof) {
      const before = marks.get(proof.n);
      if ((!before || (!before.quote && proof.quote)) && (before || marks.size < 200)) { marks.set(proof.n, proof); raw.set(proof.n, line); last = proof; }
      else last = undefined;
      continue;
    }
    // A quote that ran on to the next line belongs to the line above.
    if (last && !/^(?:<|```|~~~)/.test(line)) {
      const joined = `${raw.get(last.n)} ${line}`; const again = proofLine(joined, names);
      if (again) { last.quote = again.quote; last.target = again.target; last.kind = again.kind; raw.set(last.n, joined); }
    }
  }
  return { body, marks: [...marks.values()].sort((a, b) => a.n - b.n) };
}

/** What a model may leave just before its block: a rule, an unclosed code fence, a «Proofs» heading. */
function tidyTail(body: string): string {
  let text = body.replace(/\s+$/, '');
  for (let pass = 0; pass < 4; pass++) {
    const lines = text.split('\n'); const lastLine = lines.at(-1)?.trim() ?? '';
    const fences = lines.filter(line => /^\s*(?:```|~~~)/.test(line)).length;
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(lastLine) || (/^(?:```|~~~)\w*$/.test(lastLine) && fences % 2 === 1)
      || /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:proofs?|sources and proofs|αποδείξεις|αποδειξεις)\s*:?\s*(?:\*\*|__)?$/i.test(lastLine)) {
      text = lines.slice(0, -1).join('\n').replace(/\s+$/, '');
    } else break;
  }
  return text;
}

/** The file a proof names, among the documents or the reference material: the exact name, then the same name in
 *  any case or accents, then without its extension, then a name that contains it. */
export function proofSource<T extends { name: string }>(target: string, files: readonly T[]): T | undefined {
  const key = foldPlain(target); if (!key) return undefined;
  const stem = (value: string) => value.replace(/\.[a-z0-9]{1,5}$/, '');
  return files.find(file => file.name === target) ?? files.find(file => foldPlain(file.name) === key)
    ?? files.find(file => stem(foldPlain(file.name)) === stem(key))
    ?? (stem(key).length >= 4 ? files.find(file => { const name = stem(foldPlain(file.name)); return name.length >= 4 && (name.includes(stem(key)) || stem(key).includes(name)); }) : undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Finding a quote

/** One reading of the characters for comparison, shared with the official page's frame (api/official-web.ts): curly
 *  quotes and apostrophes straight, every dash a hyphen, the ellipsis three dots, invisible characters gone, the
 *  final sigma a sigma. Everything else: lower case, compatibility forms (ligatures) split, accents removed. */
export const FOLD_CHARS: Readonly<Record<string, string>> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '´': "'", 'ʼ': "'", 'ʹ': "'", '‹': "'", '›': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-', '﹘': '-', '﹣': '-', '－': '-',
  '…': '...',
  '­': '', '​': '', '‌': '', '‍': '', '⁠': '', '﻿': '',
  'ς': 'σ',
};
const foldCache = new Map<string, string>();
function foldChar(char: string): string {
  let value = foldCache.get(char);
  if (value === undefined) {
    value = Object.prototype.hasOwnProperty.call(FOLD_CHARS, char) ? FOLD_CHARS[char]
      : char.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/ς/g, 'σ');
    if (foldCache.size < 10_000) foldCache.set(char, value);
  }
  return value;
}
/** A string folded for comparison, whitespace collapsed (names, claim words). */
export function foldPlain(text: string): string {
  let out = '';
  for (const char of text) out += char.charCodeAt(0) < 128 ? (char === '`' ? "'" : char.toLowerCase()) : foldChar(char);
  return out.replace(/\s+/g, ' ').trim();
}

const SPACE = 1; const WORD = 2;
const kindCache = new Map<number, number>();
/** 0: other, 1: white space, 2: a letter or digit. */
function charKind(code: number): number {
  if (code < 128) return code === 32 || (code >= 9 && code <= 13) ? 1 : (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || (code >= 65 && code <= 90) ? 2 : 0;
  let kind = kindCache.get(code);
  if (kind === undefined) { const char = String.fromCharCode(code); kind = /\s/.test(char) ? 1 : /[\p{L}\p{N}]/u.test(char) ? 2 : 0; kindCache.set(code, kind); }
  return kind;
}
/** The text folded with white space removed (`norm`), each folded character's offset in the original (`map`) and
 *  whether white space came before it or it is part of a word (`flags`). Comparing without white space makes a quote
 *  match across line breaks, doubled spaces and the odd split of a PDF's text. */
type Folded = { norm: string; map: Int32Array; flags: Uint8Array; size: number };
function fold(text: string): Folded {
  const length = text.length; let capacity = length + 16; let size = 0; let space = false;
  let codes = new Uint16Array(capacity); let map = new Int32Array(capacity); let flags = new Uint8Array(capacity);
  const push = (code: number, origin: number, kind: number) => {
    if (size === capacity) {
      capacity *= 2;
      const nextCodes = new Uint16Array(capacity); nextCodes.set(codes); codes = nextCodes;
      const nextMap = new Int32Array(capacity); nextMap.set(map); map = nextMap;
      const nextFlags = new Uint8Array(capacity); nextFlags.set(flags); flags = nextFlags;
    }
    codes[size] = code; map[size] = origin; flags[size] = (space ? SPACE : 0) | (kind === 2 ? WORD : 0); size++; space = false;
  };
  for (let at = 0; at < length; at++) {
    const code = text.charCodeAt(at);
    if (code < 128) {
      const kind = charKind(code);
      if (kind === 1) { space = true; continue; }
      push(code >= 65 && code <= 90 ? code + 32 : code === 96 ? 39 : code, at, kind);
      continue;
    }
    let char = text[at];
    if (code >= 0xd800 && code < 0xdc00 && at + 1 < length) { const low = text.charCodeAt(at + 1); if (low >= 0xdc00 && low < 0xe000) char = text.slice(at, at + 2); }
    const folded = foldChar(char);
    for (let k = 0; k < folded.length; k++) {
      const value = folded.charCodeAt(k); const kind = charKind(value);
      if (kind === 1) { space = true; continue; }
      push(value, at, kind);
    }
    at += char.length - 1;
  }
  let norm = '';
  for (let at = 0; at < size; at += 8192) norm += String.fromCharCode(...codes.subarray(at, Math.min(size, at + 8192)));
  return { norm, map, flags, size };
}

type Tokens = { starts: Int32Array; ends: Int32Array; words: string[]; where: Map<string, number[]> };
function tokensOf(folded: Folded): Tokens {
  const starts: number[] = []; const ends: number[] = []; const list: string[] = [];
  const { flags, size, norm } = folded;
  for (let at = 0; at < size;) {
    if (!(flags[at] & WORD)) { at++; continue; }
    let end = at + 1; while (end < size && (flags[end] & WORD) && !(flags[end] & SPACE)) end++;
    starts.push(at); ends.push(end); list.push(norm.slice(at, end)); at = end;
  }
  const where = new Map<string, number[]>();
  list.forEach((word, index) => { const at = where.get(word); if (at) at.push(index); else where.set(word, [index]); });
  return { starts: Int32Array.from(starts), ends: Int32Array.from(ends), words: list, where };
}

// The last few texts searched, folded once: an answer's quotes are checked against the same few documents.
type Indexed = Folded & { tokens?: Tokens };
const INDEXED = new Map<string, Indexed>();
function indexed(text: string): Indexed {
  const hit = INDEXED.get(text); if (hit) return hit;
  const value: Indexed = fold(text); INDEXED.set(text, value);
  if (INDEXED.size > 4) INDEXED.delete(INDEXED.keys().next().value!);
  return value;
}

/** The nearest passage holding ≥ 85 % of the quote's words in order, within a window little longer than the quote.
 *  Candidate places come from a vote of the quote's words (each occurrence votes for where the quote would start);
 *  the best few are measured exactly (longest common subsequence of words). Quotes under four words need an exact match. */
function nearMatch(page: Indexed, quote: Folded): { a: number; b: number } | null {
  const q = tokensOf(quote).words; const m = q.length; if (m < 4) return null;
  const tokens = page.tokens ??= tokensOf(page); const total = tokens.words.length; if (!total) return null;
  const need = Math.ceil(m * 0.85); const width = 4;
  const votes = new Int32Array((total >> 2) + 2);
  q.forEach((word, index) => {
    const at = tokens.where.get(word); if (!at || at.length > 5_000) return;
    for (const position of at) votes[Math.max(0, position - index) >> 2]++;
  });
  const candidates: [number, number][] = [];
  for (let bucket = 0; bucket < votes.length; bucket++) { const value = votes[bucket] + (votes[bucket + 1] ?? 0); if (value >= need * 0.6) candidates.push([value, bucket]); }
  candidates.sort((x, y) => y[0] - x[0]);
  let best: { score: number; a: number; b: number } | null = null;
  for (const [, bucket] of candidates.slice(0, 8)) {
    const from = Math.max(0, bucket * width - Math.ceil(m * 0.2) - 2); const to = Math.min(total, bucket * width + width + m + Math.ceil(m * 0.3) + 2);
    const w = to - from; const row = w + 1; const table = new Uint16Array((m + 1) * row);
    for (let i = 1; i <= m; i++) for (let j = 1; j <= w; j++) {
      table[i * row + j] = q[i - 1] === tokens.words[from + j - 1] ? table[(i - 1) * row + j - 1] + 1 : Math.max(table[(i - 1) * row + j], table[i * row + j - 1]);
    }
    const score = table[m * row + w]; if (score < need || (best && score <= best.score)) continue;
    let i = m; let j = w; let first = -1; let last = -1;
    while (i > 0 && j > 0) {
      if (q[i - 1] === tokens.words[from + j - 1] && table[i * row + j] === table[(i - 1) * row + j - 1] + 1) { if (last < 0) last = from + j - 1; first = from + j - 1; i--; j--; }
      else if (table[(i - 1) * row + j] >= table[i * row + j - 1]) i--; else j--;
    }
    if (first < 0 || last - first + 1 > m + Math.ceil(m * 0.5) + 2) continue;
    best = { score, a: tokens.starts[first], b: tokens.ends[last] - 1 };
  }
  return best && { a: best.a, b: best.b };
}

const COMBINING = /\p{M}/u;
function span(text: string, page: Folded, a: number, b: number): { start: number; end: number } {
  const start = page.map[a]; let end = page.map[b] + 1;
  const code = text.charCodeAt(end - 1); if (code >= 0xd800 && code < 0xdc00) end++;
  while (end < text.length && COMBINING.test(text[end])) end++;
  return { start, end };
}

/** Where the quote is in the text, as offsets into the ORIGINAL text. Exact means equal once folded (case, accents,
 *  quotes and dashes, white space ignored; the quote's own end punctuation may differ); otherwise the nearest
 *  passage with ≥ 85 % of the quote's words in order, reported as exact: false. */
export function findQuote(text: string, quote: string): { start: number; end: number; exact: boolean } | null {
  if (typeof text !== 'string' || typeof quote !== 'string' || !text || !quote.trim()) return null;
  const page = indexed(text); const q = fold(quote.slice(0, 2_000));
  if (q.size < 3) return null;
  const exact = (needle: string) => { const at = needle.length >= 3 ? page.norm.indexOf(needle) : -1; return at < 0 ? null : span(text, page, at, at + needle.length - 1); };
  let hit = exact(q.norm);
  if (!hit) {
    let a = 0; let b = q.size - 1;
    while (a <= b && !(q.flags[a] & WORD)) a++; while (b >= a && !(q.flags[b] & WORD)) b--;
    if (a > 0 || b < q.size - 1) hit = exact(q.norm.slice(a, b + 1));
  }
  if (hit) return { ...hit, exact: true };
  const near = nearMatch(page, q);
  return near ? { ...span(text, page, near.a, near.b), exact: false } : null;
}

/** A proof's state from its source's text: undefined while the source is still loading, null when it is not there. */
export function checkQuote(text: string | null | undefined, quote: string): ProofState {
  if (text === undefined) return 'pending';
  if (text === null || !quote) return 'missing';
  const found = findQuote(text, quote);
  return !found ? 'missing' : found.exact ? 'checked' : 'close';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', hellip: '…', sect: '§', para: '¶', euro: '€', pound: '£', copy: '©', reg: '®', deg: '°', middot: '·', shy: '­' };
/** The text of an official page's reader HTML (/api/official-page → { html }), to check quotes against: block
 *  elements on their own lines, inline ones joined, entities decoded. */
export function htmlToText(html: string): string {
  return html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:p|div|li|tr|h[1-6]|br|hr|table|thead|tbody|ul|ol|dl|dt|dd|blockquote|pre|section|article|header|footer|main|figure|figcaption|caption)\b[^>]*>/gi, '\n')
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, name: string) => {
      if (name[0] === '#') { const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)); return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole; }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/[ \t\f\v ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Which sentences carry proof

// Not the end of a sentence: «e.g.», «s. 5», «art. 7», «No. 3», «Ltd.», initials, «U.K.», Greek «άρθ.», «παρ.», «κ.».
const ABBREVIATIONS = new Set(['eg', 'ie', 'etc', 'cf', 'vs', 'v', 'ss', 'art', 'arts', 'para', 'paras', 'no', 'nos', 'sec', 'secs', 'ch', 'cl', 'reg', 'regs', 'sch', 'pp', 'sched', 'subs', 'rr',
  'vol', 'fig', 'op', 'cit', 'ibid', 'al', 'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'ltd', 'inc', 'co', 'corp', 'plc', 'llp', 'jr', 'sr', 'approx', 'dept', 'est',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'αρ', 'αριθ', 'αρθ', 'παρ', 'εδ', 'σελ', 'βλ', 'κλπ', 'κτλ', 'υπ', 'περ', 'στοιχ']);
const SENTENCE_END = /([.!?…;;])(["'”’»)\]*_]*)((?:\s*\[\^\s*\d{1,3}\s*\])*)(?=\s|$)/g;
const BEFORE_NUMBER = new Set(['cap', 'caps', 'κεφ', 'pt', 'pts', 'ord', 'ed', 'eds']);
function sentences(block: string): string[] {
  const out: string[] = []; let from = 0;
  for (const match of block.matchAll(SENTENCE_END)) {
    const at = match.index!; const stop = at + match[0].length;
    if (at < from) continue;
    // «;» ends a sentence only as the Greek question mark.
    if (match[1] === ';' && !/\p{Script=Greek}/u.test(block[at - 1] ?? '')) continue;
    if (match[1] === '.') {
      const word = /\p{L}[\p{L}.]*$/u.exec(block.slice(Math.max(from, at - 24), at))?.[0];
      if (word && (word.length === 1 || word.includes('.') || ABBREVIATIONS.has(foldPlain(word)))) continue;
      // «Cap. 149», «Κεφ. 149», «Pt. 3»: an abbreviation only before a number («no liability cap. The tenant…» ends a sentence).
      if (word && BEFORE_NUMBER.has(foldPlain(word)) && /^\s*\d/.test(block.slice(stop))) continue;
    }
    const gap = /\s*/y; gap.lastIndex = stop; gap.exec(block); const next = block[gap.lastIndex];
    // The next sentence starts with a capital, a digit, a bracket or a quotation mark; «approx. three» goes on.
    if (next && !(next !== next.toLowerCase() || /[\d"'“‘«(\[*_]/.test(next) || (/\p{L}/u.test(next) && next === next.toUpperCase()))) continue;
    const sentence = block.slice(from, stop).trim(); if (sentence) out.push(sentence); from = stop;
  }
  const tail = block.slice(from).trim(); if (tail) out.push(tail);
  return out;
}

/** The body's prose as blocks: paragraphs, list items and table rows. Headings, code, rules and table headers are
 *  not statements. */
function statementBlocks(body: string): string[] {
  const lines = body.split('\n'); const blocks: string[] = []; let current: string[] = []; let fence = '';
  const flush = () => { if (current.length) blocks.push(current.join(' ')); current = []; };
  const separator = (line: string | undefined) => !!line && /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
  const row = (line: string) => /^\s*\|.*\|\s*$/.test(line) || (line.split('|').length >= 3 && !/^\s*[-*+]\s/.test(line));
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    const fenced = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (fenced && fenced[1][0] === fence[0] && fenced[1].length >= fence.length) fence = ''; continue; }
    if (fenced) { flush(); fence = fenced[1]; continue; }
    while (/^\s*>/.test(line)) line = line.replace(/^\s*>\s?/, '');
    if (!line.trim()) { flush(); continue; }
    if (/^\s{0,3}#{1,6}(?:\s|$)/.test(line) || /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) || separator(line)) { flush(); continue; }
    if (row(line)) { flush(); if (!separator(lines[index + 1])) blocks.push(line.split('|').map(cell => cell.trim()).filter(Boolean).join('; ')); continue; }
    const item = /^\s*(?:[-*+]|\d{1,3}[.)])\s+/.exec(line);
    if (item) { flush(); current.push(line.slice(item[0].length).trim()); continue; }
    current.push(line.trim());
  }
  flush();
  return blocks;
}

/** A sentence as the reader sees it: no Markdown marks, links reduced to their words, no proof marks. */
const plain = (text: string) => text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]^][^\]]*)\]\([^)]*\)/g, '$1').replace(MARK, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/`+/g, '').replace(/\*\*|__|(?<![\p{L}\p{N}])[*_]+|[*_]+(?![\p{L}\p{N}])/gu, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();

const FRAMING = /^(?:here(?:'s| is| are)|below|above|the following|following|in (?:summary|short|brief|conclusion|sum)|to (?:sum up|summari[sz]e|conclude)|overall|summary|let (?:me|us)|let's|i (?:will|'ll|have|'ve|can|would|am|'m)|we (?:will|'ll|have|'ve|can|would)|please|feel free|if you|i hope|hope|see|next steps?|ακολουθ|παρακατω|συνοπτικα|συμπερασματικα|εν κατακλειδι|σε συντομια|συνολικα|βλ|δειτε)(?!\p{L})/u;
const REFERENCE = /(?<!\p{L})(?:sections?|articles?|clauses?|paragraphs?|subsections?|regulations?|schedules?|annex(?:es)?|recitals?|directives?|statutes?|αρθρ\p{L}*|παραγραφ\p{L}*|εδαφι\p{L}*|ρητρ\p{L}*|κανονισμ\p{L}*|οδηγι\p{L}*|νομο[συ]?|νομων|παραρτημ\p{L}*)(?!\p{L})/u;
const NAMED_LAW = /\b(?:Act|Law|Code|Regulation|Directive|Order|Rules)\b/;
const SIGNAL = /\d|[€$£¥%§]/;
const QUOTED = /["“«„][^"”»“]{3,}["”»“]/;
const OPINION = /(?<!\p{L})(?:should|recommend\p{L}*|suggest\p{L}*|consider\p{L}*|advis\p{L}*|may wish|might|could|would|likely|unlikely|probabl\p{L}*|possibl\p{L}*|arguabl\p{L}*|in (?:my|our) (?:view|opinion)|we think|i think|we believe|i believe|appears?|seems?|προτειν\p{L}*|συνιστ\p{L}*|θα μπορουσ\p{L}*|ενδεχομεν\p{L}*|πιθαν\p{L}*|κατα τη γνωμη|φαινεται|θα πρεπει)(?!\p{L})/u;

/** Whether an unmarked sentence states something that needs a proof. The rule, in order:
 *  1. fewer than three words, a question, or framing («Here is…», «In summary…», «See…», «Let me…») — no;
 *  2. a checkable detail — a digit, an amount or a percentage, a section/article/clause/regulation reference, a
 *     named Act or Law, or words in quotation marks — yes;
 *  3. otherwise a sentence of six words or more — yes, unless it is advice or opinion («should», «we recommend»,
 *     «likely», «it appears»), which is the agent's own analysis and needs no proof. */
export function isClaim(sentence: string): boolean {
  const text = plain(sentence); const count = words(text);
  if (count < 3) return false;
  if (/[?;]["'”’»)]*$/.test(text) || /\p{Script=Greek};["'”’»)]*$/u.test(text)) return false;
  const folded = foldPlain(text).replace(/^["'(\[]+/, '');
  if (FRAMING.test(folded)) return false;
  // An open point to check («Whether the contract was a deed», «Any evidence of…») asks, it does not claim.
  if (/^(?:whether|any evidence of|if any|αν|κατα ποσο)\b/.test(folded)) return false;
  if (SIGNAL.test(text) || QUOTED.test(text) || NAMED_LAW.test(text) || REFERENCE.test(folded)) return true;
  return count >= 6 && !OPINION.test(folded);
}

/** Whether the answer is a drafted document — a letter, a notice, an agreement — rather than research (13 Nov 2026:
 *  «21 claims without a source» under a letter before action, every sentence of the letter counted). */
export function isDraftedDocument(body: string): boolean {
  const text = typeof body === 'string' ? body : '';
  const lines = text.split('\n').map(line => line.replace(/^[\s>*_#]+|[\s*_]+$/g, '')).filter(Boolean);
  // 13 Nov 2026 (code review): a letter opens with «Dear …» in its first lines, or is a contract with a preamble; it
  // closes with a sign-off on a short line of its own near the end. «signed by both parties» or «με τιμή €200.000»
  // inside research are not closings, and «This lease favours the landlord» is a review, not a lease.
  const opening = lines.slice(0, 8).some(line => /^(?:dear\b|to whom it may concern|αγαπητ\p{L}*|αξιοτιμ\p{L}*)/iu.test(line))
    || /^this (?:agreement|deed|contract|lease)\b.{0,60}\b(?:is made|made on|dated|entered into)\b/i.test(lines[0] ?? '') || /^(?:BETWEEN|ΜΕΤΑΞΥ)\b|^between\s*:/u.test(lines[0] ?? '');
  const closing = lines.slice(-6).some(line => line.length <= 40 && /^(?:yours (?:sincerely|faithfully|truly)|kind regards|best regards|με (?:εκτιμηση|εκτίμηση|τιμη|τιμή)|μετα τιμης|μετά τιμής|in witness whereof)\b[,.]?$/iu.test(line));
  return opening || closing;
}

/** A law point in a sentence: a section, article or clause, or a named Act, Law or Regulation. */
export const citesLaw = (sentence: string) => { const text = plain(sentence); return NAMED_LAW.test(text) || REFERENCE.test(foldPlain(text)); };

/** The body's sentences with the marks each carries and whether it is a claim. A sentence counts as marked when it
 *  carries a mark that has a proof line; a mark without one proves nothing, so its sentence counts as an unmarked
 *  claim. While the answer streams (no block yet) every mark is still without a proof: read the counts at the end. */
export function proofStatements(body: string, marks: ProofMark[], options: { /** A drafted document: only its points of law need a source; its facts are the user's and its prose is the draft. */ lawOnly?: boolean } = {}): { statements: { text: string; marks: number[]; claim: boolean }[]; marked: number; unmarkedClaims: number } {
  const known = new Set(marks.map(mark => mark.n));
  const statements: { text: string; marks: number[]; claim: boolean }[] = []; let marked = 0; let unmarkedClaims = 0;
  for (const block of statementBlocks(typeof body === 'string' ? body : '')) for (const sentence of sentences(block)) {
    const numbers = [...new Set([...sentence.matchAll(MARK)].map(match => Number(match[1])))];
    const text = plain(sentence); if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
    const proved = numbers.some(n => known.has(n));
    const claim = numbers.length > 0 || (options.lawOnly ? citesLaw(sentence) && isClaim(sentence) : isClaim(sentence));
    statements.push({ text, marks: numbers, claim });
    if (proved) marked++; else if (claim) unmarkedClaims++;
  }
  return { statements, marked, unmarkedClaims };
}

// ---------------------------------------------------------------------------------------------------------------
// Drawing the marks

// A mark travels through the Markdown renderer as «n» (private-use characters: plain text to marked and
// to the HTML clean-up) and becomes its button afterwards.
const PLACE_OPEN = ''; const PLACE_CLOSE = '';
const PLACEHOLDER = /(\d{1,3})/g;
/** The body with each [^n] as a placeholder that survives the Markdown renderer; code is left alone. */
export function markBody(body: string): string {
  let fence = '';
  return body.replace(/[]/g, '').split('\n').map(line => {
    const fenced = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (fenced && fenced[1][0] === fence[0] && fenced[1].length >= fence.length) fence = ''; return line; }
    if (fenced) { fence = fenced[1]; return line; }
    return line.split(/(`+[^`]*`+)/).map((part, index) => index % 2 ? part : part.replace(MARK, (_whole, digits: string) => `${PLACE_OPEN}${Number(digits)}${PLACE_CLOSE}`)
      // «owed.**[^1]»: a mark right after closing emphasis kept the ** from closing (12 Nov 2026: raw ** in the answer);
      // the mark moves inside the emphasis.
      .replace(new RegExp(`(\\*\\*|__|\\*|_)((?:${PLACE_OPEN}\\d+${PLACE_CLOSE})+)`, 'g'), '$2$1')).join('');
  }).join('\n');
}

const STATES = new Set<ProofState>(['checked', 'close', 'missing', 'pending']);
/** The placeholders in already-sanitised HTML as proof buttons (generated here, so safe). A mark whose state is
 *  «none» (no proof line) is removed, and so is a placeholder found inside a tag. */
export function proofMarksHtml(html: string, state: (n: number) => ProofState): string {
  return html.split(/(<[^>]*>)/).map((part, index) => index % 2 ? part.replace(/[]/g, '') : part.replace(PLACEHOLDER, (_whole, digits: string) => {
    const n = Number(digits); const value = state(n);
    return STATES.has(value) ? `<button type="button" class="mn-proof-mark is-${value}" data-proof="${n}" aria-label="Proof ${n}">${n}</button>` : '';
  }).replace(/[]/g, '')).join('');
}
