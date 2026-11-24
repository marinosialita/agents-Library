// Per-person settings an app needs beyond its sign-in (11 Nov 2026): today only Figma's team, which Composio cannot
// find from the sign-in (docs.composio.dev/toolkits/figma.md: «team_id cannot be programmatically obtained solely
// from a user token»). Kept beside the routines in .data/ (owner-only file, written by rename, one queue).
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConnectorId } from '../../shared/connections.ts';

export type AppSettings = Partial<Record<ConnectorId, { teamId?: string }>>;
export interface SettingsStore { get(user: string): Promise<AppSettings>; set(user: string, service: ConnectorId, value: { teamId?: string } | null): Promise<AppSettings> }

/** A Figma team link (figma.com/files/team/123…/Name, also under an organisation) or the bare number, as the team id. */
export function figmaTeamId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (/^\d{6,25}$/.test(text)) return text;
  let url: URL; try { url = new URL(text); } catch { return null; }
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null;
  return /\/team\/(\d{6,25})(?:\/|$)/.exec(url.pathname)?.[1] ?? null;
}

export function fileSettingsStore(dir: string): SettingsStore {
  const file = path.join(dir, 'connection-settings.json');
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work, work); queue = next.catch(() => undefined); return next; };
  const readAll = async (): Promise<Record<string, AppSettings>> => { try { const value = JSON.parse(await fs.readFile(file, 'utf8')); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
  return {
    get: async user => (await readAll())[user] ?? {},
    set: (user, service, value) => serial(async () => {
      const all = await readAll(); const mine = { ...(all[user] ?? {}) };
      if (value) mine[service] = value; else delete mine[service];
      all[user] = mine;
      await fs.mkdir(dir, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(all, null, 1), { mode: 0o600 });
      await fs.rename(temporary, file);
      return mine;
    }),
  };
}

/** The live store: this Mac's .data/, or ROUTINES_DIR; none on a host whose files do not last. */
export function settingsStore(): SettingsStore | null {
  const dir = process.env.ROUTINES_DIR?.trim();
  if (!dir && process.env.VERCEL) return null;
  return fileSettingsStore(path.resolve(process.cwd(), dir || '.data'));
}
