// POST /api/app-action { action } (12 Nov 2026): carries out ONE action the person approved on its card — a calendar
// event or an e-mail (shared/app-actions.ts). Signed-in person (or the owner code), same site only, the action checked
// again here whatever the browser sent, acting only on the person's own connected account. Never called by an agent:
// the agents only propose. Composio tool inputs read live from its tool list on 12 Nov 2026:
// GOOGLECALENDAR_CREATE_EVENT (summary, start_datetime, timezone, event_duration_hour/_minutes, attendees…),
// GOOGLECALENDAR_PATCH_EVENT (calendar_id, event_id, reminders {useDefault, overrides[{method, minutes}]}),
// OUTLOOK_CALENDAR_CREATE_EVENT (subject, start_datetime, end_datetime, time_zone, attendees_info…),
// GMAIL_SEND_EMAIL (recipient_email, extra_recipients, cc, subject, body, is_html), OUTLOOK_SEND_EMAIL (to, cc_emails, subject, body).
import { eventEnd, readAction, type AppAction } from '../shared/app-actions.ts';
import { actorOf, asUser, composioReady, connectedAccounts, executeTool, liveComposioDeps, safeLogText, type ComposioDeps } from './connections.ts';
import { JsonBodyError, readBoundedJson } from './read-bounded-json.ts';
import { sendReplyAs } from './send-reply.ts';
import { crossOrigin } from './same-origin.ts';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
/** A field of a tool's reply, wherever Composio put it. */
const find = (value: unknown, key: string, depth = 0): unknown => {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const record = value as Record<string, unknown>;
  if (key in record && record[key] !== undefined && record[key] !== null && typeof record[key] !== 'object') return record[key];
  for (const child of Object.values(record)) { const found = find(child, key, depth + 1); if (found !== undefined) return found; }
  return undefined;
};

/** A cell as typed by a person, except what Sheets would turn into a formula or strip (13 Nov 2026, code review): a
 *  value starting with = + @ or a non-numeric «-» (text that came from mail could otherwise become a formula), or a
 *  leading zero (a phone number or an ID), is kept as text. Numbers and dates are still read as numbers and dates. */
export const sheetCell = (cell: string) => /^[=+@]/.test(cell) || /^-(?![\d.])/.test(cell) || /^0\d/.test(cell) ? `'${cell}` : cell;

