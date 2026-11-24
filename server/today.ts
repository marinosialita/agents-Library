// «Today» (11 Nov 2026, his «build them all» after the Lindy study): one page that says what needs the person now.
//   GET /api/today?tz=Europe/Nicosia → { demo, meetings, needs, done, connected }
// Meetings come from the person's connected calendars (read-only), or from the demo calendar when none is connected;
// «Needs you» is the newest brief's «Needs you today» section; «done» counts the last 7 days of routine runs.
import { readsCalendar, CONNECTOR_BY_ID, type ConnectorId } from '../shared/connections.ts';
import { lineKey, withoutMailRefs } from '../shared/mail-refs.ts';
import { needsOf } from '../shared/needs.ts';
export { needsOf };
import { validTimeZone, type Routine, type RoutineRun } from '../shared/routines.ts';
import { actorOf, asUser, composioReady, liveComposioDeps, OWNER_USER, safeLogText, type ComposioDeps } from './connections.ts';
import { openInbox } from './connected-run.ts';
import { demoInbox } from './connected/inbox.ts';
import { routineStore, type RoutineStore } from './routines/store.ts';
import { briefOnly } from './routines/run.ts';
import { crossOrigin } from './same-origin.ts';

export type TodayMeeting = { title: string; start: string; end: string; where: string; who: string; service: string };
export type TodayNeed = { text: string; from: string; at: number; mail?: { service: ConnectorId; id: string; from: string; subject: string; date: string } };
export type TodayReply = { demo: boolean; signedIn: boolean; connected: string[]; meetings: TodayMeeting[]; needs: TodayNeed[];
  done: { briefs: number; read: number; flagged: number; sent: number; failed: number }; lastBrief: { name: string; at: number } | null;
  /** Each of the person's routines with its newest result (12 Nov 2026, his «a column for each routine agent»). */
  latest: TodayLatest[];
  /** «Ask me before sending» (12 Nov 2026): runs waiting for the person's OK, newest first. */
  waiting?: { name: string; at: number }[] };
/** One routine with its newest result (none yet: at 0, empty answer). */
export type TodayLatest = { id: string; name: string; enabled: boolean; at: number; answer: string; failed?: boolean; quiet?: boolean };

/** Each routine with its newest run that found something, else its newest at all (a quiet hourly check). */
export function latestByRoutine(routines: Pick<Routine, 'id' | 'name' | 'enabled' | 'agent'>[], runs: RoutineRun[]): TodayLatest[] {
  const newest = new Map<string, RoutineRun>();
  for (const run of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
    const held = newest.get(run.routineId);
    if (!held || (held.quiet && !run.quiet && run.status === 'done')) newest.set(run.routineId, run);
  }
  return routines.map(routine => {
    const run = newest.get(routine.id);
    const base = { id: routine.id, name: routine.name || routine.agent?.name?.trim() || 'Routine', enabled: routine.enabled };
    if (!run) return { ...base, at: 0, answer: '' };
    return { ...base, at: run.startedAt, answer: run.status === 'failed' ? '' : briefOnly(withoutMailRefs(run.answer)).slice(0, 24_000),
      ...(run.status === 'failed' ? { failed: true } : {}), ...(run.quiet ? { quiet: true } : {}) };
  }).sort((a, b) => b.at - a.at);
}


export function summariseRuns(runs: RoutineRun[], now: number, live?: Set<string>): Pick<TodayReply, 'needs' | 'done' | 'lastBrief'> {
  const week = runs.filter(run => run.startedAt >= now - 7 * 86_400_000);
  // The newest brief that has a «Needs you today» list (12 Nov 2026: an hourly news check that found nothing new came
  // after the morning brief and emptied the box).
  // A deleted routine's brief no longer asks for anything (12 Nov 2026); its runs still count in the week.
  const latest = runs.filter(run => (!live || live.has(run.routineId)) && run.status === 'done' && !run.quiet && run.answer && needsOf(run.answer).length).sort((a, b) => b.startedAt - a.startedAt)[0];
  return {
    needs: latest ? needsOf(latest.answer).map(text => {
      const link = latest.mails?.find(item => item.text === lineKey(text));
      return { text, from: latest.routineName, at: latest.startedAt, ...(link ? { mail: { service: link.service, id: link.id, from: link.from, subject: link.subject, date: link.date } } : {}) };
    }) : [],
    lastBrief: latest ? { name: latest.routineName, at: latest.startedAt } : null,
    done: { briefs: week.filter(run => run.status === 'done' && !run.quiet).length, failed: week.filter(run => run.status === 'failed').length,
      read: week.reduce((sum, run) => sum + (run.read?.mail ?? 0) + (run.read?.events ?? 0), 0), flagged: week.reduce((sum, run) => sum + (run.flagged ?? 0), 0),
      sent: week.reduce((sum, run) => sum + run.delivered.filter(item => item.ok).length, 0) },
  };
}

export function createTodayHandler(deps: { composio: ComposioDeps; store: RoutineStore | null; now(): number }) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
    if (crossOrigin(request)) return reply({ error: 'invalid_origin' }, 403);
    if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
    const zone = new URL(request.url).searchParams.get('tz') ?? 'UTC';
    const timeZone = validTimeZone(zone) ? zone : 'UTC';
    const now = deps.now();
    const actor = await actorOf(request, deps.composio);
    let inbox = demoInbox(now), demo = true, connected: string[] = [];
    if (actor && composioReady(deps.composio)) {
      const opened = await openInbox(asUser(deps.composio, actor.user), { demo: false, timeZone, now, signal: request.signal }).catch(error => { console.log('[today]', safeLogText(error)); return null; });
      if (opened && 'inbox' in opened) { inbox = opened.inbox; demo = false; connected = opened.inbox.services.map(id => CONNECTOR_BY_ID[id].name); }
    }
    const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
    const meetings = (await Promise.all(inbox.services.filter(readsCalendar).map(service => inbox.listEvents(service, { days: 1 }, request.signal)
      .then(events => events.map(event => ({ title: event.title, start: event.start, end: event.end, where: event.where, who: event.who, service: CONNECTOR_BY_ID[service].name }))).catch(() => [])))).flat()
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 12);
    const runs = actor && deps.store ? (await deps.store.runs(400)).filter(run => (run.owner ?? OWNER_USER) === actor.user) : [];
    const routines = actor && deps.store ? await deps.store.list().catch(() => []) : [];
    const mine = actor ? routines.filter(routine => (routine.owner ?? OWNER_USER) === actor.user) : [];
    return reply({ demo, signedIn: !!actor, connected, meetings, ...summariseRuns(runs, now, deps.store ? new Set(mine.map(routine => routine.id)) : undefined), latest: latestByRoutine(mine, runs),
      waiting: runs.filter(run => run.approval?.state === 'waiting').slice(0, 5).map(run => ({ name: run.routineName, at: run.startedAt })) } satisfies TodayReply);
  };
}

export const handleToday = createTodayHandler({ composio: liveComposioDeps, store: routineStore(), now: Date.now });
