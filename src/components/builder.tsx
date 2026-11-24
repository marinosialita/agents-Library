// «New agent» (reference agent-studio.tsx, AgentBuilder): describe the work, and the platform designs the agent
// (api/agent-build.ts); it opens in the editor beside the test.
import { readSites } from '../../shared/routine-sentence.ts';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, FileText, Loader2, Paperclip, Pencil, Sparkles, Square, Wand2, X } from 'lucide-react';
import { AGENT_LIMITS, type AgentDefinition } from '../../shared/agents.ts';
import { categoryBelongs, FIELDS, fieldById, type FieldId } from '../../shared/fields.ts';
import { isSearchablePlace } from '../../shared/official-sources.ts';
import { PRODUCT_NAME } from '../../shared/product.ts';
import { buildAgentDesign, type BuildDraft } from '../data/api.ts';
import { findPrivate, makeMasker } from '../data/privacy.ts';
import { blankAgent, workingField, type Settings } from '../data/store.ts';
import { readFiles, ToolBar } from './nomos-chrome.tsx';

/** What the builder shows while it designs: its stages in order, each ticked as the time passes. */
const BUILD_STAGES = ['Reading what you need', 'Choosing the area, jurisdiction and sources', 'Writing the steps of the task', 'Setting the output and the rules'];

/** A design from the server as an agent of the user's own; the examples given become its reference material. */
/** Websites besides the official ones (12 Nov 2026: «crime news in Cyprus» searched only gov.cy and found nothing):
 *  the ones already chosen, else those the agent's name and description call for (links, «Cyprus news»). */
const designedSites = (draft: BuildDraft, base: AgentDefinition) => draft.sites ?? base.sites ?? readSites(`${draft.name}. ${draft.description}`);

export function applyDesign(draft: BuildDraft, base: AgentDefinition, examples: { name: string; text: string }[] = []): AgentDefinition {
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value : '').slice(0, max);
  return { ...base, name: text(draft.name, AGENT_LIMITS.name).trim(), description: text(draft.description, AGENT_LIMITS.description).trim(),
    category: categoryBelongs(base.field, draft.category) ? draft.category : base.category,
    jurisdiction: isSearchablePlace(draft.jurisdiction) ? draft.jurisdiction : draft.jurisdiction === '' ? '' : base.jurisdiction, officialSearch: draft.officialSearch !== false, mode: draft.mode === 'deep' ? 'deep' : 'fast',
    needs: text(draft.needs, AGENT_LIMITS.needs).trim(), starters: (Array.isArray(draft.starters) ? draft.starters : []).map(item => text(item, AGENT_LIMITS.starter).trim()).filter(Boolean).slice(0, AGENT_LIMITS.starters),
    instructions: text(draft.instructions, AGENT_LIMITS.instructions).trim(), ...(designedSites(draft, base).length ? { sites: designedSites(draft, base) } : {}), knowledge: examples.length ? examples.map(file => ({ name: file.name.slice(0, 200), text: file.text.slice(0, AGENT_LIMITS.knowledgeChars) })) : base.knowledge, updatedAt: Date.now() };
}

function BuildStages() {
  const [at, setAt] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setAt(value => Math.min(value + 1, BUILD_STAGES.length - 1)), 4500); return () => window.clearInterval(timer); }, []);
  return <ol className="mn-agent-build-stages" aria-live="polite">{BUILD_STAGES.map((stage, index) => <li key={stage} className={index < at ? 'is-done' : index === at ? 'is-now' : ''}>
    <span aria-hidden="true">{index < at ? <Check size={12} /> : index === at ? <Loader2 size={12} className="is-spinning" /> : null}</span>{stage}</li>)}</ol>;
}

/** 13 Nov 2026: «How can I get a summary every time the BBC posts…?» typed here started building an agent from a question. */
export const looksLikeQuestion = (text: string) => /\?\s*$/.test(text.trim()) && /^(?:how|what|why|where|when|which|who|can|could|do|does|is|are|should|would|will)\b/i.test(text.trim())
  // «Can you build an agent that reviews NDAs?» is a build request (13 Nov 2026, code review).
  && !/\b(?:build|make|create|design|set up)\b[^?]{0,30}\b(?:an? |me an? )?(?:new )?agents?\b|\bagents? (?:that|which|to|for)\b/i.test(text);

