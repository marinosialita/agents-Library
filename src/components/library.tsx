// The library (reference agent-studio.tsx, AgentStudioPages + AgentLibrary): the top bar with the search, the sort
// and «New agent»; the practice areas on the left, each with its icon; the agents as cards. The browsing context
// (owner, area, query, sort, scroll) belongs to the app, so a return from an agent restores it exactly.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Accessibility, Activity, AlertTriangle, Archive, ArrowLeftRight, ArrowRight, ArrowUpDown, Award, BadgeCheck, BadgePercent, Banknote, BarChart3, BookA, BookMarked, BookOpen, Boxes, Briefcase, Building, Building2, Calculator, CalendarCheck, CalendarDays, CalendarRange, CandlestickChart, Clapperboard, ClipboardCheck, ClipboardList, Code, Coins, Compass, Copy, Cpu, Database, DoorOpen, DraftingCompass, Factory, Feather, FileBadge, FileCheck, FileSignature, FileSpreadsheet, FileText, Flag, FlaskConical, Gauge, Gavel, GitBranch, Globe, GraduationCap, HandCoins, Handshake, HardHat, Headphones, Headset, Heart, HeartPulse, Home, IterationCw, KeyRound, Landmark, Languages, Layers, LayoutDashboard, LayoutGrid, Leaf, Library, LifeBuoy, Lightbulb, LineChart, Link, ListChecks, Loader2, Lock, Mail, MapPin, Megaphone, MessageCircleHeart, MessageSquare, Mic, Microscope, Music, Newspaper, NotebookPen, Palette, Paperclip, PartyPopper, PenLine, Pencil, Percent, PieChart, Plane, Plus, Presentation, Receipt, RefreshCw, Rocket, Scale, Search, SearchCheck, Send, Server, Share2, ShieldAlert, ShieldCheck, Ship, ShoppingCart, Shuffle, Siren, Sparkles, SpellCheck, Star, Stethoscope, Store, Subtitles, Table, Tag, Target, ThermometerSun, TreePine, TrendingUp, Truck, UserCheck, UserPlus, UserRound, Users, Utensils, Wallet, Wand2, Workflow, Wrench, X, Zap, type LucideIcon } from 'lucide-react';
import { type AgentCategory, type AgentDefinition } from '../../shared/agents.ts';
import { explainAgent, routeTask, RunError } from '../data/api.ts';
import { rankAgents } from '../data/task-finder.ts';
import type { Shared } from '../data/shared.ts';
import { categoryOf, FIELDS, fieldById, isFieldId, type Field, type FieldId } from '../../shared/fields.ts';
import { placeName } from '../../shared/official-sources.ts';
import { cachedExplanation, explainKey, readChats, updateSettings, type AgentDraft, type Settings } from '../data/store.ts';
import { AGENT_STARTERS, AGENT_TEMPLATES } from '../data/templates/index.ts';
import { jurisdictionName, searchablePlaces, ToolBar } from './nomos-chrome.tsx';

