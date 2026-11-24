// «Send work from anywhere» by e-mail (7 Nov 2026): Postmark's inbound webhook posts each message to
// /api/inbound-email as JSON (From/FromFull, To/ToFull, Subject, TextBody, StrippedTextReply, Headers, Attachments
// with base64 Content). The webhook URL carries HTTP Basic credentials (https://user:password@host/api/inbound-email),
// checked in constant time against INBOUND_EMAIL_USER / INBOUND_EMAIL_PASSWORD. Only the addresses in
// INBOUND_ALLOWED_SENDERS are served (none when it is empty); the answer goes only to that address — never to a
// Reply-To the message names — through Postmark's send API, as plain text and simple HTML with the sources listed and
// the Word copy attached, threaded by In-Reply-To/References. Without every value set the route answers 503.
// Postmark retries a webhook that does not answer 200 and stops on 403, so a refused sender gets 403 and accepted mail
// is answered at once, the agent running afterwards (server/inbound/core.ts deferWork). A serverless host keeps that
// work alive only up to the function's time limit and loses it on a crash: for reliable delivery, put the payload on a
// queue (Vercel Queues, QStash, SQS…) and run it from a worker. Duplicates (Postmark's MessageID) and the rate limit
// are remembered in this process only.
import { PRODUCT_NAME } from '../../shared/product.ts';
import { JsonBodyError, readBoundedJson } from '../read-bounded-json.ts';
import { agentFromAddress, defaultInboundDeps, deferWork, emailConfig, firstSight, handleInbound, hasPending, RATE_LIMIT_TEXT, rateCheck, sameSecret,
  type EmailConfig, type InboundAnswer, type InboundAttachment, type InboundDeps, type InboundReply } from './core.ts';

export const POSTMARK_SEND_URL = 'https://api.postmarkapp.com/email';
/** Postmark accepts inbound messages up to 35 MB; base64 makes the JSON a third larger. A Vercel function's request
 *  body is capped lower by the platform (4.5 MB), so large attachments need another host or a direct upload. */
const MAX_BODY_BYTES = 50_000_000;
const MAX_FILE_BYTES = 25_000_000;
const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Address = { Email?: unknown; Name?: unknown; MailboxHash?: unknown };
type Header = { Name?: unknown; Value?: unknown };
type Attachment = { Name?: unknown; Content?: unknown; ContentType?: unknown; ContentLength?: unknown; ContentID?: unknown };
/** The parts of Postmark's inbound JSON this route reads. Everything in it is untrusted. */
export type PostmarkInbound = { From?: unknown; FromFull?: Address; To?: unknown; ToFull?: Address[]; CcFull?: Address[]; OriginalRecipient?: unknown;
  Subject?: unknown; MessageID?: unknown; TextBody?: unknown; HtmlBody?: unknown; StrippedTextReply?: unknown; Headers?: Header[]; Attachments?: Attachment[] };

const str = (value: unknown, max = 1_000_000) => typeof value === 'string' ? value.slice(0, max) : '';
const list = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const ADDRESS = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;
const bare = (value: unknown) => { const text = str(value, 400).trim(); const inner = /<([^<>]+)>\s*$/.exec(text)?.[1] ?? text; const address = inner.trim().toLowerCase(); return ADDRESS.test(address) ? address : ''; };
const header = (mail: PostmarkInbound, name: string) => str(list<Header>(mail.Headers).find(item => str(item?.Name).toLowerCase() === name.toLowerCase())?.Value, 4_000);
/** A header value we send on: one line, no CR/LF (no header injection), bounded. */
const oneLine = (value: string, max = 900) => value.replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, max);

export function senderOf(mail: PostmarkInbound): string { return bare(mail.FromFull?.Email) || bare(mail.From); }
/** The address the message was sent to that names an agent, else the first one (core.ts reads the agent from it). */
export function recipientOf(mail: PostmarkInbound): string | undefined {
  const all = [bare(mail.OriginalRecipient), ...list<Address>(mail.ToFull).map(item => bare(item?.Email)), ...list<Address>(mail.CcFull).map(item => bare(item?.Email)), bare(mail.To)].filter(Boolean);
  return all.find(address => agentFromAddress(address)) ?? all[0];
}
/** Auto-replies, bounces and lists never get an answer: that is how two robots would mail each other forever. */
export function automatic(mail: PostmarkInbound, config: Pick<EmailConfig, 'from'>): boolean {
  const auto = header(mail, 'Auto-Submitted').toLowerCase();
  return (!!auto && auto !== 'no') || /^(bulk|junk|list|auto_reply)$/i.test(header(mail, 'Precedence').trim()) || !!header(mail, 'X-Autoreply') || !!header(mail, 'X-Autorespond')
    || !!header(mail, 'List-Id') || senderOf(mail) === bare(config.from) || /^(mailer-daemon|postmaster|no-?reply)@/.test(senderOf(mail));
}
/** A sender address that its own domain says it did not send (SPF «fail»): a forged From is not served. */
const spfFailed = (mail: PostmarkInbound) => /^\s*fail\b/i.test(header(mail, 'Received-SPF'));

