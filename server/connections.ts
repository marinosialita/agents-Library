// «Connections» on the server (10 Nov 2026), ported from MyNomosAI's server/connections.ts: the owner's Gmail, Google
// Calendar and Outlook, through Composio. The browser never sees the Composio key: it asks this route for a sign-in
// link, opens it in a small window, and asks again which services are connected.
//
//   GET  /api/connections                           → { available, ownerSet, owner, services: [{ id, connected, since }] }
//   POST /api/connections { action:'connect', service }    → { url }   (the provider's sign-in page)
//   POST /api/connections { action:'disconnect', service } → { ok }
//
// Until the app has accounts there is ONE Composio user, the owner («agents-owner»), and every call that touches it must
// carry the owner code (CONNECTIONS_OWNER_CODE, compared in constant time). Configuration (server environment):
// COMPOSIO_API_KEY, COMPOSIO_AUTH_CONFIGS = {"gmail":"ac_…","googlecalendar":"ac_…","outlook":"ac_…"} and
// CONNECTIONS_OWNER_CODE (16+ characters). Without them the page says what is missing, and nothing breaks.
import { signedInUser } from './auth/auth.ts';
import { figmaTeamId, settingsStore, type AppSettings, type SettingsStore } from './connected/settings.ts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CONNECTORS, CONNECTOR_BY_ID, OWNER_HEADER, isConnectorId, type ConnectionsReply, type ConnectorId } from '../shared/connections.ts';
import { crossOrigin } from './same-origin.ts';

export const COMPOSIO = 'https://backend.composio.dev/api/v3.1';
export const OWNER_USER = 'agents-owner';

export type ComposioDeps = {
  key(): string;
  authConfigs(): Partial<Record<ConnectorId, string>>;
  ownerCode(): string;
  fetcher: typeof fetch;
  /** The Composio user the calls act for (11 Nov 2026, accounts); absent = the owner. */
  user?: string;
  /** The signed-in account of a request, if accounts are on (server/auth/auth.ts). */
  account?(request: Request): Promise<{ id: string; email: string } | null>;
  /** Per-person app settings (Figma's team), server/connected/settings.ts. */
  settings?: SettingsStore | null;
};

/** Who a request acts for: a signed-in account (its own Composio user) or, without one, the owner code's owner. */
export type Actor = { user: string; via: 'account' | 'owner'; email?: string };
export const accountUser = (id: string) => `agents-u-${id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)}`;
export const userOf = (deps: Pick<ComposioDeps, 'user'>) => deps.user ?? OWNER_USER;
export const asUser = (deps: ComposioDeps, user: string): ComposioDeps => ({ ...deps, user });
export async function actorOf(request: Request, deps: Pick<ComposioDeps, 'ownerCode' | 'account'>): Promise<Actor | null> {
  const account = deps.account ? await deps.account(request).catch(() => null) : null;
  if (account?.id) return { user: accountUser(account.id), via: 'account', email: account.email.toLowerCase() };
  return isOwner(request, deps) ? { user: OWNER_USER, via: 'owner' } : null;
}

export class Failure extends Error { constructor(readonly status: number, message: string) { super(message); } }

/** Error text safe to log: Composio keys (ak_…) and anything that looks like a bearer token are masked. */
export function safeLogText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(/\bak_[A-Za-z0-9_-]+/g, 'ak_[hidden]').replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}/g, '[token hidden]').replace(/\s+/g, ' ').slice(0, 300);
}

/** The Composio key from the environment, or '' when it is missing or malformed (spaces, line breaks, several keys). */
export function readComposioKey(raw = process.env.COMPOSIO_API_KEY): string {
  const key = (raw ?? '').trim();
  if (!key) return '';
  if (!/^ak_[A-Za-z0-9_-]{8,200}$/.test(key)) { console.log('[connections] COMPOSIO_API_KEY is malformed: it must be exactly one key (ak_…).'); return ''; }
  return key;
}

export function readAuthConfigs(raw = process.env.COMPOSIO_AUTH_CONFIGS): Partial<Record<ConnectorId, string>> {
  try {
    const value = JSON.parse(raw || '{}');
    return Object.fromEntries(Object.entries(value).filter(([id, config]) => isConnectorId(id) && typeof config === 'string' && /^ac_[A-Za-z0-9_-]{3,80}$/.test(config))) as Partial<Record<ConnectorId, string>>;
  } catch { return {}; }
}

/** The owner code from the environment; shorter than 16 characters counts as not set (too easy to guess). */
export function readOwnerCode(raw = process.env.CONNECTIONS_OWNER_CODE): string {
  const code = (raw ?? '').trim();
  return code.length >= 16 && code.length <= 200 ? code : '';
}

/** Whether the request carries the owner code. Hashes first, so the comparison takes the same time for any input. */
export function isOwner(request: Request, deps: Pick<ComposioDeps, 'ownerCode'>): boolean {
  const expected = deps.ownerCode(); const given = request.headers.get(OWNER_HEADER)?.trim() ?? '';
  if (!expected || !given) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(expected), digest(given));
}

export const composioReady = (deps: ComposioDeps) => !!deps.key() && Object.keys(deps.authConfigs()).length > 0;

