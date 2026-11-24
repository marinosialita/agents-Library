// The browser keeps everything (as the reference does): custom agents, conversations with their documents,
// favourites, explanations, the editor's draft and the settings. One version counter wakes every subscriber.
import { ASSISTANT_AGENT, ASSISTANT_ID } from '../../shared/assistant.ts';
import { useSyncExternalStore } from 'react';
import { AGENT_LIMITS, isAgentDefinition, type AgentDefinition, type AgentRunRequest } from '../../shared/agents.ts';
import { isSourcePlaceCode } from '../../shared/official-sources.ts';
import { isOutputLanguage, type OutputLanguage } from '../../shared/product.ts';
import { categoryOf, fieldById, FIELDS, isFieldId, type FieldId } from '../../shared/fields.ts';
import { AGENT_TEMPLATES, fieldAgents, templateAgent } from './templates/index.ts';
import { relevantPassages } from './passages.ts';
import { cleanLessons, LESSON_LIMITS } from '../../shared/teach.ts';
import { splitProofs } from './proof.ts';

export type Citation = { title: string; url: string; site: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string; at: number; sources?: Citation[]; consulted?: Citation[]; gaps?: string[]; searches?: number;
  /** The person's apps the agent read live for this answer (11 Nov 2026), e.g. «GitHub». */
  apps?: string[];
  /** E-mails the answer points at, opened in the reading panel (12 Nov 2026). */
  mails?: { service: string; id: string; from: string; subject: string; date: string }[];
  /** Calendar events and e-mails the agent proposed, and whether the person already carried each out (12 Nov 2026). */
  actions?: (import('../../shared/app-actions.ts').AppAction & { done?: string })[];
  /** The names of the documents a question went with. */
  documents?: string[];
  /** A question sent with «/» to another agent, and that agent's answer, inside this conversation (7 Nov 2026). */
  agent?: { id: string; name: string } };
export type ChatDocument = { id: string; name: string; text: string; pages?: number; truncated: boolean; size: number };
export type AgentChat = { id: string; agentId: string; title: string; messages: ChatMessage[]; documents: ChatDocument[]; createdAt: number; updatedAt: number;
  /** The jurisdiction and language the conversation ran under; a later change of settings never alters an old chat. */
  jurisdiction: string; language: OutputLanguage;
  /** This conversation's own switches, when they differ from the agent's: live official-source research, deep mode. */
  search?: boolean; deep?: boolean;
  /** «Names hidden» for this conversation: on or off (unset: the workspace setting), words always hidden, items kept visible. */
  privacy?: { on?: boolean; hide?: string[]; keep?: string[]; photos?: boolean } };
export type ModelChoice = 'quality' | 'balanced';
export type Settings = { jurisdiction: string | null; language: OutputLanguage; model: ModelChoice; /** The field the library shows, or every field («All fields», 7 Nov 2026). */ field: FieldId | 'all'; /** «My fields»: the user's own list, first in the bar's Field picker. */ fields: string[]; railPinned: boolean; name: string; /** Names and identifiers are replaced by placeholders before the AI sees anything (default on). */ hideNames: boolean };
export type AgentDraft = { agent: AgentDefinition; isNew: boolean; savedAt: number; /** The library agent a customised copy came from (its lessons go with the copy). */ from?: string };

const KEYS = { agents: 'ap-agents-v1', chats: 'ap-chats-v1', favourites: 'ap-favourites-v1', explain: 'ap-explain-v1', draft: 'ap-draft-v1', settings: 'ap-settings-v1', house: 'ap-house-v1', chains: 'ap-chains-v1', chainRuns: 'ap-chain-runs-v1', lessons: 'ap-lessons-v1' } as const;
const CHAT_LIMIT = 200; const CHAT_TEXT_LIMIT = 60_000;

