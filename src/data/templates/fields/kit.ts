// The writing kit of the ready agents of every field but Legal (6 Nov 2026). One file per field (finance.ts, hr.ts, …)
// exports its agents in this shape; index.ts turns them into ready agents. English only: the agent answers in the
// user's language (the server's instruction), the catalogue is written once.
import type { AgentDefinition } from '../../../../shared/agents.ts';
import type { FieldId } from '../../../../shared/fields.ts';

export type FieldTemplate = {
  /** Kebab-case, unique across the platform, starting with the field id: «finance-month-end-close». */
  id: string;
  /** A category id of the field (shared/fields.ts). */
  category: string;
  /** 2 to 5 words naming the task; never «Agent», «AI» or «Assistant». */
  name: string;
  /** What it does and what it returns, at most 220 characters (three lines on a card). */
  description: string;
  /** One sentence: what to upload and which details to give. */
  needs: string;
  /** Exactly nine requests the user really types to this agent, most common first, each under 14 words. */
  starters: string[];
  /** Markdown from doc(): Role, Task, Output, Rules. */
  instructions: string;
  /** True only when the task depends on the current law, regulation, official guidance or forms of a place. */
  officialSearch?: boolean;
  /** «deep» only for long, multi-document analysis; the default is fast. */
  mode?: 'fast' | 'deep';
};

/** A field's catalogue: its agents and four one-line ideas for the builder. */
export type FieldCatalogue = { field: FieldId; agents: FieldTemplate[] };

/** Rules every agent of every field holds to, after its own. */
// 12 Nov 2026 (the test set, round 4): the old wording («where something is missing, name it… never fill the gap»)
// made agents hand back lists of what was missing and templates of blanks; and every agent gave its whole Output
// list for the smallest request. The agent now uses what it was told, sizes the work to the request and commits.
export const COMMON = [
  'Read everything attached in full before answering.',
  'Lead with the answer or the deliverable, then the reasoning that supports it.',
  'Use every fact the user gives exactly as given, and work out what follows from it (a total, a calendar date, the country a city is in).',
  'The Output list is the full deliverable for a full brief. For a short or simple request give the core deliverable and only the other parts that clearly help; leave out a part whose inputs were not given rather than filling it with caveats.',
  'Where a fact is still missing when you write, put one clearly labelled assumption in its place and carry on. No blanks and no brackets, except for a name, an address or a signature nobody gave.',
  'Never invent figures, names, dates, quotations or sources.',
];

/** The instructions of an agent: a role, the task as ordered steps, the output it gives, its rules (then COMMON). */
export const doc = (role: string, task: string[], output: string[], rules: string[] = []) =>
  `## Role\n${role}\n\n## Task\n${task.map(line => `- ${line}`).join('\n')}\n\n## Output\n${output.map(line => `- ${line}`).join('\n')}\n\n## Rules\n${[...rules, ...COMMON].map(line => `- ${line}`).join('\n')}`;

/** A field template as a ready agent. A template never fixes a jurisdiction: it follows the workspace's chosen one
 *  (fallback), and when none is chosen it stays unset; an agent that researches asks for one before it runs. */
export function fieldTemplateAgent(field: FieldId, template: FieldTemplate, now = 0, fallback = ''): AgentDefinition {
  return { id: `ready-${template.id}`, field, name: template.name, description: template.description, category: template.category,
    instructions: template.instructions, starters: [...template.starters], needs: template.needs,
    jurisdiction: fallback, officialSearch: template.officialSearch ?? false, mode: template.mode ?? 'fast',
    knowledge: [], origin: 'ready', createdAt: now, updatedAt: now };
}
