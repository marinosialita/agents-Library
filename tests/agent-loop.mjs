// The agents' loop (server/agent-loop.ts): plan → work → check, with a fake provider that answers by call kind.
import assert from 'node:assert/strict';
import { createAgentRunHandler } from '../server/agent-run.ts';
import { askState, SKIP_TEXT } from '../server/agent-loop.ts';
import { parseAsk } from '../shared/ask-block.ts';

let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); process.exitCode = 1; } };
const json = value => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
const sse = text => new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: {"type":"response.completed","response":{}}\n\n`);
const provider = ({ plan, check, drafts }) => { const calls = []; let draft = 0;
  return { calls, fetcher: async (_url, init) => { const body = JSON.parse(init.body); const kind = body.text?.format?.name ?? 'work'; calls.push({ kind, body });
    if (kind === 'agent_plan') return json(plan); if (kind === 'agent_check') return json(check); return sse(drafts[Math.min(draft++, drafts.length - 1)]); } }; };
const run = async (handler, messages, ask = true) => {
  const response = await handler(new Request('http://localhost/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: { name: 'Pitch builder', instructions: 'Build an investor pitch.', jurisdiction: '', officialSearch: false, mode: 'fast', knowledge: [] }, messages, documents: [], language: 'en', ask }) }));
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line));
};

await test('plan asks first: typed and tap questions come back as the ask block, nothing is written yet', async () => {
  const fake = provider({ plan: { ask: true, questions: [{ question: 'What is your idea, in a sentence?', options: [] }, { question: 'What stage is it at?', options: ['Idea', 'Prototype', 'Revenue'] }], issues: ['the product'] }, check: { ok: true, problems: [] }, drafts: ['never'] });
  const events = await run(createAgentRunHandler({ key: () => 'k', fetcher: fake.fetcher }), [{ role: 'user', content: 'Help me pitch my idea' }]);
  const asked = parseAsk(events.find(event => event.type === 'done').answer);
  assert.deepEqual(asked, [{ question: 'What is your idea, in a sentence?', options: [] }, { question: 'What stage is it at?', options: ['Idea', 'Prototype', 'Revenue'] }]);
  assert.deepEqual(fake.calls.map(call => call.kind), ['agent_plan']);
});
await test('no questions needed: the plan goes into the work, the check passes, one draft', async () => {
  const fake = provider({ plan: { ask: false, questions: [], issues: ['the amount sought', 'the stage'] }, check: { ok: true, problems: [] }, drafts: ['The pitch.'] });
  const events = await run(createAgentRunHandler({ key: () => 'k', fetcher: fake.fetcher }), [{ role: 'user', content: 'Pitch my bakery app' }]);
  assert.equal(events.find(event => event.type === 'done').answer, 'The pitch.');
  assert.deepEqual(fake.calls.map(call => call.kind), ['agent_plan', 'work', 'agent_check']);
  const work = fake.calls[1].body;
  assert.ok(work.instructions.includes('THE PLAN FOR THIS ANSWER') && work.instructions.includes('the amount sought'));
  assert.ok(!work.instructions.includes('```ask'), 'the work step does not ask again');
  assert.ok(events.some(event => event.type === 'status' && event.text === 'checking'));
});
await test('a failing check rewrites the draft: reset, the new text, and the rewrite is told what to fix', async () => {
  const fake = provider({ plan: { ask: false, questions: [], issues: [] }, check: { ok: false, problems: ['It assumes Australian law.'] }, drafts: ['Under Australian law…', 'Which country applies?'] });
  const events = await run(createAgentRunHandler({ key: () => 'k', fetcher: fake.fetcher }), [{ role: 'user', content: 'Draft a termination letter' }]);
  assert.ok(events.some(event => event.type === 'reset'));
  assert.equal(events.find(event => event.type === 'done').answer, 'Which country applies?');
  const rewrite = fake.calls.at(-1).body.input.at(-1).content;
  assert.ok(rewrite.includes('It assumes Australian law.'));
});
await test('the loop fails open: a planner or checker that does not answer leaves the plain answer', async () => {
  const calls = []; const fetcher = async (_url, init) => { const kind = JSON.parse(init.body).text?.format?.name ?? 'work'; calls.push(kind); return kind === 'work' ? sse('Plain.') : new Response('down', { status: 500 }); };
  const events = await run(createAgentRunHandler({ key: () => 'k', fetcher, retryMs: 0 }), [{ role: 'user', content: 'Hello' }]);
  assert.equal(events.find(event => event.type === 'done').answer, 'Plain.');
});
await test('questions stop after two rounds or when the user skips', () => {
  const asked = { role: 'assistant', content: '```ask\n{"questions":[{"question":"Q?","options":["A","B"]}]}\n```' };
  const base = { agent: {}, documents: [], language: 'en' };
  assert.deepEqual(askState({ ...base, messages: [{ role: 'user', content: 'x' }] }), { rounds: 0, stop: false });
  assert.equal(askState({ ...base, messages: [{ role: 'user', content: 'x' }, asked, { role: 'user', content: SKIP_TEXT }] }).stop, true);
  assert.equal(askState({ ...base, messages: [{ role: 'user', content: 'x' }, asked, { role: 'user', content: 'a' }, asked, { role: 'user', content: 'b' }, asked, { role: 'user', content: 'c' }] }).stop, true);
  // 13 Nov 2026: two rounds at most (six questions before a letter is too many).
  assert.equal(askState({ ...base, messages: [{ role: 'user', content: 'x' }, asked, { role: 'user', content: 'a' }] }).stop, false);
  assert.equal(askState({ ...base, messages: [{ role: 'user', content: 'x' }, asked, { role: 'user', content: 'a' }, asked, { role: 'user', content: 'b' }] }).stop, true);
  // A new task after a real answer may ask again (13 Nov 2026, code review).
  assert.deepEqual(askState({ ...base, messages: [{ role: 'user', content: 'x' }, asked, { role: 'user', content: 'a' }, asked, { role: 'user', content: 'b' }, { role: 'assistant', content: 'The letter.' }, { role: 'user', content: 'Now a second letter' }] }), { rounds: 0, stop: false });
});
console.log(`${passed} loop checks passed.`);
