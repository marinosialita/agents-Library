// The person's documents and records in their apps (13 Nov 2026, the n8n / Make study): find and read Google Sheets and
// Docs, read Google Meet transcripts, Airtable records and Salesforce (SELECT only), and PROPOSE two actions the person
// carries out on a card: rows added to a sheet the agent read, and a LinkedIn post. Tool slugs and arguments read on
// docs.composio.dev/toolkits/<slug>.md on 13 Nov 2026. Everything read is untrusted data, names masked like mail.
import { z } from 'zod';
import { tool } from '@openai/agents';
import type { ConnectorId } from '../../shared/connections.ts';
import { ACTION_LIMITS, ROW_LIMITS } from '../../shared/app-actions.ts';
import { itemsOf } from './inbox.ts';
import type { Exec } from './github-code.ts';

export const DATA_LIMITS = { rows: 200, columns: 40, cell: 500, docChars: 40_000, transcriptEntries: 300, records: 100, find: 10 } as const;
type Names = { mask(text: string): string; restore(text: string): string };
export type DataState = { names: Names; sheets: Map<string, { title: string; tabs: string[] }>; gaps: Set<string> };

const SHEET_ID = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/; const DOC_ID = /\/document\/d\/([A-Za-z0-9_-]{20,100})/;
export const sheetIdOf = (value: string) => SHEET_ID.exec(value)?.[1] ?? (/^[A-Za-z0-9_-]{20,100}$/.test(value.trim()) ? value.trim() : '');
export const docIdOf = (value: string) => DOC_ID.exec(value)?.[1] ?? (/^[A-Za-z0-9_-]{20,100}$/.test(value.trim()) ? value.trim() : '');
/** A text field, wherever Composio put it (its replies nest differently from tool to tool), nearest first. */
export function field(item: unknown, ...keys: string[]): string {
  let level: unknown[] = [item];
  for (let depth = 0; depth < 5 && level.length; depth++) {
    const next: unknown[] = [];
    for (const value of level) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      for (const key of keys) if (typeof record[key] === 'string' || typeof record[key] === 'number') return String(record[key]);
      next.push(...Object.values(record).filter(child => child && typeof child === 'object' && !Array.isArray(child)));
    }
    level = next;
  }
  return '';
}
/** The first list of strings in a reply (Sheets' tab names), or the titles of a list of tabs. */
export function namesOf(data: unknown, depth = 0): string[] {
  if (Array.isArray(data)) return data.every(item => typeof item === 'string') ? data as string[] : data.map(item => field(item, 'title', 'name')).filter(Boolean);
  if (!data || typeof data !== 'object' || depth > 5) return [];
  for (const child of Object.values(data as Record<string, unknown>)) { const found = namesOf(child, depth + 1); if (found.length) return found; }
  return [];
}
/** The first array of arrays in a reply (Sheets' «values»). */
function valuesOf(data: unknown, depth = 0): string[][] {
  if (Array.isArray(data) && data.length && data.every(Array.isArray)) return (data as unknown[][]).map(row => row.map(cell => cell === null || cell === undefined ? '' : String(cell)));
  // 13 Nov 2026 (code review): a reply that carries the values as JSON text is read too (this line came after the
  // object check, so it never ran).
  if (typeof data === 'string' && depth <= 5) { try { return valuesOf(JSON.parse(data), depth + 1); } catch { return []; } }
  if (!data || typeof data !== 'object' || depth > 5) return [];
  for (const child of Object.values(data as Record<string, unknown>)) { const found = valuesOf(child, depth + 1); if (found.length) return found; }
  return [];
}
/** A table as Markdown for the model, trimmed to the limits. */
export function tableMarkdown(values: string[][]): string {
  const rows = values.slice(0, DATA_LIMITS.rows + 1).map(row => row.slice(0, DATA_LIMITS.columns).map(cell => cell.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, DATA_LIMITS.cell)));
  if (!rows.length) return '(empty)';
  const width = Math.max(...rows.map(row => row.length));
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] ?? '').join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n') + (values.length > rows.length ? `\n(${values.length - rows.length} more rows not shown)` : '');
}
const json = (value: unknown) => JSON.stringify(value);
const failed = (state: DataState, app: string) => { state.gaps.add(`${app} could not be read this time.`); return json({ error: `${app} could not be read. Say so plainly; do not guess its contents.` }); };

