// «Today» (11 Nov 2026, his «build them all» after the Lindy study): what needs you, today's meetings, what your agents
// did this week and what they have learned about you. Lindy's Home asks for your mail and a card first; this page shows
// the demo calendar until you connect one, so it is useful from the first visit.
import React, { useEffect, useState } from 'react';
import { Eye, Mail, ArrowRight, BookMarked, CalendarDays, CalendarClock, CircleAlert, Loader2, MailCheck, MessageSquare, Plug, ShieldAlert, Sparkles, Sun, Wand2, Bot, X } from 'lucide-react';
import { loadToday, type TodayReply } from '../data/today.ts';
import { renderMarkdown } from '../data/markdown.ts';
import { withoutNeeds } from '../../shared/needs.ts';
import { deleteRoutine } from '../data/routines.ts';
import { OfficialWebsiteViewer } from './official-website-viewer.tsx';
import { allLessons, findAgent, readChats, readHouse, useStoreVersion, type Settings } from '../data/store.ts';
import { ToolBar } from './nomos-chrome.tsx';
import { MailPanel, type MailTarget } from './mail-panel.tsx';

/** «Tomorrow» or the weekday for a meeting that is not today (13 Nov 2026: tomorrow's 09:00 showed as today's). */
const dayTag = (iso: string) => { const at = new Date(iso); if (Number.isNaN(at.getTime())) return ''; const now = new Date();
  const days = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  return days === 0 ? '' : days === 1 ? 'Tomorrow' : at.toLocaleDateString('en-GB', { weekday: 'short' }); };