export function basicAuthOk(value: string | null, config: Pick<EmailConfig, 'user' | 'password'>): boolean {
  const token = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(value ?? '')?.[1];
  const decoded = token ? Buffer.from(token, 'base64').toString('utf8') : '';
  const at = decoded.indexOf(':');
  const user = at >= 0 ? decoded.slice(0, at) : ''; const password = at >= 0 ? decoded.slice(at + 1) : '';
  // Both halves are always compared, so a wrong user and a wrong password take the same time.
  const userOk = sameSecret(user, config.user); const passwordOk = sameSecret(password, config.password);
  return userOk && passwordOk;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** An HTML-only message as text: line breaks kept, tags and styles gone. */
export function htmlText(html: string): string {
  return html.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => name[0] === '#' ? (() => { try { return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))); } catch { return ''; } })() : ENTITY[name.toLowerCase()] ?? whole)
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** The sender's text: the whole body (a forward carries its message there); only the new part of a reply to one of
 *  our questions, so the question quoted back is not read as the task. */
export function bodyOf(mail: PostmarkInbound, answeringQuestion: boolean): string {
  const stripped = str(mail.StrippedTextReply).trim();
  if (answeringQuestion && stripped) return stripped;
  return str(mail.TextBody).trim() || htmlText(str(mail.HtmlBody, 2_000_000)) || stripped;
}
/** The attachments as bytes. Small inline pictures (a signature's logo, referenced by Content-ID) are not the work. */
export function attachmentsOf(mail: PostmarkInbound): { files: InboundAttachment[]; skipped: string[] } {
  const files: InboundAttachment[] = []; const skipped: string[] = [];
  for (const item of list<Attachment>(mail.Attachments)) {
    const name = str(item?.Name, 200).replace(/[\u0000-\u001f]/g, '').trim() || 'attachment';
    const type = str(item?.ContentType, 200).toLowerCase();
    const content = str(item?.Content, MAX_BODY_BYTES);
    if (!content || !/^[A-Za-z0-9+/=\s]+$/.test(content)) { skipped.push(name); continue; }
    if (content.length * 0.75 > MAX_FILE_BYTES) { skipped.push(name); continue; }
    const bytes = new Uint8Array(Buffer.from(content, 'base64'));
    if (str(item?.ContentID) && type.startsWith('image/') && bytes.length < 30_000) continue;
    files.push({ name, type, bytes });
  }
  return { files, skipped };
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_whole, label: string, url: string) => {
      let host = ''; try { host = new URL(url.replace(/&amp;/g, '&')).hostname.replace(/^www\./, ''); } catch { return label; }
      // The address is shown beside every link: an answer is never a page of anonymous links.
      return `<a href="${url}">${label}</a> <span style="color:#6b6b80">(${escapeHtml(host)})</span>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
}
/** Simple HTML for the answer's Markdown: headings, lists, bold and links; tables as fixed-width text. */
export function simpleHtml(markdown: string): string {
  const out: string[] = []; let list: 'ul' | 'ol' | null = null; let table: string[] = [];
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } if (table.length) { out.push(`<pre style="font-family:Consolas,Menlo,monospace;font-size:13px;white-space:pre-wrap">${escapeHtml(table.join('\n'))}</pre>`); table = []; } };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(line)) { if (list) { out.push(`</${list}>`); list = null; } table.push(line); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line); const bullet = /^\s*[-*•]\s+(.*)$/.exec(line); const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'; if (table.length || list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inlineHtml((bullet ?? numbered)![1])}</li>`); continue;
    }
    close();
    if (heading) out.push(`<h${Math.min(4, heading[1].length + 1)} style="margin:18px 0 6px">${inlineHtml(heading[2].replace(/\s+#+\s*$/, ''))}</h${Math.min(4, heading[1].length + 1)}>`);
    else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) out.push('<hr>');
    else if (/^\s*>\s?/.test(line)) out.push(`<blockquote style="margin:0 0 0 12px;color:#444">${inlineHtml(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
    else if (line.trim()) out.push(`<p style="margin:0 0 10px">${inlineHtml(line)}</p>`);
  }
  close();
  return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1d2b">${out.join('\n')}</body></html>`;
}

