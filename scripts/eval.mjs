// The agents' test set runner (12 Nov 2026): every task in evals/tasks.mjs is played through the real agent route
// (plan → work → check), with a simulated user who answers the agent's questions from the task's facts, and a judge
// who scores the final answer. Writes evals/results/<time>.json and prints a table. Needs OPENAI_API_KEY (.env.local).
// Usage: npm run eval            all 30 tasks
//        npm run eval -- pitch   only tasks whose id contains «pitch»
import fs from 'node:fs';
import path from 'node:path';
for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split('\n') : []) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { createAgentRunHandler } = await import('../server/agent-run.ts');
const { routeCatalogue } = await import('../server/agent-route.ts');
const { apiKey, modelId, RESPONSES_URL } = await import('../server/models.ts');
const { parseAsk, askReply } = await import('../shared/ask-block.ts');
const { TASKS } = await import('../evals/tasks.mjs');
if (!apiKey()) { console.log('No OPENAI_API_KEY in .env.local'); process.exit(1); }
const only = process.argv[2] ?? '';
// One id part, or several separated by commas («budget,speech»): the tasks whose id contains any of them.
const wanted = only.split(',').map(part => part.trim()).filter(Boolean);
const tasks = TASKS.filter(task => !wanted.length || wanted.some(part => task.id.includes(part)));
const { agents } = routeCatalogue();
const handler = createAgentRunHandler({ key: apiKey, fetcher: fetch });

// The network can drop for a moment (12 Nov 2026: 14 of 30 tasks ended in «fetch failed»): each call is tried three times.
const again = async (work, tries = 3) => { for (let attempt = 1; ; attempt++) { try { return await work(); } catch (error) { if (attempt >= tries) throw error; await new Promise(resolve => setTimeout(resolve, 4000 * attempt)); } } };
async function ai(name, instructions, input, schema) {
  const response = await again(() => fetch(RESPONSES_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId('balanced'), store: false, reasoning: { effort: 'low' }, max_output_tokens: 1_500, instructions, input: [{ role: 'user', content: input }], text: { format: { type: 'json_schema', name, strict: true, schema } } }) }));
  const body = await response.json();
  return JSON.parse(body.output.filter(item => item.type === 'message').flatMap(item => item.content).map(part => part.text).join(''));
}
const turn = async (agent, task, messages) => {
  const started = Date.now();
  const response = await handler(new Request('http://localhost:3000/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: { name: agent.name, instructions: agent.instructions, jurisdiction: task.country ?? '', officialSearch: agent.officialSearch && !!task.country, mode: 'fast', knowledge: [], needs: agent.needs },
      messages, documents: task.documents ?? [], language: 'en', ask: true }) }));
  const events = (await response.text()).trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const done = events.find(event => event.type === 'done');
  return { answer: done?.answer ?? `(error: ${events.at(-1)?.error ?? response.status})`, rewrote: events.some(event => event.type === 'reset'), seconds: Math.round((Date.now() - started) / 1000) };
};
const USER_SCHEMA = { type: 'object', additionalProperties: false, required: ['answers'], properties: { answers: { type: 'array', items: { type: 'string' } } } };
const JUDGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['score', 'pass', 'failures'], properties: { score: { type: 'integer' }, pass: { type: 'boolean' }, failures: { type: 'array', items: { type: 'string' } } } };
const JUDGE = `You judge an AI agent's work for a demanding professional. Score 0–10 and pass (score ≥ 7) or fail. List each failure in one short line. Always fail for: assuming a country or law the user did not give; a template of {placeholders} where facts were given or should have been asked; ignoring facts the user gave; inventing facts, figures, laws or memories; telling the user to copy/paste or saying it cannot make Excel; a «Next steps» section; asking for something already given. Also check every expectation listed. Proof marks like [^1] link to a proof list the app shows separately: never fail for them. Today\'s date is given below and is real; using it is not inventing. A country set for the conversation is given by the user: using it without asking is correct. Judge what the agent knew: the task, the files and the user's answers shown below. Where the user answered that they do not know something, treating it as open or making one clearly labelled assumption is correct, not an invention. A bracket for a name, address or signature nobody gave is acceptable. One short list of open points (at most five lines) at the end is allowed; a list of actions for the user is not. The agent's designed output is context only: agents are told to give the core deliverable for a simple request, so never fail one for leaving out a designed part the request did not need, and never for including one; fail only when the core deliverable itself is missing or wrong, or the answer is far longer than the request needs.`;

