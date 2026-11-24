// «Teach it» (shared/teach.ts, server/agent-teach.ts): feedback → lessons (CrewAI's distill prompt), lessons in every
// later run (CrewAI's «You MUST follow these instructions») and in the loop's check (rule 12).
import assert from 'node:assert/strict';
import { cleanLessons, LESSON_LIMITS, redoMessage, validateTeachRequest } from '../shared/teach.ts';
import { createAgentTeachHandler, DISTILL_SYSTEM, readLessons } from '../server/agent-teach.ts';
import { agentInstruction, createAgentRunHandler } from '../server/agent-run.ts';
import { CHECK_RULES } from '../server/agent-loop.ts';
import { validateAgentRunRequest } from '../shared/agents.ts';
import { maskRunRequest } from '../src/data/privacy.ts';

let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); process.exitCode = 1; } };
const json = value => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
const post = (body, headers = {}) => new Request('http://localhost/api/agent-teach', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const good = { agent: 'Termination letter', output: 'Dear tenant, …', feedback: 'Too long, and put the amount owed in bold', language: 'en' };

await test('lessons are cleaned: trimmed, bullets dropped, no repeats, within the limits', async () => {
  assert.deepEqual(cleanLessons(['  - Keep it short ', 'keep it SHORT', '', 7, '• Bold the amount owed']), ['Keep it short', 'Bold the amount owed']);
  assert.equal(cleanLessons(['x'.repeat(400)])[0].length, LESSON_LIMITS.chars);
  assert.equal(cleanLessons(Array.from({ length: 50 }, (_, i) => `Rule ${i}`)).length, LESSON_LIMITS.perAgent);
});
await test('the request is checked: an empty feedback or an unknown language is refused', async () => {
  validateTeachRequest(good);
  assert.throws(() => validateTeachRequest({ ...good, feedback: '  ' }));
  assert.throws(() => validateTeachRequest({ ...good, language: 'xx' }));
  assert.throws(() => validateTeachRequest({ ...good, output: 'x'.repeat(LESSON_LIMITS.output + 1) }));
});
await test('the redo message says the feedback plainly', async () => {
  assert.equal(redoMessage('  Shorter please '), 'Redo your last answer with this feedback: Shorter please');
});
await test('the server sends CrewAI\'s distill prompt with a strict schema and returns at most five lessons with their scope', async () => {
  let sent = null;
  const handler = createAgentTeachHandler({ key: () => 'k', fetcher: async (_url, init) => { sent = JSON.parse(init.body);
    return json({ lessons: [{ text: 'Keep letters under one page', every: false }, { text: '- keep letters under one page', every: true }, { text: 'Put the amount owed in bold', every: false },
      ...Array.from({ length: 6 }, (_, i) => ({ text: `Extra ${i}`, every: true }))] }); } });
  const response = await handler(post(good));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.lessons.slice(0, 2), [{ text: 'Keep letters under one page', every: false }, { text: 'Put the amount owed in bold', every: false }]);
  assert.equal(body.lessons.length, LESSON_LIMITS.perTeach);
  assert.match(sent.instructions, /You extract generalizable lessons from human feedback on system outputs/);
  assert.match(sent.instructions, /return an empty list/);
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.strict, true);
  assert.match(sent.input[0].content, /Human feedback:\nToo long, and put the amount owed in bold/);
  assert.match(sent.input[0].content, /Extract generalizable lessons\. Return an empty list if none\./);
});
await test('approval only gives no lessons', async () => {
  const handler = createAgentTeachHandler({ key: () => 'k', fetcher: async () => json({ lessons: [] }) });
  assert.deepEqual((await (await handler(post({ ...good, feedback: 'Looks good' }))).json()).lessons, []);
});
await test('refusals: no key, another site, a bad body, a provider failure', async () => {
  const fetcher = async () => json({ lessons: [] });
  assert.equal((await createAgentTeachHandler({ key: () => '', fetcher })(post(good))).status, 503);
  assert.equal((await createAgentTeachHandler({ key: () => 'k', fetcher })(post(good, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }))).status, 403);
  assert.equal((await createAgentTeachHandler({ key: () => 'k', fetcher })(post({ ...good, feedback: '' }))).status, 400);
  assert.equal((await createAgentTeachHandler({ key: () => 'k', fetcher: async () => new Response('no', { status: 500 }) })(post(good))).status, 502);
  assert.equal((await createAgentTeachHandler({ key: () => 'k', fetcher: async () => json('not json') })(post(good))).status, 200);
});
await test('readLessons ignores junk', async () => {
  assert.deepEqual(readLessons(null), []);
  assert.deepEqual(readLessons({ lessons: [{ text: '' }, { nope: 1 }, { text: 'Use British spelling', every: 'yes' }] }), [{ text: 'Use British spelling', every: false }]);
});

