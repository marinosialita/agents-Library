// «Routines» (10 Nov 2026, pass 2 of his «… give me a brief every morning»): a brief that runs on its own, on the days
// and at the time the owner chooses, in their time zone, and is sent to them. This file is the model and the schedule
// maths, shared by the page and the server; no library: the time zone's offset is read from Intl, so summer time is
// right (Europe/Nicosia moves on the last Sundays of March and October).
import { PUBLISHER_FEEDS } from './publishers.ts';
import type { MailLink } from './mail-refs.ts';
import { isBriefId, type BriefId } from './briefs.ts';
import { isConnectorId, type ConnectorId } from './connections.ts';
import { isOutputLanguage, type OutputLanguage } from './product.ts';

/** 0 = Sunday … 6 = Saturday, as Date.getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RoutineSource = 'demo' | 'mine';
export type Routine = {
  id: string; name: string; brief: BriefId; source: RoutineSource; services?: ConnectorId[];
  days: Weekday[]; time: string; timeZone: string;
  /** 11 Nov 2026 (his «every 6 hours», «every hour»): repeat every N hours from `time` through the day, on the days chosen. */
  everyHours?: EveryHours;
  /** Where the brief goes besides the app: one allowed e-mail address and one allowed WhatsApp number, or none. */
  deliver: { email: string | null; whatsapp: string | null; /** 11 Nov 2026: a DM to yourself in Slack, a chat to yourself in Teams, an allowed Telegram chat. */ slack?: boolean; teams?: boolean; telegram?: string | null };
  namesHidden: boolean; language: OutputLanguage; enabled: boolean; createdAt: number; updatedAt: number;
  /** The last slot (epoch ms) that was run, so a slot runs once however often the clock ticks. */
  lastSlot?: number;
  /** Whose apps it reads (11 Nov 2026, accounts): the Composio user; absent = the owner («agents-owner»). */
  owner?: string;
  /** 11 Nov 2026: run when an email arrives that matches the plain-words filter, instead of on the schedule. */
  trigger?: RoutineTrigger;
  /** For a mail trigger: the newest message time already looked at (epoch ms). */
  lastSeen?: number;
  /** For a feed trigger: the items already seen (their links or ids), and a plain page's text at the last check. */
  seen?: string[]; pageText?: string;
  /** For a hook trigger: the secret in its private link (made by the server, shown only to the owner). */
  hookKey?: string;
  /** 11 Nov 2026 (his «describe it and it prepares it»): a research agent the routine runs instead of a brief, with
   *  the question it is asked each time. Carried whole, as agents live in the browser and the server runs the routine. */
  agent?: RoutineAgent;
  /** 12 Nov 2026 (CrewAI's @human_feedback, ported): «Ask me before sending». A run that would be sent waits in the app
   *  for Send it / Change / Don't send; a change redoes it with the person's words and it waits again. */
  approve?: boolean;
  /** 13 Nov 2026 (the 08:00 BBC run started the minute the Mac woke, before its Wi-Fi was back): a scheduled run that
   *  did not finish for a reason that may pass by itself tries again later: when, and which try that will be (2, 3). */
  retry?: { at: number; attempt: number };
};
/** How long after a scheduled run that did not finish the next try comes: 5 minutes, then 15. */
export const RETRY_AFTER_MS = [5 * 60_000, 15 * 60_000] as const;
/** Failures that may pass by themselves (the internet, a website, an app, the AI), not a missing key or setup. */
export const PASSING_ERRORS: readonly string[] = ['sources_unreadable', 'connections_failed', 'timeout', 'agent_failed'];
/** Where a waiting run stands: waiting for the person, sent after their OK, or not sent. `feedback` is every change
 *  they asked for, oldest first (CrewAI's human_feedback_history). */
