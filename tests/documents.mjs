// Reading Excel (.xlsx) on the device: the workbook's own XML, no library. A workbook made by our own writer is read
// back, and hand-written XML covers shared and inline strings, booleans, gaps, escaping, hidden sheets and limits.
import assert from 'node:assert/strict';
import { answerXlsx } from '../src/data/office/xlsx.ts';
import { zipEntryText } from '../src/data/document-text.ts';
import { columnIndex, sharedStrings, sheetList, sheetMarkdown, sheetRows, workbookText } from '../src/data/xlsx-text.ts';

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok   ${name}`); };

await check('columns: A, Z, AA, AB and a row number', () => {
  assert.deepEqual(['A1', 'Z9', 'AA10', 'AB3'].map(columnIndex), [0, 25, 26, 27]);
});

await check('cells: shared and inline strings, numbers, booleans, gaps, escapes, phonetic hints left out', () => {
  const strings = sharedStrings('<sst><si><t>Name</t></si><si><r><t>Total </t></r><r><t xml:space="preserve">€</t></r></si><si><t>A &amp; B</t><rPh><t>x</t></rPh></si><si/></sst>');
  assert.deepEqual(strings, ['Name', 'Total €', 'A & B', '']);
  const xml = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"/><row r="3"><c r="A3" t="inlineStr"><is><t>Line\none</t></is></c><c r="B3"><v>1250.5</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" t="s"><v>2</v></c><c r="E3"/></row></sheetData>';
  const { rows, truncated } = sheetRows(xml, strings);
  assert.deepEqual(rows, [['Name', '', 'Total €'], ['Line one', '1250.5', 'TRUE', 'A & B']]);
  assert.equal(truncated, false);
  assert.equal(sheetMarkdown('Costs', [['a|b', 'c'], ['1']]), '## Sheet: Costs\n| a\\|b | c |\n| --- | --- |\n| 1 |  |');
});

await check('sheets: workbook order, relationship targets, hidden sheets skipped; row and column limits say so', () => {
  const sheets = sheetList('<sheets><sheet name="Summary" sheetId="1" r:id="rId2"/><sheet name="Secret" state="hidden" sheetId="2" r:id="rId1"/><sheet name="Data &amp; notes" sheetId="3" r:id="rId3"/></sheets>',
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="/xl/worksheets/sheet3.xml"/></Relationships>');
  assert.deepEqual(sheets, [{ name: 'Summary', path: 'xl/worksheets/sheet2.xml' }, { name: 'Data & notes', path: 'xl/worksheets/sheet3.xml' }]);
  const many = `<sheetData>${Array.from({ length: 5 }, (_, i) => `<row><c r="A${i + 1}"><v>${i}</v></c><c r="Z${i + 1}"><v>9</v></c></row>`).join('')}</sheetData>`;
  const cut = sheetRows(many, [], { sheets: 1, rowsPerSheet: 3, columns: 10 });
  assert.deepEqual([cut.rows.length, cut.rows[0], cut.truncated], [3, ['0'], true]);
});

await check('round trip: a workbook made by our own Excel writer reads back with its headings and figures', async () => {
  const bytes = answerXlsx({ title: 'Budget 2027', markdown: '## Costs\n\n| Item | Amount |\n| --- | --- |\n| Rent | 12000 |\n| Staff & tax | 48500.75 |' });
  assert.ok(bytes, 'the writer made a file');
  const { text } = await workbookText(path => zipEntryText(bytes, path));
  assert.match(text, /## Sheet: /);
  for (const expected of ['Item', 'Amount', 'Rent', '12000', 'Staff & tax', '48500.75']) assert.ok(text.includes(expected), `missing ${expected}\n${text}`);
});

await check('a file that is not a workbook is refused in words', async () => {
  await assert.rejects(workbookText(async () => null), /could not be read/);
});

console.log(`${passed} document checks passed.`);
