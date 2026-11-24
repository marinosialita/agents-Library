// The routines' routes (10 Nov 2026). Every call acts for one person (11 Nov 2026): the signed-in account, or without
// accounts the owner code's owner. Each sees and runs only their own routines. A routine may be sent by e-mail or
// WhatsApp only for a trusted person: the owner code, or an account whose address is on INBOUND_ALLOWED_SENDERS (the
// owner's own); everyone else reads their brief in the app.
//   GET  /api/routines                                → { routines: [... with next], runs, delivery: { email, whatsapp } }
//   POST /api/routines { action:'save', routine }     → { routine }
//   POST /api/routines { action:'delete-run', id } / { action:'clear-runs', name? } → { removed } (the person's own runs only)
//   POST /api/routines { action:'delete'|'run', id } / { action:'toggle', id, enabled } → { ok } / { run } / { routine }
//   POST /api/routines { action:'approve-run'|'reject-run', id } / { action:'revise-run', id, feedback } → { run }  («Ask me before sending»)
//   GET  /api/routines-tick  (Authorization: Bearer CRON_SECRET; a host's scheduler calls it every few minutes)
import { APPROVAL_FEEDBACK_MAX, nextSlot, readRoutineInput, ROUTINE_LIMIT, type Routine } from '../../shared/routines.ts';
import { actorOf, OWNER_USER, readOwnerCode, type Actor, type ComposioDeps } from '../connections.ts';
import { signedInUser } from '../auth/auth.ts';
import { sameSecret } from '../inbound/core.ts';
import { crossOrigin } from '../same-origin.ts';
import { JsonBodyError, readBoundedJson } from '../read-bounded-json.ts';
import { deliveryOptions } from './deliver.ts';
import { approveRun, briefOnly, executeRoutine, liveRoutineDeps, rejectRun, reviseRun, runDueRoutines, runMailTriggerNow, runTriggerNow, withoutRetry, type RoutineDeps } from './run.ts';
import { randomBytes } from 'node:crypto';
import { newId, routineStore } from './store.ts';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });

const ownerOf = (item: { owner?: string }) => item.owner ?? OWNER_USER;

/** Where this person may send a brief: everything on the allow-lists if trusted, nothing otherwise. */
function sendOptions(actor: Actor, options: { email: string[]; whatsapp: string[]; telegram: string[] }) {
  const trusted = actor.via === 'owner' || (!!actor.email && options.email.some(address => address.toLowerCase() === actor.email));
  return trusted ? options : { email: [], whatsapp: [], telegram: [] };
}

