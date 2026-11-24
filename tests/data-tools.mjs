// The new apps (13 Nov 2026): Sheets / Docs / Meet / Airtable / Salesforce readers, the rows and LinkedIn proposals,
// their actions, and the Connections page staying symmetric.
import assert from 'node:assert/strict';
import { dataTools, docIdOf, sheetIdOf, tableMarkdown } from '../server/connected/data-tools.ts';
import { readAction, unseenAddresses } from '../shared/app-actions.ts';
import { performAction, sheetCell } from '../server/app-action.ts';
import { CONNECTORS, FAMILIES } from '../shared/connections.ts';
import { UPDATE_READERS } from '../server/connected/updates.ts';
import { appsAsked } from '../server/connected/ask.ts';
import { isMailAgent } from '../shared/agents.ts';
import { FIELD_CATALOGUES } from '../src/data/templates/fields/index.ts';
import { AGENT_TEMPLATES } from '../src/data/templates/index.ts';

let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); process.exitCode = 1; } };
const names = { mask: t => t.replace(/Helen Smith/g, '[APP PERSON 1]'), restore: t => t.replace(/\[APP PERSON 1\]/g, 'Helen Smith') };
const SHEET = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const setup = (services, replies) => { const calls = []; const proposed = [];
  const exec = async (slug, args) => { calls.push([slug, args]); const reply = replies[slug]; if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(args) : reply; };
  const state = { names, sheets: new Map(), gaps: new Set() };
  const tools = dataTools(exec, services, state, value => { const action = readAction(value); if (!action) return JSON.stringify({ error: 'invalid' }); proposed.push(action); return JSON.stringify({ ok: true }); });
  const call = async (name, args) => { const found = tools.find(item => item.name === name); assert.ok(found, `no tool ${name}`); return JSON.parse(await found.invoke({}, JSON.stringify(args))); };
  return { calls, proposed, tools, call, state };
};