export function dataTools(exec: Exec, services: ConnectorId[], state: DataState, propose: (value: unknown) => string) {
  const has = (id: ConnectorId) => services.includes(id); const out: any[] = []; const mask = (text: string) => state.names.mask(text);
  if (has('googlesheets')) {
    out.push(tool({ name: 'sheets_find', description: 'Find the person\'s Google Sheets by name or content. Returns id, name, last change and link.',
      parameters: z.object({ query: z.string().max(200).describe('Words in the name or content; empty for the most recent') }),
      execute: async input => { try {
        const items = itemsOf(await exec('GOOGLESHEETS_SEARCH_SPREADSHEETS', { ...(input.query.trim() ? { query: input.query.trim(), search_type: 'both' } : {}), order_by: 'modifiedTime desc', max_results: DATA_LIMITS.find }));
        return json(items.slice(0, DATA_LIMITS.find).map(item => ({ id: field(item, 'id'), name: mask(field(item, 'name')), changed: field(item, 'modifiedTime', 'modified_time'), link: field(item, 'webViewLink', 'web_view_link') })));
      } catch { return failed(state, 'Google Sheets'); } } }));
    out.push(tool({ name: 'sheets_read', description: 'Read one tab of a Google Sheet as a table (the first tab unless named). Give the id or the link.',
      parameters: z.object({ spreadsheet: z.string().min(10).max(300), tab: z.string().max(100).nullable().describe('The tab name; null for the first') }),
      execute: async input => { const id = sheetIdOf(input.spreadsheet); if (!id) return json({ error: 'That is not a Google Sheets id or link.' });
        try {
          const names = namesOf(await exec('GOOGLESHEETS_GET_SHEET_NAMES', { spreadsheet_id: id, exclude_hidden: true }));
          const tab = input.tab && names.includes(input.tab) ? input.tab : names[0] ?? input.tab ?? 'Sheet1';
          const values = valuesOf(await exec('GOOGLESHEETS_VALUES_GET', { spreadsheet_id: id, range: `'${tab.replace(/'/g, "''")}'!A1:AN${DATA_LIMITS.rows + 1}`, value_render_option: 'FORMATTED_VALUE', date_time_render_option: 'FORMATTED_STRING' }));
          state.sheets.set(id, { title: state.sheets.get(id)?.title ?? 'Google Sheet', tabs: names.length ? names : [tab] });
          return json({ id, tab, tabs: names, rows: Math.max(0, values.length - 1), table: mask(tableMarkdown(values)) });
        } catch { return failed(state, 'Google Sheets'); } } }));
    out.push(tool({ name: 'propose_sheet_rows', description: `PROPOSE rows to add at the end of a tab of a sheet you read with sheets_read in this conversation, when the person asked for it. The app shows a card; nothing is added until they press «Add rows». At most ${ROW_LIMITS.rows} rows.`,
      parameters: z.object({ spreadsheet: z.string().min(10).max(300), tab: z.string().min(1).max(100), title: z.string().max(200).describe('The sheet\'s name, for the card'),
        rows: z.array(z.array(z.string().max(ROW_LIMITS.cell)).max(ROW_LIMITS.columns)).min(1).max(ROW_LIMITS.rows).describe('Cells in the order of the sheet\'s columns') }),
      execute: async input => { const id = sheetIdOf(input.spreadsheet); const seen = state.sheets.get(id);
        if (!seen) return json({ error: 'Read the sheet with sheets_read first: rows go only to a sheet read in this conversation.' });
        if (!seen.tabs.includes(input.tab)) return json({ error: `That sheet has no tab «${input.tab}». Its tabs: ${seen.tabs.join(', ')}.` });
        return propose({ kind: 'rows', service: 'googlesheets', spreadsheetId: id, sheet: input.tab, title: state.names.restore(input.title || seen.title), values: input.rows.map(row => row.map(cell => state.names.restore(cell))) }); } }));
  }
  if (has('googledocs')) {
    out.push(tool({ name: 'docs_find', description: 'Find the person\'s Google Docs by name or content. Returns id, name, last change and link.',
      parameters: z.object({ query: z.string().max(200).describe('Words in the name or content; empty for the most recent') }),
      execute: async input => { try {
        const items = itemsOf(await exec('GOOGLEDOCS_SEARCH_DOCUMENTS', { ...(input.query.trim() ? { query: input.query.trim() } : {}), order_by: 'modifiedTime desc', max_results: DATA_LIMITS.find, response_detail: 'minimal' }));
        return json(items.slice(0, DATA_LIMITS.find).map(item => ({ id: field(item, 'id'), name: mask(field(item, 'name')), changed: field(item, 'modifiedTime', 'modified_time'), link: field(item, 'webViewLink', 'web_view_link') })));
      } catch { return failed(state, 'Google Docs'); } } }));
    out.push(tool({ name: 'docs_read', description: 'Read a Google Doc as plain text (tables included). Give the id or the link.',
      parameters: z.object({ document: z.string().min(10).max(300) }),
      execute: async input => { const id = docIdOf(input.document); if (!id) return json({ error: 'That is not a Google Docs id or link.' });
        try { const data = await exec('GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT', { document_id: id, include_tables: true }); const text = typeof data === 'string' ? data : field(data, 'plain_text', 'plaintext', 'text', 'content') || JSON.stringify(data);
          return json({ id, text: mask(text.slice(0, DATA_LIMITS.docChars)), trimmed: text.length > DATA_LIMITS.docChars }); } catch { return failed(state, 'Google Docs'); } } }));
  }
  if (has('googlemeet')) {
    out.push(tool({ name: 'meet_transcript', description: 'Read the transcript of a recorded Google Meet: the latest one, or one from list_updates (its conference record id).',
      parameters: z.object({ conference: z.string().max(200).nullable().describe('conferenceRecords/… or its id; null for the latest meeting') }),
      execute: async input => { try {
        let record = (input.conference ?? '').replace(/^conferenceRecords\//, '').trim();
        if (!record) { const latest = itemsOf(await exec('GOOGLEMEET_LIST_CONFERENCE_RECORDS', { page_size: 5 })); record = field(latest[0], 'name').replace(/^conferenceRecords\//, ''); }
        if (!record) return json({ error: 'No recorded meeting was found.' });
        const transcripts = itemsOf(await exec('GOOGLEMEET_GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID', { conference_record_id: record, page_size: 5 }));
        const transcript = field(transcripts[0], 'name').split('/').pop() ?? '';
        if (!transcript) return json({ conference: record, error: 'This meeting has no transcript (transcription was off).' });
        const entries = itemsOf(await exec('GOOGLEMEET_LIST_TRANSCRIPT_ENTRIES', { conference_record_id: record, transcript_id: transcript, page_size: 100 })).slice(0, DATA_LIMITS.transcriptEntries);
        // Google gives at most 100 lines a page: a full page may not be the whole meeting, and the agent is told so (13 Nov 2026).
        return json({ conference: record, entries: entries.map(entry => `${mask(field(entry, 'participant'))}: ${mask(field(entry, 'text'))}`).join('\n').slice(0, DATA_LIMITS.docChars),
          ...(entries.length >= 100 ? { note: 'These are the first 100 lines of the transcript; the meeting may be longer. Say so if it matters.' } : {}) });
      } catch { return failed(state, 'Google Meet'); } } }));
  }
  if (has('airtable')) {
    out.push(tool({ name: 'airtable_records', description: 'Read records of one table of an Airtable base (bases are listed by list_updates). Without a table, lists the base\'s tables.',
      parameters: z.object({ base: z.string().regex(/^app[A-Za-z0-9]{10,20}$/).describe('The base id, app…'), table: z.string().max(120).nullable() }),
      execute: async input => { try {
        if (!input.table) { const schema = await exec('AIRTABLE_GET_BASE_SCHEMA', { baseId: input.base }); return json({ tables: itemsOf(schema).map(item => field(item, 'name')).filter(Boolean) }); }
        const records = itemsOf(await exec('AIRTABLE_LIST_RECORDS', { baseId: input.base, tableIdOrName: input.table, maxRecords: DATA_LIMITS.records, cellFormat: 'string', userLocale: 'en-gb', timeZone: 'utc' }));
        return json(records.map(record => { const fields = ((record ?? {}) as { fields?: Record<string, unknown> }).fields ?? {}; return Object.fromEntries(Object.entries(fields).slice(0, DATA_LIMITS.columns).map(([key, value]) => [key, mask(String(value ?? '')).slice(0, DATA_LIMITS.cell)])); }));
      } catch { return failed(state, 'Airtable'); } } }));
  }
  if (has('salesforce')) {
    out.push(tool({ name: 'salesforce_query', description: 'Read Salesforce with one SOQL SELECT query (opportunities, leads, accounts, contacts, tasks). Read-only; at most 200 records.',
      parameters: z.object({ soql: z.string().min(10).max(2_000).describe('SELECT … FROM … WHERE … ORDER BY … LIMIT …') }),
      execute: async input => {
        if (!/^\s*select\s/i.test(input.soql) || /;|\b(insert|update|delete|upsert|merge|undelete)\b/i.test(input.soql)) return json({ error: 'Only one SELECT query, without a semicolon.' });
        try { const items = itemsOf(await exec('SALESFORCE_RUN_SOQL_QUERY', { query: /\blimit\s+\d+/i.test(input.soql) ? input.soql : `${input.soql} LIMIT 200` }));
          return json(items.slice(0, 200).map(item => Object.fromEntries(Object.entries((item ?? {}) as Record<string, unknown>).filter(([key]) => key !== 'attributes').map(([key, value]) => [key, mask(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).slice(0, DATA_LIMITS.cell)])))); }
        catch { return failed(state, 'Salesforce'); } } }));
  }
  if (has('linkedin')) {
    out.push(tool({ name: 'propose_linkedin_post', description: 'PROPOSE one LinkedIn post the person asked for, in their words and voice. The app shows a card; it is posted only when they press «Post to LinkedIn».',
      parameters: z.object({ text: z.string().min(1).max(ACTION_LIMITS.post), visibility: z.enum(['PUBLIC', 'CONNECTIONS']) }),
      execute: async input => propose({ kind: 'post', service: 'linkedin', text: state.names.restore(input.text), visibility: input.visibility }) }));
  }
  return out;
}