export type RunApproval = { state: 'waiting' | 'sent' | 'rejected'; at?: number; feedback?: string[] };
export const APPROVAL_FEEDBACK_MAX = 2_000;
/** A routine that sends its brief somewhere besides the app. */
export const deliversSomewhere = (routine: Pick<Routine, 'deliver'>) => !!(routine.deliver.email || routine.deliver.whatsapp || routine.deliver.slack || routine.deliver.teams || routine.deliver.telegram);
export type RoutineAgent = { name: string; instructions: string; question: string; jurisdiction: string; officialSearch: boolean; mode: 'fast' | 'deep';
  /** 11 Nov 2026: websites the person chose for this agent to search too (newspapers, a forum), by domain. Never the open web. */
  sites?: string[];
  /** Only tell me when something is new: a run that finds nothing new is kept quietly and sends nothing. */
  quiet?: boolean };
export const ROUTINE_AGENT_LIMITS = { name: 120, instructions: 20_000, question: 2_000, sites: 12 } as const;
export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12] as const;
export type EveryHours = typeof EVERY_HOURS[number];
/** A website as the agent's search takes it: a bare domain, lower case (no scheme, path, port or address). */
export function siteDomain(value: string): string | null {
  const text = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return /^(?=.{4,100}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/.test(text) && !/^(localhost|.*\.local|.*\.internal)$/.test(text) && !PUBLIC_SUFFIX.test(text) ? text : null;
}
/** A bare domain ending is not a website (13 Nov 2026, code review: «co.uk» or «com.cy» would let the search reach
 *  every site under it, close to the open web). */
const PUBLIC_SUFFIX = /^(?:co|com|org|net|gov|ac|edu|ltd|plc|nhs|police|sch|mil|int|info|biz|nom|or|ne|go|gob|gouv|govt|gv)\.[a-z]{2}$|^(?:blogspot|github|gitlab|herokuapp|vercel|netlify|wordpress|substack|medium|tumblr|appspot|web|pages)\.(?:com|io|app|dev|org)$/;
/** 13 Nov 2026 (the n8n / Make study): besides a new e-mail, a research agent can start when a public feed or page
 *  publishes something new («feed», checked every 15 minutes) or when another app calls its private link («hook»). */
export type RoutineTrigger = { kind: 'mail'; filter: string } | { kind: 'feed'; url: string } | { kind: 'hook' };
/** How often a feed or page trigger looks for something new. */
export const FEED_EVERY_MS = 15 * 60_000;
export const FEED_LIMITS = { url: 500, seen: 300, pageText: 6_000, items: 8, hookBody: 20_000 } as const;
/** How often a mail trigger looks for new mail. */
export const EVENT_EVERY_MS = 5 * 60_000;
export type RoutineRunStatus = 'done' | 'failed';
export type Delivery = { channel: 'email' | 'whatsapp' | 'slack' | 'teams' | 'telegram'; to: string; ok: boolean; error?: string };
export type RoutineRun = {
  id: string; routineId: string; routineName: string; trigger: 'schedule' | 'now' | 'event'; startedAt: number; finishedAt: number;
  status: RoutineRunStatus; error?: string; steps: string[]; answer: string;
  read?: { mail: number; opened: number; events: number }; flagged?: number; hidden?: number; gaps?: string[];
  delivered: Delivery[]; demo: boolean;
  /** «Only when new»: this run found nothing new, so it sent nothing. */
  quiet?: boolean;
  /** An agent routine's cited official pages (for the pills and «Cited N sources»). */
  sources?: { title: string; url: string; site: string }[];
  /** Whose routine it was (the Composio user); absent = the owner. */
  owner?: string;
  /** Replies the agent proposed, for the owner to read, edit and send (11 Nov 2026). */
  drafts?: { service: ConnectorId; messageId: string; to: string; subject: string; body: string }[];
  /** Brief lines about one e-mail, with that e-mail, so «Today» can open it (12 Nov 2026). */
  mails?: MailLink[];
  /** «Ask me before sending» (12 Nov 2026): this run waits for the person's OK, or was sent or stopped by them. */
  approval?: RunApproval;
  /** What started an «event» run: a new e-mail (absent), something new on a feed or page, or a call to the hook. */
  cause?: 'feed' | 'hook';
  /** 13 Nov 2026 (code review): the feed items or the hook's data that started a run waiting for an OK, so «Change»
   *  redoes it on the same data; dropped once it is sent or stopped. */
  input?: string;
  /** 13 Nov 2026: when this scheduled run, which did not finish, is tried again. */
  retryAt?: number;
  /** Which try of its time this run was (2, 3), when the first one did not finish. */
  attempt?: number;
};

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
export const DAY_SHORT: Record<Weekday, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5];
/** A scheduled slot still runs this long after its time (the Mac woke late, the clock ticked late); later, it is skipped. */
export const GRACE_MS = 90 * 60_000;
export const ROUTINE_LIMIT = 20;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validTimeZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; } catch { return false; }
};