export function createRoutinesHandler(deps: RoutineDeps | null, owner: Pick<ComposioDeps, 'ownerCode' | 'account'>) {
  /** Runs being sent, stopped or changed right now: a second press while the first works is refused, never sent twice. */
  const acting = new Set<string>();
  return async (request: Request): Promise<Response> => {
    if (crossOrigin(request)) return reply({ error: 'invalid_origin' }, 403);
    const actor = await actorOf(request, owner);
    if (!actor) return reply({ error: owner.ownerCode() ? 'owner_code' : 'sign_in' }, 401);
    if (!deps) return reply({ error: 'storage_unavailable' }, 503);
    const { store } = deps;
    const now = deps.now();
    const mine = async () => (await store.list()).filter(routine => ownerOf(routine) === actor.user);
    if (request.method === 'GET') {
      const routines = await mine();
      // Shown without «Next steps» or the JSON record agents built earlier appended (12 Nov 2026).
      // A run waiting for the person's OK is always listed, however many runs came after it (12 Nov 2026).
      const own = (await store.runs()).filter(run => ownerOf(run) === actor.user);
      const runs = [...own.slice(0, 20), ...own.slice(20).filter(run => run.approval?.state === 'waiting')].map(run => ({ ...run, answer: briefOnly(run.answer) }));
      return reply({ routines: routines.map(routine => ({ ...routine, next: routine.enabled && !routine.trigger ? nextSlot(routine, now) : null })), runs, delivery: sendOptions(actor, deliveryOptions(deps.delivery())), ai: !!deps.openaiKey() });
    }
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'invalid_content_type' }, 415);
    let body: Record<string, any>;
    try { body = await readBoundedJson(request, 20_000) as Record<string, any>; if (!body || typeof body !== 'object') throw new Error('invalid'); }
    catch (error) { return error instanceof JsonBodyError && error.status === 413 ? reply({ error: 'request_too_large' }, 413) : reply({ error: 'invalid_input' }, 400); }
    if (body.action === 'save') {
      let input; try { input = readRoutineInput(body.routine); } catch { return reply({ error: 'invalid_routine' }, 400); }
      const options = sendOptions(actor, deliveryOptions(deps.delivery()));
      if ((input.deliver.email && !options.email.includes(input.deliver.email)) || (input.deliver.whatsapp && !options.whatsapp.includes(input.deliver.whatsapp)) || (input.deliver.telegram && !options.telegram.includes(input.deliver.telegram))) return reply({ error: 'recipient_not_allowed' }, 400);
      // Slack and Teams go to the person themself, from their own connected account: the demo inbox has none.
      if ((input.deliver.slack || input.deliver.teams) && input.source !== 'mine') return reply({ error: 'invalid_routine' }, 400);
      const all = await mine();
      const before = input.id ? all.find(routine => routine.id === input.id) : undefined;
      if (input.id && !before) return reply({ error: 'not_found' }, 404);
      if (!before && all.length >= ROUTINE_LIMIT) return reply({ error: 'too_many' }, 409);
      // What the server keeps across edits (13 Nov 2026): a hook's secret, a feed's memory while its address is the same,
      // and the mail trigger's last look (it was lost on every save).
      const sameFeed = input.trigger?.kind === 'feed' && before?.trigger?.kind === 'feed' && before.trigger.url === input.trigger.url;
      const routine: Routine = { ...input, id: before?.id ?? newId('rt'), createdAt: before?.createdAt ?? now, updatedAt: now, ...(before?.lastSlot ? { lastSlot: before.lastSlot } : {}), owner: actor.user,
        ...(input.trigger?.kind === 'hook' ? { hookKey: before?.hookKey ?? randomBytes(16).toString('hex') } : {}),
        ...(sameFeed && before?.seen ? { seen: before.seen } : {}), ...(sameFeed && before?.pageText ? { pageText: before.pageText } : {}),
        ...(input.trigger?.kind === 'mail' && before?.lastSeen ? { lastSeen: before.lastSeen } : {}) };
      await store.save(routine);
      return reply({ routine: { ...routine, next: routine.enabled && !routine.trigger ? nextSlot(routine, now) : null } });
    }
    // History (12 Nov 2026, his «how to delete the history»): one run, one routine's runs by name (a deleted routine
    // has no id left to ask by), or all of them. Only ever the person's own.
    if (body.action === 'delete-run') { if (typeof body.id !== 'string') return reply({ error: 'invalid_input' }, 400); const removed = await store.removeRuns(run => run.id === body.id && ownerOf(run) === actor.user); return removed ? reply({ removed }) : reply({ error: 'not_found' }, 404); }
    if (body.action === 'clear-runs') { if (body.name !== undefined && typeof body.name !== 'string') return reply({ error: 'invalid_input' }, 400); return reply({ removed: await store.removeRuns(run => ownerOf(run) === actor.user && (body.name === undefined || run.routineName === body.name)) }); }
    // «Ask me before sending» (12 Nov 2026): a waiting run is sent, stopped or changed only by its owner, only while it waits.
    if (body.action === 'approve-run' || body.action === 'reject-run' || body.action === 'revise-run') {
      if (typeof body.id !== 'string' || (body.action === 'revise-run' && (typeof body.feedback !== 'string' || !body.feedback.trim() || body.feedback.length > APPROVAL_FEEDBACK_MAX))) return reply({ error: 'invalid_input' }, 400);
      const run = (await store.runs()).find(item => item.id === body.id && ownerOf(item) === actor.user);
      if (!run) return reply({ error: 'not_found' }, 404);
      if (run.approval?.state !== 'waiting' || acting.has(run.id)) return reply({ error: 'not_waiting' }, 409);
      acting.add(run.id);
      try {
        if (body.action === 'reject-run') return reply({ run: await rejectRun(run, deps) });
        const owned = await store.get(run.routineId);
        if (!owned || ownerOf(owned) !== actor.user) return reply({ error: 'routine_gone' }, 410);
        if (body.action === 'approve-run') return reply({ run: await approveRun(run, owned, deps) });
        const changed = await reviseRun(run, owned, body.feedback.trim(), deps);
        return reply({ run: { ...changed, answer: briefOnly(changed.answer) } });
      } finally { acting.delete(run.id); }
    }
    const found = typeof body.id === 'string' ? await store.get(body.id) : undefined;
    // Someone else's routine is answered exactly as a missing one.
    const routine = found && ownerOf(found) === actor.user ? found : undefined;
    if (!routine) return reply({ error: 'not_found' }, 404);
    // Its past runs go with it (12 Nov 2026: he deleted his routines and their history stayed).
    if (body.action === 'delete') { await store.remove(routine.id); await store.removeRuns(run => run.routineId === routine.id && ownerOf(run) === actor.user); return reply({ ok: true }); }
    if (body.action === 'toggle' && typeof body.enabled === 'boolean') {
      // Switched on again: the slots it missed while off are not run afterwards, nor a try planned before.
      const updated: Routine = { ...withoutRetry(routine), enabled: body.enabled, updatedAt: now, ...(body.enabled ? { lastSlot: Math.max(routine.lastSlot ?? 0, now) } : {}) };
      await store.save(updated);
      return reply({ routine: { ...updated, next: updated.enabled && !updated.trigger ? nextSlot(updated, now) : null } });
    }
    // Run now finishes even if the page is closed or reloaded (11 Nov 2026: a reload cancelled his GitHub brief); the
    // run's own time limit still bounds it.
    if (body.action === 'run') {
      const run = routine.trigger?.kind === 'mail' ? await runMailTriggerNow(routine, deps) : routine.trigger ? await runTriggerNow(routine, deps) : await executeRoutine(routine, 'now', deps);
      // 13 Nov 2026: a Run now that finished makes a try planned after a failed scheduled run unnecessary.
      if (run.status === 'done') { const latest = await store.get(routine.id); if (latest?.retry) await store.save(withoutRetry(latest)); }
      return reply({ run });
    }
    return reply({ error: 'invalid_action' }, 400);
  };
}

