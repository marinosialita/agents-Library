// The app's own assistant (12 Nov 2026, his «this needs to be a chat, not only a way to the agents… it needs to know
// everything about the platform»): one conversation that finds the agent for a task and shows it under the answer,
// offers to build one when none fits, explains every part of the app, and reads the person's connected apps. It runs
// as an agent of its own, so it has the chat, the history, the question panel and the right panel of every agent.
// Its instructions are written on the server (server/assistant.ts), never taken from the browser.
import type { AgentDefinition } from './agents.ts';
import { isConnectorId, type ConnectorId } from './connections.ts';

export const ASSISTANT_ID = 'assistant';
export const isAssistant = (agent: { id?: string } | undefined | null) => agent?.id === ASSISTANT_ID;

export const ASSISTANT_AGENT: AgentDefinition = {
  id: ASSISTANT_ID, name: 'Ask Agents', field: 'legal', category: 'general',
  description: 'Tell me what you need done. I find the agent for it or build a new one, explain anything in the app, read your connected apps and draft your emails.',
  instructions: 'The assistant of the app. Its instructions are written on the server.',
  starters: ['Do we have an agent that reviews an employment contract?', 'What is a routine, and which one should I start with?', 'What needs my reply in my inbox today?', 'Build me an agent that turns meeting notes into a client update', 'How do I connect my Gmail and calendar?'],
  needs: 'Ask for a task, an agent, your inbox, or how anything here works…',
  jurisdiction: '', officialSearch: false, mode: 'fast', knowledge: [], origin: 'ready', createdAt: 0, updatedAt: 0,
};

export type AssistantPick = { id: string; reason: string; /** The instruction «Use» gives the agent, with the facts gathered so far. */ task?: string };
export type AssistantParts = { text: string; picks: AssistantPick[]; build: string | null; /** Apps to connect right in the chat (a «connect» block). */ connect: ConnectorId[] };

const BLOCK = /```(agents|build|connect)[ \t]*\n([\s\S]*?)\n?```/g;
/** An assistant's answer: its words, the agents it picked (an «agents» block) and the agent it offers to build (a
 *  «build» block). A block still streaming is left out of the words until it is whole. */
export function assistantParts(content: string): AssistantParts {
  const picks: AssistantPick[] = []; let build: string | null = null; const connect: ConnectorId[] = [];
  let text = content.replace(BLOCK, (_all, kind: string, body: string) => {
    try {
      const value = JSON.parse(body);
      if (kind === 'agents') for (const item of Array.isArray(value?.picks) ? value.picks : []) {
        const id = String(item?.id ?? item?.ref ?? '').trim().slice(0, 100);
        const task = String(item?.task ?? '').trim().slice(0, 2_000);
        if (id && picks.length < 5 && !picks.some(pick => pick.id === id)) picks.push({ id, reason: String(item?.reason ?? '').trim().slice(0, 200), ...(task ? { task } : {}) });
      }
      if (kind === 'connect') for (const id of Array.isArray(value?.apps) ? value.apps : []) if (isConnectorId(id) && !connect.includes(id) && connect.length < 6) connect.push(id);
      if (kind === 'build' && typeof value?.description === 'string' && value.description.trim()) build = value.description.trim().slice(0, 2_000);
    } catch { /* a damaged block shows nothing */ }
    return '';
  });
  // A block that has started but not finished, or a fence just opening at the very end.
  text = text.replace(/```(agents|build|connect)\b[\s\S]*$/, '');
  const opening = /\n`{1,3}(a(g(e(n(ts?)?)?)?)?|b(u(i(ld?)?)?)?|c(o(n(n(e(ct?)?)?)?)?)?)?$/.exec(text);
  // Only a fence that opens: one that closes another code block stays.
  if (opening && (text.slice(0, opening.index).split('```').length - 1) % 2 === 0) text = text.slice(0, opening.index);
  return { text: text.trim(), picks, build, connect };
}