// 13 Nov 2026: «Good morning» at 00:32. Until five it is still the evening.
const greeting = (hour: number) => hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
const time = (iso: string) => { const at = Date.parse(iso); return Number.isNaN(at) ? '' : new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
const ago = (at: number) => { const minutes = Math.round((Date.now() - at) / 60_000); return minutes < 60 ? `${Math.max(1, minutes)} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

export function TodayPage({ settings, onGo, onTask}: { settings: Settings; onGo(page: 'connections' | 'routines' | 'house' | 'library' | 'conversations' | 'learn'): void; onTask(task: string): void }) {
  useStoreVersion();
  const [data, setData] = useState<TodayReply | null>(null);
  const [failed, setFailed] = useState(false);
  const [task, setTask] = useState('');
  const [mail, setMail] = useState<MailTarget | null>(null);
  /** A web page from an agent's column, read in the same right panel as an e-mail. */
  const [web, setWeb] = useState<string | null>(null);
  /** A routine's newest result, read in full in the right panel (12 Nov 2026); a link in it opens the site there, and
   *  closing the site comes back to the result. */
  const [brief, setBrief] = useState<TodayReply['latest'][number] | null>(null);
  const close = React.useCallback(() => { setMail(null); setWeb(null); }, []);
  const openMail = (target: MailTarget) => { setWeb(null); setMail(target); };
  useEffect(() => { const controller = new AbortController(); loadToday(controller.signal).then(setData, () => { if (!controller.signal.aborted) setFailed(true); }); return () => controller.abort(); }, []);
  // 13 Nov 2026 (code review): after a routine is deleted here, what came from it (its open result, a waiting OK, its
  // «Needs you» lines) goes too: Today is read again.
  const deleted = (id: string) => { setBrief(current => current?.id === id ? null : current); loadToday().then(setData, () => undefined); };
  const now = new Date();
  const chats = readChats().filter(chat => chat.updatedAt >= Date.now() - 7 * 86_400_000).length;
  const rules = readHouse().rules;
  // 13 Nov 2026: a name saved in lower case («alex») is greeted with its capital.
  const first = (name => name ? name.charAt(0).toLocaleUpperCase() + name.slice(1) : name)(settings.name?.trim().split(/\s+/)[0]);

  return <div className={`nomos-tool-scroll mn-today-split${mail || web || brief ? ' is-open' : ''}`}>
  <div className="mn-today">
    <ToolBar icon={Sun} title="Today" />
    <div className="mn-today-page">
      <header className="mn-today-hero">
        <p className="mn-today-date">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>{greeting(now.getHours())}{first ? <>, <em>{first}</em></> : ''}.</h1>
        {/* The pulse (12 Nov 2026): what is working for you right now, in one line. */}
        {data && <p className="mn-today-pulse"><i aria-hidden="true" />
          {(() => { const on = data.latest.filter(item => item.enabled).length;
            return [on ? `${on} ${on === 1 ? 'routine' : 'routines'} on watch` : 'No routine on watch yet', data.done.briefs ? `${data.done.briefs} ${data.done.briefs === 1 ? 'brief' : 'briefs'} this week` : '', data.done.read ? `${data.done.read} items read for you` : '', data.connected.length ? `${data.connected.length} ${data.connected.length === 1 ? 'app' : 'apps'} connected` : ''].filter(Boolean).join(' · '); })()}</p>}
        <form className="mn-today-ask" onSubmit={event => { event.preventDefault(); if (task.trim()) onTask(task.trim()); }}>
          <Wand2 size={17} aria-hidden="true" />
          <input value={task} onChange={event => setTask(event.target.value)} placeholder="Ask anything: a task to do, your inbox, an agent to build, how something works…" aria-label="Ask Agents anything" />
          <button type="submit" className="nomos-btn is-primary" disabled={!task.trim()}><span>Ask</span><ArrowRight size={14} aria-hidden="true" /></button>
        </form>
        <div className="mn-today-quick" role="group" aria-label="Start with">
          {['What needs my reply in my inbox today?', 'Do we have an agent that reviews a lease?', 'Build me an agent for client updates', 'What is a routine?'].map(idea => <button key={idea} type="button" onClick={() => onTask(idea)}>{idea}</button>)}
        </div>
        <button type="button" className="mn-today-learn" onClick={() => onGo('learn')}><Eye size={14} aria-hidden="true" />Or show it once: Watch and Learn turns a recording into an agent</button>
      </header>

      {failed && <p className="mn-conn-banner is-warn" role="alert">Today could not be loaded. The app server may not be running.</p>}
      {data?.waiting?.length ? <p className="mn-conn-banner mn-today-waiting" role="status"><CircleAlert size={16} aria-hidden="true" />
        <span>{data.waiting.length === 1 ? <>«{data.waiting[0].name}» is waiting for your OK before it is sent.</> : <>{data.waiting.length} routine results are waiting for your OK before they are sent.</>}</span>
        <button type="button" className="nomos-btn is-primary" onClick={() => onGo('routines')}>Review</button></p> : null}
      {data?.demo && <p className="mn-conn-banner" role="status"><Plug size={16} aria-hidden="true" /><span>{data.signedIn ? 'No calendar is connected yet, so the meetings below are the demo calendar.' : 'Sign in and connect your calendar to see your own day. Below: the demo calendar.'}</span>
        <button type="button" className="nomos-btn" onClick={() => onGo('connections')}>Connections</button></p>}

      <RoutineColumns latest={data?.latest} fed={data?.needs.length ? { at: data.needs[0].at, count: data.needs.length } : undefined} chosen={brief?.id} onDeleted={deleted} onRead={item => { setMail(null); setWeb(null); setBrief(current => current?.id === item.id ? null : item); }} onRoutines={() => onGo('routines')} onLink={url => { setMail(null); setWeb(url); }} />
      <div className="mn-today-grid">
        <section className="mn-today-card is-needs" id="mn-today-needs">
          <h2><CircleAlert size={16} aria-hidden="true" />Needs you</h2>
          {!data ? <p className="mn-today-empty"><Loader2 size={14} className="mn-conn-spin" aria-hidden="true" />Loading…</p>
          : data.needs.length ? <><ol className="mn-today-needs">{data.needs.map((need, index) => <li key={index}>{need.mail
                ? <button type="button" className={mail?.id === need.mail.id ? 'is-open' : ''} onClick={() => openMail(need.mail!)} aria-label={`Open the e-mail: ${need.mail.subject || 'no subject'}`}>{boldOf(need.text)}<span className="mn-today-mail"><Mail size={12} aria-hidden="true" />Open</span></button>
                : <div>{boldOf(need.text)}</div>}</li>)}</ol>
              <small>From «{data.needs[0].from}», {ago(data.needs[0].at)}</small></>
          : <div className="mn-today-empty"><p>Your morning brief fills this in: what needs you, by when, and the next step.</p>
              <button type="button" className="nomos-btn" onClick={() => onGo('routines')}><CalendarClock size={14} aria-hidden="true" /><span>Set up the morning brief</span></button></div>}
        </section>

        <section className="mn-today-card">
          <h2><CalendarDays size={16} aria-hidden="true" />Meetings ahead{data?.demo && <em>Demo</em>}</h2>
          {!data ? <p className="mn-today-empty"><Loader2 size={14} className="mn-conn-spin" aria-hidden="true" />Loading…</p>
          : data.meetings.length ? <ul className="mn-today-meetings">{data.meetings.map((meeting, index) => <li key={index}>
              <time>{time(meeting.start)}{dayTag(meeting.start) && <small>{dayTag(meeting.start)}</small>}</time><span><b>{meeting.title || 'Meeting'}</b><small>{[meeting.where, meeting.service].filter(Boolean).join(' · ')}</small></span></li>)}</ul>
          : <p className="mn-today-empty">No meetings in the next day.</p>}
        </section>

        <section className="mn-today-card">
          <h2><Sparkles size={16} aria-hidden="true" />What your agents did this week</h2>
          <div className="mn-today-stats">
            <span><b>{data?.done.briefs ?? 0}</b><small>briefs written</small></span>
            <span><b>{data?.done.read ?? 0}</b><small>messages and meetings read</small></span>
            <span><b>{data?.done.flagged ?? 0}</b><small>suspicious messages caught</small></span>
            <span><b>{chats}</b><small>conversations with agents</small></span>
          </div>
          <p className="mn-today-row"><MailCheck size={14} aria-hidden="true" />{data?.done.sent ?? 0} briefs sent to you{data?.done.failed ? ` · ${data.done.failed} did not run` : ''}
            <button type="button" onClick={() => onGo('conversations')}><MessageSquare size={13} aria-hidden="true" />Conversations</button></p>
        </section>

        <section className="mn-today-card">
          <h2><BookMarked size={16} aria-hidden="true" />What they have learned about you</h2>
          {/* 13 Nov 2026: «Teach it» lessons of each agent too, not only the rules for every agent (it said «Press Remember»). */}
          {(learned => learned.length ? <ul className="mn-today-rules">{learned.slice(-5).reverse().map((item, index) => <li key={`${index}:${item.who}:${item.text}`}>{item.text}<small>{item.who}</small></li>)}</ul>
            : <p className="mn-today-empty">Nothing yet. Press «Teach it» under any answer and say what should change: the agent redoes it and keeps the lessons you approve.</p>)(
            [...rules.map(text => ({ text, who: 'Every agent' })), ...allLessons().map(item => ({ text: item.lesson, who: findAgent(item.agentId)?.name ?? 'An agent' }))])}
          <button type="button" className="mn-today-link" onClick={() => onGo('house')}>House style<ArrowRight size={13} aria-hidden="true" /></button>
        </section>
      </div>

      <p className="mn-today-promise"><ShieldAlert size={14} aria-hidden="true" />Agents read and propose: a reply, post or event goes out only when you press it, routines send only where you chose, and agents never delete anything.</p>
    </div>
  </div>
  {mail && <MailPanel target={mail} onClose={close} />}
  {web && !mail && <OfficialWebsiteViewer key={web} url={web} language="en" onClose={close} />}
  {brief && !mail && !web && <BriefPanel key={brief.id} item={brief} onClose={() => setBrief(null)} onLink={setWeb} onRoutines={() => onGo('routines')} />}
  </div>;
}

/** The brief writes **bold** in Markdown; show it as bold text, never as stars. */
function boldOf(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part.replace(/\*\*/g, ''))
}


/** «Your routines» (12 Nov 2026, his «a column for each routine agent I am building»): one column per routine,
 *  side by side, each with its newest result. */
function RoutineColumns({ latest: all, fed, chosen, onRead, onRoutines, onLink, onDeleted }: { /** The run whose to-dos fill «Needs you», and how many. */ fed?: { at: number; count: number }; latest?: TodayReply['latest']; chosen?: string; onRead(item: TodayReply['latest'][number]): void; onRoutines(): void; onLink(url: string): void; onDeleted(id: string): void }) {
  // Deleted here (12 Nov 2026, his «delete them in Today»): the column asks in its own bar (window.confirm never shows
  // in the app's browser pane and answers «Cancel»), then goes at once; the routine is deleted on the server.
  const [gone, setGone] = useState<string[]>([]);
  const [failed, setFailed] = useState('');
  const remove = async (item: TodayReply['latest'][number]) => {
    setFailed(''); setGone(list => [...list, item.id]);
    try { await deleteRoutine(item.id); onDeleted(item.id); } catch { setGone(list => list.filter(id => id !== item.id)); setFailed(`«${item.name}» could not be deleted. Try again.`); }
  };
  const latest = all?.filter(item => !gone.includes(item.id));
  if (!latest?.length) return null;
  return <section className="mn-today-agents" aria-label="Your routines">
    <h2><Bot size={16} aria-hidden="true" />Your routines<small>{latest.length}</small></h2>
    {failed && <p className="mn-today-empty" role="alert">{failed}</p>}
    <div className="mn-today-columns">{latest.map(item => <RoutineColumn key={item.id} item={item} inNeeds={fed && item.at === fed.at ? fed.count : 0} open={chosen === item.id} onRead={() => onRead(item)} onRoutines={onRoutines} onLink={onLink} onDelete={() => void remove(item)} />)}</div>
  </section>;
}

function RoutineColumn({ item, inNeeds, open, onRead, onRoutines, onLink, onDelete }: { item: TodayReply['latest'][number]; /** Its to-dos are shown in «Needs you»: how many. */ inNeeds: number; open: boolean; onRead(): void; onRoutines(): void; onLink(url: string): void; onDelete(): void }) {
  // Footnote marks ([^1]) and their notes are the chat's proof machinery; the column shows the text.
  const [asking, setAsking] = useState(false);
  // 13 Nov 2026 (his «why do these 2 boxes show the same thing?»): the to-dos «Needs you» already shows are left out
  // here, with a line that points to them; «Read in full» still opens the whole brief.
  const shown = inNeeds ? withoutNeeds(item.answer) : item.answer;
  const html = React.useMemo(() => shown ? renderMarkdown(shown.replace(/^\[\^\d+\]:.*$/gm, '').replace(/\[\^\d+\]/g, '')) : '', [shown]);
  // The app's own browser pane does not animate a smooth scroll: it lands there anyway.
  const toNeeds = () => { const box = document.getElementById('mn-today-needs'); if (!box) return; box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    window.setTimeout(() => { const at = box.getBoundingClientRect().top; if (at < 0 || at > window.innerHeight * 0.6) box.scrollIntoView({ block: 'start' }); }, 650); };
  return <article className={`mn-today-column${open ? ' is-open' : ''}`}>
    <header>
      {asking ? <>
        <span className="mn-today-column-ask" role="alert">Delete this routine and its results?</span>
        <button type="button" className="mn-today-column-yes" onClick={() => { setAsking(false); onDelete(); }}>Delete</button>
        <button type="button" className="mn-today-column-no" onClick={() => setAsking(false)} autoFocus>Cancel</button>
      </> : <>
        <button type="button" onClick={onRoutines} title="Open Routines">{item.name}</button>
        <button type="button" className="mn-today-column-delete" onClick={() => setAsking(true)} title="Delete this routine" aria-label={`Delete ${item.name}`}><X size={15} aria-hidden="true" /></button>
      </>}
    </header>
    <small className="mn-today-column-when">{item.at ? `Last run ${ago(item.at)}` : 'Not run yet'}{item.enabled ? '' : ' · paused'}</small>
    {inNeeds > 0 && !item.failed && <button type="button" className="mn-today-column-needs" onClick={toNeeds}><CircleAlert size={13} aria-hidden="true" />{inNeeds === 1 ? 'Its to-do is' : `Its ${inNeeds} to-dos are`} in «Needs you» below<ArrowRight size={13} aria-hidden="true" /></button>}
    {item.failed ? <p className="mn-today-empty">The last run did not finish.</p>
      : html ? <div className="mn-today-column-body answer-markdown" dangerouslySetInnerHTML={{ __html: html }}
          onClick={event => { const link = (event.target as HTMLElement).closest('a'); if (link && /^https?:/.test(link.href)) { event.preventDefault(); onLink(link.href); } }} />
      : inNeeds ? null : <p className="mn-today-empty">{item.at ? 'Nothing new on the last run.' : 'Its first result appears here after it runs.'}</p>}
    {(html || inNeeds > 0) && !item.failed ? <button type="button" className="mn-today-link" aria-expanded={open} onClick={onRead}>{open ? 'Close' : 'Read in full'}<ArrowRight size={13} aria-hidden="true" /></button>
      : <button type="button" className="mn-today-link" onClick={onRoutines}>Open in Routines<ArrowRight size={13} aria-hidden="true" /></button>}
  </article>;
}


/** A routine's newest result in the right panel: the whole brief at reading width. */
function BriefPanel({ item, onClose, onLink, onRoutines }: { item: TodayReply['latest'][number]; onClose(): void; onLink(url: string): void; onRoutines(): void }) {
  const html = React.useMemo(() => renderMarkdown(item.answer.replace(/^\[\^\d+\]:.*$/gm, '').replace(/\[\^\d+\]/g, '')), [item.answer]);
  const panel = React.useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  return <aside ref={panel} tabIndex={-1} className="mn-document-source-reader mn-run-panel" aria-label={item.name}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
    onClick={event => { const link = (event.target as HTMLElement).closest('a'); if (link && /^https?:/.test(link.href)) { event.preventDefault(); onLink(link.href); } }}>
    <header className="mn-run-head">
      <div><h2>{item.name}</h2><p>Last run {ago(item.at)}{item.enabled ? '' : ' · paused'}</p></div>
      <button type="button" className="nomos-btn" onClick={onRoutines}>All runs</button>
      <button type="button" className="nomos-gov-uk-web-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="mn-run-body"><article className="mn-brief-answer mn-chat-ai-answer"><div className="ait ait--editorial"><div className="ait-md" dangerouslySetInnerHTML={{ __html: html }} /></div></article></div>
  </aside>;
}
