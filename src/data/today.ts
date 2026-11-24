// «Today» in the browser (11 Nov 2026): GET /api/today with the person's time zone (and the owner code, if any).
import { OWNER_HEADER } from '../../shared/connections.ts';
import type { TodayReply } from '../../server/today.ts';
import { ownTimeZone, readOwnerCode } from './connections.ts';

export type { TodayReply };
export async function loadToday(signal?: AbortSignal): Promise<TodayReply> {
  const code = readOwnerCode();
  const response = await fetch(`/api/today?tz=${encodeURIComponent(ownTimeZone())}`, { credentials: 'same-origin', signal, headers: code ? { [OWNER_HEADER]: code } : {} });
  if (!response.ok) throw new Error(`today_${response.status}`);
  return response.json();
}

export type OpenMail = { service: string; id: string; from: string; to: string; date: string; subject: string; body: string; attachments?: string[]; html?: string; link: string };
/** One e-mail for the reading panel (GET /api/mail; server/mail.ts). */
export async function loadMail(service: string, id: string, signal?: AbortSignal): Promise<OpenMail> {
  const code = readOwnerCode();
  const response = await fetch(`/api/mail?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}`, { credentials: 'same-origin', signal, headers: code ? { [OWNER_HEADER]: code } : {} });
  if (!response.ok) throw new Error(`mail_${response.status}`);
  return (await response.json()).mail;
}