export async function performAction(acting: ComposioDeps, action: AppAction, signal?: AbortSignal): Promise<{ link?: string; note?: string; to?: string }> {
  // 13 Nov 2026 (docs.composio.dev/toolkits/linkedin.md, googlesheets.md read that day): a post as the person, from
  // their own profile id; rows appended after the last row of the tab, as typed (USER_ENTERED, so numbers stay numbers).
  if (action.kind === 'post') {
    const me = await executeTool(acting, 'LINKEDIN_GET_MY_INFO', {}, signal);
    const id = String(find(me, 'id') ?? find(me, 'sub') ?? '').replace(/^urn:li:person:/, '');
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(id)) throw new Error('profile_not_found');
    const created = await executeTool(acting, 'LINKEDIN_CREATE_LINKED_IN_POST', { author: `urn:li:person:${id}`, commentary: action.text, visibility: action.visibility, lifecycleState: 'PUBLISHED' }, signal);
    const urn = String(find(created, 'id') ?? find(created, 'x-restli-id') ?? '');
    return urn.startsWith('urn:li:') ? { link: `https://www.linkedin.com/feed/update/${urn}/` } : {};
  }
  if (action.kind === 'rows') {
    await executeTool(acting, 'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', { spreadsheetId: action.spreadsheetId, range: `'${action.sheet.replace(/'/g, "''")}'!A1`, values: action.values.map(row => row.map(sheetCell)),
      valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', majorDimension: 'ROWS' }, signal);
    return { link: `https://docs.google.com/spreadsheets/d/${action.spreadsheetId}/edit` };
  }
  if (action.kind === 'reply') {
    const sent = await sendReplyAs(acting, action.service, action.messageId, action.body, signal);
    if (!sent) throw new Error('message_not_found');
    return { to: sent.to };
  }
  if (action.kind === 'email') {
    if (action.service === 'gmail') await executeTool(acting, 'GMAIL_SEND_EMAIL', { recipient_email: action.to[0], extra_recipients: action.to.slice(1), cc: action.cc, subject: action.subject, body: action.body, is_html: false, user_id: 'me' }, signal);
    else await executeTool(acting, 'OUTLOOK_SEND_EMAIL', { to: action.to.join(','), cc_emails: action.cc, subject: action.subject, body: action.body, is_html: false, user_id: 'me' }, signal);
    return {};
  }
  if (action.service === 'googlecalendar') {
    const created = await executeTool(acting, 'GOOGLECALENDAR_CREATE_EVENT', { calendar_id: 'primary', summary: action.title, start_datetime: `${action.start}:00`, timezone: action.timeZone,
      event_duration_hour: Math.floor(action.minutes / 60), event_duration_minutes: action.minutes % 60, attendees: action.attendees, create_meeting_room: false,
      send_updates: action.attendees.length ? 'all' : 'none', ...(action.location ? { location: action.location } : {}), ...(action.description ? { description: action.description } : {}) }, signal);
    const id = String(find(created, 'id') ?? ''); const link = String(find(created, 'htmlLink') ?? '');
    // The reminder the person asked for, on this event only.
    if (action.reminder !== null && id) {
      try { await executeTool(acting, 'GOOGLECALENDAR_PATCH_EVENT', { calendar_id: 'primary', event_id: id, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: action.reminder }] } }, signal); }
      catch (error) { console.log('[app-action] reminder:', safeLogText(error)); return { ...(link.startsWith('https://') ? { link } : {}), note: 'The event is in your calendar, but its reminder could not be set: it uses your calendar\'s usual reminder.' }; }
    }
    return link.startsWith('https://') ? { link } : {};
  }
  await executeTool(acting, 'OUTLOOK_CALENDAR_CREATE_EVENT', { subject: action.title, start_datetime: `${action.start}:00`, end_datetime: `${eventEnd(action.start, action.minutes)}:00`, time_zone: action.timeZone,
    attendees_info: action.attendees, ...(action.location ? { location: action.location } : {}), ...(action.description ? { body: action.description } : {}), user_id: 'me' }, signal);
  return action.reminder !== null ? { note: 'Outlook uses your calendar\'s usual reminder for it.' } : {};
}

export function createAppActionHandler(composio: ComposioDeps, perform = performAction) {
  return async (request: Request): Promise<Response> => {
    if (crossOrigin(request)) return reply({ error: 'invalid_origin' }, 403);
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'invalid_content_type' }, 415);
    const actor = await actorOf(request, composio);
    if (!actor) return reply({ error: 'sign_in' }, 401);
    if (!composioReady(composio)) return reply({ error: 'not_configured' }, 503);
    let body: { action?: unknown };
    try { body = await readBoundedJson(request, 1_000_000) as typeof body; } catch (error) { return reply({ error: error instanceof JsonBodyError && error.status === 413 ? 'request_too_large' : 'invalid_input' }, 400); }
    const action = readAction(body?.action);
    if (!action) return reply({ error: 'invalid_input' }, 400);
    const acting = asUser(composio, actor.user);
    try {
      const live = await connectedAccounts(acting, request.signal);
      if (!live.has(action.service)) return reply({ error: 'not_connected' }, 409);
      const done = await perform(acting, action, request.signal);
      console.log(`[app-action] ${action.kind} via ${action.service} done`);
      return reply({ ok: true, ...done });
    } catch (error) {
      const message = safeLogText(error);
      console.log('[app-action] failed:', message);
      // A connection made for reading only: the provider refuses the write (403) until the app is connected again.
      return reply({ error: /message_not_found/.test(message) ? 'message_not_found' : /40[13]/.test(message) ? 'needs_permission' : 'failed' }, /message_not_found/.test(message) ? 404 : 502);
    }
  };
}

export const handleAppAction = createAppActionHandler(liveComposioDeps);
