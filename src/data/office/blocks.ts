// One reading of an answer's Markdown for the Office writers: blocks (headings, paragraphs, bullet and numbered
// lists with their nesting, tables, quotes, rules, code) made of inline runs (bold, italic, code, links). The machine
// data agents add to an answer (a <proofs>…</proofs> block, a ```redline block of edits) and proof marks such as
// [^3] are not content and never reach a file. It follows what the screen shows (marked, GFM) closely enough.

export type Inline = { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; link?: string };
export type Align = 'left' | 'center' | 'right' | null;
export type TableBlock = { type: 'table'; header: Inline[][]; rows: Inline[][][]; align: Align[] };
export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'bullet'; level: number; inlines: Inline[] }
  /** list: one id per run of numbered items at one level; number: the item's number as shown (start + position). */
  | { type: 'numbered'; level: number; inlines: Inline[]; list: number; number: number }
  | TableBlock
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'rule' }
  | { type: 'code'; text: string; lang: string };

const PROOF_MARK = /[ \t]*\[\^[^\]\s]{1,24}\]/g;
/** The answer without machine data: the <proofs> block (closed or cut off) and HTML comments. */
export function stripMachineData(markdown: string): string {
  return String(markdown ?? '').replace(/\r\n?/g, '\n').replace(/<proofs\b[^>]*>[\s\S]*?(?:<\/proofs\s*>|$)/gi, '').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
}
export const plainText = (inlines: Inline[]) => inlines.map(inline => inline.text).join('');

