// The client's side of the server routes. Every call tells the truth about its state: a missing key is «not
// configured», an unsupported place is «unsupported», never a quiet fallback.
import type { AgentDefinition, AgentRunRequest } from '../../shared/agents.ts';
import type { FieldId } from '../../shared/fields.ts';
import type { MailTarget } from '../components/mail-panel.tsx';
import { readAction, type AppAction } from '../../shared/app-actions.ts';
import type { Citation } from './store.ts';
import type { Lesson, TeachRequest } from '../../shared/teach.ts';
import { cachedExplanation, explainKey, rememberExplanation } from './store.ts';

export type RunStatus = { text: 'started' | 'searching' | 'searched' | 'reading' | 'writing' | 'planning' | 'checking' | 'revising'; query?: string; model?: string; searching?: boolean; place?: string; /** An app being read (11 Nov 2026). */ app?: string; count?: number };
export type RunDone = { answer: string; sources: Citation[]; consulted: Citation[]; searches: number; gaps: string[]; apps?: string[]; mails?: MailTarget[]; actions?: AppAction[] };
export type RunHandlers = { onStatus(status: RunStatus): void; onDelta(text: string): void; /** The draft is being rewritten (the loop's check failed it): start the text again. */ onReset?(): void };
export class RunError extends Error { constructor(readonly code: string, readonly place?: string) { super(code); } }

export async function runAgentTurn(request: AgentRunRequest, handlers: RunHandlers, signal: AbortSignal): Promise<RunDone> {
  const response = await fetch('/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new RunError(typeof body?.error === 'string' ? body.error : response.status === 404 ? 'no_server' : 'agent_failed', typeof body?.place === 'string' ? body.place : undefined);
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
      if (event.type === 'delta' && typeof event.text === 'string') { text += event.text; handlers.onDelta(event.text); }
      else if (event.type === 'reset') { text = ''; handlers.onReset?.(); }
      else if (event.type === 'status') handlers.onStatus(event);
      else if (event.type === 'done') return { answer: typeof event.answer === 'string' && event.answer ? event.answer : text, sources: Array.isArray(event.sources) ? event.sources : [], consulted: Array.isArray(event.consulted) ? event.consulted : [], searches: Number(event.searches) || 0, gaps: Array.isArray(event.gaps) ? event.gaps : [], ...(Array.isArray(event.apps) && event.apps.length ? { apps: event.apps.filter((app: unknown) => typeof app === 'string').slice(0, 21) } : {}),
        ...(Array.isArray(event.mails) && event.mails.length ? { mails: event.mails.filter((mail: any) => mail && typeof mail.id === 'string' && typeof mail.service === 'string').slice(0, 12)
          .map((mail: any) => ({ service: mail.service, id: mail.id, from: String(mail.from ?? ''), subject: String(mail.subject ?? ''), date: String(mail.date ?? '') })) } : {}),
        ...((actions => actions.length ? { actions } : {})((Array.isArray(event.actions) ? event.actions : []).map(readAction).filter((action: AppAction | null): action is AppAction => !!action).slice(0, 3))) };
      else if (event.type === 'error') throw new RunError(typeof event.error === 'string' ? event.error : 'agent_failed');
    }
  }
  if (text) return { answer: text, sources: [], consulted: [], searches: 0, gaps: ['The connection closed before the answer finished.'] };
  throw new RunError('agent_failed');
}

export type BuildDraft = { name: string; description: string; category: AgentDefinition['category']; jurisdiction: string; officialSearch: boolean; sites?: string[]; mode: 'fast' | 'deep'; needs: string; starters: string[]; instructions: string; /** The field the design chose under «All fields». */ field?: FieldId };
export type BuildResult = { questions: { question: string; options: string[] }[]; agent: BuildDraft | null; summary: string };
export async function buildAgentDesign(input: { description: string; answers?: { question: string; answer: string }[]; examples?: { name: string; text: string }[]; current?: BuildDraft; appLaw?: string; field?: string; language: string }, signal?: AbortSignal): Promise<BuildResult> {
  const response = await fetch('/api/agent-build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new RunError(typeof body?.error === 'string' ? body.error : 'unavailable');
  return body as BuildResult;
}

export async function explainAgent(agent: AgentDefinition, kind: 'summary' | 'steps', language: string, signal?: AbortSignal): Promise<string[]> {
  const key = explainKey(agent, kind); const cached = cachedExplanation(key); if (cached) return cached;
  const response = await fetch('/api/agent-explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ kind, language, agent: { name: agent.name, description: agent.description, instructions: agent.instructions, needs: agent.needs, jurisdiction: agent.jurisdiction, mode: agent.mode, officialSearch: agent.officialSearch } }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.lines)) throw new RunError(typeof body?.error === 'string' ? body.error : 'unavailable');
  const lines = body.lines.filter((line: unknown): line is string => typeof line === 'string');
  rememberExplanation(key, lines); return lines;
}

/** «Tell me the task»: the AI's picks among every agent, best first, each with a reason (server/agent-route.ts). */
export type RoutePick = { id: string; reason: string };
export async function routeTask(input: { task: string; language: string; likely: string[]; mine: { id: string; name: string; description: string }[] }, signal?: AbortSignal): Promise<{ picks: RoutePick[]; noneFits: boolean }> {
  const response = await fetch('/api/agent-route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.picks)) throw new RunError(typeof body?.error === 'string' ? body.error : response.status === 404 ? 'no_server' : 'unavailable');
  return { picks: body.picks.filter((pick: any) => typeof pick?.id === 'string').map((pick: any) => ({ id: pick.id, reason: typeof pick.reason === 'string' ? pick.reason : '' })), noneFits: body.noneFits === true };
}

/** «Teach it» (12 Nov 2026): the lessons in the person's feedback on an answer (server/agent-teach.ts), or none. */
export async function teachLessons(input: TeachRequest, signal?: AbortSignal): Promise<Lesson[]> {
  const response = await fetch('/api/agent-teach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.lessons)) throw new RunError(typeof body?.error === 'string' ? body.error : response.status === 404 ? 'no_server' : 'unavailable');
  return body.lessons.filter((item: any) => typeof item?.text === 'string' && item.text.trim()).map((item: any) => ({ text: String(item.text), every: item.every === true }));
}

export type ServerStatus = { configured: boolean; models: { quality: string; balanced: string }; search: boolean;
  privacy?: { storeOff: boolean; euProcessing: boolean; region: string | null; hostedInEu: boolean }; channels?: { email: boolean; whatsapp: boolean; telegram?: boolean } };
export async function serverStatus(): Promise<ServerStatus | null> {
  try { const response = await fetch('/api/status'); if (!response.ok) return null; return await response.json(); } catch { return null; }
}
