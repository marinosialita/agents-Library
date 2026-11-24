// Chat with your agents on Telegram (13 Nov 2026, the n8n study: assistants on Telegram are among their most-viewed
// templates). The owner's own bot (TELEGRAM_BOT_TOKEN, already used to send routine briefs) answers the chats on
// TELEGRAM_ALLOWED_CHATS and nobody else, through the same engine as WhatsApp and e-mail (server/inbound/core.ts: the
// task picks its agent, official sources, names hidden, a Word copy). On the Mac the dev server polls Telegram
// (getUpdates: no public address needed); a host would use /api/telegram with TELEGRAM_WEBHOOK_SECRET instead.
// Messages sent while nothing was listening are skipped, never answered late; the bot token never leaves the server.
import { markdownToText } from '../../src/data/markdown.ts';
import { PRODUCT_NAME } from '../../shared/product.ts';
import { defaultInboundDeps, deferWork, firstSight, handleInbound, RATE_LIMIT_TEXT, rateCheck, sameSecret, type InboundAttachment, type InboundDeps, type InboundMessage, type InboundResult } from './core.ts';

export type TelegramConfig = { token: string; allowed: Set<string>; secret: string };
export const TELEGRAM_LIMITS = { text: 4_000, messages: 8, file: 20_000_000 } as const;
const env = (name: string) => (process.env[name] ?? '').trim();
export function telegramConfig(): TelegramConfig | null {
  const token = env('TELEGRAM_BOT_TOKEN'); const allowed = new Set(env('TELEGRAM_ALLOWED_CHATS').split(/[\s,;]+/).filter(chat => /^-?\d{4,20}$/.test(chat)));
  return /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token) && allowed.size ? { token, allowed, secret: env('TELEGRAM_WEBHOOK_SECRET') } : null;
}
type Deps = InboundDeps & { run?(message: InboundMessage, deps: InboundDeps): Promise<InboundResult> };
const api = (config: TelegramConfig, method: string) => `https://api.telegram.org/bot${config.token}/${method}`;

/** Text in Telegram-sized parts, on paragraph boundaries where possible. */
export function telegramParts(text: string, size = TELEGRAM_LIMITS.text): string[] {
  const parts: string[] = []; let rest = text.trim();
  while (rest.length > size) { const cut = Math.max(rest.lastIndexOf('\n\n', size), rest.lastIndexOf('\n', size), Math.floor(size * 0.6)); parts.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim(); }
  if (rest) parts.push(rest);
  return parts;
}
/** The reply as plain Telegram messages: the answer, its sources and notes, and who answered. */
export function telegramTexts(result: Exclude<InboundResult, { kind: 'held' }>): string[] {
  if (result.kind === 'reply') return telegramParts(result.text);
  const notes = [...result.gaps, ...result.notes];
  const text = [markdownToText(result.answer.replace(/<proofs>[\s\S]*$/i, '').replace(/\[\^\d+\]/g, '')),
    result.sources.length ? `Sources\n${result.sources.map((source, index) => `${index + 1}. ${source.title}: ${source.url}`).join('\n')}` : '',
    notes.length ? `Notes\n${notes.map(note => `• ${note}`).join('\n')}` : '',
    `— ${result.agent.name}${result.place ? ` (${result.place})` : ''} · ${PRODUCT_NAME}${result.hidden ? ` · ${result.hidden} hidden from the AI` : ''}`].map(part => part.trim()).filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n');
  const parts = telegramParts(text);
  return parts.length <= TELEGRAM_LIMITS.messages ? parts : [...parts.slice(0, TELEGRAM_LIMITS.messages - 1), 'The answer continues in the Word file below.'];
}

async function call(config: TelegramConfig, deps: Pick<InboundDeps, 'fetcher'>, method: string, body: Record<string, unknown> | FormData): Promise<any> {
  const response = await deps.fetcher(api(config, method), body instanceof FormData ? { method: 'POST', body, signal: AbortSignal.timeout(60_000) }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) throw new Error(`telegram_${method}_${response.status}`);
  return data?.result;
}

