// «Routines» (10 Nov 2026, pass 2 of his «… give me a brief every morning»): a brief that runs on its own on the days
// and at the time chosen, in the owner's time zone, and is sent to them in the app, by e-mail or by WhatsApp. One card
// per routine (on/off, Run now, Edit, Delete), the editor, and the history of every run with its steps and its brief.
// The look is the Connections page's (same cards, banners and controls).
import { findPrivate, makeMasker } from '../data/privacy.ts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OfficialWebsiteViewer } from './official-website-viewer.tsx';
import { signatureRoutines, type SignatureRoutine } from '../../shared/signature-routines.ts';
import { CalendarClock, CircleCheck, Hand, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Mail, MessageCircle, Pencil, Play, Plug, Plus, Smartphone, Trash2, TriangleAlert, X, Wand2, ArrowRight, Send, Sparkles } from 'lucide-react';
import { ToolBar } from './nomos-chrome.tsx';
import { BRIEFS, BRIEF_BY_ID, type BriefId, type BriefNeed } from '../../shared/briefs.ts';
import { CONNECTOR_BY_ID } from '../../shared/connections.ts';
import { readEvery, readSentence, readSites, readTrigger, taskOf, wantsApproval, wantsBrief, wantsQuiet } from '../../shared/routine-sentence.ts';
import { placeName, sourcePlace } from '../../shared/official-sources.ts';
import { searchablePlaces } from './nomos-chrome.tsx';
import { buildAgentDesign } from '../data/api.ts';
import { APPROVAL_FEEDBACK_MAX, deliversSomewhere, feedHost, feedUrl, validTimeZone, DAY_SHORT, EVERY_HOURS, maskedNumber, scheduleLabel, siteDomain, WEEKDAYS, WORKDAYS, type Delivery, type EveryHours, type RoutineInput, type RoutineRun, type Weekday } from '../../shared/routines.ts';
import { ConnectionsError, listConnections, ownTimeZone } from '../data/connections.ts';
import { approveRun, clearRuns, deleteRoutine, deleteRun, listRoutines, rejectRun, reviseRun, runRoutineNow, saveRoutine, toggleRoutine, type RoutinesReply, type RoutineView } from '../data/routines.ts';
import { renderMarkdown } from '../data/markdown.ts';
import { DraftCards } from './draft-cards.tsx';
import { SourcesSummary } from './official-sources-list.tsx';
import { sourceChipsHtml } from '../data/source-chips.ts';
import type { Settings } from '../data/store.ts';

