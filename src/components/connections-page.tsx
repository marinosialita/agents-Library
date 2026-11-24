// «Connections» (10 Nov 2026, his «connect my gmail and set the agent to review and give me a brief every morning»),
// ported from MyNomosAI's connections-page.tsx in its look: one card per service, grouped as people know them, one
// button that opens the provider's own sign-in in a small window, and the promises that make connecting mail
// comfortable. Below the cards, the first connected agent: the morning inbox brief, which runs on the owner's apps or
// on a demo inbox of invented messages, so anyone can see it work without connecting anything.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, EyeOff, KeyRound, Loader2, Play, Plug, RefreshCw, ShieldCheck, Square, Sunrise, TriangleAlert, Unplug, UserRound } from 'lucide-react';
import { ToolBar } from './nomos-chrome.tsx';
import { ConnectionLogo } from './connection-logos.tsx';
import { DraftCards } from './draft-cards.tsx';
import { CONNECTORS, CONNECTOR_BY_ID, FAMILIES, FAMILY_LABEL, type ConnectionsReply, type ConnectorFamily, type ConnectorId } from '../../shared/connections.ts';
import { BRIEF_BY_ID, addStep } from '../../shared/briefs.ts';
import { connectService, disconnectService, setTeamLink, listConnections, ownTimeZone, readOwnerCode, runBrief, saveOwnerCode, watchConnection, ConnectionsError, CONNECTIONS_CHANNEL, type BriefDone } from '../data/connections.ts';
import { renderMarkdown } from '../data/markdown.ts';
import type { Settings } from '../data/store.ts';


const serviceName = (id: string) => CONNECTOR_BY_ID[id as ConnectorId]?.name ?? id;
const BRIEF = BRIEF_BY_ID['morning-inbox-brief'];

const RUN_ERRORS: Record<string, string> = {
  agent_unavailable: 'The AI is not connected yet: the OpenAI key is missing on the server.',
  owner_code: 'This device does not have the owner code. Type it above, then run the brief again.',
  owner_code_not_set: 'The server has no owner code yet, so your own apps cannot be read.',
  sign_in: 'Sign in (Profile) to run the brief on your own apps.',
  not_configured: 'Connections are not switched on on this server yet.',
  nothing_connected: 'Connect Gmail, Google Calendar or Outlook first, or run the brief on the demo inbox.',
  connections_failed: 'Your connected apps could not be read just now. Try again in a moment.',
  timeout: 'The brief took too long and was stopped. Try again.',
  cut_short: 'The connection closed before the brief finished. Try again.',
  no_server: 'The server is not running.',
};

/** Figma's team link (11 Nov 2026): Composio cannot find the team from the sign-in, so the owner pastes it once. */
function TeamLink({ service, saved, onSaved }: { service: ConnectorId; saved: boolean; onSaved(): void }) {
  const [link, setLink] = useState('');
  const [editing, setEditing] = useState(!saved);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setEditing(!saved), [saved]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!link.trim() || busy) return; setBusy(true); setError('');
    try { await setTeamLink(service, link.trim()); setLink(''); onSaved(); }
    catch (failure) { setError(failure instanceof ConnectionsError && failure.code === 'invalid_team_link' ? 'Paste the link of your team page: figma.com/files/team/…' : 'Not saved. Try again.'); }
    finally { setBusy(false); }
  };
  if (!editing) return <p className="mn-conn-team is-saved"><Check size={13} aria-hidden="true" />Team link saved<button type="button" onClick={() => setEditing(true)}>Change</button></p>;
  return <form className="mn-conn-team" onSubmit={event => void save(event)}>
    <label><span>Figma team link</span>
      <input value={link} onChange={event => setLink(event.target.value)} placeholder="https://www.figma.com/files/team/…" aria-label="Figma team link" inputMode="url" /></label>
    <button type="submit" className="nomos-btn" disabled={!link.trim() || busy}>{busy ? <Loader2 size={13} className="mn-conn-spin" aria-hidden="true" /> : null}Save</button>
    {error ? <small className="is-error" role="alert">{error}</small> : <small>Open your team in Figma and copy the address. Only the team number is kept.</small>}
  </form>;
}