/** The wall clock of an instant in a time zone. */
function wall(at: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: Weekday } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const weekday = (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))) as Weekday;
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), hour: Number(get('hour')) % 24, minute: Number(get('minute')), weekday };
}
/** The instant a wall-clock time happens in a time zone (a time that does not exist in a spring-forward gap moves on). */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (at: number) => { const w = wall(at, timeZone); return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(at / 60_000) * 60_000; };
  let at = asUtc - offsetAt(asUtc);
  const again = asUtc - offsetAt(at);
  if (again !== at) at = again;
  return at;
}

/** The routine's slot on the local day `offsetDays` from the day of `at`, or null when the routine skips that weekday. */
function slotOn(routine: Pick<Routine, 'days' | 'time' | 'timeZone'>, at: number, offsetDays: number): number | null {
  const match = TIME.exec(routine.time); if (!match) return null;
  const today = wall(at, routine.timeZone);
  // Noon UTC of the local date, moved by whole days, names the date without summer-time surprises.
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day, 12) + offsetDays * 86_400_000);
  const weekday = date.getUTCDay() as Weekday;
  if (!routine.days.includes(weekday)) return null;
  return zonedInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), Number(match[1]), Number(match[2]), routine.timeZone);
}
type Timing = Pick<Routine, 'days' | 'time' | 'timeZone' | 'everyHours'>;
/** A day's slots: the time, then every N hours after it until the day ends. */
function slotsOn(routine: Timing, at: number, offsetDays: number): number[] {
  const first = slotOn(routine, at, offsetDays); if (first === null) return [];
  if (!routine.everyHours) return [first];
  const hour = Number(routine.time.slice(0, 2)); const out: number[] = [];
  for (let k = 0; hour + k * routine.everyHours < 24; k++) out.push(first + k * routine.everyHours * 3_600_000);
  return out;
}
/** The first slot after `after`. */
export function nextSlot(routine: Timing, after: number): number | null {
  for (let offset = 0; offset <= 8; offset++) { const slot = slotsOn(routine, after, offset).find(item => item > after); if (slot !== undefined) return slot; }
  return null;
}
/** The latest slot at or before `now`. */
export function previousSlot(routine: Timing, now: number): number | null {
  for (let offset = 0; offset >= -8; offset--) { const slot = slotsOn(routine, now, offset).filter(item => item <= now).at(-1); if (slot !== undefined) return slot; }
  return null;
}
/** The slot to run now, if any: switched on, its time has come, within the grace, not run yet, not before the routine existed. */
export function dueSlot(routine: Routine, now: number): number | null {
  if (!routine.enabled || routine.trigger) return null;
  const slot = previousSlot(routine, now);
  // An hourly routine's slot is late after half its interval, so a late tick never runs two in a row.
  const grace = routine.everyHours ? Math.min(GRACE_MS, routine.everyHours * 1_800_000) : GRACE_MS;
  if (slot === null || now - slot > grace || slot <= (routine.lastSlot ?? 0) || slot < routine.createdAt) return null;
  return slot;
}

