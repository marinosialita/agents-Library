// Agent chains (7 Nov 2026, his request): agents run one after another on one task; each step reads the user's task,
// the documents and the previous step's result, and does its own part. Ready-made chains show the idea; the user
// builds their own. Runs in the browser with the same request as a chat turn (house style and names hidden included).
import type { AgentDefinition, AgentRunRequest } from '../../shared/agents.ts';
import { runAgentTurn, type RunDone } from './api.ts';
import { maskRunRequest, type PrivacyChoice } from './privacy.ts';
import { READY_CHAIN_SPECS } from './chains-ready.ts';
import { fitDocuments, houseForRun, type Chain, type ChatDocument, type Settings } from './store.ts';

/** The ready-made chains as chains: id «ready-chain-…», never stored, copied to be edited. */
export const READY_CHAINS: Chain[] = READY_CHAIN_SPECS.map(spec => ({ id: `ready-chain-${spec.id}`, name: spec.name, description: spec.description, createdAt: 0, updatedAt: 0,
  steps: spec.steps.map(([agentId, ask]) => ({ agentId, ask })) }));
export const isReadyChain = (id: string) => id.startsWith('ready-chain-');

/** One step: its ask and the user's task, the documents and the previous step's result as a document. */
export function chainStepRequest(step: { agent: AgentDefinition; ask: string }, task: string, documents: ChatDocument[], previous: { label: string; answer: string } | null, jurisdiction: string, settings: Settings): AgentRunRequest {
  const question = [step.ask.trim(), task.trim() ? `The task as the user gave it:\n${task.trim()}` : ''].filter(Boolean).join('\n\n') || task;
  const carried: ChatDocument[] = previous ? [{ id: 'previous-step', name: previous.label, text: previous.answer, truncated: false, size: previous.answer.length }, ...documents] : documents;
  const house = houseForRun();
  return { agent: { name: step.agent.name, instructions: step.agent.instructions, jurisdiction: jurisdiction || step.agent.jurisdiction, officialSearch: step.agent.officialSearch, mode: step.agent.mode, knowledge: step.agent.knowledge },
    messages: [{ role: 'user', content: question.slice(0, 30_000) }], documents: fitDocuments(carried, question), language: settings.language, model: settings.model, ...(house ? { house } : {}) };
}

/** Runs one step with names hidden when the choice says so; the answer comes back with the real names. */
export async function runChainStep(request: AgentRunRequest, privacy: PrivacyChoice | null, handlers: { onText(text: string): void; onStatus(text: string): void }, signal: AbortSignal): Promise<RunDone> {
  const masked = maskRunRequest(request, privacy);
  let text = '';
  const done = await runAgentTurn(masked.request, {
    onDelta: delta => { text += delta; handlers.onText(masked.restore(text)); },
    onStatus: event => handlers.onStatus(event.text === 'searching' ? 'Searching the official sources…' : event.text === 'searched' ? 'Writing…' : ''),
  }, signal);
  return { ...done, answer: masked.restore(done.answer || text), gaps: done.gaps.map(masked.restore) };
}