async function play(task) {
  const agent = agents.find(item => item.id === task.agent);
  if (!agent) return { id: task.id, error: `no agent ${task.agent}` };
  const messages = [{ role: 'user', content: task.say }]; let rounds = 0; let asked = []; const told = []; let last; let seconds = 0; let rewrites = 0;
  for (;;) {
    last = await turn(agent, task, messages); seconds += last.seconds; if (last.rewrote) rewrites++;
    const questions = parseAsk(last.answer);
    if (!questions || rounds >= 3) break;
    rounds++; asked.push(...questions.map(item => item.question));
    const reply = await ai('sim_user', 'You are the user, a busy professional. Answer each of the agent\'s questions from YOUR FACTS; when a question touches a fact you have (a name, a quote, a date, an amount), give it in full, and add any other fact from YOUR FACTS that clearly belongs with that answer. If a fact is not there, say you do not know.', `YOUR FACTS: ${task.facts}\n\nQUESTIONS:\n${questions.map((item, i) => `${i + 1}. ${item.question}${item.options.length ? ` (options: ${item.options.join(' / ')})` : ''}`).join('\n')}`, USER_SCHEMA);
    const answers = questions.map((_, i) => reply.answers[i] ?? 'I do not know');
    told.push(...questions.map((item, i) => `Q: ${item.question}\nA: ${answers[i]}`));
    messages.push({ role: 'assistant', content: last.answer }, { role: 'user', content: askReply(questions, answers) });
  }
  const verdict = await ai('judge', JUDGE, `TODAY: ${new Date().toISOString().slice(0, 10)}\nTASK: ${task.say}\nTHE USER'S FACTS (given only when asked): ${task.facts}\nATTACHED: ${(task.documents ?? []).map(file => `${file.name}: ${file.text}`).join('\n') || 'none'}\nCOUNTRY SET FOR THE CONVERSATION: ${task.country ? `${task.country} (given by the user)` : 'none'}\nEXPECTATIONS:\n${task.expect.map(line => `- ${line}`).join('\n')}\n\nWHAT THE AGENT ASKED AND THE USER ANSWERED (${rounds} rounds; these answers are facts the agent was given):\n${told.join('\n') || 'nothing was asked'}\n\nTHE OUTPUT THIS AGENT IS DESIGNED TO GIVE: ${(/## Output\n([\s\S]*?)(\n\n## |$)/.exec(agent.instructions)?.[1] ?? '').replace(/\n/g, ' ').slice(0, 600)}\n\nTHE AGENT'S FINAL ANSWER:\n${last.answer.replace(/<proofs>[\s\S]*$/, '').slice(0, 20_000)}`, JUDGE_SCHEMA);
  return { id: task.id, agent: agent.name, rounds, asked, rewrites, seconds, score: verdict.score, pass: verdict.pass, failures: verdict.failures, answer: last.answer.slice(0, 4_000) };
}

const results = []; const queue = [...tasks]; const started = Date.now();
await Promise.all(Array.from({ length: 5 }, async () => { for (let task = queue.shift(); task; task = queue.shift()) {
  try { const result = await play(task); results.push(result); console.log(`${result.pass ? 'PASS' : 'FAIL'} ${String(result.score).padStart(2)}  ${result.id.padEnd(20)} ${result.rounds}q ${result.rewrites}rw ${result.seconds}s  ${(result.failures ?? []).join(' · ').slice(0, 160)}`); }
  catch (error) { results.push({ id: task.id, error: String(error).slice(0, 200) }); console.log(`ERR     ${task.id}: ${String(error).slice(0, 160)}`); }
} }));
const scored = results.filter(result => typeof result.score === 'number');
const summary = { at: new Date().toISOString(), tasks: results.length, passed: scored.filter(result => result.pass).length, average: +(scored.reduce((n, result) => n + result.score, 0) / Math.max(1, scored.length)).toFixed(2), minutes: +((Date.now() - started) / 60_000).toFixed(1) };
fs.mkdirSync('evals/results', { recursive: true });
const file = path.join('evals/results', `${summary.at.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify({ summary, results }, null, 1));
console.log(`\n${summary.passed}/${summary.tasks} passed · average ${summary.average}/10 · ${summary.minutes} min · ${file}`);
