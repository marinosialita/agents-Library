// «Search everything» (10 Nov 2026, before the launch): ⌘K (Ctrl+K) opens one box over any page that finds an agent
// of any field by its name or by the task, a chain, or a page of the app. Arrow keys move, Enter opens, Esc closes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CircleUser, Heart, LayoutGrid, Library, MessageSquare, Palette, Plug, Plus, Search, Settings, Sparkles, Workflow, Sun, Eye } from 'lucide-react';
import type { AgentDefinition } from '../../shared/agents.ts';
import { fieldById } from '../../shared/fields.ts';
import { READY_CHAINS } from '../data/chains.ts';
import { readChains, readChats, readFavourites } from '../data/store.ts';
import { rankAgents } from '../data/task-finder.ts';
import { categoryLabel } from './library.tsx';

export type PaletteTarget = { kind: 'agent'; id: string } | { kind: 'chain'; id: string } | { kind: 'page'; id: 'today' | 'learn' | 'library' | 'favourites' | 'chains' | 'house' | 'conversations' | 'knowledge' | 'settings' | 'build' | 'connections' | 'routines' | 'profile' | 'ask' };
type Row = { key: string; group: string; title: string; sub: string; Icon: typeof Search; target: PaletteTarget };
// 13 Nov 2026: «ask agents» found nothing (the page was called «New agent» here and «Ask Agents» in the sidebar), and a
// page always came after seven agents. Pages now carry the words people use for them and come first when they match.
const PAGES: { id: Extract<PaletteTarget, { kind: 'page' }>['id']; title: string; sub: string; Icon: typeof Search; words?: string }[] = [
  { id: 'today', title: 'Today', sub: 'What needs you, today’s meetings, what your agents did', Icon: Sun, words: 'home dashboard waiting approvals' },
  { id: 'ask', title: 'Ask Agents', sub: 'Find the right agent, or ask anything: a task, your inbox, how something works', Icon: Sparkles, words: 'assistant help how question chat home' },
  { id: 'build', title: 'New agent', sub: 'Describe the work and build an agent', Icon: Plus, words: 'create build make design builder' },
  { id: 'learn', title: 'Watch and Learn', sub: 'Show a task once; get an agent that does it your way', Icon: Eye, words: 'record screen video teach' },
  { id: 'library', title: 'Library', sub: 'Every ready-made agent', Icon: LayoutGrid, words: 'agents all templates browse' },
  { id: 'chains', title: 'Chain Agents', sub: 'Agents working in sequence', Icon: Workflow, words: 'workflow pipeline steps sequence' },
  { id: 'favourites', title: 'Favourites', sub: 'The agents you hearted', Icon: Heart, words: 'hearted saved liked' },
  { id: 'conversations', title: 'Conversations', sub: 'Everything you have asked', Icon: MessageSquare, words: 'chats history' },
  { id: 'house', title: 'House style', sub: 'Tone, positions, templates, letterhead, lessons', Icon: Palette, words: 'letterhead tone brand lessons rules remember' },
  { id: 'connections', title: 'Connections', sub: 'Gmail, Calendar, Sheets, LinkedIn and the other apps your agents read', Icon: Plug, words: 'apps integrations gmail outlook calendar slack sheets linkedin salesforce airtable telegram' },
  { id: 'routines', title: 'Routines', sub: 'Agents that run on their own: on a schedule, or when a site posts', Icon: CalendarClock, words: 'schedule automation trigger feed every morning recurring' },
  { id: 'knowledge', title: 'Knowledge', sub: 'Reference material of your agents', Icon: Library, words: 'files documents reference' },
  { id: 'profile', title: 'Profile', sub: 'Your name and your account: sign in or out', Icon: CircleUser, words: 'account me name sign login logout' },
  { id: 'settings', title: 'Settings', sub: 'Jurisdiction, language, privacy', Icon: Settings, words: 'country language privacy model' },
];
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export function CommandPalette({ agents, onPick, onClose }: { agents: AgentDefinition[]; onPick(target: PaletteTarget): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const rows = useMemo<Row[]>(() => {
    const q = fold(query.trim());
    const agentRow = (agent: AgentDefinition): Row => ({ key: `a-${agent.id}`, group: 'Agents', title: agent.name, sub: `${fieldById(agent.field)?.name ?? ''} · ${categoryLabel(agent.category)}`, Icon: Sparkles, target: { kind: 'agent', id: agent.id } });
    const chains = [...readChains(), ...READY_CHAINS];
    const chainRow = (chain: typeof chains[number]): Row => ({ key: `c-${chain.id}`, group: 'Chain agents', title: chain.name, sub: `${chain.steps.length} steps`, Icon: Workflow, target: { kind: 'chain', id: chain.id } });
    const pageRow = (page: typeof PAGES[number]): Row => ({ key: `p-${page.id}`, group: 'Go to', title: page.title, sub: page.sub, Icon: page.Icon, target: { kind: 'page', id: page.id } });
    if (!q) {
      // Nothing typed: where you were last, then the pages.
      const byId = new Map(agents.map(agent => [agent.id, agent]));
      const recent = [...new Set([...readChats().map(chat => chat.agentId), ...readFavourites()])].map(id => byId.get(id)).filter((agent): agent is AgentDefinition => !!agent).slice(0, 4);
      return [...recent.map(agent => ({ ...agentRow(agent), group: 'Recent agents' })), ...PAGES.map(pageRow)];
    }
    const named = agents.filter(agent => fold(agent.name).includes(q)).sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q)));
    const found = [...new Set([...named, ...(q.length > 2 ? rankAgents(query, agents, 8).map(item => item.agent) : [])])].slice(0, 7);
    const pages = PAGES.filter(page => fold(page.title).includes(q) || q.split(/\s+/).every(word => word.length > 1 && fold(`${page.title} ${page.words ?? ''}`).split(/\s+/).some(term => term.startsWith(word))));
    return [...pages.map(pageRow), ...found.map(agentRow), ...chains.filter(chain => fold(`${chain.name} ${chain.description ?? ''}`).includes(q)).slice(0, 4).map(chainRow)];
  }, [query, agents]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const key = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (rows.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length); }
    else if (event.key === 'Enter') { event.preventDefault(); if (rows[active]) onPick(rows[active].target); }
    else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  };
  return <div className="mn-palette-back" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="mn-palette" role="dialog" aria-modal="true" aria-label="Search everything" onKeyDown={key}>
      <label className="mn-palette-box"><Search size={18} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} autoFocus placeholder="Search agents, chains and pages, or describe a task…" aria-label="Search everything"
          role="combobox" aria-expanded="true" aria-controls="mn-palette-list" aria-activedescendant={rows[active] ? `mn-palette-${active}` : undefined} />
        <kbd>Esc</kbd></label>
      {rows.length ? <ul id="mn-palette-list" ref={list} role="listbox" aria-label="Results">{rows.map((row, index) => <React.Fragment key={row.key}>
        {(index === 0 || rows[index - 1].group !== row.group) && <li role="presentation" className="mn-agent-slash-head">{row.group}</li>}
        <li id={`mn-palette-${index}`} role="option" aria-selected={index === active} onPointerEnter={() => setActive(index)} onClick={() => onPick(row.target)}>
          <row.Icon size={15} aria-hidden="true" /><span><b>{row.title}</b><small>{row.sub}</small></span></li>
      </React.Fragment>)}</ul> : <p className="mn-palette-empty">Nothing matches. Try the words of the task, such as «lease» or «variance».</p>}
    </div>
  </div>;
}