const RUN_ERRORS: Record<string, string> = {
  feed_unreadable: 'The page or feed could not be read. Check its address, or that it is public.',
  sources_unreadable: 'Its websites could not be read just now (the internet or the site was down).',
  agent_unavailable: 'The AI is not connected: the OpenAI key is missing on the server.',
  not_configured: 'Connections are not switched on on the server.',
  nothing_connected: 'None of the routine’s apps is connected.',
  connections_failed: 'Your connected apps could not be read.',
  timeout: 'The brief took too long and was stopped.',
  cancelled: 'Stopped.',
  agent_failed: 'The brief could not be written.',
};
const DELIVERY_ERRORS: Record<string, string> = {
  email_not_set_up: 'e-mail is not set up on the server', whatsapp_not_set_up: 'WhatsApp is not set up on the server',
  not_allowed: 'not on the allowed list', whatsapp_24h: 'WhatsApp delivers only within 24 hours of your last message to the number',
  slack_not_connected: 'Slack is not connected', slack_no_dm: 'Slack did not open a direct message to you', slack_failed: 'Slack refused it', teams_not_connected: 'Teams is not connected', teams_failed: 'Teams refused it',
  telegram_not_set_up: 'the Telegram bot is not set up on the server', telegram_blocked: 'the Telegram chat has not started the bot, or blocked it', telegram_failed: 'Telegram refused it',
};
const deliveryError = (code = '') => DELIVERY_ERRORS[code] ?? (code.startsWith('email') ? 'the e-mail was refused' : 'the message was refused');
const when = (at: number, timeZone?: string) => new Intl.DateTimeFormat('en-GB', { ...(timeZone ? { timeZone } : {}), weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at);
const zones = (() => { try { return (Intl as unknown as { supportedValuesOf?(key: string): string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { return []; } })();

const NEED_LABEL: Record<BriefNeed, string> = { mail: 'Gmail or Outlook', calendar: 'a calendar', updates: 'Slack, Teams, GitHub or another work app' };
/** A ready routine as a new routine: its own suggested days and time; the person's apps when they are connected. */
/** A signature routine, filled in and ready to save (12 Nov 2026): its research agent as written, no AI preparation. */
function fromSignature(item: SignatureRoutine, settings: Settings): RoutineInput {
  return { ...blank(settings), name: item.name, source: 'mine', days: [...item.days], time: item.time, ...(item.everyHours ? { everyHours: item.everyHours } : {}),
    agent: { name: item.name, ...item.agent, ...(item.agent.sites ? { sites: [...item.agent.sites] } : {}) } };
}

function fromBrief(id: BriefId, settings: Settings, mine: boolean): RoutineInput {
  const brief = BRIEF_BY_ID[id];
  return { ...blank(settings), name: brief.name, brief: id, source: mine || id === 'new-mail-alert' ? 'mine' : 'demo', days: [...brief.suggested.days] as Weekday[], time: brief.suggested.time,
    ...(id === 'new-mail-alert' ? { trigger: { kind: 'mail' as const, filter: '' } } : {}) };
}

function blank(settings: Settings): RoutineInput {
  const brief = BRIEFS[0];
  return { name: brief.name, brief: brief.id, source: 'demo', days: [...WORKDAYS], time: '07:00', timeZone: ownTimeZone(), deliver: { email: null, whatsapp: null }, namesHidden: settings.hideNames, language: settings.language, enabled: true };
}

export function RoutinesPage({ settings, onConnections, onProfile }: { settings: Settings; onConnections(): void; onProfile?(): void }) {
  const [data, setData] = useState<RoutinesReply | null>(null);
  const [problem, setProblem] = useState('');
  const [editing, setEditing] = useState<RoutineInput | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The app asking «Delete?» on the routine itself (12 Nov 2026): window.confirm never shows in the app's browser pane. */
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  /** The country the signature routines report on: the workspace's own, never a built-in one. */
  const [sigPlace, setSigPlace] = useState(settings.jurisdiction ?? '');
  const signature = useMemo(() => signatureRoutines(sigPlace), [sigPlace]);
  const placePicker = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sentence, setSentence] = useState('');
  const [has, setHas] = useState<Record<BriefNeed, boolean>>({ mail: false, calendar: false, updates: false });
  const [apps, setApps] = useState({ slack: false, teams: false });
  // Which kinds of app are connected, for the gallery's «Ready» / «Needs …» (11 Nov 2026).
  useEffect(() => { listConnections().then(reply => { const on = reply.services.filter(service => service.connected).map(service => CONNECTOR_BY_ID[service.id]);
    setHas({ mail: on.some(item => item.reads.includes('mail')), calendar: on.some(item => item.reads.includes('calendar')), updates: on.some(item => item.reads.includes('updates')) });
    setApps({ slack: on.some(item => item.id === 'slack'), teams: on.some(item => item.id === 'microsoftteams') }); }, () => undefined); }, []);
  /** «Describe your routine»: the sentence becomes a filled routine to review; nothing is saved until «Save». */
  const [preparing, setPreparing] = useState(false);
  const describe = async () => {
    const text = sentence.trim(); if (!text || preparing) return;
    if (wantsBrief(text)) {
      const read = readSentence(sentence);
      const base = fromBrief(read.brief, settings, BRIEF_BY_ID[read.brief].needs.every(need => has[need]));
      setSentence('');
      // 13 Nov 2026 (code review): an inbox brief also keeps «ask me before sending», Telegram, and says what is not set up.
      const telegram = read.viaTelegram ? data?.delivery.telegram[0] ?? null : null;
      const unset = [read.viaEmail && !data?.delivery.email.length ? 'e-mail' : '', read.viaWhatsapp && !data?.delivery.whatsapp.length ? 'WhatsApp' : '', read.viaTelegram && !data?.delivery.telegram.length ? 'Telegram' : ''].filter(Boolean);
      void launch({ ...base, days: read.days as Weekday[], time: read.time, ...(wantsApproval(text) ? { approve: true } : {}),
        deliver: { email: read.viaEmail ? data?.delivery.email[0] ?? null : null, whatsapp: read.viaWhatsapp ? data?.delivery.whatsapp[0] ?? null : null, ...(telegram ? { telegram } : {}) } }, 'describe',
        unset.length ? `${unset.join(' and ').replace(/ and (?=[^ ]+ and )/, ', ')} ${unset.length > 1 ? 'are' : 'is'} not set up on the server yet, so its results stay here in the app.` : '');
      return;
    }
    // Research (11 Nov 2026, his «describe what I need and it prepares it»): «Build it for me» designs the agent from
    // the task; its questions, if any, get their first answer; the routine opens filled, to change by hand and save.
    const read = readSentence(text); const task = taskOf(text);
    // 11 Nov 2026: «every 6 hours», the websites named (or Cyprus's newspapers), «tell me if…» = only when new.
    const every = readEvery(text); const sites = readSites(text); const quiet = wantsQuiet(text);
    // 13 Nov 2026: «whenever the Cyprus Mail posts…» runs when the site has something new; «ask me before sending» waits.
    const trigger = every ? null : readTrigger(text); const approve = wantsApproval(text);
    const timing = every ? { days: [0, 1, 2, 3, 4, 5, 6] as Weekday[], time: '00:00', everyHours: every } : { days: read.days as Weekday[], time: read.time };
    const runs = trigger ? `each time ${feedHost(trigger.url)} publishes something new (the app watches it every 15 minutes)` : `on a schedule (${scheduleLabel(timing)})`;
    setPreparing(true); setNotice(null);
    try {
      // Names hidden (13 Nov 2026): the design is asked with placeholders, and the names put back after.
      const { mask, restore } = makeMasker(settings.hideNames ? findPrivate([task]) : []);
      const ask = { description: `${mask(task)}\n\nThis agent runs on its own ${runs}; the app runs it and sends the answer. Each time it reports only what is new since its previous run, with a link to every source. A headline and summary from a publisher's own feed or site counts as reported by that publisher: never refuse to report an item because its full article could not be opened, never count only «verified» items, and never write about retrieval, cutoffs or coverage.${sites.length ? ` Besides any official sources it searches only these websites: ${sites.join(', ')}.` : ''}`, language: settings.language, ...(settings.field !== 'all' ? { field: settings.field } : {}) };
      let result = await buildAgentDesign(ask);
      if (!result.agent && result.questions.length) result = await buildAgentDesign({ ...ask, answers: result.questions.map(item => ({ question: item.question, answer: item.options[0] ?? 'Use your best judgement' })) });
      const designed = result.agent; if (!designed) throw new Error('none');
      setSentence('');
      const unset = [read.viaEmail && !data?.delivery.email.length ? 'e-mail' : '', read.viaWhatsapp && !data?.delivery.whatsapp.length ? 'WhatsApp' : '', read.viaTelegram && !data?.delivery.telegram.length ? 'Telegram' : ''].filter(Boolean);
      const telegram = read.viaTelegram ? data?.delivery.telegram[0] ?? null : null;
      void launch({ ...blank(settings), name: restore(designed.name).slice(0, 80), source: 'mine', ...timing, ...(trigger ? { trigger } : {}), ...(approve ? { approve: true } : {}),
        deliver: { email: read.viaEmail ? data?.delivery.email[0] ?? null : null, whatsapp: read.viaWhatsapp ? data?.delivery.whatsapp[0] ?? null : null, ...(telegram ? { telegram } : {}) },
        // 13 Nov 2026 (a «BBC World news» routine failed in a second): the websites the design chose join the ones named in
        // the sentence, and official sources are searched only where a country was chosen.
        agent: { name: restore(designed.name), instructions: restore(designed.instructions), question: task, jurisdiction: designed.jurisdiction ?? '', officialSearch: designed.officialSearch && !!designed.jurisdiction, mode: designed.mode,
          ...((all => all.length ? { sites: all } : {})([...new Set([...sites, ...(designed.sites ?? [])])].slice(0, 12))), ...(quiet ? { quiet: true } : {}) } }, 'describe',
        unset.length ? `${unset.join(' and ').replace(/ and (?=[^ ]+ and )/, ', ')} ${unset.length > 1 ? 'are' : 'is'} not set up on the server yet, so its results stay here in the app.` : '');
    } catch { setNotice({ tone: 'warn', text: 'The routine could not be prepared. Is the AI connected? Try again, or pick a ready routine below.' }); }
    finally { setPreparing(false); }
  };

  const load = useCallback(async () => {
    try { setData(await listRoutines()); setProblem(''); }
    catch (error) { setData(null); setProblem(error instanceof ConnectionsError ? error.code : 'failed'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // 13 Nov 2026 (his «Open Routines should take me down to the one just made and light it up»): a chat's routine card
  // opens this page at «#routine-<id>»; once the list is drawn the card scrolls into the middle and glows for 2 s.
  const [flash, setFlash] = useState<string | null>(null);
  const flashed = useRef(false);
  useEffect(() => {
    const id = window.location.hash.match(/^#routine-(rt-[a-z0-9-]+)$/)?.[1];
    if (!id || flashed.current || !data?.routines.some(routine => routine.id === id)) return;
    flashed.current = true;
    history.replaceState(history.state, '', window.location.pathname);
    // The list is drawn when this runs (data came with it); a short wait lets the page settle under the header first.
    window.setTimeout(() => {
      const card = document.getElementById(`routine-${id}`); if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // The glow starts once the card is there; the app's own browser pane does not animate a smooth scroll, so it
      // lands on the card anyway.
      window.setTimeout(() => { const box = card.getBoundingClientRect(); if (box.top < 0 || box.bottom > window.innerHeight) card.scrollIntoView({ block: 'center' }); setFlash(id); }, 650);
    }, 60);
  }, [data]);
  useEffect(() => { if (!flash) return; const timer = window.setTimeout(() => setFlash(null), 2_400); return () => window.clearTimeout(timer); }, [flash]);

  const save = async (input: RoutineInput) => {
    setBusy('save'); setNotice(null);
    try { const saved = await saveRoutine(input); setEditing(null); await load(); setNotice({ tone: 'ok', text: `«${saved.name}» is saved.${saved.next ? ` Next run: ${when(saved.next, saved.timeZone)}.` : ''}` }); }
    catch (error) { setNotice({ tone: 'warn', text: error instanceof ConnectionsError && error.code === 'recipient_not_allowed' ? 'That address or number is not on the server’s allowed list.' : 'The routine could not be saved. Check the fields and try again.' }); }
    finally { setBusy(null); }
  };
  const toggle = async (routine: RoutineView) => {
    setBusy(routine.id);
    try { await toggleRoutine(routine.id, !routine.enabled); await load(); } catch { setNotice({ tone: 'warn', text: 'That did not work. Try again.' }); } finally { setBusy(null); }
  };
  const remove = async (routine: RoutineView) => {
    setAsking(null); setBusy(routine.id);
    try { await deleteRoutine(routine.id); await load(); setNotice({ tone: 'ok', text: `«${routine.name}» is deleted.` }); } catch { setNotice({ tone: 'warn', text: 'The routine could not be deleted.' }); } finally { setBusy(null); }
  };
  const runNow = async (routine: RoutineView) => {
    setBusy(routine.id); setNotice(null);
    try {
      const run = await runRoutineNow(routine.id);
      await load(); setOpen(run.id);
      setNotice(run.status === 'done' ? { tone: 'ok', text: `«${routine.name}» ran. The brief is in the history below.` } : { tone: 'warn', text: `«${routine.name}» did not run: ${RUN_ERRORS[run.error ?? ''] ?? 'something failed.'}` });
    } catch { setNotice({ tone: 'warn', text: 'The run could not start.' }); }
    finally { setBusy(null); }
  };

  /** One click and it works on its own (12 Nov 2026, his «the AI should do everything autonomously, I don't need to do
   *  anything»): the routine is saved as it is, switched on, and run once at once so its first brief is there to read in
   *  the right panel; from then on it runs on its schedule. Edit and Delete stay on its card. */
  const [launching, setLaunching] = useState<string | null>(null);
  const launch = async (input: RoutineInput, key: string, note = '') => {
    if (launching) return;
    setLaunching(key); setNotice(null);
    const after = note ? ` ${note}` : '';
    try {
      const saved = await saveRoutine(input); await load();
      setNotice({ tone: 'ok', text: `«${saved.name}» is on: ${scheduleLabel(saved)}${saved.next && !saved.trigger ? `, next ${when(saved.next, saved.timeZone)}` : ''}. Writing its first brief now — about a minute.${after}` });
      const run = await runRoutineNow(saved.id); await load(); setOpen(run.id);
      setNotice(run.status === 'done' ? { tone: 'ok', text: `«${saved.name}» is on and its first brief is open on the right. It runs by itself from now on (${scheduleLabel(saved)}).${saved.approve ? ' Each result waits for your OK before it is sent.' : ''}${after}` }
        : { tone: 'warn', text: `«${saved.name}» is on, but its first run did not finish: ${RUN_ERRORS[run.error ?? ''] ?? 'something failed.'} It tries again at its next time.${after}` });
    } catch (error) {
      setNotice({ tone: 'warn', text: error instanceof ConnectionsError && error.code === 'too_many' ? 'You have reached the number of routines one account can have. Delete one first.' : 'The routine could not be started. Try again.' });
    } finally { setLaunching(null); }
  };
  /** A signature routine that needs one fact first (the country, the firms): asked on its own card, then it starts. */
  const [needs, setNeeds] = useState<string | null>(null);
  const startSignature = (item: SignatureRoutine, extra?: { place?: string; firms?: string }) => {
    // Every card asks for the country first when none is chosen (12 Nov 2026, his «for all cards»), then starts.
    const chosen = extra?.place ?? sigPlace;
    if (!chosen) { setNeeds(item.id); return; }
    if (extra?.place) setSigPlace(extra.place);
    if (item.id === 'competitor-watch' && !extra?.firms?.trim()) { setNeeds(item.id); return; }
    const made = chosen !== sigPlace ? signatureRoutines(chosen).find(other => other.id === item.id) ?? item : item;
    // The country goes in the name (12 Nov 2026: three «Your Morning Paper» cards, no way to tell Afghanistan's apart).
    const where = sourcePlace(chosen);
    const input = { ...fromSignature(made, settings), ...(where ? { name: `${made.name} · ${where.name}`.slice(0, 80) } : {}) };
    if (extra?.firms?.trim() && input.agent) input.agent = { ...input.agent, question: made.agent.question.replace('[write the firm names here]', extra.firms.trim()) };
    setNeeds(null);
    // 13 Nov 2026: a second press made a twin of a routine already running for that country.
    if (item.id !== 'competitor-watch' && data?.routines.some(routine => routine.name === input.name)) { setNotice({ tone: 'ok', text: `«${input.name}» is already in your routines below.` }); return; }
    void launch(input, item.id);
  };

  const lastRun = (id: string) => data?.runs.find(run => run.routineId === id);
  const ownerProblem = problem === 'owner_code' || problem === 'owner_code_not_set' || problem === 'sign_in';

  const shownRun = data?.runs.find(run => run.id === open) ?? null;
  const waiting = (data?.runs ?? []).filter(run => run.approval?.state === 'waiting');
  return <div className={`nomos-tool-scroll mn-rt-split${shownRun ? ' is-open' : ''}`}>
  <div className="mn-conn mn-rt mn-rt-main">
    <ToolBar icon={CalendarClock} title="Routines"
      end={data ? <button type="button" className="nomos-btn is-primary" onClick={() => { setEditing({ ...blank(settings), ...(has.mail ? { source: 'mine' as const } : {}) }); setNotice(null); }} disabled={!!editing}><Plus size={14} aria-hidden="true" /><span>New routine</span></button> : undefined} />
    <div className="mn-conn-page mn-rt-page">
      <header className="mn-conn-hero">
        <h1>Routines</h1>
        <p>An agent that works on its own: at the days and time you choose, or each time a site you follow publishes something new. It sends you the result, or waits for your OK first.</p>
      </header>

      {!data && !problem && <p className="mn-rt-loading" role="status"><Loader2 size={15} className="mn-conn-spin" aria-hidden="true" />Loading your routines…</p>}
      {ownerProblem && <div className="mn-conn-banner" role="status"><Plug size={16} aria-hidden="true" />
        <span>{problem === 'owner_code' ? 'This device has not got the owner code. Sign in, or type the code on the Connections page.' : 'Sign in to make routines. Each account has its own, and they read only its own apps.'}</span>
        {onProfile && <button type="button" className="nomos-btn is-primary" onClick={onProfile}>Sign in</button>}
        <button type="button" className="nomos-btn" onClick={onConnections}>Open Connections</button></div>}
      {problem === 'storage_unavailable' && <div className="mn-conn-banner" role="status"><TriangleAlert size={16} aria-hidden="true" />
        <span>Routines need a place to be kept on this server. On your Mac they live in the project’s .data folder; on the web they need a database, which is not set up yet.</span></div>}
      {problem && !ownerProblem && problem !== 'storage_unavailable' && <div className="mn-conn-banner is-warn" role="alert"><span>The routines could not be loaded.</span>
        <button type="button" className="nomos-btn" onClick={() => void load()}>Retry</button></div>}
      {data && !data.ai && <div className="mn-conn-banner" role="status"><TriangleAlert size={16} aria-hidden="true" /><span>The AI is not connected yet (no OpenAI key on the server), so routines will record a failed run until it is.</span></div>}
      {notice && <div className={`mn-conn-banner ${notice.tone === 'warn' ? 'is-warn' : 'is-ok'}`} role="status">{notice.tone === 'ok' ? <Check size={16} aria-hidden="true" /> : null}<span>{notice.text}</span></div>}

      {/* 13 Nov 2026: what waits for the person comes first (it sat below twelve gallery cards). */}
      {waiting.length > 0 && <section className="mn-rt-waiting" aria-labelledby="mn-rt-waiting">
        <h2 id="mn-rt-waiting"><Hand size={15} aria-hidden="true" />Waiting for your OK</h2>
        <ul>{waiting.map(run => <li key={run.id}><span><b>{run.routineName}</b><small>{previewOf(run)}</small></span>
          <button type="button" className="nomos-btn is-primary" onClick={() => setOpen(run.id)}>Review</button></li>)}</ul>
      </section>}

      {editing && data && <RoutineEditor key={JSON.stringify(editing)} value={editing} delivery={data.delivery} apps={apps} saving={busy === 'save'} onCancel={() => setEditing(null)} onSave={value => void save(value)} />}

      {data && !editing && <form className="mn-rt-describe" onSubmit={event => { event.preventDefault(); void describe(); }}>
        <Wand2 size={17} aria-hidden="true" />
        <input value={sentence} onChange={event => setSentence(event.target.value)} maxLength={300} aria-label="Describe your routine"
          placeholder="Describe it, e.g. «Every Monday at 9, new court judgments in my country» or «Weekdays at 8, sum up my email»" />
        <button type="submit" className="nomos-btn is-primary" disabled={!sentence.trim() || preparing || !!launching}>{preparing ? <><Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /><span>Preparing…</span></> : <><span>Set it up</span><ArrowRight size={14} aria-hidden="true" /></>}</button>
      </form>}
      {/* 12 Nov 2026: preparing writes the agent too and takes up to a minute; say so rather than look stuck. */}
      {data && !editing && preparing && <p className="mn-rt-loading" role="status">Writing the agent, its question and the schedule — about a minute. It switches on by itself and writes its first brief.</p>}

      {data && !editing && <section className="mn-rt-signature" aria-labelledby="mn-rt-signature">
        <h2 id="mn-rt-signature"><Sparkles size={16} aria-hidden="true" />Signature routines<small>{signature.length}</small></h2>
        <p className="mn-rt-signature-lead">Research agents that work while you sleep. One click: it switches on and writes its first brief.
          {/* No country is built in: each routine reports on the one chosen here (the workspace's, until changed). */}
          <label className="mn-rt-sig-place"><span>For</span><select ref={placePicker} value={sigPlace} onChange={event => setSigPlace(event.target.value)} aria-label="The country these routines report on">
            <option value="">Choose your country…</option>{searchablePlaces().map(place => <option key={place.code} value={place.code}>{place.flag} {placeName(place, true)}</option>)}</select></label></p>
        <div className="mn-rt-signature-grid">{signature.map(item => <article key={item.id} className={`mn-rt-sig is-${item.id}`}>
          <div className="mn-rt-sig-top"><span className="mn-rt-sig-emoji" aria-hidden="true">{item.emoji}</span><span className="mn-rt-sig-when">{scheduleLabel({ days: item.days, time: item.time })}</span></div>
          <h3>{item.name}</h3>
          <p className="mn-rt-sig-tag">{item.tagline}</p>
          <p className="mn-rt-sig-promise">{item.promise}</p>
          {needs === item.id && item.id === 'competitor-watch' && sigPlace
            ? <form className="mn-rt-sig-need" onSubmit={event => { event.preventDefault(); const firms = String(new FormData(event.currentTarget).get('firms') ?? ''); startSignature(item, { firms }); }}>
                <input name="firms" autoFocus maxLength={300} placeholder="Which firms? e.g. Acme Ltd, Globex" aria-label="The firms to watch" />
                <button type="submit" className="mn-rt-sig-add"><Play size={13} aria-hidden="true" />Start</button></form>
            : needs === item.id
            ? <label className="mn-rt-sig-need"><select autoFocus defaultValue="" aria-label={`Which country «${item.name}» reports on`} onChange={event => { if (event.target.value) startSignature(item, { place: event.target.value }); }}>
                <option value="" disabled>Which country? It starts at once…</option>{searchablePlaces().map(place => <option key={place.code} value={place.code}>{place.flag} {placeName(place, true)}</option>)}</select></label>
            : (already => <button type="button" className="mn-rt-sig-add" disabled={!!launching || already} onClick={() => startSignature(item)}>
                {launching === item.id ? <><Loader2 size={14} className="mn-conn-spin" aria-hidden="true" />Starting… first brief in about a minute</> : already ? <><Check size={14} aria-hidden="true" />Already on for {sourcePlace(sigPlace)?.name}</> : <><Play size={14} aria-hidden="true" />Start it</>}</button>)(
                item.id !== 'competitor-watch' && !!sigPlace && !!data?.routines.some(routine => routine.name === `${item.name} · ${sourcePlace(sigPlace)?.name}`.slice(0, 80)))}
        </article>)}</div>
      </section>}

      {data && !editing && <section className="mn-conn-family" aria-labelledby="mn-rt-ready">
        <h2 id="mn-rt-ready">Ready routines<small>{BRIEFS.length}</small></h2>
        <div className="mn-conn-grid">{BRIEFS.map(brief => { const missing = brief.needs.filter(need => !has[need]);
          return <article key={brief.id} className="mn-conn-card mn-rt-ready">
            <div className="mn-conn-card-top"><span className="mn-brief-icon" aria-hidden="true"><CalendarClock size={17} /></span>
              <div className="mn-conn-card-name"><h3>{brief.name}</h3><span className="mn-conn-state">{brief.id === 'new-mail-alert' ? 'When a matching e-mail arrives' : scheduleLabel({ days: brief.suggested.days as Weekday[], time: brief.suggested.time })}</span></div></div>
            <p className="mn-conn-uses">{brief.description}</p>
            <p className={`mn-rt-status${missing.length ? '' : ' is-ready'}`}>{missing.length ? <>Needs {missing.map(need => NEED_LABEL[need]).join(' and ')}<button type="button" onClick={onConnections}>Connect</button></> : <><Check size={13} aria-hidden="true" />Ready on your apps</>}</p>
            <div className="mn-conn-actions">{brief.id === 'new-mail-alert' && missing.length
              ? <button type="button" className="nomos-btn mn-conn-on" onClick={onConnections}><Plug size={14} aria-hidden="true" /><span>Connect mail first</span></button>
              : <button type="button" className="nomos-btn is-primary mn-conn-on" disabled={!!launching} onClick={() => void launch(fromBrief(brief.id, settings, !missing.length), brief.id)}>
              {launching === brief.id ? <><Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /><span>Starting…</span></> : <><Play size={14} aria-hidden="true" /><span>{missing.length ? 'Start on the demo inbox' : 'Start it'}</span></>}</button>}</div>
          </article>; })}</div>
      </section>}

      {data && data.routines.length > 0 && <section className="mn-conn-family" aria-labelledby="mn-rt-yours">
        <h2 id="mn-rt-yours">Your routines</h2>
        <div className="mn-conn-grid mn-rt-grid">
          {data.routines.map(routine => {
            const last = lastRun(routine.id); const working = busy === routine.id;
            return <article key={routine.id} id={`routine-${routine.id}`} className={`mn-conn-card mn-rt-card${flash === routine.id ? ' is-flash' : ''}`} data-on={routine.enabled}>
              <div className="mn-conn-card-top">
                <span className="mn-brief-icon" aria-hidden="true"><CalendarClock size={18} /></span>
                <div className="mn-conn-card-name"><h3>{routine.name}</h3>
                  <span className="mn-conn-state"><span className="mn-conn-dot" data-on={routine.enabled} aria-hidden="true" />{routine.enabled ? scheduleLabel(routine) : 'Off'}</span></div>
                <label className="mn-rt-switch" title={routine.enabled ? 'Switch off' : 'Switch on'}><input type="checkbox" role="switch" checked={routine.enabled} disabled={!!busy} onChange={() => void toggle(routine)} aria-label={`${routine.name}: runs by itself`} /><span aria-hidden="true" /></label>
              </div>
              <p className="mn-rt-chips">
                {routine.agent?.jurisdiction && sourcePlace(routine.agent.jurisdiction) && <span>{sourcePlace(routine.agent.jurisdiction)!.flag} {sourcePlace(routine.agent.jurisdiction)!.name}</span>}
                <span>{routine.agent ? <><Sparkles size={11} aria-hidden="true" />Research{routine.agent.officialSearch && routine.agent.jurisdiction ? ' · official sources' : ''}</> : routine.source === 'demo' ? 'Demo inbox' : 'Your apps'}</span>
                {!routine.trigger && <span title={routine.timeZone}>{`${(routine.timeZone.split('/').pop() ?? routine.timeZone).replace(/_/g, ' ')} time`}</span>}
                <span><Smartphone size={11} aria-hidden="true" />In the app</span>
                {routine.deliver.email && <span><Mail size={11} aria-hidden="true" />{routine.deliver.email}</span>}
                {routine.deliver.whatsapp && <span><MessageCircle size={11} aria-hidden="true" />{maskedNumber(routine.deliver.whatsapp)}</span>}
                {routine.deliver.slack && <span><MessageCircle size={11} aria-hidden="true" />Slack DM</span>}
                {routine.deliver.teams && <span><MessageCircle size={11} aria-hidden="true" />Teams chat</span>}
                {routine.deliver.telegram && <span><Send size={11} aria-hidden="true" />Telegram</span>}
                {routine.approve && deliversSomewhere(routine) && <span><Hand size={11} aria-hidden="true" />Waits for your OK</span>}
              </p>
              {routine.trigger?.kind === 'hook' && routine.hookKey && <HookLink id={routine.id} secret={routine.hookKey} />}
              {/* 13 Nov 2026: a routine that runs on new posts said «Next: Fri 13 Nov, 07:00». */}
              <p className="mn-conn-uses">{!routine.enabled ? 'Switched off: it will not run.' : routine.trigger?.kind === 'feed' ? `Checks ${feedHost(routine.trigger.url)} every 15 minutes`
                : routine.trigger?.kind === 'mail' ? 'Checks your new mail every 5 minutes' : routine.trigger?.kind === 'hook' ? 'Runs each time its link is called'
                : routine.retry && (!routine.next || routine.retry.at < routine.next) ? `Tries again ${when(routine.retry.at, routine.timeZone)}`
                : routine.next ? `Next: ${when(routine.next, routine.timeZone)}` : 'Waiting for its next time'}
                {last ? <> · Last: {last.quiet ? 'nothing new' : last.status === 'done' ? 'done' : 'failed'} {when(last.finishedAt)}</> : null}</p>
              <div className="mn-conn-actions mn-rt-actions">
                <button type="button" className="nomos-btn is-primary" onClick={() => void runNow(routine)} disabled={!!busy}>
                  {working ? <Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}<span>{working ? 'Running… about a minute' : 'Run now'}</span></button>
                <button type="button" className="nomos-btn" onClick={() => { setEditing({ ...routine }); setNotice(null); }} disabled={!!busy || !!editing} aria-label={`Edit ${routine.name}`}><Pencil size={14} aria-hidden="true" /></button>
                {asking === routine.id
                  ? <span className="mn-ask-inline" role="alert">Delete this routine and its past runs?
                      <button type="button" className="nomos-btn mn-ask-yes" onClick={() => void remove(routine)}>Delete</button>
                      <button type="button" className="nomos-btn" onClick={() => setAsking(null)} autoFocus>Cancel</button></span>
                  : <button type="button" className="nomos-btn" onClick={() => setAsking(routine.id)} disabled={!!busy} aria-label={`Delete ${routine.name}`}><Trash2 size={14} aria-hidden="true" /></button>}
              </div>
            </article>;
          })}
        </div>
      </section>}

      {data && data.runs.length > 0 && <RunTimeline runs={data.runs} chosen={open} onOpen={id => setOpen(current => current === id ? null : id)}
        onDelete={async id => { try { await deleteRun(id); if (open === id) setOpen(null); await load(); } catch { setNotice({ tone: 'warn', text: 'That run could not be deleted. Try again.' }); } }}
        onClear={async name => { try { const removed = await clearRuns(name); setOpen(null); await load(); setNotice({ tone: 'ok', text: `${removed} ${removed === 1 ? 'run' : 'runs'} deleted from the history.` }); } catch { setNotice({ tone: 'warn', text: 'The history could not be cleared. Try again.' }); } }} />}

      {data && <p className="mn-brief-later">Routines run while this server is running: on your Mac, while the app is open in the dev server. On the web they need the host’s scheduler and a database (docs/routines.md).</p>}
    </div>
  </div>
  {shownRun && <RunPanel key={shownRun.id} run={shownRun} routine={data?.routines.find(routine => routine.id === shownRun.routineId)} onClose={() => setOpen(null)}
    onChanged={async (run, text) => { await load(); setNotice({ tone: 'ok', text }); if (run.approval?.state !== 'waiting') setOpen(run.id); }} />}
  </div>;
}

/** A hook routine's private link, to copy into another app (13 Nov 2026). Shown only to its owner. */
function HookLink({ id, secret }: { id: string; secret: string }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const link = `${window.location.origin}/api/routine-hook?id=${id}&key=${secret}`;
  return <div className="mn-rt-hook">
    <span>Its link</span>
    <code title={shown ? link : 'Hidden: it works like a password'}>{shown ? link : `${window.location.origin}/api/routine-hook?id=${id}&key=••••••••`}</code>
    <button type="button" className="nomos-btn" onClick={() => setShown(value => !value)}>{shown ? 'Hide' : 'Show'}</button>
    <button type="button" className="nomos-btn" onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }}>{copied ? <><Check size={13} aria-hidden="true" />Copied</> : 'Copy'}</button>
  </div>;
}

const DAY = 86_400_000;
const dayOf = (at: number) => { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const dayLabel = (at: number) => { const gap = Math.round((dayOf(Date.now()) - dayOf(at)) / DAY);
  return gap === 0 ? 'Today' : gap === 1 ? 'Yesterday' : new Date(at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); };
const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
/** A run in one line: its first real sentence, without Markdown. */
const previewOf = (run: RoutineRun) => run.status === 'failed' ? `${RUN_ERRORS[run.error ?? ''] ?? 'This run did not finish.'}${run.retryAt ? ` Tries again at ${clock(run.retryAt)}.` : ''}` : run.quiet ? 'Checked: nothing new since the run before.'
  : (run.answer.replace(/```[\s\S]*?```/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split('\n').map(line => line.trim()).filter(line => !/^(#|\||-{3,}|\*\*[^*]{0,40}(window|date|period)\b)/i.test(line)).map(line => line.replace(/^(\d+[.)]|[-*•])\s+/, '').replace(/[#*_`>|]/g, '').trim()).find(line => line.length > 40) ?? run.answer.replace(/[#*_`>|]/g, '').slice(0, 140)).slice(0, 170);
/** A scheduled run, or its second or third try when the first did not finish (13 Nov 2026). */
const tryLabel = (run: RoutineRun) => run.attempt === 2 ? 'Second try' : run.attempt === 3 ? 'Third try' : 'On schedule';
const statusOf = (run: RoutineRun) => run.status === 'failed' ? 'failed' : run.quiet ? 'quiet' : run.approval?.state === 'waiting' ? 'waiting' : 'done';

/** «History» as a timeline (12 Nov 2026, his «wtf is this» at the log list): the runs by day, each with the first line
 *  of what it found; a filter per routine; a click opens the run in the right panel, never a row unfolding in place. */
function RunTimeline({ runs, chosen, onOpen, onDelete, onClear }: { runs: RoutineRun[]; chosen: string | null; onOpen(id: string): void; onDelete(id: string): Promise<void>; onClear(name?: string): Promise<void> }) {
  const [only, setOnly] = useState('');
  /** The run, or 'all', the app is asking «Delete?» about: asked on the page, as window.confirm never shows in the pane. */
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<void>) => { setBusy(true); try { await work(); } finally { setBusy(false); setAsking(null); } };
  useEffect(() => { if (only && !runs.some(run => run.routineName === only)) setOnly(''); }, [runs, only]);
  const names = useMemo(() => [...new Set(runs.map(run => run.routineName))], [runs]);
  const shown = only ? runs.filter(run => run.routineName === only) : runs;
  const days = useMemo(() => { const out: { label: string; runs: RoutineRun[] }[] = [];
    for (const run of shown) { const label = dayLabel(run.startedAt); const last = out.at(-1); if (last?.label === label) last.runs.push(run); else out.push({ label, runs: [run] }); }
    return out; }, [shown]);
  const found = runs.filter(run => statusOf(run) === 'done').length;
  return <section className="mn-tl" aria-labelledby="mn-rt-history">
    <header className="mn-tl-head">
      {asking === 'all'
        ? <span className="mn-ask-inline mn-tl-clear" role="alert">{only ? `Delete every run of «${only}»?` : 'Delete the whole history?'} This cannot be undone.
            <button type="button" className="nomos-btn mn-ask-yes" disabled={busy} onClick={() => void act(() => onClear(only || undefined))}>Delete</button>
            <button type="button" className="nomos-btn" onClick={() => setAsking(null)} autoFocus>Cancel</button></span>
        : <button type="button" className="nomos-btn mn-tl-clear" onClick={() => setAsking('all')}><Trash2 size={14} aria-hidden="true" /><span>{only ? 'Clear these runs' : 'Clear history'}</span></button>}
      <h2 id="mn-rt-history">What your routines found</h2>
      <p>{runs.length} runs · {found} with something to read{runs.some(run => run.status === 'failed') ? ` · ${runs.filter(run => run.status === 'failed').length} did not finish` : ''}</p>
    </header>
    {names.length > 1 && <div className="mn-tl-filter" role="group" aria-label="Show one routine">
      <button type="button" aria-pressed={!only} onClick={() => setOnly('')}>All</button>
      {names.map(name => <button key={name} type="button" aria-pressed={only === name} onClick={() => setOnly(current => current === name ? '' : name)}>{name}</button>)}
    </div>}
    {days.map(day => <div key={day.label} className="mn-tl-day">
      <h3>{day.label}</h3>
      <ol>{day.runs.map(run => <li key={run.id} data-status={statusOf(run)}>
        <button type="button" className={chosen === run.id ? 'is-open' : ''} aria-expanded={chosen === run.id} onClick={() => onOpen(run.id)}>
          <time>{clock(run.startedAt)}</time>
          <i aria-hidden="true" />
          <span className="mn-tl-text"><b>{run.routineName}{run.demo ? ' · demo inbox' : ''}</b><small>{previewOf(run)}</small></span>
          <span className="mn-tl-chip">{run.status === 'failed' ? 'Failed' : run.quiet ? 'Nothing new' : run.approval?.state === 'waiting' ? 'Waiting for your OK' : run.approval?.state === 'rejected' ? 'Not sent' : run.trigger === 'now' ? 'Run by you' : run.trigger === 'event' ? (run.cause === 'feed' ? 'Something new' : run.cause === 'hook' ? 'Called by link' : 'New email') : tryLabel(run)}</span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        {asking === run.id
          ? <span className="mn-ask-inline mn-tl-ask" role="alert">Delete this run?
              <button type="button" className="nomos-btn mn-ask-yes" disabled={busy} onClick={() => void act(() => onDelete(run.id))}>Delete</button>
              <button type="button" className="nomos-btn" onClick={() => setAsking(null)} autoFocus>Cancel</button></span>
          : <button type="button" className="mn-tl-bin" aria-label={`Delete the ${clock(run.startedAt)} run of ${run.routineName}`} title="Delete this run" onClick={() => setAsking(run.id)}><Trash2 size={14} aria-hidden="true" /></button>}
      </li>)}</ol>
    </div>)}
  </section>;
}

/** Where a routine sends, in words: «E-mail you@x and Telegram». */
function sendsTo(routine?: RoutineView): string {
  if (!routine) return '';
  const d = routine.deliver;
  const list = [d.email ? `e-mail (${d.email})` : '', d.whatsapp ? `WhatsApp (${maskedNumber(d.whatsapp)})` : '', d.slack ? 'Slack' : '', d.teams ? 'Teams' : '', d.telegram ? 'Telegram' : ''].filter(Boolean);
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] ?? '';
}

/** «Ask me before sending» (12 Nov 2026, CrewAI's @human_feedback with approved / rejected / needs a change, ported):
 *  a waiting run is sent, stopped, or redone with the person's words, and then waits again. */
function ApprovalBar({ run, routine, onChanged }: { run: RoutineRun; routine?: RoutineView; onChanged(run: RoutineRun, notice: string): Promise<void> }) {
  const [mode, setMode] = useState<'idle' | 'changing' | 'working'>('idle');
  const [doing, setDoing] = useState<'send' | 'stop' | 'change' | null>(null);
  const [change, setChange] = useState('');
  const [error, setError] = useState('');
  const approval = run.approval!;
  const where = sendsTo(routine);
  const act = async (kind: 'send' | 'stop' | 'change') => {
    setMode('working'); setDoing(kind); setError('');
    try {
      const next = kind === 'send' ? await approveRun(run.id) : kind === 'stop' ? await rejectRun(run.id) : await reviseRun(run.id, change.trim());
      if (kind === 'change' && next.error) { setError('The change did not work this time. The version below is still waiting; try again.'); setMode('changing'); return; }
      const failed = next.delivered.filter(item => !item.ok).length;
      await onChanged(next, kind === 'send' ? (failed ? `Sent, but ${failed} of ${next.delivered.length} did not arrive: see the run.` : `«${run.routineName}» is sent.`) : kind === 'stop' ? `«${run.routineName}» was not sent.` : `«${run.routineName}» was redone with your change. It waits for your OK again.`);
      setChange(''); setMode('idle');
    } catch (problem) {
      setError(problem instanceof ConnectionsError && problem.code === 'not_waiting' ? 'This run is no longer waiting: it was already sent or stopped.' : problem instanceof ConnectionsError && problem.code === 'routine_gone' ? 'Its routine was deleted, so it has nowhere to go.' : 'That did not work. Try again.');
      setMode(kind === 'change' ? 'changing' : 'idle');
    } finally { setDoing(null); }
  };
  const asked = approval.feedback ?? [];
  return <section className={`mn-approval is-${approval.state}`} aria-label="Your OK">
    {approval.state === 'waiting' ? <>
      <p className="mn-approval-head"><Hand size={15} aria-hidden="true" /><span><b>Not sent yet.</b> {where ? `It goes to ${where} when you say so.` : 'It goes out when you say so.'}</span></p>
      {asked.length > 0 && <p className="mn-approval-asked">Changed {asked.length === 1 ? 'once' : `${asked.length} times`}: {asked.map(item => `«${item}»`).join(' · ')}</p>}
      {mode === 'changing' || (mode === 'working' && doing === 'change') ? <div className="mn-approval-change">
        <textarea value={change} onChange={event => setChange(event.target.value)} maxLength={APPROVAL_FEEDBACK_MAX} rows={3} autoFocus disabled={mode === 'working'}
          placeholder="What should change? e.g. Shorter, and put the two urgent items first" aria-label="What should change"
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && change.trim()) { event.preventDefault(); void act('change'); } if (event.key === 'Escape') { event.stopPropagation(); setMode('idle'); } }} />
        <div className="mn-approval-actions">
          <button type="button" className="nomos-btn" onClick={() => setMode('idle')} disabled={mode === 'working'}>Cancel</button>
          <button type="button" className="nomos-btn is-primary" onClick={() => void act('change')} disabled={!change.trim() || mode === 'working'}>
            {doing === 'change' ? <><Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /><span>Redoing it… about a minute</span></> : <span>Redo it</span>}</button>
        </div>
      </div>
      : <div className="mn-approval-actions">
        <button type="button" className="nomos-btn is-primary" onClick={() => void act('send')} disabled={mode === 'working'}>
          {doing === 'send' ? <Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}<span>Send it</span></button>
        <button type="button" className="nomos-btn" onClick={() => setMode('changing')} disabled={mode === 'working'}><Pencil size={14} aria-hidden="true" /><span>Change</span></button>
        <button type="button" className="nomos-btn" onClick={() => void act('stop')} disabled={mode === 'working'}>
          {doing === 'stop' ? <Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /> : <X size={14} aria-hidden="true" />}<span>Don’t send</span></button>
      </div>}
    </>
    : approval.state === 'sent' ? <p className="mn-approval-head"><CircleCheck size={15} aria-hidden="true" /><span>Sent after your OK{approval.at ? `, ${dayLabel(approval.at).toLowerCase() === 'today' ? 'today' : dayLabel(approval.at)} at ${clock(approval.at)}` : ''}{asked.length ? ` · changed ${asked.length === 1 ? 'once' : `${asked.length} times`}` : ''}.</span></p>
    : <p className="mn-approval-head"><X size={15} aria-hidden="true" /><span>Not sent: you said no{approval.at ? ` (${clock(approval.at)})` : ''}.</span></p>}
    {error && <p className="mn-approval-error" role="alert">{error}</p>}
  </section>;
}

/** One run, read in the right panel: what it did, what it found, its sources and proposed replies. A link inside it
 *  opens the website in this same panel, with a way back to the run. */
function RunPanel({ run, routine, onClose, onChanged }: { run: RoutineRun; routine?: RoutineView; onClose(): void; onChanged(run: RoutineRun, notice: string): Promise<void> }) {
  const [web, setWeb] = useState<string | null>(null);
  const html = useMemo(() => run.answer ? sourceChipsHtml(renderMarkdown(run.answer)) : '', [run.answer]);
  const sent = (delivery: Delivery) => `${({ email: 'E-mail', whatsapp: 'WhatsApp', slack: 'Slack', teams: 'Teams', telegram: 'Telegram' } as const)[delivery.channel]} ${delivery.channel === 'whatsapp' ? maskedNumber(delivery.to) : delivery.to}: ${delivery.ok ? 'sent' : deliveryError(delivery.error)}`;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  if (web) return <div className="mn-run-web" data-own-links>
    <button type="button" className="mn-run-back" onClick={() => setWeb(null)}><ChevronLeft size={15} aria-hidden="true" />Back to «{run.routineName}»</button>
    <OfficialWebsiteViewer key={web} url={web} language="en" onClose={() => setWeb(null)} />
  </div>;
  return <aside ref={panel} tabIndex={-1} className="mn-document-source-reader mn-run-panel" data-own-links aria-label={`${run.routineName}, ${when(run.startedAt)}`}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
    onClick={event => { const link = (event.target as HTMLElement).closest('a'); if (link && /^https?:/.test(link.href)) { event.preventDefault(); setWeb(link.href); } }}>
    <header className="mn-run-head">
      <div><h2>{run.routineName}</h2>
        <p>{dayLabel(run.startedAt)}, {clock(run.startedAt)} · {run.trigger === 'now' ? 'Run by you' : run.trigger === 'event' ? (run.cause === 'feed' ? 'Something new' : run.cause === 'hook' ? 'Called by link' : 'New email') : tryLabel(run)} · took {Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000))} s</p></div>
      <span className="mn-run-status" data-status={statusOf(run)}>{run.status === 'failed' ? 'Failed' : run.quiet ? 'Nothing new' : run.approval?.state === 'waiting' ? 'Waiting' : run.approval?.state === 'rejected' ? 'Not sent' : 'Done'}</span>
      <button type="button" className="nomos-gov-uk-web-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="mn-run-body">
      {run.approval && <ApprovalBar run={run} routine={routine} onChanged={onChanged} />}
      {run.error && <p className="mn-rt-run-error">{RUN_ERRORS[run.error] ?? 'Something failed.'}{run.retryAt ? ` It tries again at ${clock(run.retryAt)}.` : ''}</p>}
      {run.steps.length > 0 && <ol className="mn-brief-log">{run.steps.map((step, index) => <li key={index}><Check size={12} aria-hidden="true" />{step}</li>)}</ol>}
      {html && <article className="mn-brief-answer mn-chat-ai-answer"><div className="ait ait--editorial"><div className="ait-md" dangerouslySetInnerHTML={{ __html: html }} /></div></article>}
      {run.sources?.length ? <SourcesSummary cited={run.sources} consulted={[]} onOpen={source => setWeb(source.url)} /> : null}
      {run.drafts?.length ? <DraftCards drafts={run.drafts} demo={run.demo} /> : null}
      {(run.read || run.delivered.length > 0) && <p className="mn-brief-facts">
        {[run.read ? `${run.read.mail} messages read · ${run.read.opened} opened${run.read.events ? ` · ${run.read.events} events` : ''}` : '', run.flagged ? `${run.flagged} flagged` : '', run.hidden ? `${run.hidden} names hidden from the AI` : '',
          'In the app', ...run.delivered.map(sent), ...(run.gaps ?? [])].filter(Boolean).join(' · ')}</p>}
    </div>
  </aside>;
}

/** A research agent inside a routine (11 Nov 2026): what it is asked each time, where, and how. Prepared from the
 *  person's sentence; every field can be changed by hand. */
function AgentFields({ agent, onChange, onBrief }: { agent: NonNullable<RoutineInput['agent']>; onChange(agent: NonNullable<RoutineInput['agent']>): void; onBrief(): void }) {
  const set = (patch: Partial<NonNullable<RoutineInput['agent']>>) => onChange({ ...agent, ...patch });
  const [more, setMore] = useState(false);
  const [sitesText, setSitesText] = useState((agent.sites ?? []).join(', '));
  return <div className="mn-rt-agent">
    <p className="mn-rt-agent-head"><Sparkles size={15} aria-hidden="true" /><b>Research agent</b><span>It searches and answers this every time, like a chat with an agent.</span>
      <button type="button" onClick={onBrief}>Use a brief instead</button></p>
    <label><span>What to ask each time</span><textarea rows={2} maxLength={2000} value={agent.question} onChange={event => set({ question: event.target.value })} /></label>
    <div className="mn-rt-agent-row">
      <label><span>Agent</span><input value={agent.name} maxLength={120} onChange={event => set({ name: event.target.value })} /></label>
      <label><span>Jurisdiction</span><select value={agent.jurisdiction} onChange={event => set({ jurisdiction: event.target.value })}>
        <option value="">None</option>{searchablePlaces().map(place => <option key={place.code} value={place.code}>{place.flag} {placeName(place, true)}</option>)}</select></label>
    </div>
    <label><span>Also search these websites</span><input value={sitesText} placeholder="e.g. bbc.com, a newspaper you read" spellCheck={false}
      // 13 Nov 2026 (code review): read as typed, so Enter (which saves the form) keeps them; tidied on leaving the field.
      onChange={event => { const text = event.target.value; setSitesText(text); const sites = [...new Set(text.split(/[\s,;]+/).map(item => siteDomain(item)).filter((item): item is string => !!item))].slice(0, 12); set({ sites: sites.length ? sites : undefined }); }}
      onBlur={() => { const sites = [...new Set(sitesText.split(/[\s,;]+/).map(item => siteDomain(item)).filter((item): item is string => !!item))].slice(0, 12); setSitesText(sites.join(', ')); }} />
      <small>Only these sites, never the open web. Leave empty for official sources only.</small></label>
    <span className="mn-rt-agent-switches">
      <label className="mn-brief-switch"><input type="checkbox" checked={agent.officialSearch} onChange={event => set({ officialSearch: event.target.checked })} /><span>Search the official sources live</span></label>
      <label className="mn-brief-switch"><input type="checkbox" checked={!!agent.quiet} onChange={event => set({ quiet: event.target.checked || undefined })} /><span>Only tell me when something is new</span></label>
      <label className="mn-brief-switch"><input type="checkbox" checked={agent.mode === 'deep'} onChange={event => set({ mode: event.target.checked ? 'deep' : 'fast' })} /><span>Deep research (a few minutes)</span></label>
      <button type="button" className="mn-rt-agent-more" onClick={() => setMore(value => !value)}>{more ? 'Hide' : 'Show'} its instructions</button></span>
    {more && <label><span>Instructions</span><textarea rows={8} maxLength={20000} value={agent.instructions} onChange={event => set({ instructions: event.target.value })} className="mn-rt-agent-instructions" /></label>}
  </div>;
}

function RoutineEditor({ value, delivery, apps, saving, onCancel, onSave }: { value: RoutineInput; delivery: RoutinesReply['delivery']; apps: { slack: boolean; teams: boolean }; saving: boolean; onCancel(): void; onSave(value: RoutineInput): void }) {
  const [draft, setDraft] = useState<RoutineInput>(value);
  const set = (patch: Partial<RoutineInput>) => setDraft(current => ({ ...current, ...patch }));
  // A new routine named like a wish («a brief of what happened in my github») takes the brief that fits, until the
  // person picks one by hand (11 Nov 2026: his GitHub wish was saved as the inbox brief).
  const [briefPicked, setBriefPicked] = useState(!!value.id);
  const named = (name: string) => set({ name, ...(!briefPicked && !draft.agent && wantsBrief(name) ? { brief: readSentence(name).brief } : {}) });
  const day = (weekday: Weekday) => set({ days: draft.days.includes(weekday) ? draft.days.filter(item => item !== weekday) : [...draft.days, weekday] });
  // 13 Nov 2026 (code review): the same checks as the server, so Save is never offered for a form it would refuse.
  const valid = draft.name.trim() && draft.days.length && /^\d{2}:\d{2}$/.test(draft.time) && validTimeZone(draft.timeZone) && (!draft.agent || !!draft.agent.name.trim()) && (draft.trigger?.kind !== 'mail' || draft.source === 'mine') && (draft.trigger?.kind !== 'feed' || !!feedUrl(draft.trigger.url)) && (!draft.agent || (!!draft.agent.question.trim() && !!draft.agent.instructions.trim()));
  return <form className="mn-brief mn-rt-editor" onSubmit={event => { event.preventDefault(); if (valid) onSave(draft); }} aria-label={value.id ? 'Edit routine' : 'New routine'}>
    <div className="mn-brief-head"><span className="mn-brief-icon" aria-hidden="true"><CalendarClock size={18} /></span>
      <div><h2>{value.id ? 'Edit routine' : 'New routine'}</h2><p>{draft.trigger?.kind === 'feed' ? 'It runs each time the page or feed below has something new.' : draft.trigger?.kind === 'hook' ? 'It runs each time another app calls its private link.' : draft.trigger?.kind === 'mail' ? 'It runs when a new e-mail matches what you describe.' : 'It runs on the days and at the time below, in the time zone you choose.'}</p></div></div>
    <div className="mn-rt-fields">
      <label><span>Name</span><input value={draft.name} maxLength={80} onChange={event => named(event.target.value)} /></label>
      {draft.agent ? <>
      <AgentFields agent={draft.agent} onChange={agent => set({ agent })} onBrief={() => set({ agent: undefined, trigger: undefined })} />
      {/* 13 Nov 2026 (the n8n / Make study): a research agent can also start on a page or feed, or on another app's call. */}
      <div className="mn-rt-field mn-rt-when"><span>When it runs</span>
        <div className="mn-brief-source" role="radiogroup" aria-label="When it runs">
          <button type="button" role="radio" aria-checked={!draft.trigger} onClick={() => set({ trigger: undefined })}>On a schedule</button>
          <button type="button" role="radio" aria-checked={draft.trigger?.kind === 'feed'} onClick={() => set({ trigger: { kind: 'feed', url: draft.trigger?.kind === 'feed' ? draft.trigger.url : '' }, everyHours: undefined })}>When a page or feed changes</button>
          <button type="button" role="radio" aria-checked={draft.trigger?.kind === 'hook'} onClick={() => set({ trigger: { kind: 'hook' }, everyHours: undefined })}>When another app calls it</button></div>
        {draft.trigger?.kind === 'feed' && <label className="mn-rt-filter"><span>Page or feed to watch</span>
          <input value={draft.trigger.url} maxLength={500} inputMode="url" spellCheck={false} onChange={event => set({ trigger: { kind: 'feed', url: event.target.value } })} placeholder="https://… a news feed (RSS) or any public page" />
          <small>Checked every 15 minutes. The first check only remembers what is there; after that, the agent runs on each new item, or on what changed on the page.</small></label>}
        {draft.trigger?.kind === 'hook' && <p className="mn-rt-hook-note">After you save, its private link appears on the routine’s card. A form, Zapier or a script sends data to it, and the agent runs on that data, at most once a minute.</p>}
      </div>
      </>
      : <>
      <label><span>Brief</span><select value={draft.brief} onChange={event => { setBriefPicked(true); set({ brief: event.target.value as RoutineInput['brief'] }); }}>{BRIEFS.map(brief => <option key={brief.id} value={brief.id}>{brief.name}</option>)}</select></label>
      <div className="mn-rt-field"><span>Read from</span>
        <div className="mn-brief-source" role="radiogroup" aria-label="Read from">
          <button type="button" role="radio" aria-checked={draft.source === 'demo'} onClick={() => set({ source: 'demo', deliver: { ...draft.deliver, slack: false, teams: false }, ...(draft.trigger?.kind === 'mail' ? { trigger: undefined } : {}) })}>Demo inbox</button>
          <button type="button" role="radio" aria-checked={draft.source === 'mine'} onClick={() => set({ source: 'mine' })}>My connected apps</button>
        </div></div>
      <div className="mn-rt-field mn-rt-when"><span>When it runs</span>
        <div className="mn-brief-source" role="radiogroup" aria-label="When it runs">
          <button type="button" role="radio" aria-checked={!draft.trigger} onClick={() => set({ trigger: undefined })}>On a schedule</button>
          <button type="button" role="radio" aria-checked={!!draft.trigger} onClick={() => set({ trigger: { kind: 'mail', filter: draft.trigger?.kind === 'mail' ? draft.trigger.filter : '' }, source: 'mine', everyHours: undefined })}>When an email arrives</button></div>
        {draft.trigger?.kind === 'mail' && <label className="mn-rt-filter"><span>Only emails that…</span>
          <input value={draft.trigger.filter} maxLength={300} onChange={event => set({ trigger: { kind: 'mail', filter: event.target.value } })} placeholder="e.g. come from a client and ask for something by a date" />
          <small>Checked every 5 minutes on your connected mail. The AI decides which new emails match, with names hidden. Empty = every new email.</small></label>}
      </div>
      </>}
      {!draft.trigger && <>
      <div className="mn-rt-field"><span>Days</span>
        <div className="mn-rt-days">{WEEKDAYS.map(weekday => <button key={weekday} type="button" aria-pressed={draft.days.includes(weekday)} onClick={() => day(weekday)}>{DAY_SHORT[weekday]}</button>)}
          <button type="button" className="mn-rt-preset" onClick={() => set({ days: [...WORKDAYS] })}>Weekdays</button>
          <button type="button" className="mn-rt-preset" onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })}>Every day</button></div></div>
      <label><span>Repeat</span><select value={draft.everyHours ?? 0} onChange={event => { const every = Number(event.target.value); set(every ? { everyHours: every as EveryHours } : { everyHours: undefined }); }}>
        <option value={0}>Once, at the time below</option>{EVERY_HOURS.map(hours => <option key={hours} value={hours}>{hours === 1 ? 'Every hour' : `Every ${hours} hours`}</option>)}</select></label>
      <label><span>{draft.everyHours ? 'Starting at' : 'Time'}</span><input type="time" value={draft.time} onChange={event => set({ time: event.target.value })} required /></label>
      <label><span>Time zone</span><input value={draft.timeZone} onChange={event => set({ timeZone: event.target.value })} list="mn-rt-zones" spellCheck={false} />
        <datalist id="mn-rt-zones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist></label>
      </>}
      <label><span>Also send by e-mail</span><select value={draft.deliver.email ?? ''} onChange={event => set({ deliver: { ...draft.deliver, email: event.target.value || null } })} disabled={!delivery.email.length}>
        <option value="">{delivery.email.length ? 'No e-mail' : 'E-mail is not set up on the server'}</option>{delivery.email.map(address => <option key={address} value={address}>{address}</option>)}</select></label>
      <label><span>Also send by WhatsApp</span><select value={draft.deliver.whatsapp ?? ''} onChange={event => set({ deliver: { ...draft.deliver, whatsapp: event.target.value || null } })} disabled={!delivery.whatsapp.length}>
        <option value="">{delivery.whatsapp.length ? 'No WhatsApp' : 'WhatsApp is not set up on the server'}</option>{delivery.whatsapp.map(number => <option key={number} value={number}>{maskedNumber(number)}</option>)}</select></label>
    </div>
    <label className="mn-brief-switch"><input type="checkbox" checked={draft.namesHidden} onChange={event => set({ namesHidden: event.target.checked })} /><span>Names hidden from the AI</span></label>
    <div className="mn-rt-apps-send" role="group" aria-label="Also send to your apps">
      <label className="mn-brief-switch" title={!apps.slack ? 'Connect Slack first' : draft.source !== 'mine' ? 'Only for your connected apps, not the demo inbox' : undefined}>
        <input type="checkbox" checked={!!draft.deliver.slack} disabled={!apps.slack || draft.source !== 'mine'} onChange={event => set({ deliver: { ...draft.deliver, slack: event.target.checked } })} /><span>Slack: a direct message to me</span></label>
      <label className="mn-brief-switch" title={!apps.teams ? 'Connect Microsoft Teams first' : draft.source !== 'mine' ? 'Only for your connected apps, not the demo inbox' : undefined}>
        <input type="checkbox" checked={!!draft.deliver.teams} disabled={!apps.teams || draft.source !== 'mine'} onChange={event => set({ deliver: { ...draft.deliver, teams: event.target.checked } })} /><span>Teams: a chat to me</span></label>
      <label className="mn-rt-telegram"><span>Telegram</span><select value={draft.deliver.telegram ?? ''} onChange={event => set({ deliver: { ...draft.deliver, telegram: event.target.value || null } })} disabled={!delivery.telegram.length}>
        <option value="">{delivery.telegram.length ? 'No Telegram' : 'The Telegram bot is not set up'}</option>{delivery.telegram.map(chat => <option key={chat} value={chat}>Chat {chat}</option>)}</select></label>
    </div>
    {/* «Ask me before sending» (12 Nov 2026, CrewAI's human feedback): the brief waits in the app for Send it, Change or Don't send.
        13 Nov 2026: after the places it is sent to, and it says in words why it is greyed out (only a tooltip did). */}
    <label className="mn-brief-switch">
      <input type="checkbox" checked={!!draft.approve && deliversSomewhere(draft)} disabled={!deliversSomewhere(draft)} onChange={event => set({ approve: event.target.checked || undefined })} />
      <span>Ask me before sending: it waits here for Send it, Change or Don’t send{deliversSomewhere(draft) ? '' : <small className="mn-rt-hint"> — choose where it is sent above first; until then its results stay here{draft.approve ? ', and your OK is asked as soon as it is sent somewhere' : ''}.</small>}</span></label>
    {draft.deliver.whatsapp && <p className="mn-brief-note">WhatsApp delivers a message the app starts only within 24 hours of your last message to the number (Meta’s rule). E-mail always arrives.</p>}
    <div className="mn-brief-controls">
      <button type="button" className="nomos-btn" onClick={onCancel}>Cancel</button>
      <button type="submit" className="nomos-btn is-primary mn-brief-run" disabled={!valid || saving}>{saving ? <Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}<span>Save routine</span></button>
    </div>
  </form>;
}
