// Where routines and their runs are kept (10 Nov 2026). The app has no database yet, so this is a store with one
// backend today: JSON files in a folder on the machine that runs the server (ROUTINES_DIR, default «.data» in the
// project, ignored by git — a brief holds the owner's real mail). Writes go through one queue per process and land by
// rename, so a file is never half-written. On a serverless host the folder is not kept between requests, so the store
// says it is unavailable there until a database is chosen (docs/routines.md).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Routine, RoutineRun } from '../../shared/routines.ts';

export interface RoutineStore {
  list(): Promise<Routine[]>;
  get(id: string): Promise<Routine | undefined>;
  save(routine: Routine): Promise<void>;
  remove(id: string): Promise<boolean>;
  /** Marks a slot as taken; false when this slot (or a later one) was already taken, so a slot runs once. */
  claim(id: string, slot: number): Promise<boolean>;
  addRun(run: RoutineRun): Promise<void>;
  runs(limit?: number): Promise<RoutineRun[]>;
  /** Removes the runs that match (12 Nov 2026: history can be deleted); answers how many went. */
  removeRuns(match: (run: RoutineRun) => boolean): Promise<number>;
  /** Replaces a run where it stands in the history (12 Nov 2026: sent or changed after the person's OK); false when it is gone. */
  updateRun(run: RoutineRun): Promise<boolean>;
}

export const RUNS_KEPT = 400; // 11 Nov 2026: an hourly routine makes 24 a day
export const newId = (prefix: 'rt' | 'run') => `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

export function fileStore(dir: string): RoutineStore {
  const routinesFile = path.join(dir, 'routines.json'), runsFile = path.join(dir, 'routine-runs.json');
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work, work); queue = next.catch(() => undefined); return next; };
  const read = async <T>(file: string): Promise<T[]> => {
    try { const value = JSON.parse(await fs.readFile(file, 'utf8')); return Array.isArray(value) ? value : []; }
    catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
  };
  const write = async (file: string, value: unknown) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 1), { mode: 0o600 });
    await fs.rename(temporary, file);
  };
  return {
    list: () => serial(() => read<Routine>(routinesFile)),
    get: id => serial(async () => (await read<Routine>(routinesFile)).find(routine => routine.id === id)),
    save: routine => serial(async () => { const all = await read<Routine>(routinesFile); const at = all.findIndex(item => item.id === routine.id); if (at >= 0) all[at] = routine; else all.push(routine); await write(routinesFile, all); }),
    remove: id => serial(async () => { const all = await read<Routine>(routinesFile); const kept = all.filter(item => item.id !== id); if (kept.length === all.length) return false; await write(routinesFile, kept); return true; }),
    claim: (id, slot) => serial(async () => {
      const all = await read<Routine>(routinesFile); const routine = all.find(item => item.id === id);
      if (!routine || (routine.lastSlot ?? 0) >= slot) return false;
      routine.lastSlot = slot; await write(routinesFile, all); return true;
    }),
    addRun: run => serial(async () => { const all = await read<RoutineRun>(runsFile); await write(runsFile, [run, ...all.filter(item => item.id !== run.id)].slice(0, RUNS_KEPT)); }),
    removeRuns: match => serial(async () => { const all = await read<RoutineRun>(runsFile); const kept = all.filter(run => !match(run)); if (kept.length !== all.length) await write(runsFile, kept); return all.length - kept.length; }),
    updateRun: run => serial(async () => { const all = await read<RoutineRun>(runsFile); const at = all.findIndex(item => item.id === run.id); if (at < 0) return false; all[at] = run; await write(runsFile, all); return true; }),
    runs: (limit = RUNS_KEPT) => serial(async () => (await read<RoutineRun>(runsFile)).slice(0, limit)),
  };
}

/** The store this server uses, or null where files do not last (a serverless host) until a database is set up. */
export function routineStore(): RoutineStore | null {
  if (process.env.VERCEL && !process.env.ROUTINES_DIR) return null;
  return fileStore(process.env.ROUTINES_DIR || path.join(process.cwd(), '.data'));
}
