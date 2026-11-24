// «Send work from anywhere» (7 Nov 2026): a message that arrives by e-mail or WhatsApp — its text and its files — is
// given to one ready agent and the answer goes back the same way, with a Word copy. Provider-agnostic: the channels
// (server/inbound/email.ts, server/inbound/whatsapp.ts) turn their webhooks into an InboundMessage and send the result.
// The agent is the one named on the first line («/agent Month-end variance commentary» or «agent: …»), else the one
// the address names (finance-month-end-commentary@… → ready-finance-month-end-commentary), else the AI picker's top
// pick (server/agent-route.ts), else the reply lists three suggestions. The place comes from a line «Place: Cyprus» or
// «Jurisdiction: cy» (catalogue places only); an agent that researches official sources and has no place is asked
// for one, never given a default. Names are hidden before the AI reads anything (src/data/privacy.ts) unless
// INBOUND_SHOW_NAMES=1, and shown again in the answer. The run is the same as server/agent-run.ts — its instruction,
// its input, the official-source allow-list and «tool_choice: required» — in one call without streaming.
// Everything in the message and the files is untrusted data: the agent instruction says so, and nothing here acts on it
// beyond the two control lines above.
// Memory (duplicates, the rate limit, a message waiting for its place) is in this process only, best effort: on a
// serverless host each instance has its own and loses it when it stops (see the channels' notes on a queue).
import { createHash, timingSafeEqual } from 'node:crypto';
import { AGENT_LIMITS, validateAgentRunRequest, type AgentDefinition, type AgentRunRequest } from '../../shared/agents.ts';
import { categoryOf, fieldById } from '../../shared/fields.ts';
import { findSourcePlaces, greekPlaceName, OFFICIAL_SOURCE_PLACES, placeDomains, sourcePlace, type SourcePlace } from '../../shared/official-sources.ts';
import { isOutputLanguage, PRODUCT_NAME, type OutputLanguage } from '../../shared/product.ts';
import { findPrivate, makeMasker, maskRunRequest } from '../../src/data/privacy.ts';
import { rankAgents } from '../../src/data/task-finder.ts';
import { AGENT_TEMPLATES } from '../../src/data/templates/index.ts';
import { agentAnswerWord } from '../../src/data/word.ts';
import { agentInput, agentInstruction } from '../agent-run.ts';
import { createAgentRouteHandler, routeCatalogue } from '../agent-route.ts';
import { apiKey, modelId, reasoningEffort, RESPONSES_URL } from '../models.ts';
import { officialWebSearchEnabled, readOfficialSourcesResponse, type OfficialSourceCitation } from '../official-research.ts';
import { attachmentKind, readAttachments, type InboundAttachment, type InboundImage } from './documents.ts';

export type { InboundAttachment };
export type InboundChannel = 'email' | 'whatsapp' | 'telegram';
export type InboundMessage = { channel: InboundChannel; from: string; to?: string; subject?: string; text: string; attachments: InboundAttachment[] };
export type InboundAnswer = {
  kind: 'answer'; agent: { id: string; name: string }; place: string; answer: string; sources: OfficialSourceCitation[];
  /** What the answer could not cover (from the research reading) and what happened to the files. */
  gaps: string[]; notes: string[];
  /** How many names and identifiers were hidden from the AI. */
  hidden: number;
  word: Uint8Array; wordName: string;
};
export type InboundReplyReason = 'help' | 'task' | 'agent' | 'place' | 'images' | 'failed' | 'unavailable' | 'limited';
/** A reply without a run: a question back to the sender, or why nothing was done. */
export type InboundReply = { kind: 'reply'; reason: InboundReplyReason; text: string };
/** Files added to a message still waiting for its task: nothing to send. */
export type InboundHeld = { kind: 'held' };
export type InboundResult = InboundAnswer | InboundReply | InboundHeld;
export type InboundDeps = { key(): string; fetcher: typeof fetch; retryMs?: number };
export const defaultInboundDeps: InboundDeps = { key: apiKey, fetcher: (input, init) => fetch(input, init) };

