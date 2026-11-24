// «Every row» (13 Nov 2026, the n8n / Make study: their most-used agents work through a sheet row by row): the agent
// runs once for each row of an attached table (Excel, CSV) or a Google Sheet shared by link, three rows at a time,
// with live progress in the right panel; the finished table downloads as Excel with a «Result» column, and the
// results join the conversation. Each row goes through the same engine as a chat (lessons, house style, names hidden).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleAlert, Download, FileSpreadsheet, Link2, Loader2, Play, RotateCcw, Square, Table2, X } from 'lucide-react';
import type { AgentRunRequest } from '../../shared/agents.ts';
import { rowText, sheetCsvUrl, tablesIn, TABLE_LIMITS, delimitedRows, tidyTable, type Table } from '../../shared/table-rows.ts';
import { RunError, runAgentTurn } from '../data/api.ts';
import { renderMarkdown } from '../data/markdown.ts';
import { cellOf, type RowRun } from '../data/batch.ts';
export { batchSummary } from '../data/batch.ts';
import { download, fileName } from './answer-actions.tsx';

export type BatchSource = { id: string; label: string; table: Table };
const CONCURRENCY = 3;
/** Seconds one row takes on average (a single pass, no search): used for the estimate only. */
const ROW_SECONDS = 14;

/** The tables of the conversation's files, each with a label the picker shows. */
export function batchSources(documents: { id: string; name: string; text: string }[]): BatchSource[] {
  return documents.flatMap(doc => tablesIn(doc.name, doc.text).map((table, index, all) => ({ id: `${doc.id}:${index}`, label: all.length > 1 || table.name !== doc.name.replace(/\.[a-z0-9]+$/i, '') ? `${doc.name} · ${table.name}` : doc.name, table })));
}

const minutes = (rows: number) => { const seconds = Math.ceil(rows / CONCURRENCY) * ROW_SECONDS; return seconds < 90 ? 'about a minute' : `about ${Math.round(seconds / 60)} minutes`; };

