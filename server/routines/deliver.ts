// Sending a routine's brief (10 Nov 2026): by e-mail through Postmark and by WhatsApp through Meta's Cloud API, the same
// accounts the inbound channels use (docs/smart-features.md). A brief holds the owner's mail, so it goes ONLY to an
// address on INBOUND_ALLOWED_SENDERS or a number on WHATSAPP_ALLOWED_NUMBERS — the owner's own — never to an address
// typed on the page. WhatsApp delivers a message the business starts only within 24 hours of the owner's last message
// to the number (Meta's rule, error 131047); the run records that plainly, and e-mail always works.
import { briefBodyHtml, briefEmailHtml } from './brief-email.ts';
import { flatFields } from '../connected/updates.ts';
const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
import { PRODUCT_NAME } from '../../shared/product.ts';
import type { Delivery, Routine } from '../../shared/routines.ts';
import { allowedNumbers, allowedSenders } from '../inbound/core.ts';
import { POSTMARK_SEND_URL } from '../inbound/email.ts';
import { GRAPH_BASE, splitMessage, whatsappText } from '../inbound/whatsapp.ts';

export type DeliveryConfig = {
  email: { token: string; from: string; stream: string; allowed: Set<string> } | null;
  whatsapp: { token: string; phoneNumberId: string; version: string; allowed: Set<string> } | null;
  /** 11 Nov 2026: the owner's own Telegram bot (TELEGRAM_BOT_TOKEN) and the chats it may write to (TELEGRAM_ALLOWED_CHATS). */
  telegram?: { token: string; allowed: Set<string> } | null;
};
/** Slack and Teams go through the person's own connected account (Composio), to themself only. */
export type AppSender = (slug: string, args: Record<string, unknown>) => Promise<unknown>;
const env = (name: string) => (process.env[name] ?? '').trim();