let version = 0; const listeners = new Set<() => void>();
const notify = () => { version++; for (const listener of listeners) listener(); };
export function useStoreVersion(): number {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => version);
}
function read<T>(key: string, guard: (value: unknown) => value is T, fallback: T, repair?: (value: unknown) => unknown): T {
  try { const raw = localStorage.getItem(key); if (!raw) return fallback; const parsed = JSON.parse(raw); const value = repair ? repair(parsed) : parsed; return guard(value) ? value : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
/** A stored list: each damaged record is dropped, the rest kept (one bad record must not empty the store). A key whose
 *  JSON no longer parses is copied to «<key>-damaged» before the next write replaces it. */
function readList<T>(key: string, guard: (value: unknown) => value is T, repair?: (value: unknown) => unknown): T[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { try { localStorage.setItem(`${key}-damaged`, raw); } catch { /* storage blocked */ } return []; }
  const value = repair ? repair(parsed) : parsed;
  return Array.isArray(value) ? value.filter(guard) : [];
}
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

// ——— settings
const DEFAULT_SETTINGS: Settings = { jurisdiction: null, language: 'en', model: 'quality', field: 'legal', fields: ['legal'], railPinned: false, name: '', hideNames: true };
const isSettings = (value: unknown): value is Partial<Settings> => isObject(value);
let settingsCache: Settings | null = null;
export function readSettings(): Settings {
  if (settingsCache) return settingsCache;
  const raw = read<Partial<Settings>>(KEYS.settings, isSettings, {});
  const ids = Array.isArray(raw.fields) ? raw.fields.filter(isFieldId) : [];
  const fields: FieldId[] = ids.length ? ids : ['legal'];
  settingsCache = { ...DEFAULT_SETTINGS, ...raw,
    jurisdiction: isSourcePlaceCode(raw.jurisdiction) ? raw.jurisdiction : null,
    language: isOutputLanguage(raw.language) ? raw.language : 'en',
    model: raw.model === 'balanced' ? 'balanced' : 'quality',
    fields, field: raw.field === 'all' ? 'all' : isFieldId(raw.field) ? raw.field : fields[0],
    railPinned: raw.railPinned === true, name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '', hideNames: raw.hideNames !== false };
  return settingsCache;
}
export function updateSettings(patch: Partial<Settings>): void {
  settingsCache = { ...readSettings(), ...patch }; write(KEYS.settings, settingsCache); notify();
}

// ——— agents
/** Agents saved before fields existed (6 Nov 2026) carry no field: their category says which one. */
const withField = (value: unknown) => Array.isArray(value) ? value.map(item => isObject(item) && item.field === undefined && categoryOf(item.category) ? { ...item, field: categoryOf(item.category)!.field.id } : item) : value;
export function readMyAgents(): AgentDefinition[] { return readList(KEYS.agents, isAgentDefinition, withField); }
/** The ready agents. An agent made for one country's law (the «Cyprus law» area) is listed only for a person who
 *  chose that country (12 Nov 2026, his «nothing about Cyprus by default»); `every` gives all, for finding one by its
 *  id (an old conversation, a favourite, a link). */
export function readyAgents(every = false): AgentDefinition[] {
  const fallback = readSettings().jurisdiction ?? '';
  const all = [...AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, fallback)), ...fieldAgents(0, fallback)];
  return every ? all : all.filter(agent => !COUNTRY_AREAS[agent.category] || COUNTRY_AREAS[agent.category] === fallback);
}
/** Areas of the library that belong to one country: the area's id → the country's code. */
export const COUNTRY_AREAS: Record<string, string> = { cyprus: 'cy' };
export function allAgents(): AgentDefinition[] { return [...readMyAgents(), ...readyAgents()]; }
export function findAgent(id: string): AgentDefinition | undefined { if (id === ASSISTANT_ID) return ASSISTANT_AGENT; return readMyAgents().find(agent => agent.id === id) ?? readyAgents(true).find(agent => agent.id === id); }
export function saveAgent(agent: AgentDefinition): boolean {
  const mine = readMyAgents().filter(item => item.id !== agent.id);
  const ok = write(KEYS.agents, [agent, ...mine]); notify(); return ok;
}
export function deleteAgent(id: string): void {
  write(KEYS.agents, readMyAgents().filter(agent => agent.id !== id));
  write(KEYS.chats, readChats().filter(chat => chat.agentId !== id));
  write(KEYS.favourites, readFavourites().filter(item => item !== id));
  // 13 Nov 2026 (code review): its lessons go with it (they stayed, listed on Today under «An agent»).
  const lessons = readAllLessons(); if (lessons[id]) { delete lessons[id]; write(KEYS.lessons, lessons); }
  notify();
}
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** A ready agent set up as the user's own: a copy they can change; the template is never touched. */
export function copyAgent(source: AgentDefinition): AgentDefinition {
  const now = Date.now();
  return { ...source, id: newId('mine'), name: source.origin === 'ready' ? source.name : `${source.name} (copy)`, origin: 'mine', knowledge: source.knowledge.map(file => ({ ...file })), starters: [...source.starters], createdAt: now, updatedAt: now };
}
/** A blank agent of a field (the library's current one by default): Legal starts in «General» and researches; the others start in their first area. */
/** The field a new agent is made in: the open one, or with «All fields» open, the first of «My fields». */
export function workingField(settings: Settings): FieldId {
  return settings.field !== 'all' ? settings.field : settings.fields.find(isFieldId) ?? 'legal';
}
export function blankAgent(fieldId?: FieldId): AgentDefinition {
  const now = Date.now();
  const field = fieldById(fieldId ?? workingField(readSettings())) ?? FIELDS[0];
  return { id: newId('mine'), field: field.id, name: '', description: '', category: field.id === 'legal' ? 'general' : field.categories[0].id, instructions: '', starters: [], needs: '', jurisdiction: readSettings().jurisdiction ?? '', officialSearch: field.id === 'legal', mode: 'fast', knowledge: [], origin: 'mine', createdAt: now, updatedAt: now };
}

