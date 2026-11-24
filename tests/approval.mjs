// «Ask me before sending» (12 Nov 2026, CrewAI's @human_feedback ported): a routine that would send its brief keeps it
// waiting; Send it delivers it, Change redoes it with the person's words (same run, waits again), Don't send stops it.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { deliversSomewhere, readRoutineInput } from '../shared/routines.ts';
import { fileStore } from '../server/routines/store.ts';
import { executeRoutine } from '../server/routines/run.ts';
import { createRoutinesHandler } from '../server/routines/routes.ts';

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('ok  ', name); } catch (error) { console.log('FAIL', name); console.log('     ', error.stack?.split('\n').slice(0, 3).join(' | ') ?? error.message); process.exitCode = 1; } };
const CODE = 'owner-code-for-tests-0123456789';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tempStore = async () => fileStore(await fs.mkdtemp(path.join(os.tmpdir(), 'agents-approval-')));
const delivery = () => ({ email: { token: 'pm-token', from: 'briefs@agents.example', stream: 'outbound', allowed: new Set(['me@owner.example']) }, whatsapp: null, telegram: null });
const agent = { name: 'Weekly case updates', instructions: 'Track new judgments.', question: 'Give me the new judgments', jurisdiction: '', officialSearch: false, mode: 'fast' };
const base = { id: 'rt-appr-0001', name: 'Weekly case updates', brief: 'morning-inbox-brief', source: 'mine', days: [1], time: '09:00', timeZone: 'Europe/Nicosia', deliver: { email: 'me@owner.example', whatsapp: null },
  namesHidden: false, language: 'en', enabled: true, createdAt: 1, updatedAt: 1, agent, approve: true };
