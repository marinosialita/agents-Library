// «Chains» (7 Nov 2026, his request): agents one after another on one task. The ready-made chains show the idea and
// can be copied; the user's own are edited here, step by step. A run shows each step's answer as it arrives; the last
// twenty runs are kept in this browser.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, CircleAlert, CircleCheck, Copy, FileText, Globe, Loader2, Pencil, Play, Plus, Search, Sparkles, Square, Trash2, Workflow, X } from 'lucide-react';
import type { AgentDefinition } from '../../shared/agents.ts';
import { fieldById, FIELDS } from '../../shared/fields.ts';
import { placeName } from '../../shared/official-sources.ts';
import { RunError } from '../data/api.ts';
import { chainStepRequest, isReadyChain, READY_CHAINS, runChainStep } from '../data/chains.ts';
import { deleteChain, newChainId, readChainRuns, readChains, readMyAgents, readyAgents, saveChain, saveChainRun, useStoreVersion, type Chain, type ChainRun, type ChatDocument, type Settings } from '../data/store.ts';
import { rankAgents } from '../data/task-finder.ts';
import { AnswerActions } from './answer-actions.tsx';
import { ProofAnswer } from './proof-view.tsx';
import { categoryLabel, categoryStyle } from './library.tsx';
import { readFiles, searchablePlaces, ToolBar, whenLabel } from './nomos-chrome.tsx';

const ChainCanvas = React.lazy(() => import('./chain-canvas.tsx'));

const FAILURES: Record<string, string> = {
  agent_unavailable: 'AI is not connected on this server yet. Settings → AI connection shows what is missing.',
  no_server: 'The server routes did not answer.',
  jurisdiction_unsupported: 'No official sources are catalogued for this place.',
  request_too_large: 'The documents are too large for one step. Remove one and run again.',
};
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Finds an agent by its name, else by the words of a task. */
function AgentPick({ agents, value, onChange, disabled }: { agents: AgentDefinition[]; value: string; onChange(id: string): void; disabled: boolean }) {
  const agent = agents.find(item => item.id === value);
  const [open, setOpen] = useState(!agent && !disabled);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    const q = fold(query.trim()); if (!q) return [];
    const named = agents.filter(item => fold(item.name).includes(q)).sort((a, b) => Number(!fold(b.name).startsWith(q)) - Number(!fold(a.name).startsWith(q)));
    return [...new Set([...named, ...(named.length < 8 && q.length > 2 ? rankAgents(query, agents, 8).map(item => item.agent) : [])])].slice(0, 8);
  }, [query, agents]);
  useEffect(() => setActive(0), [query]);
  const pick = (id: string) => { onChange(id); setOpen(false); setQuery(''); };
  if (!open) return <button type="button" className="mn-chain-agent" onClick={() => { if (!disabled) setOpen(true); }} disabled={disabled} title={disabled ? undefined : 'Change the agent'}>
    {agent ? <><span className="mn-agent-card-chip">{fieldById(agent.field)?.name} · {categoryLabel(agent.category)}</span><b>{agent.name}</b></> : <b>This agent is not here any more</b>}
    {!disabled && <small>Change</small>}</button>;
  return <div className="mn-chain-pick">
    <input value={query} onChange={event => setQuery(event.target.value)} autoFocus placeholder="Find an agent by its name or by the task" aria-label="Find an agent"
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (results.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length); }
        else if (event.key === 'Enter') { event.preventDefault(); if (results[active]) pick(results[active].id); }
        else if (event.key === 'Escape' && agent) { setOpen(false); setQuery(''); }
      }} />
    {agent && <button type="button" className="mn-chain-pick-close" onClick={() => { setOpen(false); setQuery(''); }} aria-label="Keep the agent"><X size={12} aria-hidden="true" /></button>}
    {results.length > 0 && <ul className="mn-agent-slash mn-chain-pick-list" role="listbox" aria-label="Agents">{results.map((item, index) => <li key={item.id} role="option" aria-selected={index === active}
      onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(item.id)}>
      <Workflow size={14} aria-hidden="true" /><span><b>{item.name}</b><small>{fieldById(item.field)?.name} · {categoryLabel(item.category)}</small></span></li>)}</ul>}
  </div>;
}

