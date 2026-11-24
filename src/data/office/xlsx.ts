// An answer's tables as an Excel workbook: one sheet per Markdown table, named after the nearest heading above it,
// the header row bold on the accent fill and frozen, numbers stored as numbers when they are beyond doubt (with a
// format that shows them as written), widths from the content, links clickable, the brand in the print header.
// No table in the answer: no workbook (null).
import { type Brand, accentOf, FONT, appPropsXml, contentTypesXml, corePropsXml, dateOr, INK, inkAccent, LINE, NS_REL, officeZip, onAccent, REL, type Rel, relsXml, rootRels, safeUrl, xml } from './brand.ts';
import { columnNumberStyle, type Inline, parseBlocks, plainText, readNumber, type TableBlock } from './blocks.ts';

const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const MAX_CELL = 32767;
const BUILT_IN_FORMATS: Record<string, number> = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };

/** Excel's sheet name rules: at most 31 characters, none of []:*?/\, no apostrophe at either end, unique ignoring case. */
export function sheetNames(wanted: string[]): string[] {
  const used = new Set<string>(); const out: string[] = [];
  const cut = (value: string, max: number) => { const chars = [...value]; let text = ''; for (const char of chars) { if ((text + char).length > max) break; text += char; } return text.trim(); };
  wanted.forEach((raw, index) => {
    let base = String(raw ?? '').replace(/[[\]:*?/\\]/g, ' ').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
    if (!base || base.toLowerCase() === 'history') base = base ? `${base} table` : `Table ${index + 1}`;
    base = cut(base, 31).replace(/'+$/, '').trim() || `Table ${index + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) { const suffix = ` (${n})`; name = cut(base, 31 - suffix.length).replace(/'+$/, '') + suffix; }
    used.add(name.toLowerCase()); out.push(name);
  });
  return out;
}

const columnLetters = (index: number) => { let n = index + 1; let out = ''; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; };
/** Text for the print header and footer: «&» doubled, kept short. */
const hf = (value: string, max = 80) => { const text = value.replace(/\s+/g, ' ').trim(); return (text.length > max ? text.slice(0, max - 1) + '…' : text).replace(/&/g, '&&'); };