const request = (body, headers = { 'X-Owner-Code': CODE }) => new Request('http://localhost:5181/api/routines', { method: 'POST', headers: { Host: 'localhost:5181', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const setup = async (answers = ['## New\n1. Judgment A, long version.', '## New\n1. Judgment A.']) => {
  const store = await tempStore(); const asked = []; const sent = []; let turn = 0;
  const agentRun = async req => { asked.push(JSON.parse(await req.text())); return new Response(JSON.stringify({ type: 'done', answer: answers[Math.min(turn++, answers.length - 1)], sources: [] })); };
  const deps = { store, composio: { key: () => '', authConfigs: () => ({}), ownerCode: () => CODE, fetcher: fetch }, openaiKey: () => 'sk-test', provider: () => { throw new Error('no model'); },
    delivery, fetcher: async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return json({ MessageID: 'm1', ErrorCode: 0 }); }, now: () => Date.parse('2026-11-16T07:00:00Z'), agentRun };
  await store.save({ ...base, owner: 'agents-owner' });
  return { store, asked, sent, deps, handler: createRoutinesHandler(deps, { ownerCode: () => CODE }) };
};
const post = async (handler, body, headers) => { const response = await handler(request(body, headers)); return [response.status, await response.json()]; };

await test('the switch: kept only as true, refused when not a yes or no; it needs somewhere to send', () => {
  const { id: _i, createdAt: _c, updatedAt: _u, ...input } = base;
  assert.equal(readRoutineInput(input).approve, true);
  assert.equal('approve' in readRoutineInput({ ...input, approve: false }), false);
  assert.throws(() => readRoutineInput({ ...input, approve: 'yes' }));
  assert.equal(deliversSomewhere({ deliver: { email: null, whatsapp: null } }), false);
  assert.equal(deliversSomewhere({ deliver: { email: null, whatsapp: null, telegram: '55501' } }), true);
});
await test('a run waits instead of sending: nothing goes out, the step says why', async () => {
  const { store, sent, deps } = await setup();
  const run = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  assert.equal(run.status, 'done');
  assert.deepEqual(run.approval, { state: 'waiting' });
  assert.deepEqual(run.delivered, []);
  assert.equal(sent.length, 0, 'no e-mail before the OK');
  assert.ok(run.steps.includes('Waiting for your OK before sending'));
  assert.equal((await store.runs())[0].id, run.id);
});
await test('without the switch, or with nowhere to send, it is sent at once as before', async () => {
  const { sent, deps } = await setup();
  const plain = await executeRoutine({ ...base, approve: undefined, owner: 'agents-owner' }, 'schedule', deps);
  assert.equal(plain.approval, undefined); assert.equal(plain.delivered[0].ok, true); assert.equal(sent.length, 1);
  const nowhere = await executeRoutine({ ...base, deliver: { email: null, whatsapp: null }, owner: 'agents-owner' }, 'schedule', deps);
  assert.equal(nowhere.approval, undefined, 'only in the app: nothing to approve');
});
await test('Change redoes it with the words and the version read, keeps the run, and waits again', async () => {
  const { store, asked, sent, deps, handler } = await setup();
  const first = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  const [status, body] = await post(handler, { action: 'revise-run', id: first.id, feedback: 'Shorter, one line per judgment' });
  assert.equal(status, 200);
  assert.equal(body.run.id, first.id, 'the same run, changed in place');
  assert.equal(body.run.answer, '## New\n1. Judgment A.');
  assert.deepEqual(body.run.approval, { state: 'waiting', feedback: ['Shorter, one line per judgment'] });
  assert.equal(sent.length, 0);
  const redo = asked[1].messages;
  assert.equal(redo.length, 3);
  assert.equal(redo[1].role, 'assistant'); assert.equal(redo[1].content, '## New\n1. Judgment A, long version.');
  assert.equal(redo[2].content, 'Redo your last answer with this feedback: Shorter, one line per judgment');
  assert.equal((await store.runs()).length, 1, 'no second run in the history');
  const [, again] = await post(handler, { action: 'revise-run', id: first.id, feedback: 'Add the court' });
  assert.deepEqual(again.run.approval.feedback, ['Shorter, one line per judgment', 'Add the court']);
});
await test('Change on a run a link started keeps the data it was given (13 Nov 2026, code review); sending drops it', async () => {
  const { asked, deps, handler } = await setup();
  const hooked = { ...base, owner: 'agents-owner', trigger: { kind: 'hook' } };
  const first = await executeRoutine(hooked, 'event', deps, undefined, undefined, undefined, { context: 'DATA SENT TO THE LINK: {"name":"Maria","request":"refund 120 EUR"}', cause: 'hook' });
  assert.match(first.input, /refund 120 EUR/);
  const [, body] = await post(handler, { action: 'revise-run', id: first.id, feedback: 'Shorter' });
  assert.match(asked[1].messages[0].content, /refund 120 EUR/, 'the redo sees the same data');
  assert.equal(body.run.cause, 'hook');
  const [, sent] = await post(handler, { action: 'approve-run', id: first.id });
  assert.equal(sent.run.input, undefined);
});
await test('names hidden: data sent to a routine\'s link reaches the AI as placeholders and the names come back (13 Nov 2026)', async () => {
  const { asked, deps } = await setup(['[PERSON 1] wants a refund of the deposit.']);
  const hooked = { ...base, owner: 'agents-owner', namesHidden: true, approve: false, deliver: { email: null, whatsapp: null }, trigger: { kind: 'hook' } };
  const run = await executeRoutine(hooked, 'event', deps, undefined, undefined, undefined, { context: 'DATA SENT TO THE LINK: name: Maria Georgiou, email: maria.georgiou@example.com, message: refund please', cause: 'hook' });
  const sent = asked[0].messages[0].content;
  assert.doesNotMatch(sent, /Maria Georgiou|maria\.georgiou@example\.com/); assert.match(sent, /\[PERSON 1\]/); assert.equal(asked[0].anonymised, true);
  assert.equal(run.answer, 'Maria Georgiou wants a refund of the deposit.');
});
await test('Send it delivers the waiting version once; a second press is refused', async () => {
  const { store, sent, deps, handler } = await setup();
  const first = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  const [status, body] = await post(handler, { action: 'approve-run', id: first.id });
  assert.equal(status, 200);
  assert.equal(body.run.approval.state, 'sent');
  assert.equal(body.run.delivered[0].ok, true);
  assert.equal(sent.length, 1); assert.equal(sent[0].body.To, 'me@owner.example');
  assert.ok(body.run.steps.includes('Sent after your OK') && !body.run.steps.includes('Waiting for your OK before sending'));
  assert.equal((await store.runs())[0].approval.state, 'sent');
  const [twice, refused] = await post(handler, { action: 'approve-run', id: first.id });
  assert.equal(twice, 409); assert.equal(refused.error, 'not_waiting'); assert.equal(sent.length, 1);
});
await test('two presses at once send it once', async () => {
  const { sent, deps, handler } = await setup();
  const first = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  const results = await Promise.all([post(handler, { action: 'approve-run', id: first.id }), post(handler, { action: 'approve-run', id: first.id })]);
  assert.deepEqual(results.map(([status]) => status).sort(), [200, 409]);
  assert.equal(sent.length, 1);
});
await test('a change waits again even if the switch was turned off meanwhile', async () => {
  const { store, sent, deps, handler } = await setup();
  const first = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  await store.save({ ...base, approve: undefined, owner: 'agents-owner' });
  const [, body] = await post(handler, { action: 'revise-run', id: first.id, feedback: 'Shorter' });
  assert.equal(body.run.approval.state, 'waiting'); assert.equal(sent.length, 0);
});
await test('Don\'t send stops it; nothing goes out', async () => {
  const { sent, deps, handler } = await setup();
  const first = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  const [status, body] = await post(handler, { action: 'reject-run', id: first.id });
  assert.equal(status, 200); assert.equal(body.run.approval.state, 'rejected'); assert.equal(sent.length, 0);
  assert.equal((await post(handler, { action: 'revise-run', id: first.id, feedback: 'x' }))[0], 409);
});
await test('refusals: no owner code, someone else\'s run, an empty or too long change, a deleted routine', async () => {
  const { store, deps, handler } = await setup();
  const first = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  assert.equal((await post(handler, { action: 'approve-run', id: first.id }, {}))[0], 401);
  await store.updateRun({ ...first, owner: 'someone-else' });
  assert.equal((await post(handler, { action: 'approve-run', id: first.id }))[0], 404);
  await store.updateRun(first);
  assert.equal((await post(handler, { action: 'revise-run', id: first.id, feedback: '  ' }))[0], 400);
  assert.equal((await post(handler, { action: 'revise-run', id: first.id, feedback: 'x'.repeat(2_001) }))[0], 400);
  await store.remove(base.id);
  assert.equal((await post(handler, { action: 'approve-run', id: first.id }))[0], 410);
  assert.equal((await post(handler, { action: 'reject-run', id: first.id }))[0], 200, 'a run whose routine is gone can still be stopped');
});
await test('a change that fails leaves the waiting version as it was', async () => {
  const { store, deps, handler } = await setup(['## New\n1. Judgment A.', '']);
  const first = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  const [status, body] = await post(handler, { action: 'revise-run', id: first.id, feedback: 'Shorter' });
  assert.equal(status, 200); assert.ok(body.run.error);
  const kept = (await store.runs())[0];
  assert.equal(kept.answer, '## New\n1. Judgment A.'); assert.deepEqual(kept.approval, { state: 'waiting' });
});
await test('the list always carries a waiting run, even behind 20 newer ones', async () => {
  const { store, deps, handler } = await setup();
  const first = await executeRoutine({ ...base, owner: 'agents-owner' }, 'schedule', deps);
  for (let i = 0; i < 22; i++) await store.addRun({ ...first, id: `run-x-${i}`, approval: undefined });
  const response = await handler(new Request('http://localhost:5181/api/routines', { headers: { Host: 'localhost:5181', 'X-Owner-Code': CODE } }));
  const list = await response.json();
  assert.ok(list.runs.some(run => run.id === first.id && run.approval?.state === 'waiting'));
});

console.log(`\n${passed} passed`);