export function ConnectionsPage({ settings, onRoutines, onProfile }: { settings: Settings; onRoutines?(): void; onProfile?(): void }) {
  const [view, setView] = useState<ConnectionsReply | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<ConnectorId | null>(null);
  /** The app asking «Disconnect?» on the card itself (12 Nov 2026): window.confirm never shows in the app's browser pane. */
  const [asking, setAsking] = useState<ConnectorId | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [code, setCode] = useState('');
  const [hasCode, setHasCode] = useState(() => !!readOwnerCode());

  const load = useCallback(async () => {
    try { setView(await listConnections()); setFailed(false); } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // 13 Nov 2026: «How to set it up» in a chat opens this page at that app's card («#app-googlesheets»).
  useEffect(() => { const id = window.location.hash.slice(1); if (!id.startsWith('app-')) return; let tries = 0;
    const timer = window.setInterval(() => { const card = document.getElementById(id); if (card || ++tries > 30) { window.clearInterval(timer); card?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 100);
    return () => window.clearInterval(timer); }, []);
  // Back from another tab or window (a sign-in finished elsewhere): read the state again.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', again);
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel(CONNECTIONS_CHANNEL); channel.onmessage = () => void load(); } catch { channel = null; }
    return () => { document.removeEventListener('visibilitychange', again); channel?.close(); };
  }, [load]);

  const name = (id: ConnectorId) => CONNECTOR_BY_ID[id].name;
  const watching = useRef<AbortController | null>(null);
  useEffect(() => () => watching.current?.abort(), []);
  const connect = async (id: ConnectorId) => {
    watching.current?.abort();
    setBusy(id); setNotice(null);
    const connected = { tone: 'ok' as const, text: `${name(id)} is connected.` };
    try {
      const outcome = await connectService(id);
      if (outcome === 'closed') { await load(); return; }
      if (outcome === 'unknown') {
        // The sign-in window lost its link to the app (Google and Microsoft do this): check the state until it shows.
        const controller = new AbortController(); watching.current = controller;
        const ok = await watchConnection(id, controller.signal, 3000, 90_000);
        if (controller.signal.aborted) return;
        await load(); if (ok) setNotice(connected);
        return;
      }
      await load();
      setNotice(outcome === 'connected' ? connected : { tone: 'warn', text: `${name(id)} was not connected. Try again.` });
    } catch (error) {
      setNotice({ tone: 'warn', text: error instanceof ConnectionsError && error.code.startsWith('owner_code') ? 'This device does not have the owner code.' : 'The connection could not start. Try again shortly.' });
    } finally { setBusy(current => current === id ? null : current); }
  };
  const stopWaiting = () => { watching.current?.abort(); setBusy(null); };
  const disconnect = async (id: ConnectorId) => {
    setAsking(null); setBusy(id); setNotice(null);
    try { await disconnectService(id); await load(); setNotice({ tone: 'ok', text: `${name(id)} is disconnected.` }); }
    catch { setNotice({ tone: 'warn', text: 'Disconnecting failed. Try again.' }); }
    finally { setBusy(null); }
  };
  const unlock = async (event: React.FormEvent) => {
    event.preventDefault(); if (!code.trim()) return;
    saveOwnerCode(code); setCode(''); setHasCode(true);
    const next = await listConnections().catch(() => null);
    if (next) { setView(next); setNotice(next.owner ? { tone: 'ok', text: 'This device is now the owner’s.' } : { tone: 'warn', text: 'That is not the owner code.' }); if (!next.owner) { saveOwnerCode(''); setHasCode(false); } }
  };
  const forget = () => { saveOwnerCode(''); setHasCode(false); void load(); setNotice({ tone: 'ok', text: 'The owner code is forgotten on this device.' }); };

  const connectedCount = view?.services.filter(service => service.connected).length ?? 0;
  const available = !!view?.available;
  const owner = !!view?.owner;
  const date = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return <div className="nomos-tool-scroll mn-conn">
    <ToolBar icon={Plug} title="Connections"
      end={<button type="button" className="nomos-btn" onClick={() => void load()} disabled={!!busy}><RefreshCw size={14} aria-hidden="true" /><span>Refresh</span></button>} />
    <div className="mn-conn-page">
      <header className="mn-conn-hero">
        <h1>Connect your apps</h1>
        <p>One click and your usual sign-in. Your agents can then read your mail, calendar and work apps for the briefs you run. Nothing is sent unless you press Send and confirm.</p>
        {view && available && owner && <span className="mn-conn-count"><span className="mn-conn-dot" data-on={connectedCount > 0} aria-hidden="true" />{connectedCount} of {CONNECTORS.length} connected</span>}
      </header>

      {failed && <div className="mn-conn-banner is-warn" role="alert"><span>The connections could not be loaded.</span>
        <button type="button" className="nomos-btn" onClick={() => void load()}>Retry</button></div>}
      {view && !available && <div className="mn-conn-banner" role="status"><Plug size={16} aria-hidden="true" />
        <span>Connections are not switched on on this server yet. The morning brief below already works on the demo inbox.</span></div>}
      {view && available && !owner && <div className="mn-conn-banner" role="status"><UserRound size={16} aria-hidden="true" />
        <span>Sign in to connect your own apps. Each account has its own connections and routines.</span>
        {onProfile && <button type="button" className="nomos-btn is-primary" onClick={onProfile}>Sign in</button>}</div>}
      {view && available && view.ownerSet && !owner && <form className="mn-conn-banner mn-conn-owner" onSubmit={event => void unlock(event)}>
        <KeyRound size={16} aria-hidden="true" />
        <span>Or, as the owner of this server, type the owner code once on this device.</span>
        <input type="password" value={code} onChange={event => setCode(event.target.value)} placeholder="Owner code" aria-label="Owner code" autoComplete="current-password" />
        <button type="submit" className="nomos-btn is-primary" disabled={!code.trim()}>Unlock</button>
      </form>}
      {notice && <div className={`mn-conn-banner ${notice.tone === 'warn' ? 'is-warn' : 'is-ok'}`} role="status">
        {notice.tone === 'ok' ? <Check size={16} aria-hidden="true" /> : null}<span>{notice.text}</span></div>}

      {FAMILIES.map(family => <section key={family} className="mn-conn-family" aria-labelledby={`mn-conn-${family}`}>
        <h2 id={`mn-conn-${family}`}>{FAMILY_LABEL[family]}<small>{CONNECTORS.filter(connector => connector.family === family).length}</small></h2>
        <div className="mn-conn-grid">
          {CONNECTORS.filter(connector => connector.family === family).map(connector => {
            const state = view?.services.find(service => service.id === connector.id);
            const on = !!state?.connected;
            const working = busy === connector.id;
            return <article key={connector.id} id={`app-${connector.id}`} className="mn-conn-card" data-on={on}>
              <div className="mn-conn-card-top">
                <ConnectionLogo id={connector.id} size={36} />
                <div className="mn-conn-card-name">
                  <h3>{connector.name}</h3>
                  <span className="mn-conn-state">{on
                    ? <><span className="mn-conn-dot" data-on="true" aria-hidden="true" />Connected{state?.since ? ` · ${date(state.since)}` : ''}</>
                    : state && state.ready === false ? <><span className="mn-conn-dot is-setup" aria-hidden="true" />Needs one setup step</>
                    : <><span className="mn-conn-dot" aria-hidden="true" />Not connected</>}</span>
                </div>
              </div>
              <p className="mn-conn-uses">{connector.uses}</p>
              {/* 12 Nov 2026: it named one ready brief («Morning inbox brief») even when the person had none; any agent reads it. */}
              <p className="mn-conn-skills"><span>Used by</span><code>Your agents and routines</code></p>
              {connector.needsTeam && owner && available && <TeamLink service={connector.id} saved={!!state?.teamSet} onSaved={() => void load()} />}
              <div className="mn-conn-actions">
                {on && asking === connector.id
                  ? <span className="mn-ask-inline" role="alert">Disconnect {connector.name}? Your agents will no longer read it.
                      <button type="button" className="nomos-btn mn-ask-yes" onClick={() => void disconnect(connector.id)}>Disconnect</button>
                      <button type="button" className="nomos-btn" onClick={() => setAsking(null)} autoFocus>Cancel</button></span>
                  : on
                  ? <button type="button" className="nomos-btn mn-conn-off" onClick={() => setAsking(connector.id)} disabled={!!busy}>
                      {working ? <Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /> : <Unplug size={14} aria-hidden="true" />}<span>Disconnect</span></button>
                  : state && state.ready === false
                  // 13 Nov 2026: an app the server has no Composio sign-in for yet says so, instead of a button that fails.
                  ? <p className="mn-conn-setup">Its sign-in is not set up in Composio yet. In the Composio dashboard: Auth configs → Create → {connector.name}, then add its id to COMPOSIO_AUTH_CONFIGS and restart.</p>
                  : <button type="button" className="nomos-btn is-primary mn-conn-on" onClick={() => working ? stopWaiting() : void connect(connector.id)} disabled={(!!busy && !working) || !available || !owner}
                      title={working ? 'Stop waiting' : !available ? 'Connections are not switched on yet' : !owner ? 'Sign in first' : undefined}>
                      {working ? <Loader2 size={14} className="mn-conn-spin" aria-hidden="true" /> : <Plug size={14} aria-hidden="true" />}
                      <span>{working ? 'Waiting for sign-in…' : `Connect ${connector.name}`}</span></button>}
              </div>
            </article>;
          })}
        </div>
      </section>)}

      <MorningBrief settings={settings} canUseMine={available && owner && connectedCount > 0} onRoutines={onRoutines} />

      <footer className="mn-conn-promises" aria-label="How your apps are handled">
        <div><ShieldCheck size={18} aria-hidden="true" /><strong>Nothing goes out without you</strong>
          <span>Agents only read and propose. A reply leaves only when you press Send and confirm, and only to the person who wrote to you. Nothing is ever deleted.</span></div>
        <div><EyeOff size={18} aria-hidden="true" /><strong>Names hidden</strong>
          <span>Names, addresses and numbers are replaced before the AI reads a message, and put back for you.</span></div>
        <div><Unplug size={18} aria-hidden="true" /><strong>One-click disconnect</strong>
          <span>Access stops at once, here or from your account with the service.</span></div>
      </footer>
      {hasCode && owner && <p className="mn-conn-forget">This device holds the owner code. <button type="button" onClick={forget}>Forget it here</button></p>}
    </div>
  </div>;
}

function MorningBrief({ settings, canUseMine, onRoutines }: { settings: Settings; canUseMine: boolean; onRoutines?(): void }) {
  const [source, setSource] = useState<'demo' | 'mine'>('demo');
  const [namesHidden, setNamesHidden] = useState(settings.hideNames);
  const [log, setLog] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [done, setDone] = useState<BriefDone | null>(null);
  const [error, setError] = useState('');
  const running = useRef<AbortController | null>(null);
  const [isRunning, setRunning] = useState(false);
  useEffect(() => { if (!canUseMine && source === 'mine') setSource('demo'); }, [canUseMine, source]);
  useEffect(() => () => running.current?.abort(), []);
  const html = useMemo(() => answer ? renderMarkdown(answer) : '', [answer]);

  const run = async () => {
    if (running.current) { running.current.abort(); return; }
    const controller = new AbortController(); running.current = controller;
    setRunning(true); setLog([]); setAnswer(''); setDone(null); setError('');
    try {
      const result = await runBrief({ brief: BRIEF.id, demo: source === 'demo', namesHidden, language: settings.language, timeZone: ownTimeZone() },
        { onStatus: status => setLog(lines => addStep(lines, status, serviceName)), onAnswer: setAnswer },
        controller.signal);
      setAnswer(result.answer); setDone(result);
    } catch (problem) {
      const code = problem instanceof ConnectionsError ? problem.code : controller.signal.aborted ? 'cancelled' : 'agent_failed';
      setError(code === 'cancelled' || controller.signal.aborted ? 'Stopped.' : RUN_ERRORS[code] ?? 'The brief could not be written. Try again.');
    } finally { running.current = null; setRunning(false); }
  };

  const facts = done ? [
    `${done.read.mail} message${done.read.mail === 1 ? '' : 's'} read`, `${done.read.opened} opened`,
    ...(done.read.events ? [`${done.read.events} event${done.read.events === 1 ? '' : 's'}`] : []),
    ...(done.flagged ? [`${done.flagged} flagged as suspicious`] : []),
    ...(done.hidden ? [`${done.hidden} names and details hidden from the AI`] : []),
    ...(done.withheld ? [`${done.withheld} result${done.withheld === 1 ? '' : 's'} withheld`] : []),
  ] : [];

  return <section className="mn-brief" aria-labelledby="mn-brief-title">
    <div className="mn-brief-head">
      <span className="mn-brief-icon" aria-hidden="true"><Sunrise size={18} /></span>
      <div><h2 id="mn-brief-title">{BRIEF.name}</h2><p>{BRIEF.description}</p></div>
    </div>
    <div className="mn-brief-controls">
      <div className="mn-brief-source" role="radiogroup" aria-label="Read from">
        <button type="button" role="radio" aria-checked={source === 'demo'} onClick={() => setSource('demo')} disabled={isRunning}>Demo inbox</button>
        <button type="button" role="radio" aria-checked={source === 'mine'} onClick={() => setSource('mine')} disabled={isRunning || !canUseMine}
          title={canUseMine ? undefined : 'Connect an app first'}>My connected apps</button>
      </div>
      <label className="mn-brief-switch"><input type="checkbox" checked={namesHidden} onChange={event => setNamesHidden(event.target.checked)} disabled={isRunning} /><span>Names hidden</span></label>
      <button type="button" className={`nomos-btn${isRunning ? '' : ' is-primary'} mn-brief-run`} onClick={() => void run()}>
        {isRunning ? <><Square size={13} aria-hidden="true" /><span>Stop</span></> : <><Play size={14} aria-hidden="true" /><span>Run now</span></>}</button>
    </div>
    {source === 'demo' && <p className="mn-brief-note">The demo inbox holds seven invented messages and three meetings. One of them is a phishing message that tries to give the AI orders, so you can see the guards work.</p>}
    {log.length > 0 && <ol className="mn-brief-log" aria-label="What the agent did">
      {log.map((line, index) => <li key={`${index}-${line}`}>{isRunning && index === log.length - 1 ? <Loader2 size={12} className="mn-conn-spin" aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}{line}</li>)}
    </ol>}
    {error && <div className="mn-conn-banner is-warn" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{error}</span></div>}
    {html && <article className="mn-brief-answer mn-chat-ai-answer" aria-live="polite"><div className="ait ait--editorial"><div className="ait-md" dangerouslySetInnerHTML={{ __html: html }} /></div></article>}
    {done?.drafts?.length ? <DraftCards drafts={done.drafts} demo={done.demo} /> : null}
    {done && <p className="mn-brief-facts">{facts.join(' · ')}{done.gaps.length ? ` · ${done.gaps.join(' ')}` : ''}</p>}
    {!isRunning && <p className="mn-brief-later">To get it every morning on its own, make it a routine.{onRoutines ? <> <button type="button" className="mn-brief-link" onClick={onRoutines}>Open Routines</button></> : null}</p>}
  </section>;
}
