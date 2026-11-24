// The editor (reference agent-studio.tsx, AgentEditor): the form on the left — role, task, output and rules;
// jurisdiction with a live search of its official websites; reference material — and a test beside it.
import React, { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, Pencil, Sparkles, Trash2, Undo2, Wand2, X } from 'lucide-react';
import { AGENT_LIMITS, isAgentDefinition, type AgentCategory, type AgentDefinition } from '../../shared/agents.ts';
import { placeName } from '../../shared/official-sources.ts';
import { siteDomain } from '../../shared/routines.ts';
import { buildAgentDesign, type BuildDraft } from '../data/api.ts';
import { findPrivate, makeMasker } from '../data/privacy.ts';
import { clearAgentDraft, deleteAgent, readLessons, readMyAgents, saveAgent, saveAgentDraft, saveLessons, useStoreVersion, type Settings } from '../data/store.ts';
import { AgentConversation } from './agent-run.tsx';
import { applyDesign } from './builder.tsx';
import { FIELDS, fieldById } from '../../shared/fields.ts';
import { jurisdictionName, readFiles, searchablePlaces, ToolBar } from './nomos-chrome.tsx';

const toDraft = (agent: AgentDefinition): BuildDraft => ({ name: agent.name, description: agent.description, category: agent.category, jurisdiction: agent.jurisdiction, officialSearch: agent.officialSearch, sites: agent.sites ?? [], mode: agent.mode, needs: agent.needs, starters: agent.starters, instructions: agent.instructions });