export function BatchPanel({ agentName, sources, initialTask, initialLink, needsPlace, makeRequest, onClose, onFinished }: {
  agentName: string; sources: BatchSource[]; initialTask: string; /** A Google Sheets link pasted in the box: loaded at once. */ initialLink?: string;
  /** The agent researches official sources and no country is chosen yet: running is held until one is. */ needsPlace: boolean;
  makeRequest(content: string): { request: AgentRunRequest; restore(text: string): string };
  onClose(): void;
  /** The run ended (or was stopped): its task, the table and the rows, for the conversation; `again` when it is a retry
   *  of the same run, whose summary is then updated instead of added twice. */ onFinished(task: string, label: string, table: Table, runs: RowRun[], again: boolean): void;
}) {
  const [linked, setLinked] = useState<BatchSource[]>([]);
  const all = useMemo(() => [...sources, ...linked], [sources, linked]);
  const [sourceId, setSourceId] = useState(() => sources[0]?.id ?? '');
  const source = all.find(item => item.id === sourceId) ?? all[0];
  const [task, setTask] = useState(initialTask);
  const [keyColumn, setKeyColumn] = useState(0);
  // A long sheet starts on «Try the first 5», so a first run never spends 200 answers by accident (13 Nov 2026).
  const [trial, setTrial] = useState(() => (sources[0]?.table.rows.length ?? 0) > 10);
  const [link, setLink] = useState(initialLink ?? '');
  const [linkState, setLinkState] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' });
  const [runs, setRuns] = useState<RowRun[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement>(null);
  // 13 Nov 2026 (code review): the table a run used is kept here (a pasted table leaves the box when the run ends, and
  // Excel and Retry then found nothing), and whether its results reached the chat.
  const [ran, setRan] = useState<{ table: Table; label: string; task: string } | null>(null);
  const [added, setAdded] = useState(false);
  const gone = useRef(false);
  useEffect(() => { gone.current = false; panel.current?.focus({ preventScroll: true }); return () => { gone.current = true; abort.current?.abort(); }; }, []);
  // After a switch removes the pressed button, focus stays in the panel, so Esc still closes it.
  const keepFocus = () => window.setTimeout(() => { if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true }); }, 0);
  useEffect(() => { setKeyColumn(0); }, [sourceId]);
  // Loaded once, even where React runs effects twice (development).
  const loadedLink = useRef(false);
  useEffect(() => { if (initialLink && !loadedLink.current) { loadedLink.current = true; void loadLink(); } }, []);
  const table = ran?.table ?? source?.table;
  const total = table ? Math.min(table.rows.length, TABLE_LIMITS.rows) : 0;
  const count = trial ? Math.min(TABLE_LIMITS.trial, total) : total;

  const loadLink = async () => {
    if (!sheetCsvUrl(link)) { setLinkState({ busy: false, error: 'Paste the link of a Google Sheet (docs.google.com/spreadsheets/…).' }); return; }
    setLinkState({ busy: true, error: '' });
    try {
      const response = await fetch(`/api/sheet-csv?url=${encodeURIComponent(link.trim())}`);
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.csv !== 'string') {
        setLinkState({ busy: false, error: body?.error === 'private' ? 'This sheet is private, or the link is wrong. In Google Sheets press Share → «Anyone with the link» → Viewer, or download it as Excel and attach it.' : body?.error === 'too_large' ? 'This sheet is larger than 5 MB. Attach the part you need as Excel.' : 'The sheet could not be read. Check the link and try again.' });
        return;
      }
      const rows = delimitedRows(body.csv); const read = rows.length >= 2 ? tidyTable('Google Sheet', rows[0], rows.slice(1)) : null;
      if (!read) { setLinkState({ busy: false, error: 'The sheet has no rows under its header row.' }); return; }
      const id = `link:${Date.now().toString(36)}`;
      setLinked(current => [...current, { id, label: current.length ? `Google Sheet ${current.length + 1}` : 'Google Sheet', table: read }]); setSourceId(id); setLink(''); setLinkState({ busy: false, error: '' });
      if (read.rows.length > 10) setTrial(true);
    } catch { setLinkState({ busy: false, error: 'The sheet could not be read. Check your connection and try again.' }); }
  };

  const run = async (only?: number[]) => {
    if (!table || !task.trim() || running) return;
    const again = !!only && !!ran;
    const used = ran && only ? ran : { table, label: source?.label ?? 'the table', task: task.trim() };
    setRan(used);
    const controller = new AbortController(); abort.current = controller;
    const indexes = only ?? Array.from({ length: count }, (_, index) => index);
    const base: RowRun[] = only && runs ? runs : indexes.map(index => ({ index, n: table.numbers?.[index] ?? index + 2, key: (table.rows[index][keyColumn] || `Row ${table.numbers?.[index] ?? index + 2}`).replace(/\s+/g, ' ').slice(0, 80), status: 'waiting' }));
    let state = base.map(row => indexes.includes(row.index) ? { ...row, status: 'waiting' as const, error: undefined, answer: undefined } : row);
    const update = (index: number, patch: Partial<RowRun>) => { state = state.map(row => row.index === index ? { ...row, ...patch } : row); setRuns(state); };
    setRuns(state); setRunning(true); setStarted(Date.now()); setOpen(null);
    const queue = [...indexes];
    const worker = async () => {
      for (let index = queue.shift(); index !== undefined && !controller.signal.aborted; index = queue.shift()) {
        update(index, { status: 'working' });
        const content = `${used.task}\n\nTHE ROW (row ${used.table.numbers?.[index] ?? index + 2} of «${used.label}»):\n${rowText(used.table, used.table.rows[index])}`;
        try {
          const { request, restore } = makeRequest(content);
          const done = await runAgentTurn(request, { onStatus: () => {}, onDelta: () => {} }, controller.signal);
          const answer = restore(done.answer).replace(/<proofs>[\s\S]*$/i, '').trim();
          if (!answer) throw new RunError('empty_answer');
          update(index, { status: 'done', answer });
        } catch (error) {
          if (controller.signal.aborted) { update(index, { status: 'waiting' }); break; }
          update(index, { status: 'failed', error: error instanceof RunError && error.code === 'not_configured' ? 'The AI is not connected on the server.' : error instanceof RunError && error.code === 'rate_limited' ? 'Too many requests: retry in a minute.' : 'This row did not finish.' });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indexes.length) }, worker));
    setRunning(false); abort.current = null; keepFocus();
    // Stopped by the person: the rows that finished still go to the chat. Closed or left: nothing is written.
    if (!gone.current && state.some(row => row.status === 'done')) { onFinished(used.task, used.label, used.table, state, again); setAdded(true); }
  };

  const done = runs?.filter(row => row.status === 'done').length ?? 0;
  const failed = runs?.filter(row => row.status === 'failed') ?? [];
  const finished = !!runs && !running;
  const left = runs ? runs.filter(row => row.status === 'waiting' || row.status === 'working').length : 0;
  const elapsed = started ? (Date.now() - started) / 1000 : 0;
  const perRow = done ? elapsed / done * CONCURRENCY : ROW_SECONDS;
  const shown = open !== null ? runs?.find(row => row.index === open) : null;

  const excel = () => {
    if (!table || !runs) return;
    void Promise.all([import('../data/office/index.ts'), import('../data/office-brand.ts')]).then(([office, brand]) => {
      const results = new Map(runs.map(row => [row.index, row.status === 'done' ? cellOf(row.answer ?? '') : row.status === 'failed' ? 'Not finished' : '']));
      const esc = (value: string) => value.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');
      const lines = [`| ${[...table.header, 'Result'].map(esc).join(' | ')} |`, `|${' --- |'.repeat(table.header.length + 1)}`,
        ...runs.map(row => `| ${[...table.header.map((_, column) => table.rows[row.index][column] ?? ''), results.get(row.index) ?? ''].map(esc).join(' | ')} |`)];
      const label = ran?.label ?? source?.label ?? 'Rows';
      const bytes = office.answerXlsx({ title: `${agentName} · ${label}`, markdown: lines.join('\n'), brand: brand.houseBrand() });
      if (bytes) download(bytes, fileName(`${label} · results`, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });
  };

  return <aside ref={panel} tabIndex={-1} className="mn-document-source-reader mn-run-panel mn-batch" aria-label="Every row"
    onKeyDown={event => { if (event.key === 'Escape' && !running) { event.preventDefault(); if (shown) setOpen(null); else onClose(); } }}>
    <header className="mn-run-head">
      <div><h2>Every row</h2><p>{agentName} works through {source ? <>each row of <b>{source.label}</b></> : 'each row of a table'}{running ? `, ${CONCURRENCY} at a time` : ''}.</p></div>
      <button type="button" className="nomos-gov-uk-web-close" aria-label="Close" title={running ? 'Stop first' : 'Close (Esc)'} disabled={running} onClick={onClose}><X size={16} /></button>
    </header>
    <div className="mn-run-body">
      {shown ? <div className="mn-batch-detail">
        <button type="button" className="mn-run-back" onClick={() => { setOpen(null); keepFocus(); }}><ArrowLeft size={15} aria-hidden="true" />All rows</button>
        <h3>Row {shown.n ?? shown.index + 2} · {shown.key}</h3>
        {table && <dl className="mn-batch-row">{table.header.map((column, index) => table.rows[shown.index][index] ? <React.Fragment key={index}><dt>{column}</dt><dd>{table.rows[shown.index][index]}</dd></React.Fragment> : null)}</dl>}
        {shown.answer ? <article className="mn-brief-answer mn-chat-ai-answer"><div className="ait ait--editorial"><div className="ait-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(shown.answer) }} /></div></article>
          : <p className="mn-batch-empty">{shown.status === 'failed' ? shown.error : 'Not done yet.'}</p>}
      </div>
      : !runs ? <>
        {all.length > 1 && <label className="mn-batch-field"><span>Table</span>
          <select value={source?.id ?? ''} onChange={event => setSourceId(event.target.value)}>{all.map(item => <option key={item.id} value={item.id}>{item.label} · {item.table.rows.length} rows</option>)}</select></label>}
        {table ? <div className="mn-batch-preview" role="group" aria-label="The first rows">
          <div className="mn-batch-preview-head"><Table2 size={14} aria-hidden="true" /><b>{source!.label}</b><span>{table.rows.length.toLocaleString('en-GB')} rows · {table.header.length} columns</span></div>
          <div className="mn-batch-preview-scroll"><table><thead><tr>{table.header.slice(0, 6).map((column, index) => <th key={index}>{column}</th>)}{table.header.length > 6 && <th>…</th>}</tr></thead>
            <tbody>{table.rows.slice(0, 3).map((row, at) => <tr key={at}>{table.header.slice(0, 6).map((_, index) => <td key={index}>{row[index]}</td>)}{table.header.length > 6 && <td />}</tr>)}</tbody></table></div>
        </div> : <p className="mn-batch-empty">Attach an Excel or CSV file to the conversation, or paste a Google Sheets link below.</p>}
        <form className="mn-batch-link" onSubmit={event => { event.preventDefault(); void loadLink(); }}>
          <Link2 size={14} aria-hidden="true" /><input value={link} onChange={event => setLink(event.target.value)} placeholder="Or paste a Google Sheets link" aria-label="Google Sheets link" />
          <button type="submit" className="nomos-btn" disabled={!link.trim() || linkState.busy}>{linkState.busy ? <Loader2 size={14} className="is-spinning" aria-hidden="true" /> : null}<span>Load</span></button>
        </form>
        {linkState.error && <p className="mn-batch-error" role="alert">{linkState.error}</p>}
        <label className="mn-batch-field"><span>For each row</span>
          <textarea value={task} onChange={event => setTask(event.target.value)} rows={3} maxLength={2_000} placeholder="e.g. Score this lead against our ICP and give the next step." /></label>
        {table && <label className="mn-batch-field"><span>Name each row by</span>
          <select value={keyColumn} onChange={event => setKeyColumn(Number(event.target.value))}>{table.header.map((column, index) => <option key={index} value={index}>{column}</option>)}</select></label>}
        {/* 13 Nov 2026: «Try the first 4 | All 4 rows» on a short table said the same thing twice. */}
        {table && total > TABLE_LIMITS.trial && <div className="mn-batch-size" role="radiogroup" aria-label="How many rows">
          <button type="button" role="radio" aria-checked={trial} className={trial ? 'is-on' : ''} onClick={() => setTrial(true)}>Try the first {Math.min(TABLE_LIMITS.trial, total)}</button>
          <button type="button" role="radio" aria-checked={!trial} className={!trial ? 'is-on' : ''} onClick={() => setTrial(false)}>All {total.toLocaleString('en-GB')} rows</button>
        </div>}
        {table && table.rows.length > TABLE_LIMITS.rows && <p className="mn-batch-note">The first {TABLE_LIMITS.rows} rows run in one go; split a longer sheet into parts.</p>}
        {needsPlace && <p className="mn-batch-error" role="alert">This agent researches official sources: choose a country in the box below first.</p>}
        <div className="mn-batch-go">
          <span>{table ? `${count.toLocaleString('en-GB')} answers · ${minutes(count)}` : ''}</span>
          <button type="button" className="nomos-btn is-primary" disabled={!table || !task.trim() || needsPlace} onClick={() => { keepFocus(); void run(); }}><Play size={14} aria-hidden="true" /><span>Run on {count.toLocaleString('en-GB')} {count === 1 ? 'row' : 'rows'}</span></button>
        </div>
      </>
      : <>
        <div className="mn-batch-progress" aria-live="polite">
          <div className="mn-batch-bar" aria-hidden="true"><i style={{ width: `${runs.length ? (done + failed.length) / runs.length * 100 : 0}%` }} /></div>
          <p><b>{done} of {runs.length}</b> done{failed.length ? ` · ${failed.length} not finished` : ''}{running && left ? ` · ${minutes(Math.ceil(left * perRow / ROW_SECONDS))} left` : ''}{finished && added ? ' · added to this chat' : ''}</p>
          {running ? <button type="button" className="nomos-btn" onClick={() => abort.current?.abort()}><Square size={13} aria-hidden="true" /><span>Stop</span></button>
            : <span className="mn-batch-actions">
                {failed.length > 0 && <button type="button" className="nomos-btn" onClick={() => void run(failed.map(row => row.index))}><RotateCcw size={14} aria-hidden="true" /><span>Retry {failed.length}</span></button>}
                <button type="button" className="nomos-btn" onClick={() => { setRuns(null); setRan(null); setAdded(false); keepFocus(); }}><span>New run</span></button>
                <button type="button" className="nomos-btn is-primary" onClick={excel} disabled={!done}><Download size={14} aria-hidden="true" /><span>Excel</span></button>
              </span>}
        </div>
        <ol className="mn-batch-rows">{runs.map(row => <li key={row.index} data-status={row.status}>
          <button type="button" onClick={() => { setOpen(row.index); keepFocus(); }} disabled={row.status === 'waiting'}>
            <span className="mn-batch-n">{row.n ?? row.index + 2}</span>
            <span className="mn-batch-state" aria-label={row.status}>{row.status === 'working' ? <Loader2 size={13} className="is-spinning" /> : row.status === 'done' ? <Check size={13} /> : row.status === 'failed' ? <CircleAlert size={13} /> : <i />}</span>
            <span className="mn-batch-text"><b>{row.key}</b><small>{row.status === 'done' ? cellOf(row.answer ?? '').slice(0, 160) : row.status === 'failed' ? row.error : row.status === 'working' ? 'Working…' : 'Waiting'}</small></span>
          </button></li>)}</ol>
      </>}
    </div>
  </aside>;
}