// ── Configuration: every value from the environment; a channel is on only when all of its values are set ──────────
const env = (name: string) => (process.env[name] ?? '').trim();
/** E-mail addresses, comma- or space-separated, lower case. Empty means nobody, never everybody. */
export const allowedSenders = (): Set<string> => new Set(env('INBOUND_ALLOWED_SENDERS').split(/[,;\s]+/).map(value => value.toLowerCase()).filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)));
/** Phone numbers as WhatsApp gives them (country code and number, digits only); «+357 99 123456» is accepted. */
export const allowedNumbers = (): Set<string> => new Set(env('WHATSAPP_ALLOWED_NUMBERS').split(/[,;]+/).map(value => value.replace(/\D/g, '')).filter(value => value.length >= 7));
export type EmailConfig = { user: string; password: string; token: string; from: string; senders: Set<string>; stream: string };
export function emailConfig(): EmailConfig | null {
  const config = { user: env('INBOUND_EMAIL_USER'), password: env('INBOUND_EMAIL_PASSWORD'), token: env('POSTMARK_SERVER_TOKEN'), from: env('INBOUND_FROM_ADDRESS'),
    senders: allowedSenders(), stream: env('POSTMARK_MESSAGE_STREAM') || 'outbound' };
  return config.user && config.password && config.token && config.from && config.senders.size && apiKey() ? config : null;
}
export type WhatsAppConfig = { verifyToken: string; appSecret: string; token: string; phoneNumberId: string; numbers: Set<string>; version: string };
export const whatsappVerifyToken = () => env('WHATSAPP_VERIFY_TOKEN');
export function whatsappConfig(): WhatsAppConfig | null {
  const version = env('WHATSAPP_GRAPH_VERSION');
  const config = { verifyToken: whatsappVerifyToken(), appSecret: env('WHATSAPP_APP_SECRET'), token: env('WHATSAPP_TOKEN'), phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    numbers: allowedNumbers(), version: /^v\d{1,3}\.\d$/.test(version) ? version : 'v24.0' };
  return config.verifyToken && config.appSecret && config.token && /^\d{5,30}$/.test(config.phoneNumberId) && config.numbers.size && apiKey() ? config : null;
}
/** For the settings page: whether each channel has every value it needs (the AI key included). No value leaves. */
export function channelStatus(): { email: boolean; whatsapp: boolean; telegram: boolean } {
  // 13 Nov 2026: Telegram chat (server/inbound/telegram.ts) uses the same two settings as routine delivery.
  const telegram = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(env('TELEGRAM_BOT_TOKEN')) && /\d{4,20}/.test(env('TELEGRAM_ALLOWED_CHATS'));
  return { email: !!emailConfig(), whatsapp: !!whatsappConfig(), telegram };
}
const showNames = () => env('INBOUND_SHOW_NAMES') === '1';
const allowImages = () => env('INBOUND_ALLOW_IMAGES') === '1';
const language = (): OutputLanguage => { const value = env('INBOUND_LANGUAGE'); return isOutputLanguage(value) ? value : 'en'; };
const perHour = () => { const value = Number(env('INBOUND_MAX_PER_HOUR')); return Number.isInteger(value) && value > 0 && value <= 1_000 ? value : 20; };

