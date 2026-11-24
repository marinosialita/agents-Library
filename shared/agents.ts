// An agent is a professional's own instructions for one recurring task — its role, its task, the output it gives and
// its rules — with the documents it is given, the jurisdiction it answers under and, for that jurisdiction, a live
// search limited to its official websites (shared/official-sources.ts). The browser keeps the agents; the server runs
// one turn. Shared by the client and the server.
import { siteDomain } from './routines.ts';
import { ALL_CATEGORY_IDS, categoryBelongs, isFieldId, type FieldId } from './fields.ts';
import { isSourcePlaceCode } from './official-sources.ts';
import { isOutputLanguage, type OutputLanguage } from './product.ts';
import { LESSON_LIMITS } from './teach.ts';

/** Every category id of every field (shared/fields.ts); an agent's category belongs to its field. */
export const AGENT_CATEGORIES: readonly string[] = ALL_CATEGORY_IDS;
export type AgentCategory = string;
export type AgentMode = 'fast' | 'deep';
/** A code from shared/official-sources.ts (the jurisdiction whose official websites the agent researches). */
export type AgentDefinition = {
  id: string; name: string; description: string;
  /** The field (profession) the agent belongs to and one of that field's categories (shared/fields.ts). */
  field: FieldId; category: AgentCategory;
  /** Role, task, output and rules, as the lawyer writes them (Markdown). */
  instructions: string;
  starters: string[];
  /** What the agent asks for when it starts: documents to upload, details to give. */
  needs: string;
  jurisdiction: string;
  /** Search the jurisdiction's official websites live while answering. */
  officialSearch: boolean;
  /** 12 Nov 2026: other websites the agent searches too (newspapers, a forum), as bare domains; at most 12. */
  sites?: string[];
  mode: AgentMode;
  /** Reference material the agent always reads: the firm's standard positions, a template, an example. */
  knowledge: { name: string; text: string }[];
  origin: 'ready' | 'mine';
  createdAt: number; updatedAt: number;
};

/** An agent made for the person's e-mail (12 Nov 2026): its name says inbox or e-mail. It reads the mail without being
 *  told «my inbox», and its box neither asks for pasted threads nor offers a jurisdiction. */
// 13 Nov 2026: «e-mail» alone in a name made twelve WRITING agents («Cold email sequence», «Personalised outreach email»,
// «Post-meeting recap email»…) read the person's inbox. An inbox agent says inbox or mailbox, or pairs e-mail with
// reading words (my e-mails, e-mail triage, assistant, digest, brief, watch, alerts).
export const isMailAgent = (agent: { name: string }) => /\b(?:inbox|mailbox|gmail|outlook)\b/i.test(agent.name)
  || (/\be-?mails?\b/i.test(agent.name) && /\b(?:my|triage|assistant|digest|brief|watch|monitor|alerts?|sorter|reader|manager)\b/i.test(agent.name));

export const AGENT_LIMITS = { name: 120, description: 600, instructions: 20_000, starters: 9, starter: 300, needs: 400,
  knowledgeFiles: 10, knowledgeChars: 200_000, messages: 40, messageChars: 30_000, documents: 10, documentChars: 400_000,
  /** The house style every agent follows (7 Nov 2026) and the photos one question may carry. */
  houseTone: 1_000, housePositions: 8_000, houseRules: 40, houseRule: 300, houseFiles: 5, houseFileChars: 100_000, images: 4, imageChars: 1_600_000 } as const;
/** The user's house style as the server receives it: tone, standing positions, learned rules, templates. */
export type HouseStyleInput = { tone: string; positions: string; rules: string[]; files: { name: string; text: string }[] };

