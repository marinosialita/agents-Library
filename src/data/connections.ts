// «Connections» in the browser (10 Nov 2026), ported from MyNomosAI's src/app/data/connections.ts: which services are
// connected, the one-click sign-in in a small window (opened on the click itself, so no popup blocker stops it), and
// the brief run. Until the app has accounts the owner types the owner code once on their device; it is kept in this
// browser only and sent with every call that touches the owner's apps.
import { CONNECTORS, OWNER_HEADER, isConnectorId, type ConnectionsReply, type ConnectorId } from '../../shared/connections.ts';
import type { BriefId } from '../../shared/briefs.ts';
import type { OutputLanguage } from '../../shared/product.ts';

const OWNER_KEY = 'ap-owner-code-v1';
export const CONNECTIONS_CHANNEL = 'agents-connections';

export function readOwnerCode(): string { try { return localStorage.getItem(OWNER_KEY) ?? ''; } catch { return ''; } }
export function saveOwnerCode(code: string): void { try { if (code.trim()) localStorage.setItem(OWNER_KEY, code.trim()); else localStorage.removeItem(OWNER_KEY); } catch { /* storage unavailable */ } }
const ownerHeaders = (): Record<string, string> => { const code = readOwnerCode(); return code ? { [OWNER_HEADER]: code } : {}; };

export class ConnectionsError extends Error { constructor(readonly code: string) { super(code); } }