/** Two secrets compared in constant time: both are hashed first, so neither their content nor their length shows. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest(); const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) && expected.length > 0;
}

/** A request body as bytes, within the limit while it arrives (a chunked body carries no Content-Length). */
export async function readBoundedBytes(source: { headers: Headers; body: ReadableStream<Uint8Array> | null }, limit: number): Promise<Uint8Array> {
  if (Number(source.headers.get('Content-Length')) > limit) throw new Error('too_large');
  const reader = source.body?.getReader(); if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => undefined); throw new Error('too_large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(size); let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

/** Work that goes on after the webhook is answered. On Vercel the platform's own request context keeps the function
 *  alive for it (what @vercel/functions' waitUntil calls); elsewhere (the dev server, a long-running Node server) the
 *  promise simply runs on. Neither survives a crash or a redeploy: a queue does (see the channels' notes). */
export function deferWork(work: Promise<unknown>): void {
  const settled = work.catch(error => console.error('[inbound] background work failed', error instanceof Error ? error.message : 'error'));
  try {
    const context = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
    if (typeof context?.waitUntil === 'function') context.waitUntil(settled);
  } catch { /* no platform context */ }
}

// ── Memory: duplicates, the rate limit and messages waiting for a reply (this process only) ─────────────────────
const seen = new Map<string, number>();
const sent = new Map<string, number[]>();
type Parsed = { agentName?: string; placeQuery?: string; subject?: string; to?: string; body: string };
type Pending = { at: number; reason: InboundReplyReason; parsed: Parsed; attachments: InboundAttachment[] };
const pending = new Map<string, Pending>();
const PENDING_MS = 30 * 60_000; const PENDING_BYTES = 25_000_000; const PENDING_SENDERS = 50;
const limit = <K, V>(map: Map<K, V>, max: number) => { while (map.size > max) map.delete(map.keys().next().value as K); };

/** True the first time a message id is seen (within a day): a webhook delivered twice runs once. */
export function firstSight(id: string, now = Date.now()): boolean {
  for (const [key, until] of seen) { if (until > now) break; seen.delete(key); }
  if ((seen.get(id) ?? 0) > now) return false;
  seen.delete(id); seen.set(id, now + 24 * 3_600_000); limit(seen, 20_000);
  return true;
}
/** At most INBOUND_MAX_PER_HOUR messages (20) per sender in any hour. «first» is the first message over the limit
 *  (the sender is told once); later ones are dropped quietly. */
export function rateCheck(sender: string, now = Date.now()): 'ok' | 'first' | 'limited' {
  const times = (sent.get(sender) ?? []).filter(time => time > now - 3_600_000);
  const over = times.length >= perHour();
  times.push(now); sent.delete(sender); sent.set(sender, times.slice(-(perHour() + 5))); limit(sent, 5_000);
  return !over ? 'ok' : times.length === perHour() + 1 ? 'first' : 'limited';
}
export const hasPending = (channel: InboundChannel, from: string, now = Date.now()) => (pending.get(`${channel}:${from}`)?.at ?? 0) > now - PENDING_MS;
function keepPending(key: string, entry: Pending) {
  let bytes = 0; const attachments = entry.attachments.filter(file => (bytes += file.bytes.length) <= PENDING_BYTES);
  pending.delete(key); pending.set(key, { ...entry, attachments }); limit(pending, PENDING_SENDERS);
}
/** For the tests: a fresh process. */
export function resetInboundMemory() { seen.clear(); sent.clear(); pending.clear(); }

// ── Reading the message: the two control lines, the place, the agent ─────────────────────────────────────────────
// The control lines are looked for only in the sender's own words: above a forwarded or quoted message, in its first
// lines. A «Jurisdiction:» inside a forwarded contract is the contract's, not an instruction.
const QUOTE_START = /^\s*(?:-{2,}\s*(?:forwarded message|original message)|begin forwarded message|from:\s|on .{4,200} wrote:\s*$|>)/i;
const AGENT_LINE = /^\s*(?:\/agent\s+|agent\s*:\s*)(.{1,160}?)\s*$/i;
const PLACE_LINE = /^\s*(?:place|jurisdiction)\s*:\s*(.{1,80}?)\s*\.?\s*$/i;
export function readControls(text: string, subject = ''): Parsed {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const head = Math.min(lines.length, 20, ...[lines.findIndex(line => QUOTE_START.test(line))].filter(at => at >= 0));
  let agentName: string | undefined; let placeQuery: string | undefined; let topic = subject.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
  const first = lines.findIndex(line => line.trim());
  if (first >= 0 && first < head) { const found = AGENT_LINE.exec(lines[first]); if (found) { agentName = found[1]; lines[first] = ''; } }
  if (!agentName) { const found = AGENT_LINE.exec(topic); if (found) { agentName = found[1]; topic = ''; } }
  for (let at = 0; at < head; at++) { const found = PLACE_LINE.exec(lines[at]); if (found) { placeQuery = found[1]; lines[at] = ''; break; } }
  return { agentName, placeQuery, subject: topic || undefined, body: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\s*&\s*/g, ' and ').replace(/[«»"“”'’.]/g, '').replace(/\s+/g, ' ').trim();
// Names people write that are not one catalogue place: the United Kingdom has three jurisdictions.
const PLACE_ALIASES: Record<string, string[]> = { usa: ['us'], 'united states of america': ['us'], 'united states': ['us'], england: ['ew'], wales: ['ew'],
  uk: ['ew', 'gb-sct', 'gb-nir'], 'united kingdom': ['ew', 'gb-sct', 'gb-nir'], britain: ['ew', 'gb-sct', 'gb-nir'], 'great britain': ['ew', 'gb-sct'] };
/** The catalogue place a sender means, by code, English, local or Greek name; several when the name is shared. */
export function findPlace(query: string): SourcePlace[] {
  const q = fold(query).replace(/^the /, ''); if (!q) return [];
  if (PLACE_ALIASES[q]) return PLACE_ALIASES[q].map(code => sourcePlace(code)!).filter(Boolean);
  const exact = OFFICIAL_SOURCE_PLACES.filter(place => place.code === q || [place.name, place.local ?? '', greekPlaceName(place)].some(name => name && fold(name) === q));
  if (exact.length) return exact;
  const loose = q.length >= 4 ? findSourcePlaces(query) : [];
  return loose.length <= 3 ? loose : [];
}

const READY_PREFIX = 'ready-';
const greekNames = new Map(AGENT_TEMPLATES.map(template => [fold(template.name.el), `${READY_PREFIX}${template.id}`]));
const agentById = (id: string) => { const { agents, byId } = routeCatalogue(); const n = byId.get(id); return n ? agents[n - 1] : undefined; };
/** A ready agent by its id slug («finance-month-end-commentary», with or without «ready-»). */
export const agentBySlug = (slug: string) => /^[a-z0-9-]{2,100}$/.test(slug) ? agentById(slug.startsWith(READY_PREFIX) ? slug : `${READY_PREFIX}${slug}`) : undefined;
/** The agent an address names: its local part (finance-month-end-commentary@…) or the part after «+»
 *  (inbox+finance-month-end-commentary@…, which a provider's own inbound address allows). */
export function agentFromAddress(address: string | undefined): AgentDefinition | undefined {
  const local = (address ?? '').trim().toLowerCase().split('@')[0] ?? '';
  return [local, ...local.split('+').slice(1), local.split('+')[0]].map(part => agentBySlug(part)).find(Boolean);
}
/** The agent a sender named: by id, by exact name (English, or Greek for Legal), by a name only one agent contains. */
export function findAgentByName(name: string): { agent?: AgentDefinition; options: AgentDefinition[] } {
  const { agents } = routeCatalogue();
  const bySlug = agentBySlug(name.trim().toLowerCase()); if (bySlug) return { agent: bySlug, options: [] };
  const q = fold(name);
  const exact = agents.filter(agent => fold(agent.name) === q);
  const greek = greekNames.get(q); if (!exact.length && greek) exact.push(agentById(greek)!);
  if (exact.length === 1) return { agent: exact[0], options: [] };
  if (exact.length > 1) return { options: exact.slice(0, 3) };
  const within = q.length >= 4 ? agents.filter(agent => fold(agent.name).includes(q)) : [];
  if (within.length === 1) return { agent: within[0], options: [] };
  return { options: (within.length ? within : rankAgents(name, agents, 3).map(item => item.agent)).slice(0, 3) };
}
const slugOf = (agent: AgentDefinition) => agent.id.slice(READY_PREFIX.length);
const agentLine = (agent: AgentDefinition, index: number) => {
  const area = categoryOf(agent.category)?.category.name; const field = fieldById(agent.field)?.name;
  return `${index + 1}. ${agent.name}${field ? ` (${field}${area ? ` › ${area}` : ''})` : ''}\n   /agent ${slugOf(agent)}`;
};

// ── Replies without a run ──────────────────────────────────────────────────────────────────────────────────────
const HOW = (channel: InboundChannel) => `How to send work to an agent of ${PRODUCT_NAME}:
- Write the task in your message${channel === 'email' ? ' and attach the files (PDF, Word .docx, text or CSV)' : ' and send documents with the task as their caption (PDF, Word .docx, text or CSV)'}.
- To choose the agent, put it on the first line: /agent Month-end variance commentary (or «agent: …»). Without it, the agent that fits your task best is chosen.
- When the agent researches official sources, add the place on its own line: Place: France (or Jurisdiction: fr).
- The answer comes back here, with a Word copy.`;
const reply = (reason: InboundReplyReason, text: string): InboundReply => ({ kind: 'reply', reason, text });

async function aiPick(task: string, deps: InboundDeps): Promise<{ picks: { id: string }[]; noneFits: boolean } | null> {
  const { agents } = routeCatalogue();
  const likely = rankAgents(task, agents, 15).map(item => item.agent.id);
  try {
    const response = await createAgentRouteHandler({ key: deps.key, fetcher: deps.fetcher })(new Request('http://inbound.internal/api/agent-route', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: task.slice(0, 2_000), language: language(), likely }) }));
    if (!response.ok) return null;
    const read = await response.json() as { picks?: { id: string }[]; noneFits?: boolean };
    return Array.isArray(read.picks) ? { picks: read.picks, noneFits: read.noneFits === true } : null;
  } catch { return null; }
}

/** One turn of the agent, as server/agent-run.ts runs it, without streaming: the same instruction and input, the
 *  official-source allow-list and «tool_choice: required» when it researches, one more try after a rate limit or a
 *  provider error. Photos go with the question as images (the run request does not carry them here). */
async function runTurn(request: AgentRunRequest, images: InboundImage[], channel: InboundChannel, deps: InboundDeps) {
  const code = request.agent.jurisdiction;
  const domains = code ? placeDomains(code) : [];
  const searching = request.agent.officialSearch && domains.length > 0 && officialWebSearchEnabled();
  const deep = request.agent.mode === 'deep';
  const signal = AbortSignal.timeout(deep ? 780_000 : 280_000);
  const input: { role: string; content: unknown }[] = [...agentInput(request)];
  const last = input.at(-1);
  if (last && images.length) last.content = [...(typeof last.content === 'string' ? [{ type: 'input_text', text: last.content }] : Array.isArray(last.content) ? last.content : []),
    ...images.map(image => ({ type: 'input_image', image_url: `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}` }))];
  const body = JSON.stringify({ model: modelId(request.model), store: false, reasoning: { effort: reasoningEffort() }, max_output_tokens: deep ? 32_000 : 16_000,
    instructions: `${agentInstruction(request)}\n\nDELIVERY: the user sent this task by ${channel === 'email' ? 'e-mail' : channel === 'telegram' ? 'Telegram' : 'WhatsApp'} and reads your answer there; a Word copy of it is attached to the reply.`,
    input, ...(searching ? { tools: [{ type: 'web_search', filters: { allowed_domains: domains } }], tool_choice: 'required', include: ['web_search_call.action.sources'] } : {}) });
  const call = () => deps.fetcher(RESPONSES_URL, { method: 'POST', signal, headers: { Authorization: `Bearer ${deps.key()}`, 'Content-Type': 'application/json' }, body }).catch(() => null);
  let response = await call();
  if (!signal.aborted && (!response || response.status === 429 || response.status >= 500)) {
    await response?.body?.cancel().catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, deps.retryMs ?? 1_500));
    if (!signal.aborted) response = await call();
  }
  const result: any = response?.ok ? await response.json().catch(() => null) : null;
  if (!result || (result.status !== 'completed' && result.status !== 'incomplete')) return null;
  if (searching) { try { return readOfficialSourcesResponse(result, code); } catch { return null; } }
  const answer = (Array.isArray(result.output) ? result.output : []).filter((item: any) => item?.type === 'message').flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
    .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string').map((part: any) => part.text as string).join('\n\n').trim();
  return answer ? { answer, sources: [] as OfficialSourceCitation[], gaps: result.status === 'incomplete' ? ['The answer was cut short before it finished.'] : [] } : null;
}