export type AgentRunRequest = {
  agent: Pick<AgentDefinition, 'name' | 'instructions' | 'jurisdiction' | 'officialSearch' | 'mode' | 'knowledge'> & {
    /** 11 Nov 2026: websites the person chose for this run to search too (a routine's newspapers, a forum), by domain. */ sites?: string[];
    /** What the agent needs to start (the agent's own «needs» line), for the loop's planner: it asks for what is missing. */ needs?: string;
    /** 12 Nov 2026, «Teach it» (shared/teach.ts): lessons the person kept from their feedback on this agent. */ lessons?: string[] };
  messages: { role: 'user' | 'assistant'; content: string }[];
  documents: { name: string; text: string }[];
  /** The language the answer should be written in, unless the user writes in another. */
  language: OutputLanguage;
  /** The person's time zone, for questions about their own apps (server/connected/ask.ts). */
  timeZone?: string;
  /** «quality» (default) or «balanced»; the server maps it to a model. */
  model?: 'quality' | 'balanced';
  /** True when names and identifiers were replaced by placeholders («[PERSON 1]») in the browser before sending. */
  anonymised?: boolean;
  /** The chat can show questions as a panel above the input (12 Nov 2026): the agent may answer with an «ask» block. */
  ask?: boolean;
  /** The user's house style, applied by every agent. */
  house?: HouseStyleInput;
  /** A routine's own run (server/routines/run.ts): it does not offer routines. */
  routine?: boolean;
  /** 13 Nov 2026, «every row»: one row of a table run by the batch panel: a single pass, no questions, no offers. */
  batch?: boolean;
  /** The app's own assistant (shared/assistant.ts): the server writes its instructions and reads `mine`, the person's own agents. */
  assistant?: boolean;
  mine?: { id: string; name: string; description: string }[];
  /** Photos sent with the latest question, as data URLs (JPEG, PNG or WebP). */
  images?: { name: string; dataUrl: string }[];
};
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || !!value.trim());
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export const isAgentJurisdiction = (value: unknown): value is string => isSourcePlaceCode(value);

const zone = (value: unknown) => { if (typeof value !== 'string' || !value || value.length > 64) return false; try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; } catch { return false; } };