/** Cell formats, shared by every sheet: each distinct (number format, bold) pair is one xf. */
class CellStyles {
  private formats = new Map<string, number>();
  private xfs: string[] = [];
  private keys = new Map<string, number>();
  readonly header: number; readonly text: number; readonly bold: number; readonly link: number;
  constructor() {
    this.xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    this.header = this.add('<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>');
    this.text = this.add('<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>');
    this.bold = this.add('<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>');
    this.link = this.add('<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>');
  }
  private add(xf: string): number { this.xfs.push(xf); return this.xfs.length - 1; }
  number(format: string, bold: boolean): number {
    let id = BUILT_IN_FORMATS[format];
    if (id === undefined) { id = this.formats.get(format) ?? 164 + this.formats.size; this.formats.set(format, id); }
    const key = `${id}|${bold}`;
    let xf = this.keys.get(key);
    if (xf === undefined) { xf = this.add(`<xf numFmtId="${id}" fontId="${bold ? 2 : 0}" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"${bold ? ' applyFont="1"' : ''} applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>`); this.keys.set(key, xf); }
    return xf;
  }
  xml(accent: string): string {
    const font = (extra: string, color: string) => `<font>${extra}<sz val="11"/><color rgb="FF${color}"/><name val="${xml(FONT)}"/><family val="2"/></font>`;
    const side = (name: string) => `<${name} style="thin"><color rgb="FF${LINE}"/></${name}>`;
    const numFmts = this.formats.size ? `<numFmts count="${this.formats.size}">${[...this.formats].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xml(code)}"/>`).join('')}</numFmts>` : '';
    return `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}`
      + `<fonts count="4">${font('', INK)}${font('<b/>', onAccent(accent))}${font('<b/>', INK)}${font('<u/>', inkAccent(accent))}</fonts>`
      + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${accent}"/><bgColor indexed="64"/></patternFill></fill></fills>`
      + `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border></borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>';
  }
}

type Sheet = { xml: string; rels: Rel[]; range: string };
function sheetXml(table: TableBlock, styles: CellStyles, first: boolean, print: { header: string; footer: string }, accent: string): Sheet {
  const columns = table.header.length;
  const rels: Rel[] = []; const links = new Map<string, string>(); const hyperlinks: string[] = [];
  const linkOf = (inlines: Inline[]) => { const url = inlines.find(inline => inline.link)?.link; const target = url ? safeUrl(url) : null; if (!target) return null; let id = links.get(target); if (!id) { id = `rId${links.size + 1}`; links.set(target, id); rels.push({ id, type: REL.hyperlink, target, external: true }); } return id; };
  const textCell = (ref: string, text: string, style: number) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(text.length > MAX_CELL ? text.slice(0, MAX_CELL) : text)}</t></is></c>`;
  const widths = Array.from({ length: columns }, () => 8);
  const measure = (c: number, text: string, factor = 1) => { const longest = Math.max(...text.split('\n').map(line => [...line].length)); widths[c] = Math.max(widths[c], Math.min(60, Math.ceil(longest * factor * 1.1) + 2)); };
  const rows: string[] = [];
  rows.push(`<row r="1">${table.header.map((inlines, c) => { const text = plainText(inlines); measure(c, text, 1.15); return textCell(`${columnLetters(c)}1`, text, styles.header); }).join('')}</row>`);
  const numberStyle = Array.from({ length: columns }, (_, c) => columnNumberStyle(table.rows.map(row => plainText(row[c] ?? []))));
  table.rows.forEach((row, r) => {
    const rowNumber = r + 2;
    const cells = row.map((inlines, c) => {
      const ref = `${columnLetters(c)}${rowNumber}`;
      const text = plainText(inlines).trim();
      if (!text) return `<c r="${ref}" s="${styles.text}"/>`;
      const bold = inlines.every(inline => inline.bold || !inline.text.trim());
      measure(c, text);
      const number = readNumber(text, numberStyle[c]);
      if (number) return `<c r="${ref}" s="${styles.number(number.format, bold)}"><v>${number.value}</v></c>`;
      const link = linkOf(inlines);
      if (link) { hyperlinks.push(`<hyperlink ref="${ref}" r:id="${link}"/>`); return textCell(ref, text, styles.link); }
      return textCell(ref, text, bold ? styles.bold : styles.text);
    });
    rows.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
  });
  const last = `${columnLetters(columns - 1)}${table.rows.length + 1}`;
  const range = `A1:${last}`;
  const cols = widths.map((width, c) => `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`).join('');
  const wide = widths.reduce((a, b) => a + b, 0) > 110;
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}">`
    + `<sheetPr><tabColor rgb="FF${accent}"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${range}"/>`
    + `<sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="${range}"/>`
    + (hyperlinks.length ? `<hyperlinks>${hyperlinks.join('')}</hyperlinks>` : '')
    + `<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${wide ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
    + `<headerFooter><oddHeader>${xml(print.header)}</oddHeader><oddFooter>${xml(print.footer)}</oddFooter></headerFooter></worksheet>`;
  return { xml: sheet, rels, range };
}

export function answerXlsx(input: { title: string; markdown: string; brand?: Brand; date?: Date }): Uint8Array | null {
  const date = dateOr(input.date); const accent = accentOf(input.brand);
  const title = String(input.title ?? '').trim() || 'Answer';
  const tables: { heading: string; table: TableBlock }[] = [];
  let heading = '';
  for (const block of parseBlocks(input.markdown)) {
    if (block.type === 'heading') heading = plainText(block.inlines);
    if (block.type === 'table' && block.header.length) tables.push({ heading, table: block });
  }
  if (!tables.length) return null;
  const names = sheetNames(tables.map(item => item.heading));
  const brandName = input.brand?.name?.trim() ?? '';
  const print = {
    header: brandName ? `&L&"-,Bold"${hf(brandName)}&R${hf(title)}` : `&L${hf(title)}`,
    footer: `${input.brand?.footer?.trim() ? `&L${hf(input.brand.footer)}` : ''}&RPage &P of &N`,
  };
  const styles = new CellStyles();
  const sheets = tables.map((item, index) => sheetXml(item.table, styles, index === 0, print, accent));
  const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;
  const workbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>`
    + `<sheets>${names.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>`
    + `<definedNames>${sheets.map((sheet, index) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xml(`${quoted(names[index])}!$${sheet.range.replace(':', ':$').replace(/(\d+)/g, '$$$1')}`)}</definedName>`).join('')}</definedNames></workbook>`;
  const parts: [string, string | Uint8Array][] = [
    ['[Content_Types].xml', contentTypesXml([['/xl/workbook.xml', `${SML}.sheet.main+xml`], ['/xl/styles.xml', `${SML}.styles+xml`], ...sheets.map((_, index) => [`/xl/worksheets/sheet${index + 1}.xml`, `${SML}.worksheet+xml`] as [string, string])])],
    ['_rels/.rels', rootRels('xl/workbook.xml')],
    ['docProps/core.xml', corePropsXml(title, brandName || 'Agents', date)],
    ['docProps/app.xml', appPropsXml(brandName)],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', relsXml([...sheets.map((_, index) => ({ id: `rId${index + 1}`, type: `${NS_REL}/worksheet`, target: `worksheets/sheet${index + 1}.xml` })), { id: `rId${sheets.length + 1}`, type: REL.styles, target: 'styles.xml' }])],
    ['xl/styles.xml', ''],
  ];
  sheets.forEach((sheet, index) => {
    parts.push([`xl/worksheets/sheet${index + 1}.xml`, sheet.xml]);
    if (sheet.rels.length) parts.push([`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, relsXml(sheet.rels)]);
  });
  // Styles last: every sheet has registered its number formats by now.
  parts[parts.findIndex(([name]) => name === 'xl/styles.xml')][1] = styles.xml(accent);
  return officeZip(parts, date);
}