export async function composio(deps: ComposioDeps, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<any> {
  const response = await deps.fetcher(`${COMPOSIO}${path}`, {
    method: init.method || 'GET',
    headers: { 'x-api-key': deps.key(), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!response.ok) throw new Failure(response.status === 404 ? 404 : 502, `composio_${response.status}`);
  return data;
}

/** The owner's live accounts per service: every id (disconnect removes them all) and the newest one's date. */
export async function connectedAccounts(deps: ComposioDeps, signal?: AbortSignal): Promise<Map<ConnectorId, { ids: string[]; since?: string }>> {
  const data = await composio(deps, `/connected_accounts?user_ids=${encodeURIComponent(userOf(deps))}&statuses=ACTIVE&limit=100`, { signal });
  const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const byConfig = new Map(Object.entries(deps.authConfigs()).map(([id, config]) => [config, id as ConnectorId]));
  const found = new Map<ConnectorId, { ids: string[]; since?: string }>();
  for (const item of items) {
    if (String(item?.status || 'ACTIVE').toUpperCase() !== 'ACTIVE' || typeof item?.id !== 'string') continue;
    const slug = String(item?.toolkit?.slug || item?.toolkit_slug || item?.appName || '').toUpperCase();
    const service = byConfig.get(String(item?.auth_config?.id || item?.auth_config_id || '')) || CONNECTORS.find(connector => connector.toolkit === slug)?.id;
    if (!service) continue;
    const since = typeof item?.created_at === 'string' ? item.created_at : undefined;
    const kept = found.get(service) ?? { ids: [] };
    kept.ids.push(item.id);
    if (since && (!kept.since || since > kept.since)) kept.since = since;
    found.set(service, kept);
  }
  return found;
}

/** One read-only Composio tool call for the owner (server/connected/inbox.ts names the tools). */
export async function executeTool(deps: ComposioDeps, slug: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const response = await deps.fetcher(`${COMPOSIO}/tools/execute/${encodeURIComponent(slug)}`, {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    headers: { 'x-api-key': deps.key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userOf(deps), arguments: args, version: 'latest' }),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || data?.successful === false) throw new Failure(502, `composio_tool_${response.status}`);
  return data?.data ?? data;
}

/** Where the sign-in window lands: a small page that tells the app and closes itself. */
export function returnAddress(request: Request, service: ConnectorId): string {
  return `${new URL(request.url).origin}/connections-done.html?service=${service}`;
}

export function createConnectionsHandler(deps: ComposioDeps) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
    try {
      if (crossOrigin(request)) throw new Failure(403, 'invalid_origin');
      const configs = deps.authConfigs();
      const available = composioReady(deps);
      const ownerSet = !!deps.ownerCode();
      const actor = await actorOf(request, deps);
      const owner = !!actor;
      const signedIn = actor?.via === 'account';
      const acting = actor ? asUser(deps, actor.user) : deps;
      const nobody = () => CONNECTORS.map(connector => ({ id: connector.id, connected: false }));
      if (request.method === 'GET') {
        if (!available || !owner) return reply({ available, ownerSet, owner, signedIn, services: nobody() } satisfies ConnectionsReply);
        const live = await connectedAccounts(acting, request.signal);
        const settings = await (deps.settings?.get(userOf(acting)) ?? Promise.resolve({} as AppSettings)).catch(() => ({} as AppSettings));
        return reply({ available, ownerSet, owner, signedIn, services: CONNECTORS.map(connector => ({ id: connector.id, connected: live.has(connector.id), ready: !!deps.authConfigs()[connector.id], ...(live.get(connector.id)?.since ? { since: live.get(connector.id)!.since } : {}), ...(connector.needsTeam ? { teamSet: !!settings[connector.id]?.teamId } : {}) })) } satisfies ConnectionsReply);
      }
      if (request.method !== 'POST') throw new Failure(405, 'method_not_allowed');
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Failure(415, 'invalid_content_type');
      if (!owner) throw new Failure(401, ownerSet ? 'owner_code' : 'sign_in');
      const body = await request.json().catch(() => null) as { action?: unknown; service?: unknown; link?: unknown } | null;
      if (!body || !isConnectorId(body.service)) throw new Failure(400, 'invalid_service');
      const service = body.service;
      // Figma's team link (11 Nov 2026): saved for this person; the number only, never the rest of the address.
      if (body.action === 'set_team') {
        if (!CONNECTOR_BY_ID[service].needsTeam) throw new Failure(400, 'invalid_action');
        if (!deps.settings) throw new Failure(503, 'storage_unavailable');
        const teamId = body.link === null ? null : figmaTeamId(body.link);
        if (body.link !== null && !teamId) throw new Failure(400, 'invalid_team_link');
        await deps.settings.set(userOf(acting), service, teamId ? { teamId } : null);
        return reply({ ok: true, teamSet: !!teamId });
      }
      if (!available || !configs[service]) throw new Failure(503, 'not_configured');
      if (body.action === 'connect') {
        const link = await composio(acting, '/connected_accounts/link', { method: 'POST', body: { auth_config_id: configs[service], user_id: userOf(acting), callback_url: returnAddress(request, service) } });
        const url = String(link?.redirect_url || link?.redirectUrl || '');
        if (!/^https:\/\//.test(url)) throw new Failure(502, 'no_link');
        return reply({ url });
      }
      if (body.action === 'disconnect') {
        const held = (await connectedAccounts(acting)).get(service)?.ids ?? [];
        await Promise.all(held.map(id => composio(acting, `/connected_accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })));
        return reply({ ok: true });
      }
      throw new Failure(400, 'invalid_action');
    } catch (error) {
      if (error instanceof Failure) return reply({ error: error.message }, error.status);
      console.log('[connections] error:', safeLogText(error));
      return reply({ error: 'connections_failed' }, 502);
    }
  };
}

export const liveComposioDeps: ComposioDeps = { key: () => readComposioKey(), authConfigs: () => readAuthConfigs(), ownerCode: () => readOwnerCode(), fetcher: fetch, account: request => signedInUser(request), settings: settingsStore() };
export const handleConnections = createConnectionsHandler(liveComposioDeps);
