// «Watch and Learn» (11 Nov 2026): the written procedure the server returns (server/learn.ts), shared with the page.
export type LearnedProcess = { title: string; summary: string; tools: string[]; steps: { step: string; why: string }[]; inputs: string[]; decisions: string[]; exceptions: string[]; result: string; questions: string[] };

/** The procedure as the description «Build it for me» receives (its limit is 4,000 characters). */
export function processAsTask(process: LearnedProcess): string {
  const lines = [`Build an agent that does this work the way I showed it: ${process.title}.`, process.summary,
    process.tools.length ? `Tools: ${process.tools.join(', ')}.` : '', 'Steps:', ...process.steps.map((item, index) => `${index + 1}. ${item.step}${item.why ? ` (${item.why})` : ''}`),
    process.inputs.length ? `Inputs: ${process.inputs.join('; ')}.` : '', process.decisions.length ? `Decisions: ${process.decisions.join('; ')}.` : '',
    process.exceptions.length ? `Exceptions: ${process.exceptions.join('; ')}.` : '', process.result ? `Result: ${process.result}` : ''].filter(Boolean);
  let out = ''; for (const line of lines) { if ((out + line).length + 1 > 3_900) break; out += `${out ? '\n' : ''}${line}`; }
  return out;
}
