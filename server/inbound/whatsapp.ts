// «Send work from anywhere» by WhatsApp (7 Nov 2026), on Meta's WhatsApp Cloud API. /api/whatsapp answers Meta's
// verification (GET: hub.mode=subscribe, hub.verify_token = WHATSAPP_VERIFY_TOKEN, hub.challenge echoed) and its
// message webhooks (POST, signed: X-Hub-Signature-256 = HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET, checked
// in constant time before anything is read). Only the numbers in WHATSAPP_ALLOWED_NUMBERS are served (none when it is
// empty), and only messages to WHATSAPP_PHONE_NUMBER_ID. Text, documents and photos are read: a file is fetched from
// the Graph API with WHATSAPP_TOKEN (GET /{media-id}, then its URL with the same bearer token, on Meta's hosts only).
// The answer goes back as text messages split at 4,096 characters on paragraph boundaries, then the Word copy is
// uploaded (/media) and sent as a document.
// Meta wants a 200 within seconds and redelivers otherwise, so the webhook is answered first and the agent runs
// after (server/inbound/core.ts deferWork); a message id seen before is skipped. Both are best effort: on a serverless
// host the work lives only as long as the function may run (Vercel: waitUntil, up to maxDuration) and is lost on a
// crash or a redeploy, and each instance remembers its own ids. For reliable delivery, put each accepted message on a
// queue (Vercel Queues, QStash, SQS…) with its id as the de-duplication key, and run the agent from the queue's worker.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PRODUCT_NAME } from '../../shared/product.ts';
import { defaultInboundDeps, deferWork, firstSight, handleInbound, RATE_LIMIT_TEXT, rateCheck, readBoundedBytes, sameSecret, whatsappConfig, whatsappVerifyToken,
  type InboundAttachment, type InboundDeps, type InboundResult, type WhatsAppConfig } from './core.ts';

export const GRAPH_BASE = 'https://graph.facebook.com';
const MAX_WEBHOOK_BYTES = 1_000_000;
const MAX_MEDIA_BYTES = 20_000_000;
export const TEXT_LIMIT = 4_096;
/** More than this many text messages and the rest of the answer is left to the Word file. */
const MAX_TEXT_MESSAGES = 8;
const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const str = (value: unknown, max = 100_000) => typeof value === 'string' ? value.slice(0, max) : '';
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];

/** Meta's signature over the exact bytes received: «sha256=<hex>». */
export function signatureOk(raw: Uint8Array, header: string | null, secret: string): boolean {
  const hex = /^sha256=([0-9a-f]{64})$/i.exec((header ?? '').trim())?.[1];
  if (!hex || !secret) return false;
  return timingSafeEqual(Buffer.from(hex, 'hex'), createHmac('sha256', secret).update(raw).digest());
}

/** The answer's Markdown as WhatsApp shows it: *bold*, _italic_, «•» bullets, links as «words (address)». */
export function whatsappText(markdown: string): string {
  const BOLD = '\u0001';
  return markdown.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) return `${BOLD}${heading[1].replace(/\*+/g, '')}${BOLD}`;
    if (/^[\s|:-]+$/.test(line) && line.includes('---')) return '';
    return line.replace(/^(\s*)[-*•]\s+/, '$1• ');
  }).join('\n')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, `${BOLD}_$1_${BOLD}`).replace(/\*\*([^*\n]+)\*\*/g, `${BOLD}$1${BOLD}`).replace(/__([^_\n]+)__/g, `${BOLD}$1${BOLD}`)
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1_$2_').replace(/\u0001/g, '*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)').replace(/\n{3,}/g, '\n\n').trim();
}

/** A line longer than one message, cut at a space where there is one. */
function cutLine(line: string, limit: number): string[] {
  const out: string[] = []; let rest = line;
  while (rest.length > limit) { let at = rest.lastIndexOf(' ', limit); if (at < limit / 2) at = limit; out.push(rest.slice(0, at).trimEnd()); rest = rest.slice(at).trimStart(); }
  if (rest) out.push(rest);
  return out;
}
/** Text in messages of at most `limit` characters: whole paragraphs together where they fit; a longer paragraph by
 *  lines, a longer line by words. */
export function splitMessage(text: string, limit = TEXT_LIMIT): string[] {
  const chunks: string[] = []; let current = '';
  const add = (piece: string) => {
    if (!current) current = piece;
    else if (current.length + 2 + piece.length <= limit) current += `\n\n${piece}`;
    else { chunks.push(current); current = piece; }
  };
  for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(item => item.trim()).filter(Boolean)) {
    if (paragraph.length <= limit) { add(paragraph); continue; }
    let part = '';
    for (const line of paragraph.split('\n')) for (const piece of line.length <= limit ? [line] : cutLine(line, limit)) {
      if (part && part.length + 1 + piece.length > limit) { add(part); part = ''; }
      part = part ? `${part}\n${piece}` : piece;
    }
    if (part) add(part);
  }
  if (current) chunks.push(current);
  return chunks;
}

