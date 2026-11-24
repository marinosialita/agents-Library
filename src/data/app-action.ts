// Carrying out one action the person approved on its card (server/app-action.ts).
import { OWNER_HEADER } from '../../shared/connections.ts';
import type { AppAction } from '../../shared/app-actions.ts';
import { ConnectionsError, readOwnerCode } from './connections.ts';

export async function carryOut(action: AppAction): Promise<{ link?: string; note?: string; to?: string }> {
  const code = readOwnerCode();
  const response = await fetch('/api/app-action', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(code ? { [OWNER_HEADER]: code } : {}) }, body: JSON.stringify({ action }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ConnectionsError(typeof data?.error === 'string' ? data.error : `http_${response.status}`);
  return { ...(typeof data?.link === 'string' ? { link: data.link } : {}), ...(typeof data?.note === 'string' ? { note: data.note } : {}), ...(typeof data?.to === 'string' ? { to: data.to } : {}) };
}
