// Excel (.xlsx) as text for the agents (11 Nov 2026): every sheet as a table of rows, values as Excel shows them
// before formatting. Read on this device from the workbook's own XML (the same zip reader as Word), no library: the
// SheetJS build on npm (0.18.5) carries known advisories. Formulas give their last saved value; charts and images are
// skipped. Pure string functions, so the tests run them without a browser.
export const XLSX_LIMITS = { sheets: 20, rowsPerSheet: 2_000, columns: 60 } as const;

const decode = (text: string) => text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|amp|quot|apos));/gi, (_, dec, hex, named) =>
  dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[named.toLowerCase()]);
const attr = (tag: string, name: string) => { const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return found ? decode(found[1]) : undefined; };
/** The text of every <t> in a run of XML (rich text keeps its pieces, phonetic hints <rPh> are left out). */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(match => decode(match[1] ?? '')).join('');

export function sharedStrings(xml: string | null): string[] {
  return xml ? [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map(match => textOf(match[1] ?? '')) : [];
}

/** The sheets in workbook order, each with the file path of its XML. */
export function sheetList(workbook: string, rels: string | null): { name: string; path: string }[] {
  const targets = new Map<string, string>();
  for (const match of (rels ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(match[0], 'Id'), target = attr(match[0], 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((match, index) => {
    const id = attr(match[0], 'r:id');
    return { name: attr(match[0], 'name') ?? `Sheet ${index + 1}`, path: (id && targets.get(id)) || `xl/worksheets/sheet${index + 1}.xml`, hidden: attr(match[0], 'state') === 'hidden' };
  }).filter(sheet => !sheet.hidden).map(({ name, path }) => ({ name, path }));
}

/** Column letters → 0-based index («A» → 0, «AB» → 27). */
export const columnIndex = (ref: string) => { let n = 0; for (const letter of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + letter.charCodeAt(0) - 64; return n - 1; };

/** One sheet's rows, as text cells; empty rows are dropped, trailing empty cells trimmed. */
export function sheetRows(xml: string, strings: string[], limits = XLSX_LIMITS): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = []; let truncated = false;
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= limits.rowsPerSheet) { truncated = true; break; }
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = `<c${cell[1]}>`, body = cell[2] ?? '';
      const ref = attr(head, 'r'); const at = ref ? columnIndex(ref) : cells.length;
      if (at < 0 || at >= limits.columns) { if (at >= limits.columns) truncated = true; continue; }
      const type = attr(head, 't'); const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === 's' ? (strings[Number(raw)] ?? '')
        : type === 'inlineStr' ? textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '')
        : type === 'b' ? (raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '')
        : raw !== undefined ? decode(raw) : '';
      while (cells.length < at) cells.push('');
      cells[at] = value.replace(/\s*\n\s*/g, ' ').trim();
    }
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (cells.length) rows.push(cells);
  }
  return { rows, truncated };
}

/** A sheet as a Markdown table the model reads well; a cell's «|» is escaped. */
export function sheetMarkdown(name: string, rows: string[][]): string {
  if (!rows.length) return `## Sheet: ${name}\n(empty)`;
  const width = Math.max(...rows.map(row => row.length));
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => (row[index] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
  return [`## Sheet: ${name}`, line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

/** The whole workbook as text, through a reader of zip entries (src/data/document-text.ts). */
export async function workbookText(read: (path: string) => Promise<string | null>): Promise<{ text: string; truncated: boolean }> {
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('The Excel file could not be read. Save it again as .xlsx.');
  const strings = sharedStrings(await read('xl/sharedStrings.xml'));
  const sheets = sheetList(workbook, await read('xl/_rels/workbook.xml.rels'));
  let truncated = sheets.length > XLSX_LIMITS.sheets; const parts: string[] = [];
  for (const sheet of sheets.slice(0, XLSX_LIMITS.sheets)) {
    const xml = await read(sheet.path); if (!xml) continue;
    const { rows, truncated: cut } = sheetRows(xml, strings);
    truncated ||= cut;
    parts.push(sheetMarkdown(sheet.name, rows) + (cut ? `\n(only the first ${XLSX_LIMITS.rowsPerSheet.toLocaleString('en-GB')} rows and ${XLSX_LIMITS.columns} columns)` : ''));
  }
  return { text: parts.join('\n\n'), truncated };
}
