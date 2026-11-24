// «Teach it» (12 Nov 2026, his «take it from CrewAI»). Ported from CrewAI (crewAIInc/crewAI, MIT licence):
// - lib/crewai/src/crewai/flow/human_feedback.py `_distill_and_store_lessons` with the prompts `hitl_distill_system` and
//   `hitl_distill_user` of translations/en.json: feedback on an output becomes reusable lessons, or none;
// - translations/en.json `human_feedback` («You got human feedback on your work, re-evaluate it and give a new Final
//   Answer»): the same feedback redoes the answer at once;
// - agent/core.py `_training_handler`: later runs carry the lessons as «You MUST follow these instructions».
// Our changes: the person sees every lesson and keeps it only with a click (for this agent or for every agent), each one
// can be edited or forgotten, and the loop's check (server/agent-loop.ts) fails a draft that breaks one.
import { isOutputLanguage, type OutputLanguage } from './product.ts';

export const LESSON_LIMITS = { perAgent: 30, chars: 300, perTeach: 5, feedback: 2_000, output: 20_000, agent: 120 } as const;
export type TeachRequest = { agent: string; output: string; feedback: string; language: OutputLanguage };
/** A lesson as the server proposes it: `every` when it is about form or style any agent should follow. */
export type Lesson = { text: string; every: boolean };

const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max;
export function validateTeachRequest(value: any): asserts value is TeachRequest {
  if (!value || typeof value !== 'object' || !text(value.agent, LESSON_LIMITS.agent) || !text(value.output, LESSON_LIMITS.output)
    || !text(value.feedback, LESSON_LIMITS.feedback) || !isOutputLanguage(value.language)) throw new Error('invalid_teach_request');
}

/** Lessons as stored and sent: trimmed, within the limits, no repeats (case ignored). */
export function cleanLessons(value: unknown, max: number = LESSON_LIMITS.perAgent): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string') continue;
    const line = item.replace(/\s+/g, ' ').trim().replace(/^[-•*]\s*/, '').slice(0, LESSON_LIMITS.chars);
    const key = line.toLocaleLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key); out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/** The message that redoes the answer: the person's own words, said plainly (CrewAI's `human_feedback` slice). */
export const redoMessage = (feedback: string) => `Redo your last answer with this feedback: ${feedback.trim()}`;
