// «Every row» (shared/table-rows.ts, server/sheet-csv.ts): tables out of Excel text and CSV, Google Sheets links, and
// the reader that refuses private sheets and anything but docs.google.com.
import assert from 'node:assert/strict';
import { delimitedRows, rowText, sheetCsvUrl, tablesIn, tidyTable, TABLE_LIMITS } from '../shared/table-rows.ts';
import { pastedTable } from '../shared/table-rows.ts';
import { createSheetCsvHandler } from '../server/sheet-csv.ts';
import { sheetMarkdown } from '../src/data/xlsx-text.ts';
import { batchSummary, cellOf } from '../src/data/batch.ts';

let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); process.exitCode = 1; } };
await test('an Excel workbook as text gives one table per sheet, named, with escaped pipes kept', () => {
  const text = [sheetMarkdown('Leads', [['Company', 'Country', 'Notes'], ['Acme | Ltd', 'Cyprus', 'met at fair'], ['Beta', 'Greece', '']]), sheetMarkdown('Empty', [])].join('\n\n');
  const tables = tablesIn('leads.xlsx', text);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0], { name: 'Leads', header: ['Company', 'Country', 'Notes'], rows: [['Acme | Ltd', 'Cyprus', 'met at fair'], ['Beta', 'Greece', '']] });
});
await test('CSV with quotes, commas inside cells, CRLF, semicolons and a BOM', () => {
  assert.deepEqual(delimitedRows('﻿Name,Note\r\n"Smith, J","said ""yes"""\r\n'), [['Name', 'Note'], ['Smith, J', 'said "yes"']]);
  assert.deepEqual(delimitedRows('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(tablesIn('people.csv', 'Name,Role\nAnna,CFO\n\nBob,CTO\n')[0].rows, [['Anna', 'CFO'], ['Bob', 'CTO']]);
});
await test('a prose document has no table; a header without rows is not a table', () => {
  assert.deepEqual(tablesIn('letter.docx', 'Dear Sir,\nThank you for your letter.'), []);
  assert.deepEqual(tablesIn('one.csv', 'Name,Role\n'), []);
});
await test('blank headers get names, wide tables are cut to the column limit, one row reads as Column: value', () => {
  const table = tidyTable('T', ['Company', ''], [['Acme', 'x', 'extra']]);
  assert.deepEqual(table.header, ['Company', 'Column 2', 'Column 3']);
  assert.equal(tidyTable('W', Array.from({ length: 60 }, (_, i) => `C${i}`), [['1']]).header.length, TABLE_LIMITS.columns);
  assert.equal(rowText({ header: ['Company', 'Country', 'Notes'] }, ['Acme', '', 'hot lead']), '- Company: Acme\n- Notes: hot lead');
});
await test('Google Sheets links become CSV exports (with the tab); anything else is refused', () => {
  assert.equal(sheetCsvUrl('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=12345'), 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=12345');
  assert.equal(sheetCsvUrl('https://evil.example/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'), null);
  assert.equal(sheetCsvUrl('http://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'), null);
  assert.equal(sheetCsvUrl('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'), null);
});
const get = url => new Request(`http://localhost/api/sheet-csv?url=${encodeURIComponent(url)}`);
const SHEET = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit';
await test('the reader: a shared sheet comes back as CSV; a private one says so; never follows a sign-in redirect', async () => {
  let asked = [];
  const ok = createSheetCsvHandler({ fetcher: async (url, init) => { asked.push([String(url), init.redirect]); return new Response('a,b\n1,2', { headers: { 'content-type': 'text/csv' } }); } });
  assert.deepEqual(await (await ok(get(SHEET))).json(), { csv: 'a,b\n1,2' });
  assert.deepEqual(asked[0], ['https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv', 'manual']);
  const signIn = createSheetCsvHandler({ fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin?continue=x' } }) });
  const refused = await signIn(get(SHEET)); assert.equal(refused.status, 403); assert.equal((await refused.json()).error, 'private');
  const moved = []; const viaContent = createSheetCsvHandler({ fetcher: async (url) => { moved.push(String(url)); return moved.length === 1 ? new Response(null, { status: 307, headers: { location: 'https://doc-0s-1c-sheets.googleusercontent.com/export/abc' } }) : new Response('x,y\n3,4', { headers: { 'content-type': 'text/csv' } }); } });
  assert.deepEqual(await (await viaContent(get(SHEET))).json(), { csv: 'x,y\n3,4' });
  const html = createSheetCsvHandler({ fetcher: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) });
  assert.equal((await html(get(SHEET))).status, 403);
  assert.equal((await ok(get('https://evil.example/x'))).status, 400);
});

await test('a row result becomes one readable Excel cell; the chat summary lists every row', () => {
  assert.equal(cellOf('| Lead | Score | Tier |\n|---|---:|---|\n| Nordvik | **90/100** | A |\n\nCall the CFO this week.'), 'Lead: Nordvik · Score: 90/100 · Tier: A · Call the CFO this week.');
  assert.equal(cellOf('**A**: strong fit.\n\n- Call\n- Email'), 'A: strong fit. · Call · Email');
  const summary = batchSummary('Score it', 'leads.csv', [{ index: 0, key: 'Acme', status: 'done', answer: 'Tier A' }, { index: 1, key: 'Be|ta', status: 'failed', error: 'x' }]);
  assert.match(summary, /\*\*Every row of leads\.csv:\*\* 1 of 2 done\./);
  assert.match(summary, /\| 2 \| Acme \| Tier A \|\n\| 3 \| Be\/ta \| Not finished \|/);
});

await test('a table pasted into the box: tab-separated rows or Markdown, the words around it are the task; prose with commas is not a table', () => {
  const tab = pastedTable('Score these leads:\nCompany\tEmployees\tCountry\nAcme\t120\tCyprus\nBlue\t35\tMalta');
  assert.deepEqual(tab?.table.header, ['Company', 'Employees', 'Country']); assert.equal(tab?.table.rows.length, 2); assert.equal(tab?.rest, 'Score these leads:');
  assert.equal(pastedTable('I like apples, pears, and plums.\nAnd also, sometimes, figs.\nYes, really, I do.'), null);
  assert.equal(pastedTable('a\tb\nc\td'), null, 'one row is not a list to work through');
  assert.equal(pastedTable('| Name | Size |\n|---|---|\n| A | 1 |\n| B | 2 |\nRank them')?.rest, 'Rank them');
});

await test('the sheet route asks for a sign-in before it fetches anything (13 Nov 2026, code review)', async () => {
  let fetched = 0;
  const handler = createSheetCsvHandler({ fetcher: async () => { fetched++; return new Response('a,b\n1,2'); }, signedIn: async () => false });
  const response = await handler(new Request('http://localhost/api/sheet-csv?url=https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit'));
  assert.equal(response.status, 401); assert.equal(fetched, 0);
});

console.log(`\n${passed} passed`);