async function call(init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }): Promise<any> {
  const response = await fetch('/api/connections', { method: init.method, credentials: 'same-origin', signal: init.signal,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...ownerHeaders() }, body: init.body ? JSON.stringify(init.body) : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ConnectionsError(typeof data?.error === 'string' ? data.error : response.status === 404 ? 'no_server' : `http_${response.status}`);
  return data;
}

export async function listConnections(signal?: AbortSignal): Promise<ConnectionsReply> {
  const data = await call({ method: 'GET', signal });
  const services = CONNECTORS.map(connector => {
    const found = Array.isArray(data?.services) ? data.services.find((item: any) => item?.id === connector.id) : null;
    // 13 Nov 2026: «ready» (the app's sign-in is set up) and Figma's «teamSet» were dropped here, so a saved Figma team
    // link always looked unsaved and an app without a sign-in showed a Connect button that could only fail.
    return { id: connector.id, connected: found?.connected === true, ...(typeof found?.since === 'string' ? { since: found.since } : {}),
      ...(typeof found?.ready === 'boolean' ? { ready: found.ready } : {}), ...(typeof found?.teamSet === 'boolean' ? { teamSet: found.teamSet } : {}) };
  });
  return { available: data?.available === true, ownerSet: data?.ownerSet === true, owner: data?.owner === true, services };
}

export type ConnectOutcome = 'connected' | 'failed' | 'unknown' | 'closed';

/** Opens the service's sign-in and resolves when its last page reports back ('connected' / 'failed'), or with
 *  'unknown' when the window is gone without a word: Google's and Microsoft's sign-in pages cut the link to the
 *  opener, so a «closed» window may still be signing in and the caller checks the state itself (watchConnection). */
export async function connectService(service: ConnectorId): Promise<ConnectOutcome> {
  const width = 520, height = 680;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open('about:blank', `agents-connect-${service}`, `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  try {
    const { url } = await call({ method: 'POST', body: { action: 'connect', service } });
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new ConnectionsError('no_link');
    // No window (blocked): this tab goes to the sign-in and the last page brings the owner back to Connections.
    if (!popup || popup.closed) { window.location.assign(url); return 'unknown'; }
    popup.location.href = url;
  } catch (error) { popup?.close(); throw error; }
  return new Promise<ConnectOutcome>(resolve => {
    let settled = false; let channel: BroadcastChannel | null = null;
    const finish = (outcome: ConnectOutcome) => { if (settled) return; settled = true; window.removeEventListener('message', onMessage); window.clearInterval(watch); channel?.close(); resolve(outcome); };
    const heard = (data: any) => { if (data?.type !== 'agents-connection' || (isConnectorId(data.service) && data.service !== service)) return; finish(data.ok === true ? 'connected' : 'failed'); };
    const onMessage = (event: MessageEvent) => { if (event.origin === window.location.origin) heard(event.data); };
    window.addEventListener('message', onMessage);
    try { channel = new BroadcastChannel(CONNECTIONS_CHANNEL); channel.onmessage = event => heard(event.data); } catch { channel = null; }
    // A window closed within a few seconds was cancelled ('closed'); later, it may be a cut link mid sign-in ('unknown').
    const opened = Date.now();
    const watch = window.setInterval(() => { if (popup.closed) window.setTimeout(() => finish(Date.now() - opened < 8000 ? 'closed' : 'unknown'), 1500); }, 600);
  });
}

/** After an 'unknown' outcome: read the state every few seconds until the service shows as connected. */
export async function watchConnection(service: ConnectorId, signal: AbortSignal, everyMs = 3000, forMs = 120_000): Promise<boolean> {
  const until = Date.now() + forMs;
  while (!signal.aborted && Date.now() < until) {
    try { if ((await listConnections()).services.find(item => item.id === service)?.connected) return true; } catch { /* try again */ }
    await new Promise(done => { const timer = window.setTimeout(done, everyMs); signal.addEventListener('abort', () => { window.clearTimeout(timer); done(null); }, { once: true }); });
  }
  return false;
}

export async function disconnectService(service: ConnectorId): Promise<void> { await call({ method: 'POST', body: { action: 'disconnect', service } }); }
/** Figma's team link (null forgets it); the server keeps only the team number. */
export async function setTeamLink(service: ConnectorId, link: string | null): Promise<boolean> { return (await call({ method: 'POST', body: { action: 'set_team', service, link } })).teamSet === true; }

// The brief run (POST /api/connected-run, NDJSON).
export type BriefRequest = { brief: BriefId; demo: boolean; services?: ConnectorId[]; namesHidden: boolean; language: OutputLanguage; timeZone: string; hours?: number };
export type BriefStatus = { text: 'started' | 'reading' | 'opened' | 'calendar' | 'updates' | 'writing'; service?: ConnectorId; count?: number; subject?: string; demo?: boolean; services?: ConnectorId[] };
export type BriefDone = { drafts?: { service: ConnectorId; messageId: string; to: string; subject: string; body: string }[]; answer: string; read: { mail: number; opened: number; events: number }; flagged: number; hidden: number; withheld: number; gaps: string[]; demo: boolean; services: ConnectorId[] };

export const ownTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export async function runBrief(request: BriefRequest, handlers: { onStatus(status: BriefStatus): void; onAnswer(text: string): void }, signal: AbortSignal): Promise<BriefDone> {
  const response = await fetch('/api/connected-run', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(request.demo ? {} : ownerHeaders()) }, body: JSON.stringify(request) });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new ConnectionsError(typeof body?.error === 'string' ? body.error : response.status === 404 ? 'no_server' : 'agent_failed');
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let text = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
      if (!line) continue;
      let event: any; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'answer' && typeof event.text === 'string') { text = event.text; handlers.onAnswer(text); }
      else if (event.type === 'status') handlers.onStatus(event);
      else if (event.type === 'done') return { drafts: Array.isArray(event.drafts) ? event.drafts.filter((draft: any) => draft && typeof draft.messageId === 'string' && typeof draft.body === 'string').slice(0, 3) : [], answer: typeof event.answer === 'string' && event.answer ? event.answer : text, read: event.read ?? { mail: 0, opened: 0, events: 0 }, flagged: Number(event.flagged) || 0, hidden: Number(event.hidden) || 0, withheld: Number(event.withheld) || 0, gaps: Array.isArray(event.gaps) ? event.gaps : [], demo: event.demo === true, services: Array.isArray(event.services) ? event.services.filter(isConnectorId) : [] };
      else if (event.type === 'error') throw new ConnectionsError(typeof event.error === 'string' ? event.error : 'agent_failed');
    }
  }
  throw new ConnectionsError(text ? 'cut_short' : 'agent_failed');
}