/** «Weekdays at 07:00», «Every day at 18:30», «Mon, Wed at 09:00». */
export function scheduleLabel(routine: Pick<Routine, 'days' | 'time'> & { trigger?: RoutineTrigger; everyHours?: EveryHours }): string {
  if (routine.trigger?.kind === 'mail') return routine.trigger.filter.trim() ? `When an email arrives: ${routine.trigger.filter.trim()}` : 'When any email arrives';
  if (routine.trigger?.kind === 'feed') return `When ${feedHost(routine.trigger.url)} publishes something new`;
  if (routine.trigger?.kind === 'hook') return 'When another app calls its link';
  const days = [...new Set(routine.days)].sort();
  const set = days.join(',');
  const which = set === '0,1,2,3,4,5,6' ? 'Every day' : set === '1,2,3,4,5' ? 'Weekdays' : set === '0,6' ? 'Weekends' : WEEKDAYS.filter(day => days.includes(day)).map(day => DAY_SHORT[day]).join(', ');
  if (routine.everyHours) return `${routine.everyHours === 1 ? 'Every hour' : `Every ${routine.everyHours} hours`}${routine.time === '00:00' ? '' : ` from ${routine.time}`}${which === 'Every day' ? '' : `, ${which === 'Weekdays' || which === 'Weekends' ? which.toLowerCase() : which}`}`;
  return `${which} at ${routine.time}`;
}