export function AgentBuilder({ settings, onCancel, onBlank, onBuilt, initialDescription, initialField, autoStart, onAsk }: { /** The assistant offered this agent and the person said yes: the design starts at once. */ autoStart?: boolean; settings: Settings; onCancel(): void; onBlank(): void; onBuilt(agent: AgentDefinition, summary: string): void; initialDescription?: string; /** The field of the task's nearest agent («Tell me the task»). */ initialField?: FieldId;
  /** A question typed here goes to Ask Agents instead, when the person chooses. */ onAsk?(question: string): void }) {
  const [description, setDescription] = useState(initialDescription ?? '');
  const [examples, setExamples] = useState<{ name: string; text: string }[]>([]);
  const [questions, setQuestions] = useState<{ question: string; options: string[] }[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  // The agent is built in the library's current field: its areas are offered, its ideas shown.
  // «All fields» (12 Nov 2026: a meal planner was filed under Legal): no field is sent and the design chooses one.
  const anyField = !initialField && settings.field === 'all';
  const field = fieldById(initialField ?? workingField(settings)) ?? FIELDS[0];
  const picker = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const [reading, setReading] = useState(0);
  const attach = async (files: File[]) => {
    if (!files.length) return;
    setNotice('Reading examples…'); setReading(count => count + 1);
    try {
      const read = await readFiles(files);
      setExamples(current => [...current, ...read.map(file => ({ name: file.name, text: file.text }))].slice(0, 3));
      setNotice(read.length < files.length ? 'Some files could not be read (PDF, Word, Excel or text).' : '');
    } finally { setReading(count => count - 1); }
  };
  const building = useRef(false);
  const [question, setQuestion] = useState(false);
  const run = async (answered?: { question: string; answer: string }[], anyway = false) => {
    const text = description.trim(); if (!text || busy || reading || building.current) return;
    if (!answered && !anyway && onAsk && looksLikeQuestion(text)) { setQuestion(true); return; }
    setQuestion(false);
    building.current = true;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setNotice('');
    try {
      // Names hidden (7 Nov 2026): the examples are documents too; the design comes back with the names put back.
      const masker = makeMasker(settings.hideNames ? findPrivate([text, ...(answered ?? []).flatMap(item => [item.question, item.answer]), ...examples.flatMap(file => [file.name, file.text])]) : []);
      const { mask, restore } = masker;
      const result = await buildAgentDesign({ description: mask(text).slice(0, 4_000), answers: answered?.map(item => ({ question: mask(item.question).slice(0, 400), answer: mask(item.answer).slice(0, 1_000) })),
        examples: examples.map(file => ({ name: mask(file.name).slice(0, 200), text: mask(file.text).slice(0, 40_000) })), // The task decides the field (12 Nov 2026: a love-letter agent built from the Real estate library was told to
        // pick a real-estate task instead); only a field brought by a task's nearest agent is passed on.
        ...(initialField ? { field: field.id } : {}), appLaw: settings.jurisdiction ?? undefined, language: settings.language }, controller.signal);
      if (result.agent) { const design = result.agent; onBuilt(applyDesign({ ...design, name: restore(design.name), description: restore(design.description), needs: restore(design.needs), instructions: restore(design.instructions), starters: (Array.isArray(design.starters) ? design.starters : []).map(restore) }, blankAgent(design.field ?? field.id), examples), restore(result.summary)); }
      else { const questions = result.questions.map(item => ({ question: restore(item.question), options: item.options.map(restore) })); setQuestions(questions); setAnswers(questions.map(() => '')); }
    } catch {
      if (!controller.signal.aborted) setNotice('The agent was not built. Please try again.');
    } finally { setBusy(false); abort.current = null; building.current = false; }
  };
  // Offered by the assistant: the design starts as the page opens (on a timer, so StrictMode's double effect starts it once).
  const start = useRef(run); start.current = run;
  useEffect(() => { if (!autoStart || !initialDescription?.trim()) return; const timer = window.setTimeout(() => { void start.current(); }, 0); return () => window.clearTimeout(timer); }, []);
  const asking = questions.length > 0 && !busy;
  return <div className="nomos-tool-scroll mn-agents is-run">
    <ToolBar icon={Wand2} title="New agent" onBack={onCancel} backLabel="To the library"
      end={<span className="mn-agents-bar-actions"><button type="button" className="nomos-btn" onClick={onBlank}><Pencil size={14} aria-hidden="true" /><span>Start blank</span></button></span>} />
    <section className="mn-agent-chat is-home mn-agent-build" aria-label="Build an agent"
      onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) event.preventDefault(); }}
      onDrop={event => { event.preventDefault(); void attach([...event.dataTransfer.files]); }}>
      <div className="mn-agent-chat-scroll"><div className="mn-agent-home">
        <span className="mn-agent-home-eyebrow">{initialField ? `${field.name} Agents · Builder` : 'Agent builder · any field'}</span>
        <h1 className="mn-agent-home-title">Describe the agent you <em>need</em></h1>
        <p className="mn-agent-home-text">Say in your own words which task you do again and again. {PRODUCT_NAME} writes its role, steps, output and rules, picks the jurisdiction and sources, and opens it beside a test.</p>
        {busy ? <div className="mn-agent-build-working"><BuildStages />
          <button type="button" className="nomos-btn" onClick={() => abort.current?.abort()}><Square size={12} aria-hidden="true" /><span>Stop</span></button></div>
        : asking ? <form className="mn-agent-build-questions" onSubmit={event => { event.preventDefault(); void run(questions.map((item, index) => ({ question: item.question, answer: answers[index]?.trim() || 'As you think best' }))); }}>
          {notice && <p className="mn-agent-notice" role="alert">{notice}</p>}
          <p className="mn-agent-build-lead"><Sparkles size={13} aria-hidden="true" />{questions.length > 1 ? 'Two things before I build it:' : 'One thing before I build it:'}</p>
          {questions.map((item, index) => <fieldset key={index}><legend>{item.question}</legend>
            <span className="mn-agent-build-options">{item.options.map((option, at) => <button key={at} type="button" aria-pressed={answers[index] === option} onClick={() => setAnswers(current => current.map((value, i) => i === index ? option : value))}>{option}</button>)}</span>
            <input value={item.options.includes(answers[index]) ? '' : answers[index] ?? ''} maxLength={1000} placeholder="or write your own answer"
              onChange={event => setAnswers(current => current.map((value, i) => i === index ? event.target.value : value))} /></fieldset>)}
          <span className="mn-agent-build-actions"><button type="button" className="nomos-btn" onClick={() => { setQuestions([]); setAnswers([]); }}>Back to the description</button>
            <button type="submit" className="nomos-btn is-primary"><Wand2 size={14} aria-hidden="true" /><span>Build the agent</span></button></span>
        </form>
        : <>
          <form className="mn-agent-composer" onSubmit={event => { event.preventDefault(); void run(); }}>
            {examples.length > 0 && <span className="mn-agent-docs">{examples.map((file, index) => <span key={`${file.name}-${index}`}><FileText size={12} aria-hidden="true" />{file.name}
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setExamples(current => current.filter((_, i) => i !== index))}><X size={11} aria-hidden="true" /></button></span>)}</span>}
            {notice && <p className="mn-agent-notice" role="status">{notice}</p>}
            {question && onAsk && <p className="mn-agent-notice mn-build-question" role="status"><span>This reads like a question. Ask Agents answers questions and finds the right agent; this page builds a new one.</span>
              <button type="button" className="nomos-btn is-primary" onClick={() => onAsk(description.trim())}>Ask it in Ask Agents</button>
              <button type="button" className="nomos-btn" onClick={() => void run(undefined, true)}>Build an agent anyway</button></p>}
            <textarea value={description} onChange={event => { setDescription(event.target.value); setQuestion(false); }} rows={3} maxLength={4000} autoFocus
              placeholder="e.g. Reviews supply contracts for the buyer, finds risky terms and writes counter-proposals…" aria-label="Describe the agent"
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void run(); } }} />
            <span className="mn-agent-composer-row">
              <button type="button" className="nomos-btn" onClick={() => picker.current?.click()} disabled={examples.length >= 3} title="A template, past work or a checklist: the agent will work like them"><Paperclip size={14} aria-hidden="true" /><span>Examples</span></button>
              <input ref={picker} type="file" hidden multiple accept=".pdf,.docx,.xlsx,.xlsm,.txt,.md,.csv" onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; void attach(files); }} />
              <small>Optional: a template or your past work</small>
              <button type="submit" className="mn-agent-send" disabled={!description.trim() || reading > 0} aria-label="Build">{reading > 0 ? <Loader2 size={15} className="is-spinning" aria-hidden="true" /> : <Wand2 size={15} aria-hidden="true" />}</button>
            </span>
          </form>
          <div className="mn-agent-home-starters" role="group" aria-label="Ideas">
            {(anyField ? FIELDS.slice(0, 5).map(item => item.ideas[0]).filter(Boolean) : field.ideas).map(idea => <button key={idea} type="button" onClick={() => setDescription(idea)}>
              <span className="mn-agent-home-starter-icon" aria-hidden="true"><Sparkles size={12} /></span><span>{idea}</span><ArrowUpRight size={13} aria-hidden="true" /></button>)}
          </div>
        </>}
      </div></div>
    </section>
  </div>;
}