/** A category's name, colour and icon come from its field (shared/fields.ts); an unknown id draws grey and «Layers». */
const ICONS: Record<string, LucideIcon> = { Accessibility, Activity, AlertTriangle, Archive, ArrowLeftRight, Award, BadgeCheck, BadgePercent, Banknote, BarChart3, BookA, BookMarked, BookOpen, Boxes, Briefcase, Building, Building2, Calculator, CalendarCheck, CalendarDays, CalendarRange, CandlestickChart, Clapperboard, ClipboardCheck, ClipboardList, Code, Coins, Compass, Cpu, Database, DoorOpen, DraftingCompass, Factory, Feather, FileBadge, FileCheck, FileSignature, FileSpreadsheet, FileText, Flag, FlaskConical, Gauge, Gavel, GitBranch, Globe, GraduationCap, HandCoins, Handshake, HardHat, Headphones, Headset, Heart, HeartPulse, Home, IterationCw, KeyRound, Landmark, Languages, Layers, LayoutDashboard, LayoutGrid, Leaf, Library, LifeBuoy, Lightbulb, LineChart, Link, ListChecks, Lock, Mail, MapPin, Megaphone, MessageCircleHeart, MessageSquare, Mic, Microscope, Music, Newspaper, NotebookPen, Palette, PartyPopper, PenLine, Percent, PieChart, Plane, Presentation, Receipt, RefreshCw, Rocket, Scale, SearchCheck, Send, Server, ShieldAlert, ShieldCheck, Ship, ShoppingCart, Shuffle, Siren, Sparkles, SpellCheck, Star, Stethoscope, Store, Subtitles, Table, Tag, Target, ThermometerSun, TreePine, TrendingUp, Truck, UserCheck, UserPlus, Users, Utensils, Wallet, Workflow, Wrench, Zap };
export const categoryLabel = (id: string) => categoryOf(id)?.category.name ?? id;
export const categoryStyle = (id: string) => ({ ['--agent-cat' as string]: categoryOf(id)?.category.color ?? '#596270' }) as React.CSSProperties;
export function CategoryIcon({ id, size = 16 }: { id: string; size?: number }) { const Icon = ICONS[categoryOf(id)?.category.icon ?? ''] ?? Layers; return <Icon size={size} aria-hidden="true" />; }
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export type AgentSort = 'recommended' | 'recent' | 'name';
export type LibraryOwner = 'all' | 'favourites' | 'mine' | 'ready';
/** «Tell me the task»: the agents found for the task, best first, by the AI (with a reason each) or by wording. */
export type TaskFound = { task: string; ids: string[]; reasons: Record<string, string>; by: 'words' | 'ai'; noneFits: boolean; ai: 'waiting' | 'done' | 'unavailable' | 'failed' };
export type LibraryState = { owner: LibraryOwner; category: AgentCategory | ''; query: string; sort: AgentSort; scroll: number; task: string; found: TaskFound | null };
export const INITIAL_LIBRARY: LibraryState = { owner: 'all', category: '', query: '', sort: 'recommended', scroll: 0, task: '', found: null };