const fileSlug = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'answer';

/** One inbound message, start to end: what to reply, and with which agent's answer. */
export async function handleInbound(message: InboundMessage, deps: InboundDeps = defaultInboundDeps): Promise<InboundResult> {
  const key = `${message.channel}:${message.from}`; const now = Date.now();
  const before = pending.get(key); pending.delete(key);
  const waiting = before && before.at > now - PENDING_MS ? before : undefined;
  const own = readControls(message.text, message.subject);
  own.to = message.to;
  const parsed: Parsed = waiting ? { agentName: own.agentName ?? waiting.parsed.agentName, placeQuery: own.placeQuery ?? waiting.parsed.placeQuery,
    subject: waiting.parsed.subject || own.subject, to: own.to || waiting.parsed.to, body: [waiting.parsed.body, own.body].filter(Boolean).join('\n\n') } : own;
  const attachments = [...(waiting?.attachments ?? []), ...message.attachments];
  const hold = (reason: InboundReplyReason, text: string, files = attachments, agent?: AgentDefinition): InboundReply => {
    keepPending(key, { at: now, reason, parsed: { ...parsed, ...(agent ? { agentName: slugOf(agent) } : {}) }, attachments: files });
    return reply(reason, text);
  };
  // Files sent one by one while the task is still awaited are kept with it, without a reply each.
  if (waiting?.reason === 'task' && message.attachments.length && !own.body && !own.agentName && !own.placeQuery) { hold('task', ''); return { kind: 'held' }; }
  if (!attachments.length && /^\/?help\??$/i.test(parsed.body) && !parsed.agentName) return reply('help', HOW(message.channel));

  const hide = !showNames();
  if (hide && !allowImages() && attachments.some(file => attachmentKind(file) === 'image'))
    return hold('images', `Photos were not sent to the AI: names in a photo cannot be hidden before the AI reads it. Send the document as a PDF with text or as a Word (.docx) file instead${message.channel === 'whatsapp' ? '' : ', or paste its text'}. Anything else you sent is kept for 30 minutes.`,
      attachments.filter(file => attachmentKind(file) !== 'image'));

  let place: SourcePlace | undefined;
  if (parsed.placeQuery) {
    const places = findPlace(parsed.placeQuery);
    if (places.length !== 1) return hold('place', places.length
      ? `«${parsed.placeQuery}» could mean ${places.map(item => `${item.name} (${item.code})`).join(', ')}. Reply with one of them on its own line, for example:\nPlace: ${places[0].name}`
      : `«${parsed.placeQuery}» is not a place the agents research. Reply with a country or region by name or code on its own line, for example:\nPlace: France\nJurisdiction: de`);
    place = places[0];
  }

  // The agent: named on the first line, named by the address, or picked by the AI from the task.
  const task = [parsed.subject, parsed.body].filter(Boolean).join('\n\n');
  let agent: AgentDefinition | undefined;
  if (parsed.agentName) {
    const found = findAgentByName(parsed.agentName);
    if (!found.agent) return hold('agent', `${found.options.length > 1 && found.options.every(option => fold(option.name) === fold(parsed.agentName!)) ? `More than one agent is called «${parsed.agentName}»` : `No agent is called «${parsed.agentName}»`}. Reply with one of these on the first line${found.options.length ? '' : ' (or write the task without an agent line and the best one is chosen)'}:\n${found.options.map(agentLine).join('\n')}`);
    agent = found.agent;
  } else agent = agentFromAddress(parsed.to);
  if (!agent) {
    if (!task.trim()) return hold('task', attachments.length ? `What should be done with ${attachments.length === 1 ? `«${attachments[0].name}»` : `the ${attachments.length} files`}? Reply with the task, and name the agent on the first line if you know it (/agent …). The files are kept for 30 minutes.` : HOW(message.channel));
    // The picker reads the task with its names hidden too.
    const names = attachments.map(file => file.name).join(', ');
    const pickerText = names ? `${task}\n\nAttached: ${names}` : task;
    const masker = hide ? makeMasker(findPrivate([pickerText], {})) : null;
    const picked = deps.key() ? await aiPick(masker ? masker.mask(pickerText) : pickerText, deps) : null;
    const top = picked && !picked.noneFits ? picked.picks.map(pick => agentById(pick.id)).find(Boolean) : undefined;
    if (!top) {
      const { agents } = routeCatalogue();
      const options = [...(picked?.picks ?? []).map(pick => agentById(pick.id)).filter((item): item is AgentDefinition => !!item), ...rankAgents(task, agents, 6).map(item => item.agent)]
        .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index).slice(0, 3);
      return hold('agent', options.length
        ? `No agent was clearly right for this task. Reply with one of these on the first line, or describe the task more fully:\n${options.map(agentLine).join('\n')}`
        : `No agent was found for this task. Describe it more fully, or name the agent on the first line (/agent …).`);
    }
    agent = top;
  }

  // The place: the agent's own, else the one given. An agent that researches official sources needs one: it is
  // asked for, never assumed.
  const code = agent.jurisdiction || place?.code || '';
  if (agent.officialSearch && !code) return hold('place', `«${agent.name}» researches the official sources of one place, and none was given. Reply with the place on its own line, for example:\nPlace: France\nJurisdiction: de\nYour message${attachments.length ? ' and files are' : ' is'} kept for 30 minutes.`, attachments, agent);
  if (agent.officialSearch && !placeDomains(code).length) return hold('place', `${sourcePlace(code)?.name ?? code} has no official sources the agents can research yet. Reply with another place on its own line (Place: …).`, attachments, agent);

  const files = await readAttachments(attachments);
  if (!task.trim() && !files.documents.length && !files.images.length) return hold('task', [`What should «${agent.name}» do? Reply with the task.`, ...files.notes].join('\n'), attachments, agent);
  if (!deps.key()) return reply('unavailable', 'The agents are not connected to the AI at the moment, so nothing was run. Please try again later.');

  // The message is the task; a very long one (a forwarded thread) goes as a document of its own.
  const documents = [...files.documents]; let content = task.trim() || 'Do your task on the attached documents.';
  if (content.length > AGENT_LIMITS.messageChars - 1_000 && documents.length < AGENT_LIMITS.documents) {
    const room = AGENT_LIMITS.documentChars - documents.reduce((n, file) => n + file.text.length, 0);
    if (room > 1_000) { documents.unshift({ name: 'Message text', text: content.slice(0, room) }); content = 'My message is long: its full text is attached as «Message text». Do your task on it and on any other documents.'; }
  }
  const request: AgentRunRequest = { agent: { name: agent.name, instructions: agent.instructions, jurisdiction: code, officialSearch: agent.officialSearch, mode: agent.mode, knowledge: [] },
    messages: [{ role: 'user', content: content.slice(0, AGENT_LIMITS.messageChars) }], documents, language: language(), model: 'quality' };
  try { validateAgentRunRequest(request); } catch { return reply('failed', 'This message could not be given to the agent (it is longer than an agent reads, or a file is damaged). Send a shorter message or fewer files.'); }
  const masked = maskRunRequest(request, hide ? {} : null);
  const started = Date.now();
  const result = await runTurn(masked.request, files.images, message.channel, deps);
  console.log(`[inbound] ${message.channel} ${agent.id} ${result ? 'answered' : 'failed'} ${Date.now() - started} ms${masked.count ? `, ${masked.count} hidden` : ''}`);
  if (!result) return reply('failed', `«${agent.name}» could not answer this time (the AI service did not respond). Please send the message again later.`);
  const answer = masked.restore(result.answer);
  const sources = result.sources.map(source => ({ ...source, title: masked.restore(source.title) }));
  const placeName = code ? sourcePlace(code)?.name ?? '' : '';
  const markdown = [answer, sources.length ? `## Sources\n${sources.map(source => `- [${source.title}](${source.url})`).join('\n')}` : '',
    result.gaps.length || files.notes.length ? `## Notes\n${[...result.gaps, ...files.notes].map(note => `- ${note}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  return { kind: 'answer', agent: { id: agent.id, name: agent.name }, place: placeName, answer, sources, gaps: result.gaps, notes: files.notes, hidden: masked.count,
    word: agentAnswerWord(agent.name, markdown), wordName: `${fileSlug(agent.name)}-${new Date().toISOString().slice(0, 10)}.docx` };
}

/** What a channel sends after a refusal by the rate limit (once per hour at most). */
export const RATE_LIMIT_TEXT = 'You have sent more messages in the last hour than the agents take. Nothing more will be run for you until the hour has passed.';