/** The host's scheduler (Vercel Cron sends «Authorization: Bearer <CRON_SECRET>»). */
export function createRoutinesTickHandler(deps: RoutineDeps | null, secret: () => string) {
  return async (request: Request): Promise<Response> => {
    const expected = secret();
    if (!expected) return reply({ error: 'tick_not_set_up' }, 503);
    const given = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
    if (!given || !sameSecret(given, expected)) return reply({ error: 'unauthorised' }, 401);
    if (!deps) return reply({ error: 'storage_unavailable' }, 503);
    const ran = await runDueRoutines(deps);
    return reply({ ran: ran.map(run => ({ id: run.id, routine: run.routineId, status: run.status })) });
  };
}

const store = routineStore();
const live = store ? liveRoutineDeps(store) : null;
export const handleRoutines = createRoutinesHandler(live, { ownerCode: () => readOwnerCode(), account: request => signedInUser(request) });
export const handleRoutinesTick = createRoutinesTickHandler(live, () => (process.env.CRON_SECRET ?? '').trim());

/** The dev server's own clock (vite.config.ts): every minute, the routines that are due. One tick at a time. */
export async function localTick(): Promise<void> {
  const flag = globalThis as { __agentsTicking?: boolean };
  if (flag.__agentsTicking || !live) return;
  flag.__agentsTicking = true;
  try { const ran = await runDueRoutines(live); if (ran.length) console.log(`[routines] ran ${ran.map(run => `${run.routineName}: ${run.status}`).join(', ')}`); }
  catch (error) { console.log('[routines] tick failed:', error instanceof Error ? error.message.slice(0, 200) : 'error'); }
  finally { flag.__agentsTicking = false; }
}