export function AgentEditor({ agent, isNew, built, restored = false, settings, onCancel, onSaved, onDeleted, lessonsFrom }: { agent: AgentDefinition; isNew: boolean; built?: string; restored?: boolean; settings: Settings; onCancel(): void; onSaved(agent: AgentDefinition): void; onDeleted(): void;
  /** «Customise» on a library agent: its lessons, shown here and kept by the copy when it is saved. */ lessonsFrom?: string }) {
  const [value, setValue] = useState<AgentDefinition>(agent);
  const [sitesText, setSitesText] = useState((agent.sites ?? []).join(', '));
  const [error, setError] = useState('');
  const [testKey, setTestKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // Leaving with changes (or with an agent the builder just designed) asks first.
  const [leaving, setLeaving] = useState(false);
  // A draft brought back is unsaved work too, even before it is changed again.
  const dirty = !!built || restored || JSON.stringify(value) !== JSON.stringify(agent);
  // Left without Save, Cancel or Delete (the rail, another page): the work is kept as a draft.
  const finished = useRef(false);
  const latest = useRef({ value, dirty }); latest.current = { value, dirty };
  // The save waits a tick and checks the editor is really gone: React's development StrictMode runs this
  // cleanup once on mount too, and that must not leave a draft behind.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; window.setTimeout(() => { if (!alive.current && !finished.current && latest.current.dirty) saveAgentDraft(latest.current.value, isNew, lessonsFrom); }, 0); };
  }, []);
  const finish = () => { finished.current = true; clearAgentDraft(); };
  // Closing or reloading the tab with unsaved work asks too.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { saveAgentDraft(latest.current.value, isNew, lessonsFrom); event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const knowledgePicker = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  // «Change with AI»: the user says the change; the builder rewrites the agent, and one click undoes it.
  const [change, setChange] = useState('');
  const [refining, setRefining] = useState(false);
  const [note, setNote] = useState(built ?? '');
  const [before, setBefore] = useState<AgentDefinition | null>(null);
  const refineAbort = useRef<AbortController | null>(null);
  useEffect(() => () => refineAbort.current?.abort(), []);
  const changing = useRef(false);
  const refine = async () => {
    const text = change.trim(); if (!text || refining || changing.current) return;
    changing.current = true;
    const controller = new AbortController(); refineAbort.current = controller; setRefining(true); setError('');
    try {
      // 13 Nov 2026 (code review): with «Hide names» on, the change and the agent go as placeholders, as in the builder,
      // and the names come back in the result.
      const current = toDraft(value);
      const { mask, restore } = makeMasker(settings.hideNames ? findPrivate([text, current.name, current.description, current.needs, current.instructions, ...current.starters]) : []);
      const result = await buildAgentDesign({ description: mask(text), current: { ...current, name: mask(current.name), description: mask(current.description), needs: mask(current.needs), instructions: mask(current.instructions), starters: current.starters.map(mask) }, field: value.field, appLaw: settings.jurisdiction ?? undefined, language: settings.language }, controller.signal);
      if (!result.agent) throw new Error('no_agent');
      const design = { ...result.agent, name: restore(result.agent.name), description: restore(result.agent.description), needs: restore(result.agent.needs), instructions: restore(result.agent.instructions), starters: (result.agent.starters ?? []).map(restore) };
      const next = applyDesign(design, value);
      // The websites box shows what the change set (it kept the old ones, and leaving it put them back).
      setBefore(value); setValue(next); setSitesText((next.sites ?? []).join(', ')); setNote(restore(result.summary || '') || 'The agent was changed.'); setChange(''); setTestKey(key => key + 1);
    } catch { if (!controller.signal.aborted) setError('The change was not made. Please try again.'); }
    finally { setRefining(false); refineAbort.current = null; changing.current = false; }
  };
  const set = <K extends keyof AgentDefinition>(key: K, next: AgentDefinition[K]) => setValue(current => ({ ...current, [key]: next }));
  const places = searchablePlaces();
  // The examples in the form: the reference's for Legal, neutral ones for every other field.
  const legal = value.field === 'legal';
  const save = () => {
    if (!value.name.trim() || !value.instructions.trim()) { setError('A name and instructions are needed.'); nameInput.current?.focus(); return; }
    const next = { ...value, name: value.name.trim(), starters: value.starters.map(item => item.trim()).filter(Boolean), updatedAt: Date.now() };
    if (!isAgentDefinition(next)) { setError('Not saved. Check the limits (instructions up to 20,000 characters).'); return; }
    // Within the limits but not written: the browser's storage is full.
    if (!saveAgent(next)) { setError('Not saved: the browser storage is full. Delete old conversations or agents.'); return; }
    finish(); onSaved(readMyAgents().find(item => item.id === value.id) ?? next);
  };
  return <div className="nomos-tool-scroll mn-agents is-edit">
    <ToolBar icon={Pencil} title={value.name.trim() || 'New agent'} onBack={() => { if (dirty) setLeaving(true); else { finish(); onCancel(); } }} backLabel="Cancel"
      end={<span className="mn-agents-bar-actions">
        {!isNew && <button type="button" className="nomos-btn is-danger-quiet" aria-label="Delete" onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" /><span>Delete</span></button>}
        <button type="button" className="nomos-btn is-primary" onClick={save}>Save</button>
      </span>} />
    {leaving && <div className="mn-agents-confirm" role="alertdialog" aria-label="Leave without saving">
      <span>This agent is not saved. Leave without saving?</span>
      <button type="button" className="nomos-btn" autoFocus onClick={() => setLeaving(false)}>Stay</button>
      <button type="button" className="nomos-btn is-danger" onClick={() => { finish(); onCancel(); }}>Leave</button>
    </div>}
    {confirming && <div className="mn-agents-confirm" role="alertdialog" aria-label="Delete agent">
      <span>Delete «{value.name}» and its chats?</span>
      <button type="button" className="nomos-btn" autoFocus onClick={() => setConfirming(false)}>Cancel</button>
      <button type="button" className="nomos-btn is-danger" onClick={() => { finish(); deleteAgent(value.id); onDeleted(); }}>Delete</button>
    </div>}
    <div className="mn-agents-editor">
      <form className="mn-agents-form" onSubmit={event => { event.preventDefault(); save(); }}>
        {error && <p className="mn-agent-notice is-error" role="alert">{error}</p>}
        <div className="mn-agent-refine">
          {note && <p className="mn-agent-refine-note"><Sparkles size={13} aria-hidden="true" /><span>{note}{built && !before && <small className="mn-agent-refine-hint">Try it in the test, change anything, then save.</small>}</span>
            {before && <button type="button" className="nomos-btn" onClick={() => { setValue(before); setSitesText((before.sites ?? []).join(', ')); setBefore(null); setNote(''); setTestKey(key => key + 1); }}><Undo2 size={13} aria-hidden="true" /><span>Undo</span></button>}</p>}
          <span className="mn-agent-refine-row"><Wand2 size={15} aria-hidden="true" />
            <input value={change} onChange={event => setChange(event.target.value)} maxLength={4000} disabled={refining} aria-label="Change with AI"
              placeholder={legal ? 'Change with AI: e.g. "act for the tenant" or "add a risk table"' : 'Change with AI: e.g. "write for a non-expert reader" or "add a summary table"'}
              onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void refine(); } }} />
            {refining ? <button type="button" className="nomos-btn" onClick={() => refineAbort.current?.abort()}><Loader2 size={13} className="is-spinning" aria-hidden="true" /><span>Changing…</span></button>
              : <button type="button" className="nomos-btn" disabled={!change.trim()} onClick={() => void refine()}>Change</button>}</span>
        </div>
        <label><span>Name</span><input ref={nameInput} value={value.name} maxLength={AGENT_LIMITS.name} onChange={event => set('name', event.target.value)} /></label>
        <label><span>Description</span><textarea rows={2} value={value.description} maxLength={AGENT_LIMITS.description} onChange={event => set('description', event.target.value)} placeholder="What the agent does, in one or two sentences." /></label>
        <div className="mn-agents-form-row">
          <label><span>{(fieldById(value.field) ?? FIELDS[0]).area}</span><select value={value.category} onChange={event => set('category', event.target.value as AgentCategory)}>
            {(fieldById(value.field) ?? FIELDS[0]).categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Jurisdiction</span><select value={value.jurisdiction} onChange={event => set('jurisdiction', event.target.value)}>
            <option value="">No country (choose one to research)</option>
            <optgroup label="Official sources">{places.map(place => <option key={place.code} value={place.code}>{place.flag} {placeName(place, true)}</option>)}
              {value.jurisdiction && !places.some(place => place.code === value.jurisdiction) && <option value={value.jurisdiction}>{(name => `${name.flag} ${name.name}`)(jurisdictionName(value.jurisdiction))}</option>}</optgroup>
          </select>
          {!value.jurisdiction && <small className="mn-agents-hint">Without a jurisdiction the agent asks for one in the chat; it never defaults to a place.</small>}</label>
        </div>
        <div className="mn-agents-form-row">
          <label className="mn-agents-toggle"><input type="checkbox" checked={value.officialSearch} onChange={event => set('officialSearch', event.target.checked)} />
            <span><b>Live search of the official sources</b><small>Only the jurisdiction's official websites, with a link to every page.</small></span></label>
          <label className="mn-agents-field mn-agents-sites"><span>Also search these websites</span>
            <input value={sitesText} onChange={event => setSitesText(event.target.value)} onBlur={() => { const sites = [...new Set(sitesText.split(/[\s,;]+/).map(siteDomain).filter((site): site is string => !!site))].slice(0, 12); set('sites', sites); setSitesText(sites.join(', ')); }}
              placeholder="e.g. bbc.com, a newspaper you read" />
            <small className="mn-agents-hint">Newspapers or other sites the agent searches besides the official ones. Leave empty for official sources only.</small></label>
          <div className="mn-agents-mode" role="radiogroup" aria-label="Mode">
            {(['fast', 'deep'] as const).map(mode => <button key={mode} type="button" role="radio" aria-checked={value.mode === mode} onClick={() => set('mode', mode)}>
              <b>{mode === 'fast' ? 'Fast' : 'Deep research'}</b><small>{mode === 'fast' ? 'Seconds to a minute' : 'More thorough, a few minutes'}</small></button>)}
          </div>
        </div>
        <label><span>What it asks the user for</span><input value={value.needs} maxLength={AGENT_LIMITS.needs} onChange={event => set('needs', event.target.value)} placeholder={legal ? 'e.g. Upload the contract and say whom you act for.' : 'e.g. Upload the document and say what you need from it.'} /></label>
        <label className="is-instructions"><span>Instructions: role, task, output, rules</span>
          <textarea rows={16} value={value.instructions} maxLength={AGENT_LIMITS.instructions} onChange={event => set('instructions', event.target.value)} />
          <small>{value.instructions.length.toLocaleString('en-GB')} / {AGENT_LIMITS.instructions.toLocaleString('en-GB')}</small></label>
        <fieldset><legend>Conversation starters</legend>
          {[...value.starters, ''].slice(0, AGENT_LIMITS.starters).map((starter, index) => <input key={index} value={starter} maxLength={AGENT_LIMITS.starter}
            placeholder={legal ? 'e.g. Flag every clause that creates risk for us.' : 'e.g. Summarise the attached document in ten points.'}
            onChange={event => { const next = [...value.starters]; next[index] = event.target.value; while (next.length && !next.at(-1)?.trim()) next.pop(); set('starters', next); }} />)}
        </fieldset>
        <fieldset><legend>Reference material (positions, templates, examples)</legend>
          {value.knowledge.map((file, index) => <span key={`${file.name}-${index}`} className="mn-agents-file"><FileText size={13} aria-hidden="true" />{file.name}<small>{file.text.length.toLocaleString('en-GB')} chars</small>
            <button type="button" aria-label="Remove" onClick={() => set('knowledge', value.knowledge.filter((_, i) => i !== index))}><X size={12} aria-hidden="true" /></button></span>)}
          <button type="button" className="nomos-btn" onClick={() => knowledgePicker.current?.click()} disabled={value.knowledge.length >= AGENT_LIMITS.knowledgeFiles}><Paperclip size={14} aria-hidden="true" />Add files</button>
          <input ref={knowledgePicker} type="file" hidden multiple accept=".pdf,.docx,.xlsx,.xlsm,.txt,.md,.csv" onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = '';
            void readFiles(files).then(read => setValue(current => {
              // The 200,000 characters are for all the files together (the server refuses more).
              let left = AGENT_LIMITS.knowledgeChars - current.knowledge.reduce((n, file) => n + file.text.length, 0); const added: { name: string; text: string }[] = [];
              for (const file of read) { if (current.knowledge.length + added.length >= AGENT_LIMITS.knowledgeFiles || left <= 0) break; const text = file.text.slice(0, left); added.push({ name: file.name.slice(0, 200), text }); left -= text.length; }
              if (added.length < read.length || added.some((file, index) => file.text.length < read[index].text.length)) setError('Reference material holds up to 10 files and 200,000 characters in all; the rest was not added.');
              return { ...current, knowledge: [...current.knowledge, ...added] };
            })); }} />
        </fieldset>
        {(!isNew || lessonsFrom) && <AgentLessons agentId={isNew ? lessonsFrom! : agent.id} copy={isNew} />}
      </form>
      <aside className="mn-agents-test" aria-label="Test">
        <header><b>Test</b><small>Runs with the settings as they are now; nothing is saved.</small>
          <button type="button" className="nomos-btn" onClick={() => setTestKey(key => key + 1)}>Reset</button></header>
        <AgentConversation key={testKey} agent={value} settings={settings} test onJurisdiction={code => set('jurisdiction', code)} />
      </aside>
    </div>
  </div>;
}

/** «Teach it» (12 Nov 2026): the lessons kept from the person's feedback on this agent's answers. They are kept apart
 *  from the form (a ready agent keeps its own too), so forgetting one takes effect at once. */
function AgentLessons({ agentId, copy = false }: { agentId: string; copy?: boolean }) {
  useStoreVersion();
  const lessons = readLessons(agentId);
  if (copy && !lessons.length) return null;
  return <fieldset><legend>Lessons from your feedback</legend>
    {copy && <small>From the library agent. Your copy keeps them when you save it; forget any of them in your copy after saving.</small>}
    {/* 13 Nov 2026 (code review): in a copy not yet saved, «Forget» removed the library agent's own lesson at once. */}
    {lessons.length ? <ol className="mn-hs-rules">{lessons.map(item => <li key={item}><span>{item}</span>
      {!copy && <button type="button" onClick={() => saveLessons(agentId, lessons.filter(other => other !== item))} aria-label={`Forget: ${item}`} title="Forget"><X size={14} aria-hidden="true" /></button>}</li>)}</ol>
    : <small>None yet. Press «Teach it» under an answer and say what should change: the agent redoes it and offers lessons to keep.</small>}
  </fieldset>;
}