/** The reply as Postmark's send API takes it. */
export function replyPayload(config: EmailConfig, mail: PostmarkInbound, to: string, result: InboundAnswer | InboundReply, skipped: string[]): Record<string, unknown> {
  const subject = oneLine(str(mail.Subject, 300)) || (result.kind === 'answer' ? result.agent.name : PRODUCT_NAME);
  const messageId = oneLine(header(mail, 'Message-ID'), 500);
  const references = oneLine(`${header(mail, 'References')} ${messageId}`, 1_900);
  const threading = /^<[^<>\s]+>$/.test(messageId) ? [{ Name: 'In-Reply-To', Value: messageId }, { Name: 'References', Value: references }] : [];
  const skippedNote = skipped.length ? [`Not read: ${skipped.join(', ')} (empty or too large).`] : [];
  const base = { From: config.from, To: to, Subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, MessageStream: config.stream, TrackOpens: false, TrackLinks: 'None',
    Headers: [...threading, { Name: 'Auto-Submitted', Value: 'auto-replied' }], ...(bare(mail.OriginalRecipient) ? { ReplyTo: bare(mail.OriginalRecipient) } : {}) };
  if (result.kind === 'reply') {
    const text = [result.text, ...skippedNote].join('\n\n');
    return { ...base, TextBody: text, HtmlBody: simpleHtml(text) };
  }
  const notes = [...result.gaps, ...result.notes, ...skippedNote];
  const footer = `Answered by the agent «${result.agent.name}» of ${PRODUCT_NAME}${result.place ? ` (${result.place})` : ''}.${result.hidden ? ` ${result.hidden} name${result.hidden === 1 ? ' or identifier was' : 's and identifiers were'} hidden from the AI and are shown again here.` : ''} The Word copy is attached. AI answers can be wrong: check them before relying on them.`;
  const markdown = [result.answer,
    result.sources.length ? `## Sources\n${result.sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join('\n')}` : '',
    notes.length ? `## Notes\n${notes.map(note => `- ${note}`).join('\n')}` : '', '---', footer].filter(Boolean).join('\n\n');
  const text = [result.answer,
    result.sources.length ? `Sources\n${result.sources.map((source, index) => `${index + 1}. ${source.title}: ${source.url}`).join('\n')}` : '',
    notes.length ? `Notes\n${notes.map(note => `- ${note}`).join('\n')}` : '', `--\n${footer}`].filter(Boolean).join('\n\n');
  return { ...base, TextBody: text, HtmlBody: simpleHtml(markdown),
    Attachments: [{ Name: result.wordName, Content: Buffer.from(result.word).toString('base64'), ContentType: WORD_TYPE }] };
}

async function send(config: EmailConfig, payload: Record<string, unknown>, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(POSTMARK_SEND_URL, { method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': config.token }, body: JSON.stringify(payload) });
    if (!response.ok) { const read = await response.json().catch(() => null) as { ErrorCode?: unknown } | null; console.error(`[inbound-email] reply refused ${response.status} code ${String(read?.ErrorCode ?? '?')}`); }
    return response.ok;
  } catch { console.error('[inbound-email] reply failed'); return false; }
}

export function createInboundEmailHandler(deps: InboundDeps & { defer?(work: Promise<unknown>): void } = defaultInboundDeps) {
  return async (request: Request): Promise<Response> => {
    const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', ...headers } });
    const config = emailConfig();
    if (!config) return answer({ error: 'channel_not_configured' }, 503);
    if (request.method !== 'POST') return answer({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    if (!basicAuthOk(request.headers.get('Authorization'), config)) return answer({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Basic realm="inbound-email", charset="UTF-8"' });
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return answer({ error: 'invalid_content_type' }, 415);
    let mail: PostmarkInbound;
    try {
      const value = await readBoundedJson(request, MAX_BODY_BYTES);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JsonBodyError(400);
      mail = value as PostmarkInbound;
    } catch (error) { return error instanceof JsonBodyError && error.status === 413 ? answer({ error: 'request_too_large' }, 413) : answer({ error: 'invalid_input' }, 400); }
    const sender = senderOf(mail);
    // 403: Postmark stops retrying. The address is not logged.
    if (!sender || !config.senders.has(sender)) { console.log('[inbound-email] refused: sender not allowed'); return answer({ error: 'sender_not_allowed' }, 403); }
    if (spfFailed(mail)) { console.log('[inbound-email] refused: SPF fail'); return answer({ error: 'sender_not_verified' }, 403); }
    if (automatic(mail, config)) return answer({ ok: true, ignored: 'automatic' });
    const id = oneLine(str(mail.MessageID, 300)) || oneLine(header(mail, 'Message-ID'), 300);
    if (id && !firstSight(`email:${id}`)) return answer({ ok: true, ignored: 'duplicate' });
    const rate = rateCheck(`email:${sender}`);
    if (rate === 'limited') return answer({ ok: true, ignored: 'rate_limited' });
    const work = (async () => {
      if (rate === 'first') { await send(config, replyPayload(config, mail, sender, { kind: 'reply', reason: 'limited', text: RATE_LIMIT_TEXT }, []), deps.fetcher); return; }
      const { files, skipped } = attachmentsOf(mail);
      let result;
      try {
        result = await handleInbound({ channel: 'email', from: sender, to: recipientOf(mail), subject: str(mail.Subject, 300), text: bodyOf(mail, hasPending('email', sender)), attachments: files }, deps);
      } catch (error) {
        console.error('[inbound-email] run failed', error instanceof Error ? error.message : 'error');
        result = { kind: 'reply', reason: 'failed', text: 'Your message could not be processed. Please send it again later.' } as InboundReply;
      }
      if (result.kind === 'held') return;
      await send(config, replyPayload(config, mail, sender, result, skipped), deps.fetcher);
    })();
    (deps.defer ?? deferWork)(work);
    return answer({ ok: true, accepted: true });
  };
}

export const handleInboundEmail = createInboundEmailHandler();