/** A file the person sent: its path from getFile, then the bytes, at most 20 MB (Telegram's own bot limit). */
async function download(config: TelegramConfig, deps: Pick<InboundDeps, 'fetcher'>, fileId: string): Promise<Uint8Array> {
  const file = await call(config, deps, 'getFile', { file_id: fileId });
  const path = typeof file?.file_path === 'string' ? file.file_path : '';
  if (!path || (file.file_size ?? 0) > TELEGRAM_LIMITS.file) throw new Error('file_unavailable');
  const response = await deps.fetcher(`https://api.telegram.org/file/bot${config.token}/${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('file_unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > TELEGRAM_LIMITS.file) throw new Error('file_unavailable');
  return bytes;
}

/** One update: only an allowed chat, once, within the hourly limit; the answer and its Word copy go back to that chat. */
export async function handleTelegramUpdate(update: any, config: TelegramConfig, deps: Deps = defaultInboundDeps): Promise<'ignored' | 'answered'> {
  const message = update?.message; const chat = String(message?.chat?.id ?? '');
  if (!message || !config.allowed.has(chat) || !firstSight(`telegram:${update.update_id}`)) return 'ignored';
  const say = (text: string) => call(config, deps, 'sendMessage', { chat_id: chat, text, disable_web_page_preview: true }).catch(() => undefined);
  const rate = rateCheck(`telegram:${chat}`);
  if (rate === 'limited') return 'ignored';
  if (rate === 'first') { await say(RATE_LIMIT_TEXT); return 'answered'; }
  let text = String(message.text ?? message.caption ?? '').slice(0, 4_096).replace(/^\/(start|help)\b.*/i, 'help');
  const attachments: InboundAttachment[] = [];
  try {
    if (message.document?.file_id) attachments.push({ name: String(message.document.file_name ?? 'document').replace(/[\u0000-\u001f/\\]/g, '').slice(0, 200) || 'document', type: String(message.document.mime_type ?? 'application/octet-stream'), bytes: await download(config, deps, message.document.file_id) });
    else if (Array.isArray(message.photo) && message.photo.length) attachments.push({ name: 'photo.jpg', type: 'image/jpeg', bytes: await download(config, deps, message.photo.at(-1).file_id) });
  } catch { await say(`The file could not be fetched from Telegram (bots can read files up to ${TELEGRAM_LIMITS.file / 1_000_000} MB). Please send it again, or a smaller one.`); return 'answered'; }
  if (!text && !attachments.length) { await say('Only text, documents (PDF, Word .docx, text, CSV) and photos are read. Write the task, or send the document with the task as its caption.'); return 'answered'; }
  void call(config, deps, 'sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => undefined);
  let result: InboundResult;
  try { result = await (deps.run ?? handleInbound)({ channel: 'telegram', from: chat, text, attachments }, deps); }
  catch { result = { kind: 'reply', reason: 'failed', text: 'Your message could not be processed. Please send it again later.' }; }
  if (result.kind === 'held') return 'answered';
  for (const part of telegramTexts(result)) await say(part);
  if (result.kind === 'answer') {
    const form = new FormData(); form.set('chat_id', chat); form.set('caption', `${result.agent.name}: the answer as a Word file`);
    form.set('document', new Blob([result.word as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), result.wordName);
    await call(config, deps, 'sendDocument', form).catch(() => say('The Word copy could not be sent this time.'));
  }
  return 'answered';
}

/** Polling on the Mac (vite.config.ts starts it): long polls, one update at a time; the backlog is skipped first. */
export async function pollTelegram(config: TelegramConfig, deps: Deps = defaultInboundDeps, state: { offset?: number; stop?: boolean } = {}, timeoutSeconds = 25): Promise<void> {
  if (state.offset === undefined) {
    // Nothing is answered late: everything already waiting is acknowledged without running.
    // 13 Nov 2026 (code review): when this first look fails, it is tried again later; starting from 0 would have
    // answered up to a day of old messages.
    const last = await call(config, deps, 'getUpdates', { offset: -1, timeout: 0 }).catch(() => null);
    if (!Array.isArray(last)) throw new Error('telegram_unreachable');
    state.offset = last.length ? Number(last.at(-1).update_id) + 1 : 0;
  }
  const updates = await call(config, deps, 'getUpdates', { offset: state.offset, timeout: timeoutSeconds, allowed_updates: ['message'] });
  for (const update of Array.isArray(updates) ? updates : []) {
    state.offset = Number(update.update_id) + 1;
    await handleTelegramUpdate(update, config, deps).catch(error => console.log('[telegram] update failed:', error instanceof Error ? error.message.slice(0, 120) : 'error'));
  }
}

/** Starts the polling loop once per process, unless a webhook is set (then Telegram refuses getUpdates) or it is off. */
export async function startTelegramPolling(): Promise<string> {
  const flag = globalThis as { __agentsTelegram?: { offset?: number; stop?: boolean } };
  const config = telegramConfig();
  if (flag.__agentsTelegram) return 'already running';
  if (!config) return 'not set up';
  if (env('TELEGRAM_POLLING') === 'off') return 'switched off';
  const hook = await call(config, defaultInboundDeps, 'getWebhookInfo', {}).catch(() => null);
  if (hook?.url) return 'a webhook is set: polling not started';
  const state = flag.__agentsTelegram = {};
  void (async () => { let wait = 1_000;
    while (!(state as { stop?: boolean }).stop) {
      try { await pollTelegram(config, defaultInboundDeps, state); wait = 1_000; }
      catch (error) { console.log('[telegram] poll failed:', error instanceof Error ? error.message.slice(0, 120) : 'error'); await new Promise(resolve => setTimeout(resolve, wait)); wait = Math.min(wait * 2, 60_000); }
    } })();
  return 'listening';
}

/** POST /api/telegram for a host: Telegram's secret header must match TELEGRAM_WEBHOOK_SECRET; answered at once. */
export function createTelegramHandler(deps: Deps = defaultInboundDeps, config: () => TelegramConfig | null = telegramConfig) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    const settings = config();
    if (!settings || !settings.secret) return reply({ error: 'channel_not_configured' }, 503);
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!sameSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '', settings.secret)) return reply({ error: 'forbidden' }, 403);
    const update = await request.json().catch(() => null);
    if (update) deferWork(handleTelegramUpdate(update, settings, deps));
    return reply({ ok: true });
  };
}
export const handleTelegram = createTelegramHandler();