// Inline runs.
type Style = Omit<Inline, 'text'>;
const LINK = /^\[((?:[^[\]\\]|\\.|\[[^[\]]*\])*)\]\(\s*<?((?:https?:\/\/|mailto:)(?:[^()\s<>]|\([^()\s]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/i;
const BARE_URL = /^https?:\/\/[^\s<>]+/i;
const HTML_TAG = /^<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);
const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/** Where an emphasis opened at `at` with `size` markers closes: the inner text and the index after the closer. */
function closeEmphasis(text: string, at: number, char: string, size: number): { inner: string; end: number } | null {
  if (isSpace(text[at + size])) return null;
  if (char === '_' && isWordChar(text[at - 1])) return null;
  for (let j = at + size; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') { const run = /^`+/.exec(text.slice(j))![0]; const close = text.indexOf(run, j + run.length); if (close > 0) j = close + run.length - 1; else j += run.length - 1; continue; }
    if (c !== char) continue;
    let length = 1; while (text[j + length] === char) length++;
    const fits = !isSpace(text[j - 1]) && !(char === '_' && isWordChar(text[j + length]));
    if (fits && length === size) return { inner: text.slice(at + size, j), end: j + length };
    // «**bold *italic***»: a closing run of three ends the inner emphasis and this one.
    if (fits && length === 3 && size < 3) return { inner: text.slice(at + size, j + 3 - size), end: j + 3 };
    j += length - 1;
  }
  return null;
}

function scan(text: string, style: Style, out: Inline[]): void {
  let buffer = '';
  const flush = () => { if (buffer) { out.push({ text: buffer, ...style }); buffer = ''; } };
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (char === '\\' && /[!-/:-@[-`{-~]/.test(text[i + 1] ?? '')) { buffer += text[i + 1]; i += 2; continue; }
    if (char === '`') {
      const run = /^`+/.exec(text.slice(i))![0];
      let close = text.indexOf(run, i + run.length);
      while (close > 0 && text[close + run.length] === '`') close = text.indexOf(run, close + run.length + 1);
      if (close > 0) {
        flush();
        const code = text.slice(i + run.length, close).replace(/\n/g, ' ');
        out.push({ text: /^ .*[^ ].* $/.test(code) ? code.slice(1, -1) : code, ...style, code: true });
        i = close + run.length; continue;
      }
      buffer += run; i += run.length; continue;
    }
    if (char === '[') {
      const link = LINK.exec(text.slice(i));
      if (link && !style.link) { flush(); scan(link[1], { ...style, link: link[2] }, out); i += link[0].length; continue; }
    }
    if (char === '<') {
      const rest = text.slice(i);
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) { flush(); out.push({ text: auto[1].replace(/^mailto:/i, ''), ...style, link: auto[1] }); i += auto[0].length; continue; }
      const br = /^<br\s*\/?>/i.exec(rest);
      if (br) { buffer += '\n'; i += br[0].length; continue; }
      const tag = HTML_TAG.exec(rest);
      if (tag) { i += tag[0].length; continue; }
    }
    if ((char === 'h' || char === 'H') && !style.link && !isWordChar(text[i - 1]) && BARE_URL.test(text.slice(i))) {
      let url = BARE_URL.exec(text.slice(i))![0];
      // Trailing punctuation belongs to the sentence; a closing bracket only when it has no opening one in the address.
      for (;;) {
        const last = url.at(-1)!;
        if (/[.,;:!?'"»”’*_]/.test(last)) { url = url.slice(0, -1); continue; }
        if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) { url = url.slice(0, -1); continue; }
        break;
      }
      flush(); out.push({ text: url, ...style, link: url }); i += url.length; continue;
    }
    if (char === '*' || char === '_' || char === '~') {
      let length = 1; while (text[i + length] === char) length++;
      const tries = char === '~' ? (length === 2 ? [2] : []) : length === 3 ? [3, 1, 2] : length <= 2 ? [length] : [];
      let done = false;
      for (const size of tries) {
        const span = closeEmphasis(text, i, char, size);
        if (!span) continue;
        flush();
        const next: Style = { ...style };
        if (char === '~') next.strike = true;
        if (size === 1 || size === 3) { if (char !== '~') next.italic = true; }
        if (size === 2 && char !== '~') next.bold = true;
        if (size === 3) next.bold = true;
        scan(span.inner, next, out);
        i = span.end; done = true; break;
      }
      if (done) continue;
      buffer += char.repeat(length); i += length; continue;
    }
    buffer += char; i++;
  }
  flush();
}

const sameStyle = (a: Inline, b: Inline) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && !!a.code === !!b.code && a.link === b.link;
/** Inline runs of one line or paragraph; proof marks dropped, neighbouring runs of one style joined. */
export function parseInline(source: string): Inline[] {
  const raw: Inline[] = [];
  scan(String(source ?? '').replace(PROOF_MARK, ''), {}, raw);
  const out: Inline[] = [];
  for (const inline of raw) {
    const clean: Inline = { text: inline.text };
    if (inline.bold) clean.bold = true; if (inline.italic) clean.italic = true; if (inline.strike) clean.strike = true; if (inline.code) clean.code = true; if (inline.link) clean.link = inline.link;
    const last = out.at(-1);
    if (last && sameStyle(last, clean)) last.text += clean.text; else out.push(clean);
  }
  // Leading and trailing spaces of the whole line go.
  if (out.length) { out[0].text = out[0].text.replace(/^[ \t]+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/[ \t]+$/, ''); }
  return out.filter(inline => inline.text !== '');
}

/** The first `count` characters of a line's runs. */
export function sliceInlines(inlines: Inline[], count: number): Inline[] {
  const out: Inline[] = []; let left = count;
  for (const inline of inlines) { if (left <= 0) break; out.push({ ...inline, text: inline.text.slice(0, left) }); left -= inline.text.length; }
  return out;
}
/** Where a text longer than `max` is best cut: after the last sentence that fits, else at a word, else at max. */
export function cutPoint(text: string, max: number): { at: number; ellipsis: boolean } | null {
  if (text.length <= max) return null;
  const head = text.slice(0, max + 1);
  let sentence = -1;
  for (const match of head.matchAll(/[.!?;](?=\s)|[.!?]["”’»)]?(?=\s)/g)) if (match.index! + 1 <= max) sentence = match.index! + match[0].length;
  if (sentence >= max * 0.4) return { at: sentence, ellipsis: false };
  const space = head.lastIndexOf(' ', max - 1);
  return { at: space >= max * 0.5 ? space : max - 1, ellipsis: true };
}
/** Runs shortened to about `max` characters at a sentence boundary (or a word, with «…»). */
export function shortenInlines(inlines: Inline[], max: number): Inline[] {
  const cut = cutPoint(plainText(inlines), max);
  if (!cut) return inlines;
  const out = sliceInlines(inlines, cut.at);
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text.replace(/\s+$/, '') + (cut.ellipsis ? '…' : '') };
  return out;
}

// Numbers in table cells.
export type NumberStyle = 'en' | 'eu';
export type ReadNumber = { value: number; format: string; decimals: number };
const CURRENCY: Record<string, string> = { '€': '€', $: '$', '£': '£', eur: '€', usd: '$', gbp: '£', 'us$': '$' };
const GROUPED_EN = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const GROUPED_EU = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
const GROUPED_SPACE = /^\d{1,3}(?:[ '’]\d{3})+(?:[.,]\d+)?$/;
const SINGLE = /^(\d+)([.,])(\d+)$/;

/** Which decimal mark a column's unambiguous numbers use, if they agree. */
export function columnNumberStyle(cells: string[]): NumberStyle | undefined {
  let en = false; let eu = false;
  for (const cell of cells) {
    const core = cell.replace(/[^\d.,]/g, '');
    if (GROUPED_EN.test(core) && (core.includes('.') || core.split(',').length > 2)) en = true;
    else if (GROUPED_EU.test(core) && (core.includes(',') || core.split('.').length > 2)) eu = true;
    else { const single = SINGLE.exec(core); if (single && single[3].length !== 3) { if (single[2] === '.') en = true; else eu = true; } }
  }
  return en && !eu ? 'en' : eu && !en ? 'eu' : undefined;
}

/** A cell's number when the text is one beyond doubt (thousand marks, €/$/£, %, minus or brackets for negatives),
 *  with an Excel number format that shows it as written; else null and the cell stays text. «1.200» with nothing
 *  else in its column to tell is text; «1,200» reads as twelve hundred unless the column writes decimal commas. */
export function readNumber(text: string, style?: NumberStyle): ReadNumber | null {
  let s = String(text ?? '').trim().replace(/[   ]/g, ' ');
  if (!s || s.length > 40) return null;
  let negative = false; let brackets = false;
  const bracket = /^\((.+)\)$/.exec(s);
  if (bracket) { s = bracket[1].trim(); negative = true; brackets = true; }
  const sign = () => { const m = /^([-−–+])\s?/.exec(s); if (m) { if (m[1] !== '+') { if (negative) return false; negative = true; } s = s.slice(m[0].length); } return true; };
  if (!sign()) return null;
  let currency = ''; let prefix = false;
  const pre = /^(us\$|€|\$|£|eur|usd|gbp)(?:\s?)(?=[\d(−–-])/i.exec(s);
  if (pre) { currency = CURRENCY[pre[1].toLowerCase()]; prefix = true; s = s.slice(pre[0].length); if (!sign()) return null; }
  const post = /\s?(€|\$|£|eur|usd|gbp)$/i.exec(s);
  if (!currency && post) { currency = CURRENCY[post[1].toLowerCase()]; s = s.slice(0, -post[0].length); }
  let percent = false;
  if (/\s?%$/.test(s)) { percent = true; s = s.replace(/\s?%$/, ''); }
  if (percent && currency) return null;
  const hint = style;
  let digits: string; let decimals = 0; let grouped = false;
  if (/^\d+$/.test(s)) {
    if ((s.length > 1 && s[0] === '0') || s.length > 15) return null;
    digits = s;
  } else if (GROUPED_SPACE.test(s)) {
    const [whole, fraction = ''] = s.split(/[.,](?=\d+$)/); digits = whole.replace(/[ '’]/g, '') + (fraction ? '.' + fraction : ''); decimals = fraction.length; grouped = true;
  } else if (SINGLE.test(s)) {
    const [, whole, mark, fraction] = SINGLE.exec(s)!;
    if (whole.length > 1 && whole[0] === '0') return null;
    const thousands = fraction.length === 3 && whole.length <= 3 && whole !== '0';
    if (thousands) {
      const asThousands = mark === ',' ? hint !== 'eu' : hint === 'eu';
      if (mark === '.' && !hint) return null;
      if (asThousands) { digits = whole + fraction; grouped = true; } else { digits = `${whole}.${fraction}`; decimals = 3; }
    } else { digits = `${whole}.${fraction}`; decimals = fraction.length; }
  } else if (GROUPED_EN.test(s) && hint !== 'eu') {
    const [whole, fraction = ''] = s.split('.'); digits = whole.replace(/,/g, '') + (fraction ? '.' + fraction : ''); decimals = fraction.length; grouped = true;
  } else if (GROUPED_EU.test(s) && hint !== 'en') {
    const [whole, fraction = ''] = s.split(','); digits = whole.replace(/\./g, '') + (fraction ? '.' + fraction : ''); decimals = fraction.length; grouped = true;
  } else return null;
  if (digits.replace('.', '').length > 15) return null;
  let value = Number(digits);
  if (!Number.isFinite(value)) return null;
  if (negative) value = -value;
  if (percent) value = Number((value / 100).toPrecision(15));
  const places = Math.min(decimals, 6);
  let format = (grouped || currency ? '#,##0' : '0') + (places ? '.' + '0'.repeat(places) : '');
  if (percent) format += '%';
  if (currency) format = prefix ? `"${currency}"${format}` : `${format} "${currency}"`;
  if (brackets) format = `${format};(${format})`;
  return { value, format: format === '0' ? 'General' : format, decimals: places };
}

// Blocks.
type Draft = { block: Block; raw?: string };
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const RULE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^(\s*)([-*+•]|\d{1,9}[.)])[ \t]+(.*)$/;
const SEPARATOR_CELL = /^:?-+:?$/;
const indentWidth = (space: string) => [...space].reduce((width, char) => (char === '\t' ? width + 4 - (width % 4) : width + 1), 0);
const unescapedPipes = (line: string) => line.match(/(?<!\\)\|/g)?.length ?? 0;

/** A table row's cells; «\|» is a pipe inside a cell, not a border. */
export function rowCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim());
}
const isSeparator = (line: string) => { const cells = rowCells(line); return cells.length > 0 && cells.every(cell => SEPARATOR_CELL.test(cell)) && line.includes('-'); };
/** A soft-wrapped paragraph's lines as one text; two trailing spaces or a backslash keep the break. */
const joinLines = (lines: string[]) => lines.map((line, index) => index === lines.length - 1 ? line.trim() : /( {2,}|\\)$/.test(line) ? line.replace(/(?: {2,}|\\)$/, '').trim() + '\n' : line.trim() + ' ').join('');

export function parseBlocks(markdown: string): Block[] {
  const lines = stripMachineData(markdown).split('\n').map(line => line.replace(/^(\s*)\[\^[^\]\s]{1,24}\]:\s*/, '$1'));
  const drafts: Draft[] = [];
  let paragraph: string[] = []; let quote: string[] = [];
  let levels: number[] = []; let lists: (number | undefined)[] = []; let listOpen = false; let afterBlank = false;
  let listCounter = 0; const listNext = new Map<number, number>();
  let item: Draft | null = null;
  const flushParagraph = () => { if (paragraph.length) drafts.push({ block: { type: 'paragraph', inlines: [] }, raw: joinLines(paragraph) }); paragraph = []; };
  const flushQuote = () => { if (quote.length) drafts.push({ block: { type: 'quote', inlines: [] }, raw: joinLines(quote) }); quote = []; };
  const closeList = () => { levels = []; lists = []; listOpen = false; item = null; };
  const flushAll = () => { flushParagraph(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flushAll();
      const marker = fence[1]; const lang = fence[2].toLowerCase();
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        const close = new RegExp(`^\\s{0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
        if (close.test(lines[i])) break;
        body.push(lines[i]);
      }
      // Edits for the redline are data, not content.
      if (!/^redline\b/.test(lang)) drafts.push({ block: { type: 'code', text: body.join('\n').replace(/\s+$/, ''), lang } });
      if (!(listOpen && indentWidth(/^\s*/.exec(line)![0]) >= 2)) closeList();
      continue;
    }
    if (!line.trim()) { flushAll(); afterBlank = true; continue; }
    const wasBlank = afterBlank; afterBlank = false;

    // Tables: a row of pipes, or a pipe row over a separator row.
    const pipeStart = /^\s*\|/.test(line) && unescapedPipes(line) >= 2;
    const headerOverSeparator = unescapedPipes(line) >= 1 && i + 1 < lines.length && isSeparator(lines[i + 1]);
    if ((pipeStart || headerOverSeparator) && !(listOpen && !wasBlank && !pipeStart)) {
      flushAll(); closeList();
      const rows: string[][] = []; let align: Align[] = []; let sawSeparator = false;
      for (; i < lines.length && lines[i].trim() && (/^\s*\|/.test(lines[i]) || (!pipeStart && unescapedPipes(lines[i]) >= 1)); i++) {
        if (!sawSeparator && rows.length === 1 && isSeparator(lines[i])) {
          sawSeparator = true;
          align = rowCells(lines[i]).map(cell => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null));
          continue;
        }
        if (isSeparator(lines[i])) continue;
        rows.push(rowCells(lines[i]));
      }
      i--;
      if (!rows.length) continue;
      // Every row as wide as the header: short rows padded, extra cells joined into the last one.
      const width = rows[0].length;
      const even = rows.map(row => (row.length > width ? [...row.slice(0, width - 1), row.slice(width - 1).join(' | ')] : [...row, ...Array<string>(width - row.length).fill('')]));
      drafts.push({ block: { type: 'table', header: even[0].map(parseInline), rows: even.slice(1).map(row => row.map(parseInline)), align: Array.from({ length: width }, (_, index) => align[index] ?? null) } });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) { flushAll(); closeList(); drafts.push({ block: { type: 'heading', level: heading[1].length, inlines: [] }, raw: heading[2] ?? '' }); continue; }
    // Setext headings: a paragraph underlined with === or ---.
    if (paragraph.length && /^\s{0,3}(=+|-+)\s*$/.test(line)) {
      const level = line.trim()[0] === '=' ? 1 : 2; const raw = joinLines(paragraph); paragraph = [];
      drafts.push({ block: { type: 'heading', level, inlines: [] }, raw }); continue;
    }
    if (RULE.test(line)) { flushAll(); closeList(); drafts.push({ block: { type: 'rule' } }); continue; }
    const quoted = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph(); closeList();
      if (!quoted[1].trim()) flushQuote(); else quote.push(quoted[1].replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/, match => (/\d/.test(match) ? match.trim() + ' ' : '• ')));
      continue;
    }
    flushQuote();
    const listItem = ITEM.exec(line);
    if (listItem && !(paragraph.length && !listOpen && /^\d/.test(listItem[2]) && listItem[2] !== '1.' && listItem[2] !== '1)')) {
      flushParagraph();
      const indent = indentWidth(listItem[1]);
      if (!listOpen) { levels = [indent]; lists = []; listOpen = true; }
      else if (indent >= levels[levels.length - 1] + 2) levels.push(indent);
      else { while (levels.length > 1 && indent < levels[levels.length - 1]) levels.pop(); if (indent < levels[levels.length - 1]) levels[levels.length - 1] = indent; }
      const level = Math.min(levels.length - 1, 8);
      let text = listItem[3];
      const task = /^\[([ xX])\]\s+/.exec(text);
      if (task) text = (task[1] === ' ' ? '☐ ' : '☑ ') + text.slice(task[0].length);
      lists.length = level + 1;
      if (/^\d/.test(listItem[2])) {
        let id = lists[level];
        if (id === undefined) { id = ++listCounter; lists[level] = id; listNext.set(id, parseInt(listItem[2], 10)); }
        const number = listNext.get(id)!; listNext.set(id, number + 1);
        item = { block: { type: 'numbered', level, list: id, number, inlines: [] }, raw: text };
      } else {
        lists[level] = undefined;
        item = { block: { type: 'bullet', level, inlines: [] }, raw: text };
      }
      drafts.push(item);
      continue;
    }
    // A line under a list item: its continuation (directly below, or indented after a blank line).
    if (listOpen && item && (!wasBlank || indentWidth(/^\s*/.exec(line)![0]) >= 2)) {
      item.raw = (item.raw ?? '') + (wasBlank ? '\n' : /( {2,}|\\)$/.test(item.raw ?? '') ? '\n' : ' ') + line.trim();
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushAll();
  const blocks: Block[] = [];
  for (const draft of drafts) {
    const block = draft.block;
    if ('inlines' in block && draft.raw !== undefined) block.inlines = parseInline(draft.raw.replace(/\s+$/, ''));
    if ('inlines' in block && !block.inlines.length && block.type !== 'heading') continue;
    if (block.type === 'heading' && !block.inlines.length) continue;
    blocks.push(block);
  }
  return blocks;
}

/** Lower case, single spaces: how a heading is compared with the title. */
export const foldTitle = (value: string) => value.normalize('NFC').toLocaleLowerCase().replace(/[\s:.–—-]+/g, ' ').trim();