export function ChainsPage({ chainId, settings, onSelect, onOpenAgent }: { chainId?: string; settings: Settings; onSelect(id?: string): void; onOpenAgent(id: string): void }) {
  const version = useStoreVersion();
  const mine = useMemo(() => readChains(), [version]);
  const agents = useMemo(() => [...readMyAgents(), ...readyAgents()], [version]);
  const byId = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
  const runs = useMemo(() => readChainRuns(), [version]);
  const chosen = [...mine, ...READY_CHAINS].find(chain => chain.id === chainId) ?? null;
  const ready = !!chosen && isReadyChain(chosen.id);
  const [tab, setTab] = useState<'ready' | 'mine'>('ready');
  const [query, setQuery] = useState('');
  const [field, setField] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const now = Date.now();
  const create = () => { const chain: Chain = { id: newChainId(), name: 'New chain', steps: [{ agentId: '', ask: '' }], createdAt: now, updatedAt: now }; saveChain(chain); onSelect(chain.id); };
  const copy = (chain: Chain) => { const next: Chain = { ...chain, id: newChainId(), name: isReadyChain(chain.id) ? chain.name : `${chain.name} (copy)`, steps: chain.steps.map(step => ({ ...step })), createdAt: now, updatedAt: now }; saveChain(next); onSelect(next.id); };
  const update = (patch: Partial<Chain>) => { if (chosen && !ready) saveChain({ ...chosen, ...patch, updatedAt: Date.now() }); };
  // A chain belongs to the field of its first agent: the card's chip and the filter read it.
  const first = (chain: Chain) => byId.get(chain.steps[0]?.agentId ?? '');
  const fieldsWithChains = useMemo(() => FIELDS.filter(item => READY_CHAINS.some(chain => byId.get(chain.steps[0]?.agentId ?? '')?.field === item.id)), [byId]);
  if (chosen) return <div className="nomos-tool-scroll mn-agents">
    <ToolBar icon={Workflow} title={chosen.name} onBack={() => onSelect(undefined)} backLabel="All chains" />
    <div className="mn-pages-body mn-chain-page">
      <ChainView key={chosen.id} chain={chosen} ready={ready} agents={agents} byId={byId} settings={settings} runs={runs.filter(run => run.chainId === chosen.id)}
        onUpdate={update} onCopy={() => copy(chosen)} onDelete={() => { deleteChain(chosen.id); onSelect(undefined); }} onOpenAgent={onOpenAgent} />
    </div>
  </div>;
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const text = (chain: Chain) => fold([chain.name, chain.description ?? '', fieldById(first(chain)?.field)?.name ?? '', ...chain.steps.flatMap(step => [byId.get(step.agentId)?.name ?? '', step.ask])].join(' '));
  const list = (tab === 'ready' ? READY_CHAINS : mine).filter(chain => (!field || first(chain)?.field === field) && (!words.length || (hay => words.every(word => hay.includes(word)))(text(chain))));
  const last = runs[0];
  return <div className="nomos-tool-scroll mn-agents">
    <ToolBar icon={Workflow} title="Chain Agents" end={<span className="mn-agents-bar-actions"><button type="button" className="nomos-btn is-primary" onClick={create}><Plus size={15} aria-hidden="true" /><span>Create chain</span></button></span>} />
    <div className="mn-chain-home">
      <label className="mn-chain-search"><Search size={18} aria-hidden="true" />
        <input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search chains, tasks or agents…" aria-label="Search chains" />
        {query && <button type="button" onClick={() => { setQuery(''); search.current?.focus(); }} aria-label="Clear"><X size={14} aria-hidden="true" /></button>}</label>
      <p className="mn-chain-lead"><span>One task. Your agents, working in sequence.</span>
        <button type="button" onClick={() => onSelect('ready-chain-lease-letter-greek')}><Play size={13} aria-hidden="true" />Try the lease chain</button></p>
      {last && <button type="button" className="mn-chain-recent" onClick={() => onSelect(last.chainId)} title="Your last run">
        {last.chainName} · {last.steps.filter(step => step.status === 'done').length}/{last.steps.length}</button>}
      <div className="mn-chain-tabs">
        <span role="tablist" aria-label="Chains">
          <button type="button" role="tab" aria-selected={tab === 'ready'} onClick={() => setTab('ready')}><Sparkles size={15} aria-hidden="true" />Ready-made<small>{READY_CHAINS.length}</small></button>
          <button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}><Pencil size={15} aria-hidden="true" />My chains<small>{mine.length}</small></button>
        </span>
        <select value={field} onChange={event => setField(event.target.value)} aria-label="Field">
          <option value="">All fields</option>
          {fieldsWithChains.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
      {!list.length ? <div className="mn-agents-empty"><p>{tab === 'mine' && !mine.length ? 'You have no chain of your own yet. Copy a ready-made one or create a chain.' : 'No chain matches.'}</p></div>
      : <ul className="mn-agents-grid mn-chain-grid">{list.map(chain => { const lead = first(chain); return <li key={chain.id}>
        <button type="button" className="mn-agent-card" onClick={() => onSelect(chain.id)}>
          <span className="mn-agent-card-top"><span className="mn-agent-card-tags">{lead ? <span className="mn-agent-card-chip" style={categoryStyle(lead.category)}>{fieldById(lead.field)?.name}</span> : <span className="mn-agent-card-chip">Chain</span>}</span>
            <small className="mn-chain-count">{chain.steps.length} {chain.steps.length === 1 ? 'step' : 'steps'}</small></span>
          <b title={chain.name}>{chain.name}</b>
          <span className="mn-agent-card-text"><span>{chain.description || chain.steps.map(step => byId.get(step.agentId)?.name ?? 'Pick an agent').join(' → ')}</span></span>
          <span className="mn-chain-dots">{chain.steps.map((step, index) => <i key={index} title={byId.get(step.agentId)?.name}><Sparkles size={11} aria-hidden="true" />{index + 1}</i>)}<small>One connected task</small></span>
        </button>
        <span className="mn-agent-card-foot">
          <button type="button" className="mn-agent-customise" onClick={() => copy(chain)}><Copy size={13} aria-hidden="true" />{tab === 'ready' ? 'Copy & edit' : 'Duplicate'}</button>
          <button type="button" className="mn-agent-use" onClick={() => onSelect(chain.id)}>View chain<ArrowRight size={13} aria-hidden="true" /></button>
        </span>
      </li>; })}</ul>}
    </div>
  </div>;
}

