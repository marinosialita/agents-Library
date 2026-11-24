// Approve and send (11 Nov 2026): a reply the person read and confirmed, to the sender of one message (server/send-reply.ts).
import { OWNER_HEADER } from '../../shared/connections.ts';
import { ConnectionsError, readOwnerCode } from './connections.ts';

export type Draft = { service: 'gmail' | 'outlook' | string; messageId: string; to: string; subject: string; body: string };

export async function sendReply(draft: Pick<Draft, 'service' | 'messageId'>, body: string): Promise<{ to: string }> {
  const code = readOwnerCode();
  const response = await fetch('/api/send-reply', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(code ? { [OWNER_HEADER]: code } : {}) },
    body: JSON.stringify({ service: draft.service, messageId: draft.messageId, body }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ConnectionsError(typeof data?.error === 'string' ? data.error : `http_${response.status}`);
  return { to: String(data?.to ?? '') };
}
