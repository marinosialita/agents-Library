// «Every row» (13 Nov 2026, the n8n / Make study: their most-used agents work through a sheet row by row): the tables
// in an attached document, as rows. Two shapes reach the chat: an Excel file arrives as «## Sheet: name» Markdown
// tables (src/data/xlsx-text.ts) and a .csv / .tsv file or a shared Google Sheet as delimited text. Pure functions.
export type Table = { name: string; header: string[]; rows: string[][]; /** Each row's number in the sheet (the header is 1), when blank rows were left out. */ numbers?: number[] };
export const TABLE_LIMITS = { rows: 200, columns: 40, cell: 2_000, trial: 5 } as const;

/** Markdown tables («| a | b |» lines after a «| --- |» rule), each named by the «## Sheet:» heading above it. */
function markdownTables(text: string, fallback: string): Table[] {
  const tables: Table[] = []; const lines = text.split('\n'); let sheet = fallback;
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
  for (let index = 0; index < lines.length; index++) {
    const heading = /^##\s*Sheet:\s*(.+)$/.exec(lines[index].trim()); if (heading) { sheet = heading[1].trim(); continue; }
    if (!/^\s*\|.*\|\s*$/.test(lines[index]) || !/^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) continue;
    const header = cells(lines[index]); const rows: string[][] = [];
    let at = index + 2;
    while (at < lines.length && /^\s*\|.*\|\s*$/.test(lines[at])) { rows.push(cells(lines[at])); at++; }
    tables.push({ name: sheet, header, rows }); index = at - 1;
  }
  return tables;
}

/** Delimited text (comma, semicolon or tab, whichever the first line uses most), with quoted cells («"a, b"», «""»). */
export function delimitedRows(text: string): string[][] {
  const first = text.split('\n', 1)[0] ?? '';
  const counts = [',', ';', '\t'].map(mark => ({ mark, n: first.split(mark).length - 1 })).sort((a, b) => b.n - a.n);
  const mark = counts[0].n ? counts[0].mark : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === mark) { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && body[index + 1] === '\n') index++; row.push(cell.trim()); cell = ''; if (row.some(Boolean)) rows.push(row); row = []; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** Cleans a table: a header for every column («Column 3» where blank), rows padded or cut to its width, empty rows
 *  and columns beyond the limits dropped. */
export function tidyTable(name: string, header: string[], rows: string[][]): Table | null {
  const width = Math.min(TABLE_LIMITS.columns, Math.max(header.length, ...rows.map(row => row.length), 0));
  if (!width) return null;
  const head = Array.from({ length: width }, (_, index) => (header[index] ?? '').trim().slice(0, 120) || `Column ${index + 1}`);
  // 13 Nov 2026 (code review): blank rows are left out, but each row keeps its number in the sheet.
  const kept = rows.map((row, at) => ({ at, cells: Array.from({ length: width }, (_, index) => (row[index] ?? '').trim().slice(0, TABLE_LIMITS.cell)) })).filter(row => row.cells.some(Boolean));
  if (!kept.length) return null;
  const numbers = kept.map(row => row.at + 2);
  return { name: name.slice(0, 120), header: head, rows: kept.map(row => row.cells), ...(numbers.some((n, i) => n !== i + 2) ? { numbers } : {}) };
}

/** Every table in a document: Excel sheets, Markdown tables, or the whole file as CSV / TSV. At least one data row. */
export function tablesIn(documentName: string, text: string): Table[] {
  const fromMarkdown = markdownTables(text, documentName.replace(/\.[a-z0-9]+$/i, ''));
  const found = fromMarkdown.length ? fromMarkdown.map(table => tidyTable(table.name, table.header, table.rows))
    : /\.(csv|tsv|txt)$/i.test(documentName) || /^[^\n]*[,;\t][^\n]*\n[^\n]*[,;\t]/.test(text)
      ? (rows => rows.length >= 2 ? [tidyTable(documentName.replace(/\.[a-z0-9]+$/i, ''), rows[0], rows.slice(1))] : [])(delimitedRows(text))
      : [];
  return found.filter((table): table is Table => !!table && table.rows.length >= 1);
}

/** A table pasted into the message box (13 Nov 2026: rows copied from Excel or Google Sheets got no «Every row»): the
 *  block of tab-separated lines, or a Markdown table, with a header and at least two rows and two columns; `rest` is the
 *  words around it (the task). Commas in prose are never read as a table. */
export function pastedTable(text: string): { table: Table; rest: string } | null {
  const lines = text.split('\n'); let start = -1, end = -1;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes('\t')) { if (start < 0) start = index; end = index; }
    else if (start >= 0 && lines[index].trim()) break;
  }
  if (start >= 0 && end - start >= 2) {
    const block = lines.slice(start, end + 1).filter(line => line.trim());
    const rows = block.map(line => line.split('\t'));
    const table = tidyTable('The table you pasted', rows[0], rows.slice(1).slice(0, TABLE_LIMITS.rows));
    if (table && table.header.length >= 2 && table.rows.length >= 2) return { table, rest: [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n').trim() };
  }
  const markdown = markdownTables(text, 'The table you pasted').map(table => tidyTable(table.name, table.header, table.rows.slice(0, TABLE_LIMITS.rows))).find(table => !!table && table.header.length >= 2 && table.rows.length >= 2);
  return markdown ? { table: markdown, rest: lines.filter(line => !/^\s*\|.*\|\s*$/.test(line) && !/^\s*\|?\s*:?-{3,}/.test(line)).join('\n').trim() } : null;
}

/** One row as the agent reads it: «Column: value» lines, empty cells left out. */
export const rowText = (table: Pick<Table, 'header'>, row: string[]) => table.header.map((column, index) => row[index] ? `- ${column}: ${row[index]}` : '').filter(Boolean).join('\n');

/** A Google Sheets link → its CSV export address (the sheet's own tab when the link names one). Null for anything else. */
export function sheetCsvUrl(link: string): string | null {
  let url: URL; try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/.exec(url.pathname)?.[1]; if (!id) return null;
  const gid = /(?:^|[#&?])gid=(\d{1,12})/.exec(url.hash + url.search)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}
