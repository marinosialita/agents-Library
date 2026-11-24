// POST /api/connected-run (10 Nov 2026): run a brief on the owner's connected apps, or on the demo inbox, and stream it
// back as NDJSON lines ({type:'status'|'answer'|'done'|'error'}).
//   { brief: 'morning-inbox-brief', demo: true|false, services?: ['gmail', …], namesHidden: true, language: 'en',
//     timeZone: 'Europe/Nicosia', hours?: 24, model?: 'quality'|'balanced' }
// The demo inbox needs only the AI key. The owner's real mail needs the owner code too, and Composio set up.
import { OpenAIProvider, type ModelProvider } from '@openai/agents';
import { BRIEF_BY_ID, isBriefId } from '../shared/briefs.ts';
import { CONNECTOR_IDS, isConnectorId, type ConnectorId } from '../shared/connections.ts';
import { isOutputLanguage } from '../shared/product.ts';
import { apiKey, isModelChoice, modelId, reasoningEffort, RESPONSES_URL, type ModelChoice } from './models.ts';
import { JsonBodyError, readBoundedJson } from './read-bounded-json.ts';
import { crossOrigin } from './same-origin.ts';
import { actorOf, asUser, composioReady, connectedAccounts, liveComposioDeps, safeLogText, userOf, type ComposioDeps } from './connections.ts';
import { settingsStore } from './connected/settings.ts';
import { composioInbox, demoInbox, type Inbox } from './connected/inbox.ts';
import { LIMITS, runConnectedBrief } from './connected/run.ts';

export type ConnectedRunRequest = { brief: keyof typeof BRIEF_BY_ID; demo: boolean; services?: ConnectorId[]; namesHidden: boolean; language: string; timeZone: string; hours?: number; model?: ModelChoice };
export type ConnectedRunDeps = { composio: ComposioDeps; openaiKey(): string; provider(key: string): ModelProvider; now(): number; timeLimitMs?: number };

export const validTimeZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; } catch { return false; }
};

export function readConnectedRunRequest(value: unknown): ConnectedRunRequest {
  const body = value as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
  if (!isBriefId(body.brief) || typeof body.demo !== 'boolean' || typeof body.namesHidden !== 'boolean' || !isOutputLanguage(body.language) || !validTimeZone(body.timeZone)) throw new Error('invalid');
  if (body.services !== undefined && (!Array.isArray(body.services) || body.services.length > CONNECTOR_IDS.length || !body.services.every(isConnectorId))) throw new Error('invalid');
  if (body.hours !== undefined && (!Number.isInteger(body.hours) || (body.hours as number) < 1 || (body.hours as number) > LIMITS.hours)) throw new Error('invalid');
  if (body.model !== undefined && !isModelChoice(body.model)) throw new Error('invalid');
  return { brief: body.brief, demo: body.demo, namesHidden: body.namesHidden, language: body.language, timeZone: body.timeZone,
    ...(body.services ? { services: [...new Set(body.services as ConnectorId[])] } : {}), ...(body.hours ? { hours: body.hours as number } : {}), ...(body.model ? { model: body.model as ModelChoice } : {}) };
}

/** The inbox a brief reads: the demo one, or the owner's connected apps (Composio set up, at least one connected). The
 *  owner check is the caller's: a route checks the code; a routine was made by the owner. */
export async function openInbox(composio: ComposioDeps, options: { demo: boolean; services?: ConnectorId[]; timeZone: string; now: number; signal?: AbortSignal }): Promise<{ inbox: Inbox } | { error: 'not_configured' | 'connections_failed' | 'nothing_connected'; status: number }> {
  if (options.demo) return { inbox: demoInbox(options.now) };
  if (!composioReady(composio)) return { error: 'not_configured', status: 503 };
  let live: Awaited<ReturnType<typeof connectedAccounts>>;
  try { live = await connectedAccounts(composio, options.signal); }
  catch (error) { console.log('[connected] accounts:', safeLogText(error)); return { error: 'connections_failed', status: 502 }; }
  const configs = composio.authConfigs();
  const services = (options.services ?? [...CONNECTOR_IDS]).filter(service => live.has(service) && configs[service]);
  if (!services.length) return { error: 'nothing_connected', status: 409 };
  // Settings an app needs beyond its sign-in (Figma's team), kept per person.
  const settings = await (settingsStore()?.get(userOf(composio)) ?? Promise.resolve({})).catch(() => ({}));
  return { inbox: composioInbox(composio, services, { now: options.now, timeZone: options.timeZone, settings }) };
}

export function createConnectedRunHandler(deps: ConnectedRunDeps) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (crossOrigin(request)) return reply({ error: 'invalid_origin' }, 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'invalid_content_type' }, 415);
    let body: ConnectedRunRequest;
    try { body = readConnectedRunRequest(await readBoundedJson(request, 20_000)); }
    catch (error) { return error instanceof JsonBodyError && error.status === 413 ? reply({ error: 'request_too_large' }, 413) : reply({ error: 'invalid_input' }, 400); }
    const key = deps.openaiKey();
    if (!key) return reply({ error: 'agent_unavailable' }, 503);
    const now = deps.now();
    // The demo inbox is anyone's; real mail is the signed-in account's own (or the owner code's owner).
    const actor = body.demo ? null : await actorOf(request, deps.composio);
    if (!body.demo && !actor) return reply({ error: deps.composio.ownerCode() ? 'owner_code' : 'sign_in' }, 401);
    const opened = await openInbox(actor ? asUser(deps.composio, actor.user) : deps.composio, { demo: body.demo, services: body.services, timeZone: body.timeZone, now, signal: request.signal });
    if ('error' in opened) return reply({ error: opened.error }, opened.status);
    const { inbox } = opened;
    const brief = BRIEF_BY_ID[body.brief];
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deps.timeLimitMs ?? 240_000)]);
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (value: unknown) => { try { controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); } catch { /* the browser left */ } };
        send({ type: 'status', text: 'started', demo: inbox.demo, services: inbox.services });
        try {
          const outcome = await runConnectedBrief({ inbox, brief, namesHidden: body.namesHidden, timeZone: body.timeZone, language: body.language, hours: body.hours, now,
            provider: deps.provider(key), model: modelId(body.model), effort: reasoningEffort(), signal, onEvent: send });
          send({ type: 'done', ...outcome, demo: inbox.demo, services: inbox.services });
        } catch (error) {
          console.log('[connected-run] failed:', safeLogText(error));
          send({ type: 'error', error: request.signal.aborted ? 'cancelled' : signal.aborted ? 'timeout' : 'agent_failed' });
        }
        try { controller.close(); } catch { /* closed */ }
      },
    }), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
  };
}

export const handleConnectedRun = createConnectedRunHandler({
  composio: liveComposioDeps, openaiKey: apiKey, now: Date.now,
  provider: key => new OpenAIProvider({ apiKey: key, baseURL: RESPONSES_URL.replace(/\/responses$/, ''), useResponses: true }),
});