export function deliveryConfig(): DeliveryConfig {
  const email = { token: env('POSTMARK_SERVER_TOKEN'), from: env('ROUTINES_FROM_ADDRESS') || env('INBOUND_FROM_ADDRESS'), stream: env('POSTMARK_MESSAGE_STREAM') || 'outbound', allowed: allowedSenders() };
  const version = env('WHATSAPP_GRAPH_VERSION');
  const whatsapp = { token: env('WHATSAPP_TOKEN'), phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'), version: /^v\d{1,3}\.\d$/.test(version) ? version : 'v24.0', allowed: allowedNumbers() };
  const telegram = { token: env('TELEGRAM_BOT_TOKEN'), allowed: new Set(env('TELEGRAM_ALLOWED_CHATS').split(/[\s,;]+/).filter(chat => /^-?\d{4,20}$/.test(chat))) };
  return { email: email.token && email.from && email.allowed.size ? email : null, whatsapp: whatsapp.token && /^\d{5,30}$/.test(whatsapp.phoneNumberId) && whatsapp.allowed.size ? whatsapp : null,
    telegram: /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(telegram.token) && telegram.allowed.size ? telegram : null };
}
/** What the page may offer: the allowed addresses and numbers of the channels that are set up. */
export const deliveryOptions = (config: DeliveryConfig) => ({ email: config.email ? [...config.email.allowed] : [], whatsapp: config.whatsapp ? [...config.whatsapp.allowed] : [], telegram: config.telegram ? [...config.telegram.allowed] : [] });

export const footerText = (routine: Pick<Routine, 'name'> & { agent?: Routine['agent'] }) => routine.agent ? `Written by your routine «${routine.name}» of ${PRODUCT_NAME}. It researched the official sources and links every page it used. AI can be wrong, so check the links before you rely on it.` : `Written by your routine «${routine.name}» of ${PRODUCT_NAME}. It only read your mail and calendar: nothing was sent, replied to or deleted. AI briefs can be wrong, so check before you rely on one.`;

export async function briefEmail(config: NonNullable<DeliveryConfig['email']>, routine: Pick<Routine, 'name' | 'timeZone'>, to: string, answer: string, at: number): Promise<Record<string, unknown>> {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: routine.timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  return { From: config.from, To: to, Subject: `${routine.name} · ${day}`, MessageStream: config.stream, TrackOpens: false, TrackLinks: 'None',
    Headers: [{ Name: 'Auto-Submitted', Value: 'auto-generated' }],
    TextBody: `${answer}\n\n--\n${footerText(routine)}`, HtmlBody: await briefEmailHtml({ routineName: routine.name, day, answer, footer: footerText(routine) }) };
}

export async function deliverBrief(config: DeliveryConfig, fetcher: typeof fetch, routine: Routine, answer: string, at: number, apps?: AppSender): Promise<Delivery[]> {
  const out: Delivery[] = [];
  const { email, whatsapp } = routine.deliver;
  if (email) {
    if (!config.email) out.push({ channel: 'email', to: email, ok: false, error: 'email_not_set_up' });
    else if (!config.email.allowed.has(email)) out.push({ channel: 'email', to: email, ok: false, error: 'not_allowed' });
    else {
      try {
        const response = await fetcher(POSTMARK_SEND_URL, { method: 'POST', signal: AbortSignal.timeout(30_000),
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': config.email.token }, body: JSON.stringify(await briefEmail(config.email, routine, email, answer, at)) });
        out.push(response.ok ? { channel: 'email', to: email, ok: true } : { channel: 'email', to: email, ok: false, error: `email_refused_${response.status}` });
      } catch { out.push({ channel: 'email', to: email, ok: false, error: 'email_failed' }); }
    }
  }
  if (whatsapp) {
    if (!config.whatsapp) out.push({ channel: 'whatsapp', to: whatsapp, ok: false, error: 'whatsapp_not_set_up' });
    else if (!config.whatsapp.allowed.has(whatsapp)) out.push({ channel: 'whatsapp', to: whatsapp, ok: false, error: 'not_allowed' });
    else {
      const base = `${GRAPH_BASE}/${config.whatsapp.version}/${config.whatsapp.phoneNumberId}/messages`;
      let result: Delivery = { channel: 'whatsapp', to: whatsapp, ok: true };
      for (const body of splitMessage(whatsappText(`${answer}\n\n_${footerText(routine)}_`))) {
        try {
          const response = await fetcher(base, { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: whatsapp, type: 'text', text: { preview_url: false, body } }) });
          if (!response.ok) {
            const read = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
            result = { channel: 'whatsapp', to: whatsapp, ok: false, error: read?.error?.code === 131047 ? 'whatsapp_24h' : `whatsapp_refused_${response.status}` };
            break;
          }
        } catch { result = { channel: 'whatsapp', to: whatsapp, ok: false, error: 'whatsapp_failed' }; break; }
      }
      out.push(result);
    }
  }
  const text = `${answer}\n\n— ${footerText(routine)}`;
  // Slack (11 Nov 2026): a DM to the connected person themself — who they are (SLACK_TEST_AUTH), their DM channel
  // (SLACK_OPEN_DM), then SLACK_SEND_MESSAGE (docs.composio.dev/toolkits/slack.md, read 11 Nov 2026). Not run live yet.
  if (routine.deliver.slack) {
    if (!apps) out.push({ channel: 'slack', to: 'you', ok: false, error: 'slack_not_connected' });
    else try {
      const me = flatFields(await apps('SLACK_TEST_AUTH', {})).get('user_id');
      const dm = me ? flatFields(await apps('SLACK_OPEN_DM', { users: me, return_im: true })).get('id') : undefined;
      if (!dm) out.push({ channel: 'slack', to: 'you', ok: false, error: 'slack_no_dm' });
      else { await apps('SLACK_SEND_MESSAGE', { channel: dm, markdown_text: text.slice(0, 35_000) }); out.push({ channel: 'slack', to: 'you', ok: true }); }
    } catch { out.push({ channel: 'slack', to: 'you', ok: false, error: 'slack_failed' }); }
  }
  // Teams: the person's own self-chat (MICROSOFT_TEAMS_SEND_MESSAGE_TO_SELF), in our escaped HTML.
  if (routine.deliver.teams) {
    if (!apps) out.push({ channel: 'teams', to: 'you', ok: false, error: 'teams_not_connected' });
    else try { await apps('MICROSOFT_TEAMS_SEND_MESSAGE_TO_SELF', { content: `${briefBodyHtml(answer)}<p><em>${escapeText(footerText(routine))}</em></p>`, content_type: 'html' }); out.push({ channel: 'teams', to: 'you', ok: true }); }
    catch { out.push({ channel: 'teams', to: 'you', ok: false, error: 'teams_failed' }); }
  }
  // Telegram: the owner's own bot, plain text (no parse mode: nothing to escape), only to an allowed chat.
  const chat = routine.deliver.telegram;
  if (chat) {
    if (!config.telegram) out.push({ channel: 'telegram', to: chat, ok: false, error: 'telegram_not_set_up' });
    else if (!config.telegram.allowed.has(chat)) out.push({ channel: 'telegram', to: chat, ok: false, error: 'not_allowed' });
    else {
      let result: Delivery = { channel: 'telegram', to: chat, ok: true };
      for (let start = 0; start < text.length; start += 4000) {
        try {
          const response = await fetcher(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chat, text: text.slice(start, start + 4000), disable_web_page_preview: true }) });
          if (!response.ok) { result = { channel: 'telegram', to: chat, ok: false, error: response.status === 403 ? 'telegram_blocked' : `telegram_refused_${response.status}` }; break; }
        } catch { result = { channel: 'telegram', to: chat, ok: false, error: 'telegram_failed' }; break; }
      }
      out.push(result);
    }
  }
  return out;
}