export type RoutineInput = Omit<Routine, 'id' | 'createdAt' | 'updatedAt' | 'lastSlot' | 'lastSeen' | 'retry'> & { id?: string };
/** A routine as the page sends it, checked field by field; throws on anything else. */
export function readRoutineInput(value: unknown): RoutineInput {
  const body = value as Record<string, any> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const days = Array.isArray(body.days) ? [...new Set(body.days)] : [];
  const deliver = body.deliver && typeof body.deliver === 'object' ? body.deliver : {};
  const email = deliver.email === null || deliver.email === undefined || deliver.email === '' ? null : typeof deliver.email === 'string' && /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(deliver.email.trim()) ? deliver.email.trim().toLowerCase() : undefined;
  const whatsapp = deliver.whatsapp === null || deliver.whatsapp === undefined || deliver.whatsapp === '' ? null : typeof deliver.whatsapp === 'string' && /^\d{7,15}$/.test(deliver.whatsapp.replace(/\D/g, '')) ? deliver.whatsapp.replace(/\D/g, '') : undefined;
  if (!name || name.length > 80 || !isBriefId(body.brief) || (body.source !== 'demo' && body.source !== 'mine') || !days.length || !days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    || typeof body.time !== 'string' || !TIME.test(body.time) || !validTimeZone(body.timeZone) || email === undefined || whatsapp === undefined
    || typeof body.namesHidden !== 'boolean' || !isOutputLanguage(body.language) || typeof body.enabled !== 'boolean'
    || (body.services !== undefined && (!Array.isArray(body.services) || !body.services.every(isConnectorId)))
    || (body.id !== undefined && (typeof body.id !== 'string' || !/^rt-[a-z0-9-]{4,60}$/.test(body.id)))) throw new Error('invalid');
  // A mail trigger reads the person's own new mail, so it never runs on the demo inbox.
  const raw = body.trigger;
  const trigger: RoutineTrigger | null | undefined = raw === undefined || raw === null ? undefined
    : raw?.kind === 'mail' && typeof raw.filter === 'string' && raw.filter.length <= 300 && body.source === 'mine' ? { kind: 'mail', filter: raw.filter.trim().replace(/\s+/g, ' ') }
    : raw?.kind === 'feed' && typeof raw.url === 'string' && raw.url.length <= FEED_LIMITS.url && feedUrl(raw.url) ? { kind: 'feed', url: feedUrl(raw.url)! }
    : raw?.kind === 'hook' ? { kind: 'hook' } : null;
  if (trigger === null) throw new Error('invalid');
  const agentIn = body.agent;
  const agent = agentIn === undefined || agentIn === null ? undefined
    : agentIn && typeof agentIn === 'object' && typeof agentIn.name === 'string' && agentIn.name.trim() && agentIn.name.length <= ROUTINE_AGENT_LIMITS.name
      && typeof agentIn.instructions === 'string' && agentIn.instructions.trim() && agentIn.instructions.length <= ROUTINE_AGENT_LIMITS.instructions
      && typeof agentIn.question === 'string' && agentIn.question.trim() && agentIn.question.length <= ROUTINE_AGENT_LIMITS.question
      && typeof agentIn.jurisdiction === 'string' && /^[a-z0-9-]{0,12}$/.test(agentIn.jurisdiction) && typeof agentIn.officialSearch === 'boolean' && (agentIn.mode === 'fast' || agentIn.mode === 'deep')
      && (agentIn.sites === undefined || (Array.isArray(agentIn.sites) && agentIn.sites.length <= ROUTINE_AGENT_LIMITS.sites && agentIn.sites.every((site: unknown) => typeof site === 'string' && siteDomain(site))))
      && (agentIn.quiet === undefined || typeof agentIn.quiet === 'boolean')
      ? { name: agentIn.name.trim(), instructions: agentIn.instructions.trim(), question: agentIn.question.trim(), jurisdiction: agentIn.jurisdiction, officialSearch: agentIn.officialSearch, mode: agentIn.mode as 'fast' | 'deep',
        ...(agentIn.sites?.length ? { sites: [...new Set((agentIn.sites as string[]).map(site => siteDomain(site)!))] } : {}), ...(agentIn.quiet ? { quiet: true } : {}) } : null;
  // A research agent starts on a schedule, a feed or a hook; an inbox brief on a schedule or a new e-mail.
  if (agent === null || (agent && trigger?.kind === 'mail') || (!agent && trigger && trigger.kind !== 'mail')) throw new Error('invalid');
  const everyHours = body.everyHours === undefined || body.everyHours === null ? undefined : (EVERY_HOURS as readonly number[]).includes(body.everyHours) ? body.everyHours as EveryHours : null;
  if (everyHours === null || (everyHours && trigger)) throw new Error('invalid');
  const telegram = deliver.telegram === null || deliver.telegram === undefined || deliver.telegram === '' ? null : typeof deliver.telegram === 'string' && /^-?\d{4,20}$/.test(deliver.telegram.trim()) ? deliver.telegram.trim() : undefined;
  if (telegram === undefined || (deliver.slack !== undefined && typeof deliver.slack !== 'boolean') || (deliver.teams !== undefined && typeof deliver.teams !== 'boolean')) throw new Error('invalid');
  if (body.approve !== undefined && typeof body.approve !== 'boolean') throw new Error('invalid');
  return { ...(body.id ? { id: body.id } : {}), name, brief: body.brief, source: body.source, ...(body.services ? { services: [...new Set(body.services as ConnectorId[])] } : {}),
    days: (days as Weekday[]).sort(), time: body.time, timeZone: body.timeZone, ...(everyHours ? { everyHours } : {}), deliver: { email, whatsapp, ...(deliver.slack ? { slack: true } : {}), ...(deliver.teams ? { teams: true } : {}), ...(telegram ? { telegram } : {}) }, namesHidden: body.namesHidden, ...(body.approve === true ? { approve: true } : {}), language: body.language, enabled: body.enabled, ...(trigger ? { trigger } : {}), ...(agent ? { agent } : {}) };
}

/** A phone number shown with only its last four digits. */
export const maskedNumber = (digits: string) => digits.length > 4 ? `+${'•'.repeat(Math.max(2, digits.length - 4))}${digits.slice(-4)}` : digits;

/** A feed or page address as a trigger takes it: https or http, a public-looking name, no credentials; else null.
 *  The server checks again, every time, that the name resolves to a public address (server/routines/feed.ts). */
export function feedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || /^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return null;
    url.hash = '';
    return url.toString();
  } catch { return null; }
}
/** The site a feed belongs to, as people know it: a publisher's own feed shows as «bbc.com», not «feeds.bbci.co.uk». */
export const feedHost = (url: string) => { const site = Object.entries(PUBLISHER_FEEDS).find(([, feed]) => feed === url)?.[0]; if (site) return site; try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'the page'; } };
