// «/» in the chat box (7 Nov 2026): what the menu offers for the word typed after «/». The menu itself is
// src/components/slash-menu.tsx.
import type { AgentDefinition } from '../../shared/agents.ts';
import { rankAgents } from './task-finder.ts';

export type SlashCommand = 'documents' | 'names' | 'guide' | 'new';
export type SlashItem = { kind: 'command'; id: SlashCommand; label: string; hint: string } | { kind: 'starter'; text: string } | { kind: 'agent'; agent: AgentDefinition };

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
/** The «/word» being typed at the caret: at the start of the box or after a space, up to the caret. */
/** 13 Nov 2026: «@name», as in Slack or Teams, opens the same menu with the agents only (an e-mail address never does:
 *  the «@» must start a word). */
export function slashToken(draft: string, caret: number): { start: number; query: string; mention?: boolean } | null {
  const match = /(^|\s)([/@])([^\s/@]{0,40})$/u.exec(draft.slice(0, caret));
  return match ? { start: match.index + match[1].length, query: match[3], ...(match[2] === '@' ? { mention: true } : {}) } : null;
}

export function slashItems(query: string, options: { agent: AgentDefinition; agents: AgentDefinition[]; favourites: string[]; recent: string[]; test: boolean; hiding: boolean; /** «@»: agents only. */ mention?: boolean }): SlashItem[] {
  const q = fold(query);
  const commands: { id: SlashCommand; label: string; hint: string; words: string }[] = [
    { id: 'documents', label: 'Attach documents', hint: 'PDF, Word, Excel or text', words: 'documents attach files upload' },
    { id: 'names', label: options.hiding ? 'Show names to the AI' : 'Hide names from the AI', hint: 'In this conversation', words: 'names hide show privacy anonymise anonymize' },
    { id: 'guide', label: 'How it works', hint: 'What to give this agent and what it returns', words: 'how help guide steps' },
    ...(options.test ? [] : [{ id: 'new' as const, label: 'New conversation', hint: 'With this agent', words: 'new chat conversation' }]),
  ];
  const shownCommands = commands.filter(command => !q || fold(`${command.label} ${command.words}`).split(/\s+/).some(word => word.startsWith(q)));
  const starters = q ? options.agent.starters.filter(starter => fold(starter).includes(q)).slice(0, 3) : [];
  let agents: AgentDefinition[] = [];
  if (!options.test) {
    const others = options.agents.filter(item => item.id !== options.agent.id);
    if (!q) {
      // Nothing typed yet: the favourites, then the agents used lately.
      const byId = new Map(others.map(item => [item.id, item]));
      agents = [...new Set([...options.favourites, ...options.recent])].map(id => byId.get(id)).filter((item): item is AgentDefinition => !!item).slice(0, 6);
    } else {
      const byName = others.map(item => { const name = fold(item.name); return { item, score: name.startsWith(q) ? 3 : name.split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(q)) ? 2 : name.includes(q) ? 1 : 0 }; })
        .filter(entry => entry.score).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).map(entry => entry.item);
      agents = [...new Set([...byName, ...(byName.length < 6 && q.length > 2 ? rankAgents(query, others, 6).map(entry => entry.agent) : [])])].slice(0, 6);
    }
  }
  // «@» (13 Nov 2026, code review: «Forward this to @hr» offered «Case chronology» and Enter took it): at least three
  // letters, and only agents with a word of their name starting with them.
  if (options.mention) return q.length < 3 ? [] : agents.filter(agent => fold(agent.name).split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(q))).map(agent => ({ kind: 'agent' as const, agent }));
  return [...shownCommands.map(({ id, label, hint }) => ({ kind: 'command' as const, id, label, hint })), ...starters.map(text => ({ kind: 'starter' as const, text })), ...agents.map(agent => ({ kind: 'agent' as const, agent }))];
}
