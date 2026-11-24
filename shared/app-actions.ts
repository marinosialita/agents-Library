// Doing things in the person's own apps (12 Nov 2026, his «can the agent go into my calendar and add meetings, or send
// e-mails from here?»). An agent never acts by itself: it PROPOSES an action (a calendar event, an e-mail), the chat
// shows it as a card with every detail, and only the person's own press of «Add to calendar» or «Send» carries it out
// (server/app-action.ts). The agents read mail written by other people, and a message can carry text aimed at an AI;
// with a person's click on each action, no message can make an agent send mail or change the calendar.
import type { ConnectorId } from './connections.ts';

export type EventAction = { kind: 'event'; service: 'googlecalendar' | 'outlook'; title: string;
  /** Local start, «YYYY-MM-DDTHH:MM», in `timeZone`. */ start: string; minutes: number; timeZone: string;
  location?: string; description?: string; attendees: string[];
  /** A pop-up reminder this many minutes before (Google Calendar), or null for the calendar's own default. */ reminder: number | null };
export type EmailAction = { kind: 'email'; service: 'gmail' | 'outlook'; to: string[]; cc: string[]; subject: string; body: string };
/** A reply in the thread of one message the agent read. The server reads that message itself to find its sender and
 *  thread, so neither the AI nor the browser can choose where it goes; `to` and `subject` are for the card only. */
export type ReplyAction = { kind: 'reply'; service: 'gmail' | 'outlook'; messageId: string; to: string; subject: string; body: string };
/** 13 Nov 2026: a LinkedIn post as the person approved it, posted as them. */
export type PostAction = { kind: 'post'; service: 'linkedin'; text: string; visibility: 'PUBLIC' | 'CONNECTIONS' };
/** 13 Nov 2026: rows added to the end of one tab of a Google Sheet the agent read. */
export type RowsAction = { kind: 'rows'; service: 'googlesheets'; spreadsheetId: string; sheet: string; title: string; values: string[][] };
export type AppAction = EventAction | EmailAction | ReplyAction | PostAction | RowsAction;

export const ROW_LIMITS = { rows: 50, columns: 26, cell: 500 } as const;
export const ACTION_LIMITS = { perAnswer: 3, post: 3_000, recipients: 10, title: 200, subject: 300, body: 10_000, description: 4_000, location: 300, minutes: 24 * 60 } as const;
const EMAIL = /^[^\s@<>(),;:"[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
export const isAddress = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && EMAIL.test(value.trim());
const zone = (value: unknown): value is string => { if (typeof value !== 'string' || !value || value.length > 64) return false; try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; } catch { return false; } };
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '';
const addresses = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).filter(isAddress).map(address => address.trim().toLowerCase()))];

/** An action as the app accepts it — from the AI, the browser or the route — or null. Nothing invalid gets through. */
export function readAction(value: unknown): AppAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'event') {
    const service = raw.service === 'googlecalendar' || raw.service === 'outlook' ? raw.service : null;
    const start = typeof raw.start === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/.test(raw.start) ? raw.start : '';
    const minutes = Number.isInteger(raw.minutes) && (raw.minutes as number) >= 5 && (raw.minutes as number) <= ACTION_LIMITS.minutes ? raw.minutes as number : 0;
    const reminder = raw.reminder === null || raw.reminder === undefined ? null : Number.isInteger(raw.reminder) && (raw.reminder as number) >= 0 && (raw.reminder as number) <= 40_320 ? raw.reminder as number : null;
    const title = text(raw.title, ACTION_LIMITS.title); const attendees = addresses(raw.attendees);
    if (!service || !start || !minutes || !title || !zone(raw.timeZone) || attendees.length > ACTION_LIMITS.recipients) return null;
    const location = text(raw.location, ACTION_LIMITS.location), description = text(raw.description, ACTION_LIMITS.description);
    return { kind: 'event', service, title, start, minutes, timeZone: raw.timeZone as string, ...(location ? { location } : {}), ...(description ? { description } : {}), attendees, reminder };
  }
  if (raw.kind === 'reply') {
    const service = raw.service === 'gmail' || raw.service === 'outlook' ? raw.service : null;
    const messageId = typeof raw.messageId === 'string' && /^[A-Za-z0-9_=+/-]{1,400}$/.test(raw.messageId) ? raw.messageId : '';
    const body = text(raw.body, ACTION_LIMITS.body);
    if (!service || !messageId || !body) return null;
    return { kind: 'reply', service, messageId, to: text(raw.to, 300), subject: text(raw.subject, ACTION_LIMITS.subject), body };
  }
  if (raw.kind === 'post') {
    // A post longer than LinkedIn allows is refused, never cut short.
    const body = typeof raw.text === 'string' && raw.text.length <= ACTION_LIMITS.post ? text(raw.text, ACTION_LIMITS.post) : '';
    if (raw.service !== 'linkedin' || !body) return null;
    return { kind: 'post', service: 'linkedin', text: body, visibility: raw.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC' };
  }
  if (raw.kind === 'rows') {
    const spreadsheetId = typeof raw.spreadsheetId === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(raw.spreadsheetId) ? raw.spreadsheetId : '';
    const sheet = text(raw.sheet, 100); const title = text(raw.title, 200) || 'Google Sheet';
    const values = Array.isArray(raw.values) ? raw.values.slice(0, ROW_LIMITS.rows + 1).map(row => Array.isArray(row) ? row.slice(0, ROW_LIMITS.columns).map(cell => typeof cell === 'string' || typeof cell === 'number' ? String(cell).slice(0, ROW_LIMITS.cell) : '') : null) : [];
    if (raw.service !== 'googlesheets' || !spreadsheetId || !sheet || !values.length || values.length > ROW_LIMITS.rows || values.some(row => !row || !row.some(Boolean)) || /[\[\]*?:\/\\]/.test(sheet)) return null;
    return { kind: 'rows', service: 'googlesheets', spreadsheetId, sheet, title, values: values as string[][] };
  }
  if (raw.kind === 'email') {
    const service = raw.service === 'gmail' || raw.service === 'outlook' ? raw.service : null;
    const to = addresses(raw.to), cc = addresses(raw.cc).filter(address => !to.includes(address));
    const subject = text(raw.subject, ACTION_LIMITS.subject), body = text(raw.body, ACTION_LIMITS.body);
    if (!service || !to.length || to.length + cc.length > ACTION_LIMITS.recipients || !subject || !body) return null;
    return { kind: 'email', service, to, cc, subject, body };
  }
  return null;
}

/** The end of an event, as a local «YYYY-MM-DDTHH:MM» (the start plus its minutes, by the calendar, not by a clock). */
export function eventEnd(start: string, minutes: number): string {
  const [date, time] = start.split('T'); const [y, m, d] = date.split('-').map(Number); const [h, min] = time.split(':').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d, h, min + minutes));
  return end.toISOString().slice(0, 16);
}

/** Addresses in an action that the person never typed in this conversation: the card points them out. */
export const unseenAddresses = (action: AppAction, typed: string) => {
  const said = typed.toLowerCase();
  // A reply goes to the sender of the message it answers, found by the server: nothing to point out.
  if (action.kind === 'reply' || action.kind === 'post' || action.kind === 'rows') return [];
  return (action.kind === 'email' ? [...action.to, ...action.cc] : action.attendees).filter(address => !said.includes(address.toLowerCase()));
};

/** The service an action needs, by the connector ids the person connected. */
export const actionService = (action: AppAction): ConnectorId => action.service;