/** A card's «What it does» note: three short lines from the agent's own configuration, asked once and kept. */
export function AgentExplain({ agent, language, onClose, kind = 'summary' }: { agent: AgentDefinition; language: string; onClose(): void; kind?: 'summary' | 'steps' }) {
  const [state, setState] = useState<{ lines?: string[]; failed?: boolean | 'unavailable' }>({});
  const [attempt, setAttempt] = useState(0);
  // Asked by what the agent says, a moment after it stops changing: in the editor's test the agent changes with every key.
  const latest = useRef(agent); latest.current = agent;
  const content = [agent.id, agent.name, agent.description, agent.instructions, agent.needs, agent.jurisdiction, agent.category, agent.mode, String(agent.officialSearch)].join('\u0001');
  useEffect(() => {
    const kept = cachedExplanation(explainKey(latest.current, kind));
    if (kept) { setState({ lines: kept }); return; }
    const controller = new AbortController(); setState({});
    const timer = window.setTimeout(() => explainAgent(latest.current, kind, language, controller.signal).then(lines => setState({ lines }), (error: unknown) => { if (!controller.signal.aborted) setState({ failed: error instanceof RunError && (error.code === 'agent_unavailable' || error.code === 'not_configured') ? 'unavailable' : true }); }), 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [content, language, kind, attempt]);
  // Escape closes it, as it closes every other transient panel.
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <div className={`mn-agent-explain-wrap${kind === 'steps' ? ' is-steps' : ''}`} role="status">
    <span className="mn-agent-explain-label"><Sparkles size={11} aria-hidden="true" />{kind === 'steps' ? 'What to do here' : 'What it does'}</span>
    <div className="mn-agent-explain">
      {state.lines ? (kind === 'steps' ? <ol>{state.lines.map((line, index) => <li key={index}>{line}</li>)}</ol> : <ul>{state.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>)
        : state.failed === 'unavailable' ? <p>AI is not connected on this server yet. Settings → AI connection shows what is missing.</p>
        : state.failed ? <p>The explanation did not arrive. <button type="button" className="mn-agent-explain-retry" onClick={() => setAttempt(value => value + 1)}>Try again</button></p>
        : <p className="is-loading"><Loader2 size={13} className="is-spinning" aria-hidden="true" />Reading the agent…</p>}
      <button type="button" onClick={onClose} aria-label="Close"><X size={12} aria-hidden="true" /></button>
    </div>
  </div>;
}

type PageProps = { title: string; settings: Settings; state: LibraryState; onState(patch: Partial<LibraryState>): void; ready: AgentDefinition[]; mine: AgentDefinition[]; favourites: string[]; language: string;
  draft: AgentDraft | null; onContinueDraft(): void; onDiscardDraft(): void; onFavourite(id: string): void; onUse(agent: AgentDefinition): void; onEdit(agent: AgentDefinition): void; onNew(): void;
  /** Every agent of every field, the user's own first, and the user's own alone: «Tell me the task» looks across all of them. */
  everyAgent: AgentDefinition[]; allMine: AgentDefinition[]; shared: Shared | null; onDropShared(): void; onUseTask(agent: AgentDefinition, task: string): void; onBuildTask(task: string, field?: FieldId): void };

export function LibraryPage({ title, settings, state, onState, ready, mine, favourites, language, draft, onContinueDraft, onDiscardDraft, onFavourite, onUse, onEdit, onNew, everyAgent, allMine, shared, onDropShared, onUseTask, onBuildTask }: PageProps) {
  // «/» puts the keyboard in the search box, as in a code editor; it does nothing while typing anywhere else.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable=true]')) return;
      event.preventDefault(); search.current?.focus(); search.current?.select();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The bar's two pickers (6 Nov 2026, his request): the field and the research jurisdiction change here, not only in Settings.
  const allFields = settings.field === 'all';
  const field = fieldById(settings.field) ?? FIELDS[0];
  const place = jurisdictionName(settings.jurisdiction);
  return <div className="nomos-tool-scroll mn-agents">
    <ToolBar icon={Sparkles} title={title}
      end={<span className="mn-agents-bar-end">
        <label className="mn-agents-pick mn-agents-field" title="Field"><Briefcase size={14} aria-hidden="true" />
          {/* Picking a field opens it (and drops the previous field's area filter); «My fields» (Settings) come first. */}
          <select value={allFields ? 'all' : field.id} onChange={event => { const value = event.target.value; if (value === 'all' || isFieldId(value)) { updateSettings({ field: value }); onState({ category: '', scroll: 0 }); } }} aria-label="Field">
            <option value="all">All fields</option>
            {settings.fields.length < FIELDS.length
              ? <><optgroup label="My fields">{FIELDS.filter(item => settings.fields.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
                <optgroup label="Other fields">{FIELDS.filter(item => !settings.fields.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup></>
              : FIELDS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        <label className="mn-agents-pick mn-agents-place" title="Research jurisdiction">{/* 13 Nov 2026: one mark only (it showed a globe icon, a 🌐 and «🌐 Choose…»). */}
          {settings.jurisdiction ? <span className="mn-agents-pick-flag" aria-hidden="true">{place.flag}</span> : <Globe size={14} aria-hidden="true" />}
          <select value={settings.jurisdiction ?? ''} onChange={event => updateSettings({ jurisdiction: event.target.value || null })} aria-label="Research jurisdiction">
            <option value="">Choose jurisdiction</option>
            <optgroup label="Official sources">{searchablePlaces().map(item => <option key={item.code} value={item.code}>{item.flag} {placeName(item, true)}</option>)}</optgroup>
          </select></label>
        <label className="mn-agents-search"><Search size={14} aria-hidden="true" />
          <input ref={search} type="search" value={state.query} onChange={event => onState({ query: event.target.value })} placeholder="Search agents" aria-label="Search agents" />
          {state.query && <button type="button" onClick={() => onState({ query: '' })} aria-label="Clear"><X size={13} aria-hidden="true" /></button>}</label>
        <label className="mn-agents-sort" title="Sort"><ArrowUpDown size={14} aria-hidden="true" />
          <select value={state.sort} onChange={event => onState({ sort: event.target.value as AgentSort })} aria-label="Sort">
            <option value="recommended">Recommended</option>
            <option value="recent">Recently used</option>
            <option value="name">Name A–Z</option>
          </select></label>
        <button type="button" className="nomos-btn is-primary" onClick={onNew}><Plus size={15} aria-hidden="true" /><span>New agent</span></button>
      </span>} />
    {draft && <div className="mn-agents-draft" role="status"><Pencil size={14} aria-hidden="true" />
      <span>The agent «{draft.agent.name || 'untitled'}» was not saved.</span>
      <button type="button" className="nomos-btn is-primary" onClick={onContinueDraft}>Continue</button>
      <button type="button" className="nomos-btn" onClick={onDiscardDraft}>Discard</button></div>}
    <AgentLibrary field={field} allFields={allFields} onOpenField={id => { updateSettings({ field: id }); onState({ category: '', scroll: 0 }); }} ready={ready} mine={mine} state={state} onState={onState} favourites={favourites} language={language} onFavourite={onFavourite} onUse={onUse} onUseTask={onUseTask} onEdit={onEdit}
      top={<TaskFinder agents={everyAgent} mine={allMine} state={state} onState={onState} language={language} onUse={onUseTask} onBuild={onBuildTask} shared={shared} onDropShared={onDropShared} />} />
  </div>;
}

function AgentLibrary({ field, allFields, onOpenField, ready, mine, state, onState, favourites, language, onFavourite, onUse, onUseTask, onEdit, top }: { onUseTask(agent: AgentDefinition, task: string): void; top?: React.ReactNode; field: Field; allFields: boolean; onOpenField(id: FieldId): void; ready: AgentDefinition[]; mine: AgentDefinition[]; state: LibraryState; onState(patch: Partial<LibraryState>): void; favourites: string[]; language: string; onFavourite(id: string): void; onUse(agent: AgentDefinition): void; onEdit(agent: AgentDefinition): void }) {
  const { owner, category, query, sort } = state;
  const main = useRef<HTMLElement>(null);
  useEffect(() => { const element = main.current; if (element) element.scrollTop = state.scroll; }, []);
  const loved = useMemo(() => new Set(favourites), [favourites]);
  // 13 Nov 2026: a heart re-sorted the grid under the mouse (the card jumped to the top). The order follows the hearts as
  // they were when this view opened; a new heart moves its card the next time the list is opened, searched or sorted.
  const orderKey = `${owner}|${category}|${query}|${sort}|${field.id}|${allFields}`;
  const frozen = useRef<{ key: string; loved: Set<string>; list: string[] } | null>(null);
  if (!frozen.current || frozen.current.key !== orderKey) frozen.current = { key: orderKey, loved: new Set(favourites), list: [...favourites] };
  const sortLoved = frozen.current.loved; const sortList = frozen.current.list;
  const owned = (agent: AgentDefinition) => owner === 'all' || (owner === 'favourites' ? loved.has(agent.id) : agent.origin === owner);
  const all = useMemo(() => [...mine, ...ready], [mine, ready]);
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const [explaining, setExplaining] = useState<string | null>(null);
  const lastUsed = useMemo(() => { const used = new Map<string, number>(); for (const chat of readChats()) if (!used.has(chat.agentId)) used.set(chat.agentId, chat.updatedAt); return used; }, []);
  // A ready agent is found in either language and by its starters.
  const searchable = useMemo(() => new Map(AGENT_TEMPLATES.map(template => {
    const starters = AGENT_STARTERS[template.id] ?? template.starters;
    return [`ready-${template.id}`, fold([template.name.el, template.name.en, template.description.el, template.description.en, ...starters.el, ...starters.en].join(' '))];
  })), []);
  const haystack = (agent: AgentDefinition) => `${fold(`${agent.name} ${agent.description} ${agent.starters.join(' ')} ${categoryLabel(agent.category)}`)} ${searchable.get(agent.id) ?? ''}`;
  const matching = all.filter(agent => owned(agent) && (!category || agent.category === category) && (!words.length || (text => words.every(word => text.includes(word)))(haystack(agent))));
  const shown = sort === 'name' ? [...matching].sort((a, b) => a.name.localeCompare(b.name, 'en'))
    : sort === 'recent' ? [...matching].sort((a, b) => (lastUsed.get(b.id) ?? 0) - (lastUsed.get(a.id) ?? 0))
    // A search is ranked by where its words are (13 Nov 2026: «lead» showed «Tagline and headline options» before «Lead
    // scoring against your ICP»): a word at the start of a word of the name, then in the name, then the description.
    : words.length ? [...matching].map(agent => { const name = fold(agent.name); const about = fold(agent.description);
        const score = words.reduce((sum, word) => sum + (new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(name) ? 6 : name.includes(word) ? 4 : about.includes(word) ? 2 : 1), 0);
        return { agent, score: score + (sortLoved.has(agent.id) ? 0.5 : 0) }; }).sort((a, b) => b.score - a.score).map(item => item.agent)
    // «Recommended»: the hearted agents first, in the order they were hearted, then the rest as they come.
    : [...matching].sort((a, b) => (sortLoved.has(b.id) ? 1 : 0) - (sortLoved.has(a.id) ? 1 : 0) || (sortLoved.has(a.id) ? sortList.indexOf(a.id) - sortList.indexOf(b.id) : 0));
  const count = (value: AgentCategory) => all.filter(agent => agent.category === value && owned(agent)).length;
  const lovedCount = all.filter(agent => loved.has(agent.id)).length;
  // «All fields» with nothing narrowed (11 Nov 2026, his request): the fields as cards, as on the landing page, not 1,000 agents in a row.
  const fieldsView = allFields && owner === 'all' && !category && !words.length && !state.found;
  // The left bar: the library first, then the practice areas, each with its icon; the count shows on the chosen row
  // and on hover, the chosen row carries an accent edge.
  const peek = explaining ? all.find(agent => agent.id === explaining) ?? null : null;
  return <div className={`mn-agents-library${peek ? ' has-peek' : ''}`}>
    <nav className="mn-agents-side" aria-label="Categories">
      <div className="mn-agents-side-group">
        {(['all', 'favourites', 'mine', 'ready'] as const).map(value => { const Icon = value === 'all' ? LayoutGrid : value === 'favourites' ? Heart : value === 'mine' ? UserRound : Sparkles;
          return <button key={value} type="button" aria-pressed={owner === value && !category} onClick={() => onState({ owner: value, category: '' })}>
            <Icon size={16} aria-hidden="true" />
            <span>{{ all: 'All agents', favourites: 'Favourites', mine: 'My agents', ready: 'Ready-made' }[value]}</span>
            <small>{value === 'all' ? all.length : value === 'favourites' ? lovedCount : value === 'mine' ? mine.length : ready.length}</small></button>; })}
      </div>
      <p className="mn-agents-side-title">{allFields ? 'Fields' : field.areas}</p>
      {/* «All fields»: the fields themselves, each opening its own library with its areas. */}
      {allFields ? <div className="mn-agents-side-group">
        {FIELDS.map(item => { const total = all.filter(agent => agent.field === item.id && owned(agent)).length; if (!total) return null;
          return <button key={item.id} type="button" className="is-area" style={categoryStyle(item.categories[0].id)} onClick={() => onOpenField(item.id)} title={`Open ${item.name}`}>
            <CategoryIcon id={item.categories[0].id} /><span>{item.name}</span><small>{total}</small></button>; })}
      </div> : <div className="mn-agents-side-group">
        {field.categories.map(item => { const value = item.id; if (!count(value)) return null;
          return <button key={value} type="button" className="is-area" style={categoryStyle(value)} aria-pressed={category === value} onClick={() => onState({ category: category === value ? '' : value })}>
            <CategoryIcon id={value} /><span>{item.name}</span><small>{count(value)}</small></button>; })}
      </div>}
    </nav>
    <section ref={main} className="mn-agents-main" onScroll={event => { state.scroll = event.currentTarget.scrollTop; }}>
      {top}
      {fieldsView ? <FieldCards agents={all} onOpen={onOpenField} />
      : !shown.length ? <div className="mn-agents-empty"><p>{owner === 'favourites' && !lovedCount ? 'Tap the heart on an agent to keep it here.' : owner === 'mine' && !mine.length ? 'You have no agent of your own yet. Start from a ready one or create a new one.' : (words.length || category) && !allFields ? `No agent in ${field.name} matches.` : 'No agent matches.'}</p>
        {/* 12 Nov 2026 (a new user's dead end): a search inside one field offers every field. */}
        {(words.length > 0 || !!category) && !allFields && <button type="button" className="nomos-btn" onClick={() => { updateSettings({ field: 'all' }); onState({ category: '', owner: 'all', scroll: 0 }); }}>Search all fields</button>}</div>
      : <ul className="mn-agents-grid">{shown.map(agent => { const place = jurisdictionName(agent.jurisdiction); return <li key={agent.id}>
        {/* The whole card opens the agent; the small tools below it explain, customise or open it. */}
        <button type="button" className="mn-agent-card" onClick={() => onUse(agent)}>
          <span className="mn-agent-card-top"><b title={agent.name}>{agent.name}</b>
            <span className="mn-agent-card-place" title={agent.jurisdiction ? `${place.name}${agent.officialSearch ? ' · searches the official sources' : ''}` : agent.officialSearch ? 'Choose a jurisdiction to research its official sources' : 'Works without a jurisdiction'}>{place.flag}{agent.officialSearch && <Landmark size={11} aria-hidden="true" />}</span></span>
          <span className="mn-agent-card-text"><span>{agent.description}</span></span>
          {agent.needs.trim() && <span className="mn-agent-card-needs"><Paperclip size={12} aria-hidden="true" /><span>{agent.needs}</span></span>}
          <span className="mn-agent-card-tags">{allFields && <span className="mn-agent-card-chip is-field">{fieldById(agent.field)?.name ?? ''}</span>}<span className="mn-agent-card-chip" style={categoryStyle(agent.category)}>{categoryLabel(agent.category)}</span>{agent.mode === 'deep' && <em className="mn-agent-card-deep">Deep research</em>}</span>
        </button>
        <span className="mn-agent-card-foot">
          {/* The foot's left slot is the AI explanation (6 Nov 2026, his request): the reference's origin label («Ready-made» / «Mine») said nothing worth a press. */}
          <button type="button" className="mn-agent-explain-btn" aria-pressed={explaining === agent.id} onClick={() => setExplaining(current => current === agent.id ? null : agent.id)} title="Look inside this agent" aria-label={`Look inside ${agent.name}`}><Sparkles size={13} aria-hidden="true" />Look inside</button>
          <button type="button" className="mn-agent-tool mn-agent-heart" aria-pressed={loved.has(agent.id)} onClick={() => onFavourite(agent.id)}
            title={loved.has(agent.id) ? 'Remove from favourites' : 'Add to favourites'} aria-label={loved.has(agent.id) ? `Remove ${agent.name} from favourites` : `Add ${agent.name} to favourites`}>
            <Heart size={14} aria-hidden="true" fill={loved.has(agent.id) ? 'currentColor' : 'none'} /></button>
          <button type="button" className="mn-agent-customise" onClick={() => onEdit(agent)}>{agent.origin === 'ready' ? <><Copy size={13} aria-hidden="true" />Customise</> : <><Pencil size={13} aria-hidden="true" />Edit</>}</button>
          <button type="button" className="mn-agent-use" onClick={() => onUse(agent)}>Use<ArrowRight size={13} aria-hidden="true" /></button>
        </span>
      </li>; })}</ul>}
    </section>
    {peek && <AgentPeek key={peek.id} agent={peek} language={language} showField={allFields} loved={loved.has(peek.id)} onFavourite={() => onFavourite(peek.id)}
      onClose={() => setExplaining(null)} onUse={() => onUse(peek)} onAsk={question => onUseTask(peek, question)} onEdit={() => onEdit(peek)} />}
  </div>;
}

/** «Look inside» (12 Nov 2026, his «open more things in the right panel»): an agent in the right panel before you
 *  commit to it — what it does in the AI's words, what to give it, how it works, and its ready questions, each of
 *  which opens the agent with that question already in the box. */
function AgentPeek({ agent, language, showField, loved, onFavourite, onClose, onUse, onAsk, onEdit }: { agent: AgentDefinition; language: string; showField: boolean; loved: boolean; onFavourite(): void; onClose(): void; onUse(): void; onAsk(question: string): void; onEdit(): void }) {
  const place = jurisdictionName(agent.jurisdiction);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  const steps = useMemo(() => (/##\s*Task\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(agent.instructions)?.[1] ?? '').split('\n').map(line => line.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean).slice(0, 6), [agent.instructions]);
  return <aside ref={panel} tabIndex={-1} className="mn-document-source-reader mn-peek" aria-label={agent.name} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <header className="mn-peek-head">
      <div>
        <p className="mn-peek-eyebrow">{showField ? `${fieldById(agent.field)?.name ?? ''} · ` : ''}{categoryLabel(agent.category)}{agent.origin === 'mine' ? ' · Yours' : ''}</p>
        <h2>{agent.name}</h2>
      </div>
      <button type="button" className="mn-agent-tool mn-agent-heart" aria-pressed={loved} onClick={onFavourite} title={loved ? 'Remove from favourites' : 'Add to favourites'} aria-label={loved ? 'Remove from favourites' : 'Add to favourites'}><Heart size={15} aria-hidden="true" fill={loved ? 'currentColor' : 'none'} /></button>
      <button type="button" className="nomos-gov-uk-web-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="mn-peek-body">
      <p className="mn-peek-lead">{agent.description}</p>
      <div className="mn-peek-facts">
        <span><Globe size={13} aria-hidden="true" />{agent.jurisdiction ? `${place.flag} ${place.name}` : agent.officialSearch ? 'You choose the country' : 'Works anywhere'}</span>
        <span>{agent.officialSearch ? 'Searches official sources live' : 'Works from what you give it'}</span>
        <span>{agent.mode === 'deep' ? 'Deep research · a few minutes' : 'Fast · under a minute'}</span>
      </div>
      <AgentExplain agent={agent} language={language} onClose={() => {}} />
      {agent.needs.trim() && <section><h3><Paperclip size={14} aria-hidden="true" />Give it</h3><p>{agent.needs}</p></section>}
      {steps.length > 0 && <section><h3>How it works</h3><ol className="mn-peek-steps">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol></section>}
      {agent.starters.length > 0 && <section><h3>Try it with one click</h3>
        <div className="mn-peek-starters">{agent.starters.slice(0, 6).map(starter => <button key={starter} type="button" onClick={() => onAsk(starter)}><span>{starter}</span><ArrowRight size={14} aria-hidden="true" /></button>)}</div></section>}
    </div>
    <footer className="mn-peek-foot">
      <button type="button" className="nomos-btn" onClick={onEdit}>{agent.origin === 'ready' ? <><Copy size={14} aria-hidden="true" /><span>Customise</span></> : <><Pencil size={14} aria-hidden="true" /><span>Edit</span></>}</button>
      <button type="button" className="nomos-btn is-primary" onClick={onUse}><span>Use this agent</span><ArrowRight size={14} aria-hidden="true" /></button>
    </footer>
  </aside>;
}

/** The fields as cards (11 Nov 2026, his request, from the landing page): name, count, what it covers and its first areas. */
function FieldCards({ agents, onOpen }: { agents: AgentDefinition[]; onOpen(id: FieldId): void }) {
  const counts = useMemo(() => { const byArea = new Map<string, number>(); const byField = new Map<string, number>();
    for (const agent of agents) { byArea.set(agent.category, (byArea.get(agent.category) ?? 0) + 1); byField.set(agent.field, (byField.get(agent.field) ?? 0) + 1); }
    return { byArea, byField }; }, [agents]);
  return <ul className="mn-field-cards" aria-label="Fields">{FIELDS.map(item => { const total = counts.byField.get(item.id) ?? 0; if (!total) return null;
    const areas = item.categories.filter(area => counts.byArea.get(area.id));
    return <li key={item.id}><button type="button" className="mn-field-card" onClick={() => onOpen(item.id)}>
      <span className="mn-field-card-top"><b>{item.name}</b><em>{total}</em></span>
      {/* Always two full lines (12 Nov 2026, his «2 lines for each card»): the blurb, then the areas the chips leave out. */}
      <small>{item.blurb}{areas.length > 2 ? ` Also ${areas.slice(2).map(area => area.name).join(', ')}.` : ''}</small>
      <span className="mn-field-card-areas">{areas.slice(0, 2).map(area => <i key={area.id} style={categoryStyle(area.id)}>{area.name}</i>)}{areas.length > 2 && <i className="is-more">+{areas.length - 2}</i>}</span>
    </button></li>; })}</ul>;
}

/** «Tell me the task» (7 Nov 2026, his request): the job in the user's words, and the agents of every field that do it.
 *  The browser's matches by wording show at once; the AI's picks, each with a reason, replace them when they arrive. */
function TaskFinder({ agents, mine, state, onState, language, onUse, onBuild, shared, onDropShared }: { shared: Shared | null; onDropShared(): void; agents: AgentDefinition[]; mine: AgentDefinition[]; state: LibraryState; onState(patch: Partial<LibraryState>): void; language: string; onUse(agent: AgentDefinition, task: string): void; onBuild(task: string, field?: FieldId): void }) {
  const [text, setText] = useState(state.task);
  // Text shared from another app arrives after the first draw.
  useEffect(() => { if (shared?.text) setText(shared.text); }, [shared]);
  const asked = useRef<AbortController | null>(null);
  const byId = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
  const find = async () => {
    const task = text.trim() || (shared?.files.length ? `Work on the shared ${shared.files.length === 1 ? 'file' : 'files'}: ${shared.files.map(file => file.name).join(', ')}` : ''); if (!task) return;
    asked.current?.abort(); const controller = new AbortController(); asked.current = controller;
    const local = rankAgents(task, agents, 12);
    const words: TaskFound = { task, ids: local.slice(0, 5).map(item => item.agent.id), reasons: {}, by: 'words', noneFits: false, ai: 'waiting' };
    onState({ task, found: words });
    try {
      const result = await routeTask({ task, language, likely: local.filter(item => item.agent.origin === 'ready').map(item => item.agent.id),
        mine: mine.slice(0, 100).map(agent => ({ id: agent.id, name: agent.name.slice(0, 120), description: agent.description.slice(0, 600) })) }, controller.signal);
      if (controller.signal.aborted) return;
      const ids = result.picks.map(pick => pick.id).filter(id => byId.has(id));
      // The AI's word stands when it picked or said none fits; an empty answer leaves the matches by wording.
      onState({ found: ids.length || result.noneFits ? { task, ids, reasons: Object.fromEntries(result.picks.map(pick => [pick.id, pick.reason])), by: 'ai', noneFits: result.noneFits, ai: 'done' } : { ...words, ai: 'failed' } });
    } catch (error) {
      if (controller.signal.aborted) return;
      onState({ found: { ...words, ai: error instanceof RunError && ['not_configured', 'no_server'].includes(error.code) ? 'unavailable' : 'failed' } });
    }
  };
  const found = state.found;
  const shown = found ? found.ids.map(id => byId.get(id)).filter((agent): agent is AgentDefinition => !!agent) : [];
  return <section className="mn-agents-task" aria-label="Tell me the task">
    {shared && shared.files.length > 0 && <p className="mn-agents-task-shared"><Share2 size={13} aria-hidden="true" /><span>Shared with Agents: <b>{shared.files.map(file => file.name).join(', ')}</b>. Pick the agent below; the files go with your task.</span>
      <button type="button" onClick={onDropShared} aria-label="Drop the shared files"><X size={12} aria-hidden="true" /></button></p>}
    <form className="mn-agents-task-form" onSubmit={event => { event.preventDefault(); void find(); }}>
      <Wand2 size={16} aria-hidden="true" />
      <input value={text} onChange={event => setText(event.target.value)} maxLength={2000} placeholder="Tell me the task, e.g. check a lease for the tenant’s risks" aria-label="Tell me the task" />
      {(text || found) && <button type="button" className="mn-agents-task-clear" onClick={() => { asked.current?.abort(); setText(''); onState({ task: '', found: null }); }} aria-label="Clear the task"><X size={13} aria-hidden="true" /></button>}
      <button type="submit" className="nomos-btn is-primary" disabled={!text.trim()}><Search size={14} aria-hidden="true" /><span>Find agents</span></button>
    </form>
    {found && <div className="mn-agents-task-found" aria-live="polite">
      <p className="mn-agents-task-head"><b>{found.by === 'ai' ? (found.noneFits ? (shown.length ? 'No agent does exactly this; the nearest' : 'No agent does this task yet') : 'Best agents for this task') : 'Matched by the words of the task'}</b>
        {found.ai === 'waiting' && <span><Loader2 size={12} className="is-spinning" aria-hidden="true" />Asking AI for the best match…</span>}
        {found.ai === 'unavailable' && <span>AI is not connected, so these match the wording only.</span>}
        {found.ai === 'failed' && <span>AI did not answer, so these match the wording only.</span>}</p>
      {shown.length ? <ul className="mn-agents-task-list">{shown.map(agent => <li key={agent.id}><button type="button" onClick={() => onUse(agent, found.task)}>
        <span className="mn-agents-task-pick"><span className="mn-agent-card-chip" style={categoryStyle(agent.category)}>{fieldById(agent.field)?.name} · {categoryLabel(agent.category)}</span><b>{agent.name}</b></span>
        <span className="mn-agents-task-why">{found.reasons[agent.id] || agent.description}</span>
        <ArrowRight size={14} aria-hidden="true" /></button></li>)}</ul>
        : <p className="mn-agents-task-empty">{found.by === 'ai' ? 'None of the ready agents does this task.' : 'No agent shares the words of this task.'}</p>}
      <button type="button" className="mn-agents-task-build" onClick={() => onBuild(found.task, shown[0]?.field)}><Wand2 size={13} aria-hidden="true" />{shown.length ? 'None of these? Build an agent for this task' : 'Build an agent for this task'}<ArrowRight size={13} aria-hidden="true" /></button>
    </div>}
  </section>;
}