type Item = { id: string; from: string; message: any; rate: 'ok' | 'first' };
/** The messages of a webhook, for this number only; delivery statuses and other fields are not messages. */
export function messagesOf(payload: any, config: Pick<WhatsAppConfig, 'phoneNumberId'>): { id: string; from: string; message: any }[] {
  if (payload?.object !== 'whatsapp_business_account') return [];
  const out: { id: string; from: string; message: any }[] = [];
  for (const entry of list(payload.entry)) for (const change of list(entry?.changes)) {
    if (change?.field !== 'messages' || str(change.value?.metadata?.phone_number_id) !== config.phoneNumberId) continue;
    for (const message of list(change.value?.messages)) {
      const id = str(message?.id, 300); const from = str(message?.from, 40).replace(/\D/g, '');
      if (id && from) out.push({ id, from, message });
    }
  }
  return out;
}

/** Media URLs are Meta's own; the bearer token is never sent anywhere else. */
const MEDIA_HOSTS = ['fbsbx.com', 'facebook.com', 'fbcdn.net', 'whatsapp.net'];
export function mediaHostAllowed(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && MEDIA_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)); } catch { return false; }
}
async function downloadMedia(id: string, config: WhatsAppConfig, fetcher: typeof fetch): Promise<{ bytes: Uint8Array; type: string }> {
  if (!/^[A-Za-z0-9_.-]{1,200}$/.test(id)) throw new Error('media_id');
  const auth = { Authorization: `Bearer ${config.token}` };
  const lookup = await fetcher(`${GRAPH_BASE}/${config.version}/${encodeURIComponent(id)}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
  const info = await lookup.json().catch(() => null) as { url?: unknown; mime_type?: unknown; file_size?: unknown } | null;
  const url = str(info?.url, 4_000);
  if (!lookup.ok || !url) throw new Error('media_lookup');
  if (Number(info?.file_size) > MAX_MEDIA_BYTES) throw new Error('media_too_large');
  if (!mediaHostAllowed(url)) throw new Error('media_host');
  const file = await fetcher(url, { headers: auth, signal: AbortSignal.timeout(60_000) });
  if (!file.ok) throw new Error('media_download');
  return { bytes: await readBoundedBytes(file, MAX_MEDIA_BYTES), type: str(info?.mime_type, 200) || str(file.headers.get('Content-Type'), 200) };
}

function graph(config: WhatsAppConfig, fetcher: typeof fetch) {
  const auth = { Authorization: `Bearer ${config.token}` };
  const base = `${GRAPH_BASE}/${config.version}/${config.phoneNumberId}`;
  const post = async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const response = await fetcher(`${base}/messages`, { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...body }) });
      if (!response.ok) { const read = await response.json().catch(() => null) as { error?: { code?: unknown } } | null; console.error(`[whatsapp] send refused ${response.status} code ${String(read?.error?.code ?? '?')}`); }
      return response.ok;
    } catch { console.error('[whatsapp] send failed'); return false; }
  };
  return {
    text: (to: string, body: string, replyTo?: string) => post({ recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body }, ...(replyTo ? { context: { message_id: replyTo } } : {}) }),
    read: (id: string) => post({ status: 'read', message_id: id }),
    async document(to: string, bytes: Uint8Array, filename: string, caption: string): Promise<boolean> {
      try {
        const form = new FormData();
        form.append('messaging_product', 'whatsapp'); form.append('type', WORD_TYPE);
        form.append('file', new Blob([new Uint8Array(bytes)], { type: WORD_TYPE }), filename);
        const upload = await fetcher(`${base}/media`, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: auth, body: form });
        const media = await upload.json().catch(() => null) as { id?: unknown } | null;
        if (!upload.ok || !str(media?.id)) { console.error(`[whatsapp] upload refused ${upload.status}`); return false; }
        return post({ recipient_type: 'individual', to, type: 'document', document: { id: str(media?.id), filename, caption: caption.slice(0, 1_000) } });
      } catch { console.error('[whatsapp] upload failed'); return false; }
    },
  };
}

/** The reply as WhatsApp messages: the answer's text, the sources, the notes, then (separately) the Word file. */
export function replyTexts(result: Exclude<InboundResult, { kind: 'held' }>): string[] {
  if (result.kind === 'reply') return splitMessage(result.text);
  const notes = [...result.gaps, ...result.notes];
  const text = [whatsappText(result.answer),
    result.sources.length ? `*Sources*\n${result.sources.map((source, index) => `${index + 1}. ${source.title}: ${source.url}`).join('\n')}` : '',
    notes.length ? `*Notes*\n${notes.map(note => `• ${note}`).join('\n')}` : '',
    `_${result.agent.name}${result.place ? ` (${result.place})` : ''} · ${PRODUCT_NAME}${result.hidden ? ` · ${result.hidden} hidden from the AI` : ''}_`].filter(Boolean).join('\n\n');
  const chunks = splitMessage(text);
  return chunks.length <= MAX_TEXT_MESSAGES ? chunks : [...chunks.slice(0, MAX_TEXT_MESSAGES - 1), 'The answer continues in the Word file below.'];
}

const IMAGE_EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const IGNORED = new Set(['reaction', 'system', 'unsupported', 'ephemeral', 'request_welcome']);

async function runOne(item: Item, config: WhatsAppConfig, deps: InboundDeps): Promise<void> {
  const send = graph(config, deps.fetcher);
  if (item.rate === 'first') { await send.text(item.from, RATE_LIMIT_TEXT, item.id); return; }
  const type = str(item.message?.type, 40);
  if (IGNORED.has(type)) return;
  await send.read(item.id);
  let text = ''; const attachments: InboundAttachment[] = [];
  if (type === 'text') text = str(item.message.text?.body, 65_536);
  else if (type === 'document' || type === 'image') {
    const media = item.message[type] ?? {};
    text = str(media.caption, 4_096);
    try {
      const file = await downloadMedia(str(media.id, 300), config, deps.fetcher);
      const declared = str(media.mime_type, 200) || file.type;
      attachments.push({ name: type === 'document' ? (str(media.filename, 200).replace(/[\u0000-\u001f/\\]/g, '').trim() || 'document') : `photo.${IMAGE_EXTENSION[declared.split(';')[0]] ?? 'jpg'}`, type: declared, bytes: file.bytes });
    } catch (error) {
      console.error('[whatsapp] media failed', error instanceof Error ? error.message : 'error');
      await send.text(item.from, `The ${type === 'image' ? 'photo' : 'file'} could not be fetched from WhatsApp (it may be larger than ${MAX_MEDIA_BYTES / 1_000_000} MB). Please send it again.`, item.id);
      return;
    }
  } else { await send.text(item.from, 'Only text messages, documents (PDF, Word .docx, text, CSV) and photos are read. Write the task, or send the document with the task as its caption.', item.id); return; }
  let result: InboundResult;
  try { result = await handleInbound({ channel: 'whatsapp', from: item.from, text, attachments }, deps); }
  catch (error) { console.error('[whatsapp] run failed', error instanceof Error ? error.message : 'error'); result = { kind: 'reply', reason: 'failed', text: 'Your message could not be processed. Please send it again later.' }; }
  if (result.kind === 'held') return;
  const texts = replyTexts(result);
  for (let index = 0; index < texts.length; index++) await send.text(item.from, texts[index], index === 0 ? item.id : undefined);
  if (result.kind === 'answer') await send.document(item.from, result.word, result.wordName, `${result.agent.name}: the answer as a Word file`);
}

export function createWhatsAppHandler(deps: InboundDeps & { defer?(work: Promise<unknown>): void } = defaultInboundDeps) {
  return async (request: Request): Promise<Response> => {
    const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
    if (request.method === 'GET') {
      // Registering the webhook needs only the verify token, so it can be done before the rest is set.
      const verify = whatsappVerifyToken();
      if (!verify) return answer({ error: 'channel_not_configured' }, 503);
      const query = new URL(request.url).searchParams;
      const challenge = query.get('hub.challenge') ?? '';
      if (query.get('hub.mode') === 'subscribe' && sameSecret(query.get('hub.verify_token') ?? '', verify) && /^[A-Za-z0-9_-]{1,256}$/.test(challenge))
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      return answer({ error: 'forbidden' }, 403);
    }
    const config = whatsappConfig();
    if (!config) return answer({ error: 'channel_not_configured' }, 503);
    if (request.method !== 'POST') return answer({ error: 'method_not_allowed' }, 405);
    // The raw body, read once and bounded: the signature is over these exact bytes.
    let raw: Uint8Array;
    try { raw = await readBoundedBytes(request, MAX_WEBHOOK_BYTES); } catch { return answer({ error: 'request_too_large' }, 413); }
    if (!signatureOk(raw, request.headers.get('X-Hub-Signature-256'), config.appSecret)) { console.log('[whatsapp] refused: bad signature'); return answer({ error: 'invalid_signature' }, 401); }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return answer({ error: 'invalid_input' }, 400); }
    const accepted: Item[] = [];
    for (const item of messagesOf(payload, config)) {
      // An unknown number is acknowledged (Meta would redeliver otherwise) and nothing is done; the number is not logged.
      if (!config.numbers.has(item.from)) { console.log('[whatsapp] ignored: number not allowed'); continue; }
      if (!firstSight(`whatsapp:${item.id}`)) continue;
      const rate = rateCheck(`whatsapp:${item.from}`);
      if (rate !== 'limited') accepted.push({ ...item, rate });
    }
    if (accepted.length) {
      // One sender's messages in order (a document, then its task); different senders side by side.
      const bySender = new Map<string, Item[]>();
      for (const item of accepted) bySender.set(item.from, [...(bySender.get(item.from) ?? []), item]);
      (deps.defer ?? deferWork)(Promise.all([...bySender.values()].map(async items => { for (const item of items) await runOne(item, config, deps).catch(error => console.error('[whatsapp] message failed', error instanceof Error ? error.message : 'error')); })));
    }
    return answer({ ok: true });
  };
}

export const handleWhatsApp = createWhatsAppHandler();