// ——— favourites
export function readFavourites(): string[] { return readList(KEYS.favourites, (value): value is string => typeof value === 'string'); }
export function toggleFavourite(id: string): boolean {
  const list = readFavourites(); const on = !list.includes(id);
  write(KEYS.favourites, on ? [id, ...list] : list.filter(item => item !== id)); notify(); return on;
}

// ——— chats
const isMessage = (value: unknown): value is ChatMessage => isObject(value) && (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string' && typeof value.at === 'number';
const isDocument = (value: unknown): value is ChatDocument => isObject(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.text === 'string' && typeof value.truncated === 'boolean';
const isChat = (value: unknown): value is AgentChat => isObject(value) && typeof value.id === 'string' && typeof value.agentId === 'string' && typeof value.title === 'string'
  && Array.isArray(value.messages) && value.messages.every(isMessage) && Array.isArray(value.documents) && value.documents.every(isDocument)
  && typeof value.createdAt === 'number' && typeof value.updatedAt === 'number' && typeof value.jurisdiction === 'string' && isOutputLanguage(value.language);
export function readChats(): AgentChat[] { return readList(KEYS.chats, isChat).sort((a, b) => b.updatedAt - a.updatedAt); }
export function agentChats(agentId: string): AgentChat[] { return readChats().filter(chat => chat.agentId === agentId).sort((a, b) => b.updatedAt - a.updatedAt); }
export function findChat(id: string): AgentChat | undefined { return readChats().find(chat => chat.id === id); }
export function newChat(agent: AgentDefinition): AgentChat {
  const now = Date.now(); const settings = readSettings();
  return { id: newId('chat'), agentId: agent.id, title: '', messages: [], documents: [], createdAt: now, updatedAt: now, jurisdiction: agent.jurisdiction || settings.jurisdiction || '', language: settings.language };
}
/** Saved most recent first, 200 at most; when the store is full, the oldest half of the conversations goes. False when
 *  even that did not fit: the conversation is not in the store. */
export function saveChat(chat: AgentChat): boolean {
  const trimmed: AgentChat = { ...chat, title: chat.title || chat.messages.find(message => message.role === 'user')?.content.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New conversation',
    messages: chat.messages.map(message => message.content.length > CHAT_TEXT_LIMIT ? { ...message, content: message.content.slice(0, CHAT_TEXT_LIMIT) } : message) };
  let list = [trimmed, ...readChats().filter(item => item.id !== chat.id)].slice(0, CHAT_LIMIT);
  let written = write(KEYS.chats, list);
  while (!written && list.length > 1) { list = list.slice(0, Math.ceil(list.length / 2)); written = write(KEYS.chats, list); }
  notify(); return written;
}
export function deleteChat(id: string): AgentChat | undefined {
  const list = readChats(); const gone = list.find(chat => chat.id === id);
  write(KEYS.chats, list.filter(chat => chat.id !== id)); notify(); return gone;
}
export function restoreChat(chat: AgentChat): void { write(KEYS.chats, [chat, ...readChats().filter(item => item.id !== chat.id)].slice(0, CHAT_LIMIT)); notify(); }

// ——— editor draft (unsaved work survives a closed tab)
// A draft may lack the name or the instructions still: the shape is checked with placeholders in their place.
const isDraft = (value: unknown): value is AgentDraft => isObject(value) && isObject(value.agent) && typeof value.isNew === 'boolean' && typeof value.savedAt === 'number'
  && isAgentDefinition({ ...value.agent, name: typeof value.agent.name === 'string' && value.agent.name.trim() ? value.agent.name : 'Draft', instructions: typeof value.agent.instructions === 'string' && value.agent.instructions.trim() ? value.agent.instructions : 'Draft' });
// The write wakes the subscribers: the editor saves its draft a tick after it unmounts, and the library (already drawn
// by then) shows the banner only on a render after it.
export function saveAgentDraft(agent: AgentDefinition, isNew: boolean, from?: string): void { write(KEYS.draft, { agent, isNew, savedAt: Date.now(), ...(from ? { from } : {}) }); notify(); }
export function readAgentDraft(): AgentDraft | null { return read<AgentDraft | null>(KEYS.draft, (value): value is AgentDraft | null => value === null || isDraft(value), null, value => isObject(value) ? { ...value, agent: (withField([value.agent]) as unknown[])[0] } : value); }
export function clearAgentDraft(): void { try { localStorage.removeItem(KEYS.draft); } catch { /* storage blocked: nothing to clear */ } }

// ——— explanations («What does this agent do?»), keyed by the agent's content
const isExplain = (value: unknown): value is Record<string, string[]> => isObject(value);
export function explainKey(agent: AgentDefinition, kind: 'summary' | 'steps'): string {
  let hash = 0; const text = `${kind}|${agent.name}|${agent.description}|${agent.instructions}|${agent.needs}|${agent.jurisdiction}|${agent.mode}|${agent.officialSearch}`;
  for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) | 0;
  return `${kind}:${agent.id}:${hash}`;
}
export function cachedExplanation(key: string): string[] | null { const all = read(KEYS.explain, isExplain, {}); return Array.isArray(all[key]) ? all[key] : null; }
export function rememberExplanation(key: string, lines: string[]): void {
  const all = read(KEYS.explain, isExplain, {}); const entries = Object.entries(all).slice(-300); write(KEYS.explain, Object.fromEntries([...entries, [key, lines]]));
}

// ——— the turns and documents that travel with one question
export function agentTurns(messages: ChatMessage[]): AgentRunRequest['messages'] {
  const turns: AgentRunRequest['messages'] = [];
  for (const message of messages) {
    // An earlier answer goes back without its proof block: the marks stay, the quotes are already in the sources.
    const content = message.role === 'assistant' ? splitProofs(message.content).body : message.content;
    const last = turns.at(-1);
    if (last && last.role === message.role) last.content += `\n\n${content}`; else turns.push({ role: message.role, content });
  }
  // The newest turns within the limit, starting with a question: a window that opened on an answer was refused.
  let kept = turns.slice(-AGENT_LIMITS.messages);
  if (kept[0]?.role === 'assistant') kept = kept.slice(1);
  return kept.map(turn => ({ ...turn, content: turn.content.slice(0, AGENT_LIMITS.messageChars) }));
}
/** The conversation's documents within the request budget: each whole when they fit, otherwise its relevant passages. */
export function fitDocuments(documents: ChatDocument[], question: string): AgentRunRequest['documents'] {
  const chosen = documents.slice(-AGENT_LIMITS.documents);
  const total = chosen.reduce((sum, document) => sum + document.text.length, 0);
  if (total <= AGENT_LIMITS.documentChars) return chosen.map(document => ({ name: document.name, text: document.text }));
  const share = Math.floor(AGENT_LIMITS.documentChars / chosen.length) - 200;
  return chosen.map(document => ({ name: document.name, text: relevantPassages(document.text, question, Math.max(2_000, share)) }));
}

// ——— house style (7 Nov 2026): the user's tone, standing positions, taught rules, templates and letterhead, applied by
// every agent; the letterhead brands the Word, Excel and PowerPoint files.
export type Letterhead = { name: string; address: string; footer: string; color: string; /** PNG or JPEG as a data URL, with its size in pixels. */ logo: string; logoWidth: number; logoHeight: number };
export type HouseStyle = { on: boolean; tone: string; positions: string; rules: string[]; files: { name: string; text: string }[]; letterhead: Letterhead };
export const EMPTY_HOUSE: HouseStyle = { on: true, tone: '', positions: '', rules: [], files: [], letterhead: { name: '', address: '', footer: '', color: '#7352E8', logo: '', logoWidth: 0, logoHeight: 0 } };
const str = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';
export function readHouse(): HouseStyle {
  const raw = read<Record<string, any>>(KEYS.house, isObject, {});
  const head = isObject(raw.letterhead) ? raw.letterhead : {};
  return { on: raw.on !== false, tone: str(raw.tone, AGENT_LIMITS.houseTone), positions: str(raw.positions, AGENT_LIMITS.housePositions),
    rules: Array.isArray(raw.rules) ? raw.rules.filter((rule: unknown): rule is string => typeof rule === 'string' && !!rule.trim()).map(rule => rule.slice(0, AGENT_LIMITS.houseRule)).slice(0, AGENT_LIMITS.houseRules) : [],
    files: Array.isArray(raw.files) ? raw.files.filter((file: unknown): file is { name: string; text: string } => isObject(file) && typeof file.name === 'string' && typeof file.text === 'string').slice(0, AGENT_LIMITS.houseFiles) : [],
    letterhead: { name: str(head.name, 120), address: str(head.address, 400), footer: str(head.footer, 200), color: /^#[0-9a-f]{6}$/i.test(head.color) ? head.color : EMPTY_HOUSE.letterhead.color,
      logo: typeof head.logo === 'string' && /^data:image\/(?:png|jpeg);base64,/.test(head.logo) && head.logo.length < 400_000 ? head.logo : '',
      logoWidth: Number(head.logoWidth) > 0 ? Number(head.logoWidth) : 0, logoHeight: Number(head.logoHeight) > 0 ? Number(head.logoHeight) : 0 } };
}
export function saveHouse(next: HouseStyle): boolean { const ok = write(KEYS.house, next); notify(); return ok; }
/** «Remember for every agent»: a rule taught from an answer joins the house style. */
export function addHouseRule(rule: string): boolean {
  const house = readHouse(); const text = rule.trim().slice(0, AGENT_LIMITS.houseRule); if (!text) return false;
  if (house.rules.some(item => item.toLocaleLowerCase() === text.toLocaleLowerCase())) return true;
  return saveHouse({ ...house, rules: [...house.rules, text].slice(-AGENT_LIMITS.houseRules) });
}
/** What a run request carries of the house style: nothing when it is off or empty. */
export function houseForRun(): AgentRunRequest['house'] {
  const house = readHouse();
  if (!house.on || (!house.tone.trim() && !house.positions.trim() && !house.rules.length && !house.files.length)) return undefined;
  let left = AGENT_LIMITS.houseFileChars;
  const files = house.files.map(file => { const text = file.text.slice(0, Math.max(0, left)); left -= text.length; return { name: file.name.slice(0, 200), text }; }).filter(file => file.text.trim());
  return { tone: house.tone, positions: house.positions, rules: house.rules, files };
}

// ——— «Teach it» (12 Nov 2026, shared/teach.ts): the lessons the person kept for each agent, by agent id. Lessons for
// every agent are house rules (above).
function readAllLessons(): Record<string, string[]> {
  const raw = read<Record<string, unknown>>(KEYS.lessons, isObject, {});
  return Object.fromEntries(Object.entries(raw).map(([id, list]) => [id, cleanLessons(list)]).filter(([, list]) => list.length));
}
export function readLessons(agentId: string): string[] { return readAllLessons()[agentId] ?? []; }
/** Every agent's lessons, for «Today» (13 Nov 2026): agent id and lesson, the newest last. */
export function allLessons(): { agentId: string; lesson: string }[] { return Object.entries(readAllLessons()).flatMap(([agentId, list]) => list.map(lesson => ({ agentId, lesson }))); }
export function saveLessons(agentId: string, lessons: string[]): boolean {
  const all = readAllLessons(); const list = cleanLessons(lessons);
  if (list.length) all[agentId] = list; else delete all[agentId];
  const ok = write(KEYS.lessons, all); notify(); return ok;
}
/** New lessons join the agent's list (the oldest go when it is full); a repeat is not added twice. */
export function addLessons(agentId: string, lessons: string[]): boolean {
  return saveLessons(agentId, cleanLessons([...readLessons(agentId), ...lessons], Infinity).slice(-LESSON_LIMITS.perAgent));
}

// ——— agent chains (7 Nov 2026): steps of agents run one after another, each reading the previous step's result.
export type ChainStep = { agentId: string; ask: string };
export type Chain = { id: string; name: string; /** Two short sentences for the card. */ description?: string; steps: ChainStep[]; createdAt: number; updatedAt: number };
export type ChainRunStep = { agentId: string; agentName: string; ask: string; answer: string; status: 'waiting' | 'working' | 'done' | 'failed' | 'stopped'; sources?: Citation[]; gaps?: string[]; note?: string };
export type ChainRun = { id: string; chainId: string; chainName: string; input: string; documents: string[]; jurisdiction: string; steps: ChainRunStep[]; createdAt: number; updatedAt: number };
const isChain = (value: unknown): value is Chain => isObject(value) && typeof value.id === 'string' && typeof value.name === 'string' && Array.isArray(value.steps)
  && value.steps.every((step: unknown) => isObject(step) && typeof step.agentId === 'string' && typeof step.ask === 'string') && typeof value.createdAt === 'number' && typeof value.updatedAt === 'number';
const isChainRun = (value: unknown): value is ChainRun => isObject(value) && typeof value.id === 'string' && typeof value.chainId === 'string' && typeof value.chainName === 'string' && typeof value.input === 'string'
  && Array.isArray(value.steps) && typeof value.createdAt === 'number' && typeof value.updatedAt === 'number';
export function readChains(): Chain[] { return readList(KEYS.chains, isChain).sort((a, b) => b.updatedAt - a.updatedAt); }
export function saveChain(chain: Chain): boolean { const ok = write(KEYS.chains, [chain, ...readChains().filter(item => item.id !== chain.id)].slice(0, 100)); notify(); return ok; }
export function deleteChain(id: string): void { write(KEYS.chains, readChains().filter(item => item.id !== id)); notify(); }
export function newChainId(): string { return newId('chain'); }
export function readChainRuns(): ChainRun[] { return readList(KEYS.chainRuns, isChainRun).sort((a, b) => b.updatedAt - a.updatedAt); }
/** The last 20 runs are kept; a full store drops the oldest first. */
export function saveChainRun(run: ChainRun): boolean {
  let list = [run, ...readChainRuns().filter(item => item.id !== run.id)].slice(0, 20);
  let ok = write(KEYS.chainRuns, list);
  while (!ok && list.length > 1) { list = list.slice(0, Math.ceil(list.length / 2)); ok = write(KEYS.chainRuns, list); }
  notify(); return ok;
}
