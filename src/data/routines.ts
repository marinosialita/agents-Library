// «Routines» in the browser (10 Nov 2026): the owner's routines, their runs, and the four actions. Every call carries the
// owner code (src/data/connections.ts), as a routine reads the owner's apps.
import { OWNER_HEADER } from '../../shared/connections.ts';
import type { Routine, RoutineInput, RoutineRun } from '../../shared/routines.ts';
import { ConnectionsError, readOwnerCode } from './connections.ts';

export type RoutineView = Routine & { next: number | null };
export type RoutinesReply = { routines: RoutineView[]; runs: RoutineRun[]; delivery: { email: string[]; whatsapp: string[]; telegram: string[] }; ai: boolean };

async function call(init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }): Promise<any> {
  const code = readOwnerCode();
  const response = await fetch('/api/routines', { method: init.method, credentials: 'same-origin', signal: init.signal,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(code ? { [OWNER_HEADER]: code } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ConnectionsError(typeof data?.error === 'string' ? data.error : response.status === 404 ? 'no_server' : `http_${response.status}`);
  return data;
}

export async function listRoutines(signal?: AbortSignal): Promise<RoutinesReply> {
  const data = await call({ method: 'GET', signal });
  return { routines: Array.isArray(data?.routines) ? data.routines : [], runs: Array.isArray(data?.runs) ? data.runs : [],
    delivery: { email: Array.isArray(data?.delivery?.email) ? data.delivery.email : [], whatsapp: Array.isArray(data?.delivery?.whatsapp) ? data.delivery.whatsapp : [], telegram: Array.isArray(data?.delivery?.telegram) ? data.delivery.telegram : [] }, ai: data?.ai === true };
}
/** Only what the form edits goes back (13 Nov 2026, code review: a feed routine's memory of seen items, its page text
 *  and its link secret travelled back with every edit and could pass the server's 20 KB limit). The server keeps them. */
export const saveRoutine = async (routine: RoutineInput): Promise<RoutineView> => {
  const { seen: _seen, pageText: _page, hookKey: _key, owner: _owner, lastSlot: _slot, lastSeen: _last, retry: _retry, createdAt: _made, updatedAt: _changed, next: _next, ...input } = routine as RoutineInput & Record<string, unknown>;
  return (await call({ method: 'POST', body: { action: 'save', routine: input } })).routine;
};
export const toggleRoutine = async (id: string, enabled: boolean): Promise<RoutineView> => (await call({ method: 'POST', body: { action: 'toggle', id, enabled } })).routine;
export const deleteRoutine = async (id: string): Promise<void> => { await call({ method: 'POST', body: { action: 'delete', id } }); };
export const deleteRun = async (id: string): Promise<void> => { await call({ method: 'POST', body: { action: 'delete-run', id } }); };
/** Every run, or one routine's runs by its name. */
export const clearRuns = async (name?: string): Promise<number> => Number((await call({ method: 'POST', body: { action: 'clear-runs', ...(name ? { name } : {}) } })).removed) || 0;
/** «Ask me before sending» (12 Nov 2026): send a waiting run, stop it, or have it redone with what should change. */
export const approveRun = async (id: string): Promise<RoutineRun> => (await call({ method: 'POST', body: { action: 'approve-run', id } })).run;
export const rejectRun = async (id: string): Promise<RoutineRun> => (await call({ method: 'POST', body: { action: 'reject-run', id } })).run;
export const reviseRun = async (id: string, feedback: string, signal?: AbortSignal): Promise<RoutineRun> => (await call({ method: 'POST', body: { action: 'revise-run', id, feedback }, signal })).run;
export const runRoutineNow = async (id: string, signal?: AbortSignal): Promise<RoutineRun> => (await call({ method: 'POST', body: { action: 'run', id }, signal })).run;