function ChainView({ chain, ready, agents, byId, settings, runs, onUpdate, onCopy, onDelete, onOpenAgent }: { chain: Chain; ready: boolean; agents: AgentDefinition[]; byId: Map<string, AgentDefinition>; settings: Settings; runs: ChainRun[];
  onUpdate(patch: Partial<Chain>): void; onCopy(): void; onDelete(): void; onOpenAgent(id: string): void }) {
  const [task, setTask] = useState('');
  const [documents, setDocuments] = useState<ChatDocument[]>([]);
  const [jurisdiction, setJurisdiction] = useState(settings.jurisdiction ?? '');
  const [run, setRun] = useState<ChainRun | null>(runs[0] ?? null);
  const [busy, setBusy] = useState(false);
  /** 13 Nov 2026: «Delete» removed a chain at once, with no question and no undo. Asked on the page (window.confirm never shows in the pane). */
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // A step on the map scrolls to it (its result while a run shows, otherwise its settings).
  const openStep = React.useCallback((index: number) => { (document.getElementById(`chain-run-step-${index}`) ?? document.getElementById(`chain-step-${index}`))?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, []);
  const setStep = (index: number, patch: Partial<Chain['steps'][number]>) => onUpdate({ steps: chain.steps.map((step, at) => at === index ? { ...step, ...patch } : step) });
  const move = (index: number, by: number) => { const next = [...chain.steps]; const [step] = next.splice(index, 1); next.splice(index + by, 0, step); onUpdate({ steps: next }); };
  const attach = async (files: File[]) => { if (!files.length) return; setReading(true); try { const read = await readFiles(files); setDocuments(current => [...current, ...read].slice(0, 10)); if (read.length < files.length) setNotice('Some files could not be read (PDF, Word, Excel or text).'); } finally { setReading(false); } };
  const start = async () => {
    if (busy) return;
    const missing = chain.steps.findIndex(step => !byId.get(step.agentId));
    if (missing >= 0) { setNotice(`Step ${missing + 1} has no agent. Pick one first.`); return; }
    if (!task.trim() && !documents.length) { setNotice('Write the task or attach the documents first.'); return; }
    const researching = chain.steps.map(step => byId.get(step.agentId)!).find(agent => agent.officialSearch && !jurisdiction && !agent.jurisdiction);
    if (researching) { setNotice(`«${researching.name}» researches official sources: choose a jurisdiction first.`); return; }
    setNotice(''); setBusy(true);
    const controller = new AbortController(); abort.current = controller;
    let current: ChainRun = { id: newChainId().replace('chain', 'run'), chainId: chain.id, chainName: chain.name, input: task, documents: documents.map(file => file.name), jurisdiction,
      steps: chain.steps.map(step => ({ agentId: step.agentId, agentName: byId.get(step.agentId)!.name, ask: step.ask, answer: '', status: 'waiting' as const })), createdAt: Date.now(), updatedAt: Date.now() };
    const show = (index: number, patch: Partial<ChainRun['steps'][number]>) => { current = { ...current, updatedAt: Date.now(), steps: current.steps.map((step, at) => at === index ? { ...step, ...patch } : step) }; setRun(current); };
    setRun(current);
    let previous: { label: string; answer: string } | null = null;
    for (let index = 0; index < chain.steps.length; index++) {
      const agent = byId.get(chain.steps[index].agentId)!;
      show(index, { status: 'working' });
      try {
        const done = await runChainStep(chainStepRequest({ agent, ask: chain.steps[index].ask }, task, documents, previous, jurisdiction, settings), settings.hideNames ? {} : null,
          { onText: text => show(index, { answer: text }), onStatus: () => undefined }, controller.signal);
        if (!done.answer.trim()) throw new RunError('empty_answer');
        show(index, { status: 'done', answer: done.answer, ...(done.sources.length ? { sources: done.sources } : {}), ...(done.gaps.length ? { gaps: done.gaps } : {}) });
        previous = { label: `Result of step ${index + 1} · ${agent.name}`, answer: done.answer };
      } catch (error) {
        const code = error instanceof RunError ? error.code : '';
        show(index, { status: controller.signal.aborted ? 'stopped' : 'failed', note: controller.signal.aborted ? 'Stopped.' : FAILURES[code] ?? 'This step did not answer. Run the chain again.' });
        for (let rest = index + 1; rest < chain.steps.length; rest++) show(rest, { status: 'stopped', note: 'Not run: the step before did not finish.' });
        break;
      }
      saveChainRun(current);
    }
    saveChainRun(current);
    setBusy(false); abort.current = null;
  };
  return <section className="mn-chain" aria-label={chain.name}>
    <header className="mn-chain-head">
      {ready ? <h2>{chain.name}</h2> : <input value={chain.name} maxLength={120} onChange={event => onUpdate({ name: event.target.value })} aria-label="Chain name" />}
      <span className="mn-agents-bar-actions">
        {ready ? <button type="button" className="nomos-btn" onClick={onCopy}><Copy size={14} aria-hidden="true" /><span>Copy to edit</span></button>
          : asking ? <span className="mn-ask-inline" role="alert">Delete this chain?
              <button type="button" className="nomos-btn mn-ask-yes" onClick={onDelete}>Delete</button>
              <button type="button" className="nomos-btn" onClick={() => setAsking(false)} autoFocus>Cancel</button></span>
          : <button type="button" className="nomos-btn is-danger-quiet" onClick={() => setAsking(true)}><Trash2 size={14} aria-hidden="true" /><span>Delete</span></button>}
      </span>
    </header>
    <React.Suspense fallback={<div className={`mn-cc${chain.steps.length <= 3 ? " is-row" : ""}`} aria-hidden="true" />}>
      <ChainCanvas task={task} documents={documents.length} onOpenStep={openStep}
        steps={chain.steps.map((step, index) => ({ agentName: byId.get(step.agentId)?.name ?? '', ask: step.ask, status: run && run.chainId === chain.id && run.steps.length === chain.steps.length ? run.steps[index]?.status : undefined }))} />
    </React.Suspense>
    <ol className="mn-chain-steps">{chain.steps.map((step, index) => <li key={index} id={`chain-step-${index}`}>
      <span className="mn-chain-n" aria-hidden="true">{index + 1}</span>
      <div className="mn-chain-step">
        <AgentPick agents={agents} value={step.agentId} onChange={id => setStep(index, { agentId: id })} disabled={ready} />
        <textarea rows={2} value={step.ask} readOnly={ready} maxLength={2_000} onChange={event => setStep(index, { ask: event.target.value })} placeholder="What this step does, e.g. «Turn the report into a letter to the tenant»" aria-label={`Step ${index + 1}: what it does`} />
      </div>
      {!ready && <span className="mn-chain-step-tools">
        <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up"><ArrowUp size={13} aria-hidden="true" /></button>
        <button type="button" onClick={() => move(index, 1)} disabled={index === chain.steps.length - 1} aria-label="Move down"><ArrowDown size={13} aria-hidden="true" /></button>
        <button type="button" onClick={() => onUpdate({ steps: chain.steps.filter((_, at) => at !== index) })} disabled={chain.steps.length === 1} aria-label="Remove the step"><Trash2 size={13} aria-hidden="true" /></button>
      </span>}
    </li>)}</ol>
    {!ready && chain.steps.length < 8 && <button type="button" className="mn-agents-task-build" onClick={() => onUpdate({ steps: [...chain.steps, { agentId: '', ask: '' }] })}><Plus size={13} aria-hidden="true" />Add a step</button>}
    <form className="mn-agent-composer mn-chain-run" onSubmit={event => { event.preventDefault(); void start(); }}>
      {documents.length > 0 && <span className="mn-agent-docs">{documents.map((file, index) => <span key={file.id}><FileText size={12} aria-hidden="true" />{file.name}
        <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setDocuments(current => current.filter((_, at) => at !== index))}><X size={11} aria-hidden="true" /></button></span>)}</span>}
      {notice && <p className="mn-agent-notice" role="status">{notice}</p>}
      <span className="mn-agent-input"><textarea rows={3} value={task} onChange={event => setTask(event.target.value)} maxLength={20_000} placeholder="What should the chain work on? Describe it and attach the documents." aria-label="The task for the chain" /></span>
      <span className="mn-agent-composer-row">
        <button type="button" className="nomos-btn" onClick={() => picker.current?.click()} disabled={busy || reading} aria-label="Documents"><FileText size={14} aria-hidden="true" /><span>{reading ? 'Reading…' : 'Documents'}</span></button>
        <input ref={picker} type="file" hidden multiple accept=".pdf,.docx,.xlsx,.xlsm,.txt,.md,.csv" onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; void attach(files); }} />
        <span className="mn-agent-chips"><label className="mn-agent-chip is-choose" title="The place whose official sources researching steps read"><Globe size={12} aria-hidden="true" />
          <select value={jurisdiction} onChange={event => setJurisdiction(event.target.value)} aria-label="Jurisdiction"><option value="">No jurisdiction</option>{searchablePlaces().map(item => <option key={item.code} value={item.code}>{item.flag} {placeName(item, true)}</option>)}</select></label></span>
        {busy ? <button type="button" className="mn-agent-send" onClick={() => abort.current?.abort()} aria-label="Stop"><Square size={14} aria-hidden="true" /></button>
          : <button type="submit" className="mn-agent-send" aria-label="Run the chain" title="Run the chain"><Play size={15} aria-hidden="true" /></button>}
      </span>
    </form>
    {run && <section className="mn-chain-result" aria-label="Run" aria-live="polite">
      <h3>{run.createdAt ? `Run of ${whenLabel(run.createdAt)}` : 'Run'}{runs.length > 1 && <select value={run.id} onChange={event => setRun(runs.find(item => item.id === event.target.value) ?? run)} aria-label="Earlier runs">{runs.map(item => <option key={item.id} value={item.id}>{whenLabel(item.createdAt)} · {item.input.slice(0, 40) || item.documents.join(', ')}</option>)}</select>}</h3>
      <ol>{run.steps.map((step, index) => <li key={index} id={`chain-run-step-${index}`} className={`is-${step.status}`}>
        <header><span className="mn-chain-status" aria-hidden="true">{step.status === 'done' ? <CircleCheck size={15} /> : step.status === 'working' ? <Loader2 size={15} className="is-spinning" /> : step.status === 'failed' ? <CircleAlert size={15} /> : <span>{index + 1}</span>}</span>
          <button type="button" className="mn-agent-by" onClick={() => onOpenAgent(step.agentId)}>{step.agentName}</button><small>{step.status === 'working' ? 'Working…' : step.status === 'waiting' ? 'Waiting' : step.note ?? ''}</small></header>
        {step.answer && <ProofAnswer content={step.answer} streaming={step.status === 'working'} language={settings.language} researched={!!step.sources?.length} reference={byId.get(step.agentId)?.knowledge ?? []}
          documents={[...(index > 0 && run.steps[index - 1].answer ? [{ name: `Result of step ${index} · ${run.steps[index - 1].agentName}`, text: run.steps[index - 1].answer }] : []), ...documents]} />}
        {step.gaps?.length ? <ul className="mn-agent-gaps">{step.gaps.map((gap, at) => <li key={at}>{gap}</li>)}</ul> : null}
        {step.status === 'done' && <AnswerActions title={`${run.chainName} · ${step.agentName}`} content={step.answer} sources={step.sources} original={documents.at(-1)} onNotice={setNotice} />}
      </li>)}</ol>
    </section>}
  </section>;
}