export function validateAgentRunRequest(value: unknown): asserts value is AgentRunRequest {
  if (!object(value) || !object(value.agent) || !isOutputLanguage(value.language) || (value.model !== undefined && !['quality', 'balanced'].includes(value.model)) || (value.ask !== undefined && typeof value.ask !== 'boolean') || (value.assistant !== undefined && typeof value.assistant !== 'boolean') || (value.routine !== undefined && typeof value.routine !== 'boolean') || (value.batch !== undefined && typeof value.batch !== 'boolean') || (value.anonymised !== undefined && typeof value.anonymised !== 'boolean') || (value.timeZone !== undefined && !zone(value.timeZone))) throw new Error('invalid_agent_request');
  const agent = value.agent;
  if (agent.needs !== undefined && !text(agent.needs, AGENT_LIMITS.needs, true)) throw new Error('invalid_agent_request');
  if (agent.lessons !== undefined && (!Array.isArray(agent.lessons) || agent.lessons.length > LESSON_LIMITS.perAgent || !agent.lessons.every((lesson: unknown) => text(lesson, LESSON_LIMITS.chars)))) throw new Error('invalid_agent_request');
  if (agent.sites !== undefined && (!Array.isArray(agent.sites) || agent.sites.length > 12 || !agent.sites.every((site: unknown) => typeof site === 'string' && siteDomain(site) === site))) throw new Error('invalid_agent_request');
  // A jurisdiction is required where the agent researches a place's official sources; an agent that does not research may run without one.
  if (!text(agent.name, AGENT_LIMITS.name) || !text(agent.instructions, AGENT_LIMITS.instructions) || typeof agent.officialSearch !== 'boolean'
    || !(isAgentJurisdiction(agent.jurisdiction) || (agent.jurisdiction === '' && !agent.officialSearch)) || !['fast', 'deep'].includes(agent.mode) || !Array.isArray(agent.knowledge)
    || agent.knowledge.length > AGENT_LIMITS.knowledgeFiles || !agent.knowledge.every((file: unknown) => object(file) && text(file.name, 200) && text(file.text, AGENT_LIMITS.knowledgeChars))
    || agent.knowledge.reduce((n: number, file: { text: string }) => n + file.text.length, 0) > AGENT_LIMITS.knowledgeChars) throw new Error('invalid_agent_request');
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > AGENT_LIMITS.messages
    || !value.messages.every((message: unknown, index: number) => object(message) && message.role === (index % 2 ? 'assistant' : 'user') && text(message.content, AGENT_LIMITS.messageChars))
    || value.messages.at(-1).role !== 'user') throw new Error('invalid_agent_request');
  if (!Array.isArray(value.documents) || value.documents.length > AGENT_LIMITS.documents
    || !value.documents.every((file: unknown) => object(file) && text(file.name, 200) && text(file.text, AGENT_LIMITS.documentChars))
    || value.documents.reduce((n: number, file: { text: string }) => n + file.text.length, 0) > AGENT_LIMITS.documentChars) throw new Error('invalid_agent_request');
  const house = value.house;
  if (house !== undefined && (!object(house) || !text(house.tone, AGENT_LIMITS.houseTone, true) || !text(house.positions, AGENT_LIMITS.housePositions, true)
    || !Array.isArray(house.rules) || house.rules.length > AGENT_LIMITS.houseRules || !house.rules.every((rule: unknown) => text(rule, AGENT_LIMITS.houseRule))
    || !Array.isArray(house.files) || house.files.length > AGENT_LIMITS.houseFiles || !house.files.every((file: unknown) => object(file) && text(file.name, 200) && text(file.text, AGENT_LIMITS.houseFileChars))
    || house.files.reduce((n: number, file: { text: string }) => n + file.text.length, 0) > AGENT_LIMITS.houseFileChars)) throw new Error('invalid_agent_request');
  const images = value.images;
  if (images !== undefined && (!Array.isArray(images) || images.length > AGENT_LIMITS.images
    || !images.every((image: unknown) => object(image) && text(image.name, 200) && typeof image.dataUrl === 'string' && image.dataUrl.length <= AGENT_LIMITS.imageChars && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl)))) throw new Error('invalid_agent_request');
}

/** An agent as the browser keeps it: anything damaged is dropped, never half-loaded. An unset jurisdiction («») is
 *  allowed here (the agent asks for one before it runs); a run request (validateAgentRunRequest) needs a real one. */
export function isAgentDefinition(value: unknown): value is AgentDefinition {
  return object(value) && text(value.id, 100) && text(value.name, AGENT_LIMITS.name) && text(value.description, AGENT_LIMITS.description, true)
    && isFieldId(value.field) && categoryBelongs(value.field, value.category) && text(value.instructions, AGENT_LIMITS.instructions)
    && Array.isArray(value.starters) && value.starters.length <= AGENT_LIMITS.starters && value.starters.every((s: unknown) => text(s, AGENT_LIMITS.starter))
    && text(value.needs, AGENT_LIMITS.needs, true) && (value.jurisdiction === '' || isAgentJurisdiction(value.jurisdiction)) && typeof value.officialSearch === 'boolean'
    && ['fast', 'deep'].includes(value.mode) && Array.isArray(value.knowledge) && value.knowledge.length <= AGENT_LIMITS.knowledgeFiles
    && value.knowledge.every((file: unknown) => object(file) && text(file.name, 200) && text(file.text, AGENT_LIMITS.knowledgeChars))
    && ['ready', 'mine'].includes(value.origin) && Number.isFinite(value.createdAt) && Number.isFinite(value.updatedAt)
    && (value.sites === undefined || (Array.isArray(value.sites) && value.sites.length <= 12 && value.sites.every((site: unknown) => typeof site === 'string' && siteDomain(site) === site)));
}