const request = { agent: { name: 'Termination letter', instructions: 'Write the letter.', jurisdiction: '', officialSearch: false, mode: 'fast', knowledge: [], lessons: ['Keep letters under one page', 'Put the amount owed in bold'] },
  messages: [{ role: 'user', content: 'Write it' }], documents: [], language: 'en' };
await test('a run request carries the lessons; too many or too long are refused', async () => {
  validateAgentRunRequest(request);
  assert.throws(() => validateAgentRunRequest({ ...request, agent: { ...request.agent, lessons: Array.from({ length: LESSON_LIMITS.perAgent + 1 }, (_, i) => `R${i}`) } }));
  assert.throws(() => validateAgentRunRequest({ ...request, agent: { ...request.agent, lessons: ['x'.repeat(LESSON_LIMITS.chars + 1)] } }));
  assert.throws(() => validateAgentRunRequest({ ...request, agent: { ...request.agent, lessons: [''] } }));
});
await test('the brief puts the lessons after the agent\'s instructions, as a must', async () => {
  const brief = agentInstruction(request, '2026-11-12');
  const at = brief.indexOf('LESSONS THE USER TAUGHT THIS AGENT');
  assert.ok(at > brief.indexOf('Write the letter.'), 'after the instructions');
  assert.match(brief, /you MUST follow every one/);
  assert.match(brief, /- Keep letters under one page\n- Put the amount owed in bold/);
  assert.doesNotMatch(agentInstruction({ ...request, agent: { ...request.agent, lessons: undefined } }, '2026-11-12'), /LESSONS THE USER TAUGHT/);
});
await test('the check reads the lessons and house rules and fails a draft that breaks one (rule 12)', async () => {
  assert.match(CHECK_RULES, /12\. It breaks one of the LESSONS THE USER TAUGHT/);
  const calls = [];
  const sse = text => new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: {"type":"response.completed","response":{}}\n\n`);
  let drafts = 0;
  const handler = createAgentRunHandler({ key: () => 'k', fetcher: async (_url, init) => { const body = JSON.parse(init.body); const kind = body.text?.format?.name ?? 'work'; calls.push({ kind, body });
    if (kind === 'agent_plan') return json({ ask: false, questions: [], issues: [] });
    if (kind === 'agent_check') return json(drafts === 1 ? { ok: false, problems: ['The amount owed is not in bold (lesson).'] } : { ok: true, problems: [] });
    drafts += 1; return sse(drafts === 1 ? 'Long letter, amount 1,100.' : 'Short letter, amount **1,100**.'); } });
  const response = await handler(new Request('http://localhost/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, ask: true, house: { tone: '', positions: '', rules: ['Use British spelling'], files: [] } }) }));
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  const check = calls.find(call => call.kind === 'agent_check');
  assert.match(check.body.input[0].content, /LESSONS THE USER TAUGHT \(the draft must follow each\):\n- Keep letters under one page\n- Put the amount owed in bold\n- Use British spelling/);
  assert.equal(events.find(event => event.type === 'done').answer, 'Short letter, amount **1,100**.');
});

await test('names hidden: a lesson that names someone goes masked, like the rest of the request', async () => {
  const masked = maskRunRequest({ ...request, agent: { ...request.agent, lessons: ['Always copy jane.doe@example.com on letters'] }, messages: [{ role: 'user', content: 'Write to jane.doe@example.com' }] }, { on: true });
  assert.equal(masked.request.anonymised, true);
  assert.doesNotMatch(masked.request.agent.lessons[0], /jane\.doe@example\.com/);
  assert.match(masked.request.agent.lessons[0], /\[EMAIL 1\]/);
});

console.log(`\n${passed} passed`);
