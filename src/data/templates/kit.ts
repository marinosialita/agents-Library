// The shared shape and writing kit of Nomos's ready agents (5 Nov 2026): templates.ts and templates-elite.ts both use it.
import type { AgentCategory } from '../../../shared/agents.ts';

export type L = { el: string; en: string };
export type AgentTemplate = { id: string; category: AgentCategory; name: L; description: L; needs: L; starters: { el: string[]; en: string[] };
  instructions: string; jurisdiction?: string; officialSearch?: boolean; mode?: 'fast' | 'deep' };

export const doc = (role: string, task: string[], output: string[], rules: string[] = []) =>
  `## Role\n${role}\n\n## Task\n${task.map(line => `- ${line}`).join('\n')}\n\n## Output\n${output.map(line => `- ${line}`).join('\n')}${rules.length ? `\n\n## Rules\n${rules.map(line => `- ${line}`).join('\n')}` : ''}`;
export const COMMON = ['Read every attached document in full, schedules and annexes included, before answering.', 'Give the clause, section or page for every finding.',
  // 12 Nov 2026 (the test set, round 4): a six-clause contract came back as a nine-section rewrite.
  'Size the work to the material: a short document gets a short review, findings ranked by impact, proposed wording only for the ones that matter most.',
  'Use every fact the user gives exactly as given; where one is still missing when you write, state one clear assumption in its place rather than a blank.'];
