// POST /api/send-reply (11 Nov 2026, «approve and send»): the one place the app sends mail, and only like this —
//   { service: 'gmail' | 'outlook', messageId, body }  from a signed-in person (or the owner code), same site only.
// The reply goes to the SENDER of that message in the person's own mailbox, as a reply in its thread. The server reads
// the message itself to find the sender and the thread: the browser, the AI and the mail's own text cannot choose
// the recipient. Plain text only, at most 5,000 characters. Tool slugs from docs.composio.dev/toolkits/{gmail,outlook}.md
// (read 11 Nov 2026): GMAIL_REPLY_TO_THREAD (thread_id, recipient_email, message_body, is_html) and
// OUTLOOK_REPLY_EMAIL (message_id, comment, is_html).
import { isConnectorId } from '../shared/connections.ts';
import { actorOf, asUser, composioReady, executeTool, liveComposioDeps, safeLogText, type ComposioDeps } from './connections.ts';
import { messageOf, mailOf, fieldsOf } from './connected/inbox.ts';
import { JsonBodyError, readBoundedJson } from './read-bounded-json.ts';
import { crossOrigin } from './same-origin.ts';

export const REPLY_LIMIT = 5_000;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
/** The bare address in «Name <address>» or an address alone. */
export const addressOf = (from: string) => (/<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.exec(from.trim())?.[0] ?? '').toLowerCase();

/** A reply in the thread of one message in the person's own mailbox, to its sender (read here, never taken from the caller). */
export async function sendReplyAs(acting: ComposioDeps, service: 'gmail' | 'outlook', messageId: string, text: string, signal?: AbortSignal): Promise<{ to: string } | null> {
  if (service === 'gmail') {
    // The message itself, not its first list: an e-mail with attachments carries «attachmentList», which the generic
    // list reader took for the message (12 Nov 2026: «That e-mail is no longer in your mailbox» on a reply to Legal Advice CY).
    const original = messageOf(await executeTool(acting, 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', { message_id: messageId, format: 'full' }, signal));
    const thread = fieldsOf(original).get('threadid') ?? '';
    const to = addressOf(mailOf('gmail', original).from);
    if (!thread || !to) return null;
    await executeTool(acting, 'GMAIL_REPLY_TO_THREAD', { thread_id: thread, recipient_email: to, message_body: text, is_html: false, user_id: 'me' }, signal);
    return { to };
  }
  const original = messageOf(await executeTool(acting, 'OUTLOOK_GET_MESSAGE', { message_id: messageId }, signal));
  const to = addressOf(mailOf('outlook', original).from);
  if (!to) return null;
  await executeTool(acting, 'OUTLOOK_REPLY_EMAIL', { message_id: messageId, comment: text, is_html: false }, signal);
  return { to };
}

export function createSendReplyHandler(composio: ComposioDeps) {
  return async (request: Request): Promise<Response> => {
    if (crossOrigin(request)) return reply({ error: 'invalid_origin' }, 403);
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'invalid_content_type' }, 415);
    const actor = await actorOf(request, composio);
    if (!actor) return reply({ error: 'sign_in' }, 401);
    if (!composioReady(composio)) return reply({ error: 'not_configured' }, 503);
    let body: { service?: unknown; messageId?: unknown; body?: unknown };
    try { body = await readBoundedJson(request, 12_000) as typeof body; } catch (error) { return reply({ error: error instanceof JsonBodyError && error.status === 413 ? 'request_too_large' : 'invalid_input' }, 400); }
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!isConnectorId(body?.service) || (body.service !== 'gmail' && body.service !== 'outlook') || typeof body.messageId !== 'string' || !/^[A-Za-z0-9_=+/-]{1,400}$/.test(body.messageId)
      || !text || text.length > REPLY_LIMIT) return reply({ error: 'invalid_input' }, 400);
    const acting = asUser(composio, actor.user);
    try {
      const sent = await sendReplyAs(acting, body.service, body.messageId, text, request.signal);
      return sent ? reply({ ok: true, to: sent.to }) : reply({ error: 'message_not_found' }, 404);
    } catch (error) {
      console.log('[send-reply] failed:', safeLogText(error));
      return reply({ error: 'send_failed' }, 502);
    }
  };
}

export const handleSendReply = createSendReplyHandler(liveComposioDeps);