await test('ids from links; a table for the model, trimmed', () => {
  assert.equal(sheetIdOf(`https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`), SHEET);
  assert.equal(docIdOf(`https://docs.google.com/document/d/${SHEET}/edit`), SHEET);
  assert.equal(sheetIdOf('not a link'), '');
  assert.equal(tableMarkdown([['A', 'B'], ['1', 'x|y']]), '| A | B |\n| --- | --- |\n| 1 | x/y |');
  assert.match(tableMarkdown([['A'], ...Array.from({ length: 300 }, (_, i) => [String(i)])]), /\(100 more rows not shown\)$/);
});
await test('only the tools of connected apps are offered', () => {
  assert.deepEqual(setup(['gmail'], {}).tools.map(item => item.name), []);
  assert.deepEqual(setup(['googlesheets', 'linkedin'], {}).tools.map(item => item.name), ['sheets_find', 'sheets_read', 'propose_sheet_rows', 'propose_linkedin_post']);
});
await test('a sheet is read as a table with names masked; rows can be proposed only for a sheet that was read', async () => {
  const run = setup(['googlesheets'], { GOOGLESHEETS_GET_SHEET_NAMES: { sheet_names: ['Leads', 'Old'] }, GOOGLESHEETS_VALUES_GET: { range: "'Leads'!A1:AN201", values: [['Name', 'Company'], ['Helen Smith', 'Acme']] } });
  const early = await run.call('propose_sheet_rows', { spreadsheet: SHEET, tab: 'Leads', title: 'Leads', rows: [['Bob', 'Beta']] });
  assert.match(early.error, /Read the sheet with sheets_read first/);
  const read = await run.call('sheets_read', { spreadsheet: `https://docs.google.com/spreadsheets/d/${SHEET}/edit`, tab: null });
  assert.equal(read.tab, 'Leads'); assert.equal(read.rows, 1);
  assert.match(read.table, /\| \[APP PERSON 1\] \| Acme \|/);
  assert.deepEqual(run.calls[1], ['GOOGLESHEETS_VALUES_GET', { spreadsheet_id: SHEET, range: "'Leads'!A1:AN201", value_render_option: 'FORMATTED_VALUE', date_time_render_option: 'FORMATTED_STRING' }]);
  assert.match((await run.call('propose_sheet_rows', { spreadsheet: SHEET, tab: 'Nope', title: 'Leads', rows: [['x']] })).error, /no tab «Nope»/);
  assert.deepEqual(await run.call('propose_sheet_rows', { spreadsheet: SHEET, tab: 'Leads', title: 'Leads', rows: [['[APP PERSON 1]', 'Gamma']] }), { ok: true });
  assert.deepEqual(run.proposed[0], { kind: 'rows', service: 'googlesheets', spreadsheetId: SHEET, sheet: 'Leads', title: 'Leads', values: [['Helen Smith', 'Gamma']] });
});
await test('docs, meet transcripts and airtable read; a failure becomes a stated gap', async () => {
  const run = setup(['googledocs', 'googlemeet', 'airtable'], {
    GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT: { response: { plain_text: 'Minutes: Helen Smith agreed.' } },
    GOOGLEMEET_LIST_CONFERENCE_RECORDS: { data: { conferenceRecords: [{ name: 'conferenceRecords/abc' }] } },
    GOOGLEMEET_GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID: { data: { transcripts: [{ name: 'conferenceRecords/abc/transcripts/t1' }] } },
    GOOGLEMEET_LIST_TRANSCRIPT_ENTRIES: { data: { transcriptEntries: [{ participant: 'Helen Smith', text: 'Price is fine.' }] } },
    AIRTABLE_LIST_RECORDS: new Error('composio_tool_500') });
  assert.equal((await run.call('docs_read', { document: SHEET })).text, 'Minutes: [APP PERSON 1] agreed.');
  const meet = await run.call('meet_transcript', { conference: null });
  assert.equal(meet.entries, '[APP PERSON 1]: Price is fine.');
  assert.deepEqual(run.calls.find(([slug]) => slug === 'GOOGLEMEET_LIST_TRANSCRIPT_ENTRIES')[1], { conference_record_id: 'abc', transcript_id: 't1', page_size: 100 });
  assert.match((await run.call('airtable_records', { base: 'appABCDEFGHIJKLMN', table: 'Leads' })).error, /could not be read/);
  assert.deepEqual([...run.state.gaps], ['Airtable could not be read this time.']);
});
await test('salesforce: one SELECT only, a LIMIT added', async () => {
  const run = setup(['salesforce'], { SALESFORCE_RUN_SOQL_QUERY: { data: { records: [{ attributes: {}, Name: 'Acme deal', Amount: 5000 }] } } });
  assert.match((await run.call('salesforce_query', { soql: 'DELETE FROM Opportunity WHERE x' })).error, /Only one SELECT/);
  assert.match((await run.call('salesforce_query', { soql: 'SELECT Id FROM Lead; SELECT Id FROM Account' })).error, /Only one SELECT/);
  assert.deepEqual(await run.call('salesforce_query', { soql: 'SELECT Name, Amount FROM Opportunity' }), [{ Name: 'Acme deal', Amount: '5000' }]);
  assert.equal(run.calls[0][1].query, 'SELECT Name, Amount FROM Opportunity LIMIT 200');
});
await test('a LinkedIn post is only proposed; posting reads the profile id and posts as that person', async () => {
  const run = setup(['linkedin'], {});
  await run.call('propose_linkedin_post', { text: 'We closed our first deal with [APP PERSON 1].', visibility: 'PUBLIC' });
  assert.deepEqual(run.proposed[0], { kind: 'post', service: 'linkedin', text: 'We closed our first deal with Helen Smith.', visibility: 'PUBLIC' });
  assert.equal(readAction({ kind: 'post', service: 'linkedin', text: 'x'.repeat(3001) }), null);
  assert.deepEqual(unseenAddresses(run.proposed[0], ''), []);
  const calls = []; const composio = { key: () => 'k', authConfigs: () => ({}), ownerCode: () => '', fetcher: async (url, init) => { const slug = String(url).split('/').pop(); calls.push([slug, JSON.parse(init.body).arguments]);
    return Response.json({ successful: true, data: slug === 'LINKEDIN_GET_MY_INFO' ? { id: 'F6kGF1Uduq' } : { id: 'urn:li:share:123' } }); } };
  const done = await performAction(composio, run.proposed[0]);
  assert.deepEqual(calls[1], ['LINKEDIN_CREATE_LINKED_IN_POST', { author: 'urn:li:person:F6kGF1Uduq', commentary: 'We closed our first deal with Helen Smith.', visibility: 'PUBLIC', lifecycleState: 'PUBLISHED' }]);
  assert.equal(done.link, 'https://www.linkedin.com/feed/update/urn:li:share:123/');
});
await test('rows are appended as typed, after the last row of the named tab; bad rows are refused', async () => {
  assert.equal(readAction({ kind: 'rows', service: 'googlesheets', spreadsheetId: SHEET, sheet: 'Le:ads', values: [['a']] }), null);
  assert.equal(readAction({ kind: 'rows', service: 'googlesheets', spreadsheetId: SHEET, sheet: 'Leads', values: [['', '']] }), null);
  assert.equal(readAction({ kind: 'rows', service: 'googlesheets', spreadsheetId: SHEET, sheet: 'Leads', values: Array.from({ length: 51 }, () => ['x']) }), null);
  const calls = []; const composio = { key: () => 'k', authConfigs: () => ({}), ownerCode: () => '', fetcher: async (url, init) => { calls.push(JSON.parse(init.body).arguments); return Response.json({ successful: true, data: {} }); } };
  const done = await performAction(composio, readAction({ kind: 'rows', service: 'googlesheets', spreadsheetId: SHEET, sheet: "Bob's leads", title: 'Leads', values: [['Gamma', 42]] }));
  assert.deepEqual(calls[0], { spreadsheetId: SHEET, range: "'Bob''s leads'!A1", values: [['Gamma', '42']], valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', majorDimension: 'ROWS' });
  assert.equal(done.link, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`);
  // 13 Nov 2026 (code review): what Sheets would turn into a formula, or strip of its leading zero, stays text.
  assert.deepEqual(['=IMPORTXML("x")', '+357 99 123456', '@me', '-note', '0099', '-5', '12.5', '2026-11-13', 'Plain'].map(sheetCell),
    ["'=IMPORTXML(\"x\")", "'+357 99 123456", "'@me", "'-note", "'0099", '-5', '12.5', '2026-11-13', 'Plain']);
});
await test('the Connections page stays symmetric (rows of three), every reading app has a reader, and questions route', () => {
  for (const family of FAMILIES) assert.equal(CONNECTORS.filter(item => item.family === family).length % 3, 0, family);
  for (const item of CONNECTORS) if (item.reads.includes('updates')) assert.ok(UPDATE_READERS[item.id] || ['github', 'jira', 'trello', 'gitlab', 'figma', 'linear', 'asana', 'confluence', 'box', 'calendly'].includes(item.id), item.id);
  assert.deepEqual(appsAsked('read my leads spreadsheet'), ['googlesheets']);
  assert.deepEqual(appsAsked('summarise yesterday\'s meeting transcript'), ['googlemeet']);
  assert.deepEqual(appsAsked('post this on LinkedIn'), ['linkedin']);
  assert.deepEqual(appsAsked('which opportunities changed in Salesforce?'), ['salesforce']);
  assert.equal(appsAsked('write a spreadsheet formula for VAT'), null);
  assert.equal(appsAsked('analyse our balance sheet for 2025'), null);
  assert.equal(appsAsked('review my term sheet'), null);
});

await test('only agents made to read mail read the inbox: no library agent that WRITES e-mails does', () => {
  const library = [...FIELD_CATALOGUES.flatMap(c => c.agents.map(a => a.name)), ...AGENT_TEMPLATES.map(a => a.name)];
  assert.deepEqual(library.filter(name => isMailAgent({ name })), []);
  for (const name of ['Inbox Email Replies', 'My email assistant', 'Email triage', 'Gmail digest']) assert.equal(isMailAgent({ name }), true, name);
  for (const name of ['Cold email sequence', 'Personalised outreach email', 'Post-meeting recap email', 'Email thread summary']) assert.equal(isMailAgent({ name }), false, name);
});

console.log(`\n${passed} passed`);
