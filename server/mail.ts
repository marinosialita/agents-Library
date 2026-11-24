// One e-mail, opened for reading in the app's right panel (12 Nov 2026, his «press and open the emails in the right panel»).
//   GET /api/mail?service=gmail&id=… → { mail: { service, id, from, to, date, subject, body, link } }
// Read only, the signed-in person's own connected mail; the browser shows it as text, never as HTML.
import { readsMail, type ConnectorId } from '../shared/connections.ts';
import { actorOf, asUser, composioReady, liveComposioDeps, safeLogText, type ComposioDeps } from './connections.ts';
import { openInbox } from './connected-run.ts';
import { crossOrigin } from './same-origin.ts';

const BODY_CHARS = 100_000;
const HTML_CHARS = 1_500_000;

/** The message's HTML, without anything that runs, embeds or redirects. The browser shows it in a sandbox that allows no
 *  scripts, so this is the second lock, not the first. Pictures pasted into the message («cid:») cannot load and go. */
export function cleanMailHtml(html: string): string {
  if (!html || html.length > HTML_CHARS) return '';
  return html
    .replace(/<(script|iframe|object|embed|frameset|frame|applet|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:script|iframe|object|embed|frameset|frame|applet|base|form|input|button|textarea|select|link|meta)\b[^>]*>/gi, '')
    .replace(/\s(?:on[a-z]+|formaction|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|background)\s*=\s*(["']?)\s*(?:javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi, '$1="#"')
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']?cid:[^>]*>/gi, '');
}
const ID = /^[A-Za-z0-9_=+\/.-]{1,300}$/;

export function createMailHandler(deps: { composio: ComposioDeps; now(): number }) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
    if (crossOrigin(request)) return reply({ error: 'invalid_origin' }, 403);
    if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
    const params = new URL(request.url).searchParams;
    const service = params.get('service') as ConnectorId, id = params.get('id') ?? '';
    if (!service || !readsMail(service) || !ID.test(id)) return reply({ error: 'invalid_request' }, 400);
    const actor = await actorOf(request, deps.composio);
    if (!actor) return reply({ error: 'sign_in' }, 401);
    if (!composioReady(deps.composio)) return reply({ error: 'not_configured' }, 503);
    const opened = await openInbox(asUser(deps.composio, actor.user), { demo: false, services: [service], timeZone: 'UTC', now: deps.now(), signal: request.signal });
    if (!('inbox' in opened)) return reply({ error: opened.error }, opened.status);
    try {
      const mail = await opened.inbox.openMessage(service, id, request.signal, BODY_CHARS);
      if (!mail) return reply({ error: 'not_found' }, 404);
      return reply({ mail: { service, id, from: mail.from, to: mail.to, date: mail.date, subject: mail.subject, body: mail.body.replace(/\[cid:[^\]\s]+\]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), attachments: mail.attachments ?? [], html: cleanMailHtml(mail.html ?? ''), link: mail.link } });
    } catch (error) { console.log('[mail]', safeLogText(error)); return reply({ error: 'read_failed' }, 502); }
  };
}

export const handleMail = (request: Request) => mailHandler(request);
const mailHandler = createMailHandler({ composio: liveComposioDeps, now: Date.now });
