// «Today»: the brief's «Needs you today» items, the week's counts, and the route (demo calendar when nothing is connected).
import assert from 'node:assert/strict';
import { createTodayHandler, needsOf, summariseRuns } from '../server/today.ts';
import { createMailHandler } from '../server/mail.ts';
import { takeMailRefs } from '../shared/mail-refs.ts';

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok   ${name}`); };
const NOW = Date.parse('2026-11-11T06:00:00Z');
const brief = 'Demo inbox: invented messages.\n\n## Needs you today\n1. Confirm the completion funds by 16:00. (Gmail · Helen · 04:00)\n2) File the skeleton argument.\n\n## Today\'s meetings\n- 10:00 Call';
const run = (extra) => ({ id: 'r', routineId: 'rt', routineName: 'Morning inbox brief', trigger: 'schedule', startedAt: NOW - 3_600_000, finishedAt: NOW, status: 'done', steps: [], answer: brief, delivered: [{ channel: 'email', to: 'x', ok: true }], demo: true, read: { mail: 7, opened: 2, events: 3 }, flagged: 1, ...extra });

await check('needs: the numbered items under «Needs you today», nothing from other sections', () => {
  assert.deepEqual(needsOf(brief), ['Confirm the completion funds by 16:00. (Gmail · Helen · 04:00)', 'File the skeleton argument.']);
  assert.deepEqual(needsOf('## Can wait\n1. Later'), []);
});
await check('week: briefs, reads, flags, sends and failures of the last 7 days; the newest done brief gives the needs', () => {
  const summary = summariseRuns([run({}), run({ status: 'failed', answer: '', startedAt: NOW - 600_000, delivered: [], read: undefined, flagged: 0 }), run({ startedAt: NOW - 9 * 86_400_000 })], NOW);
  assert.deepEqual(summary.done, { briefs: 1, failed: 1, read: 10, flagged: 1, sent: 1 });
  assert.equal(summary.needs.length, 2);
  assert.equal(summary.lastBrief.name, 'Morning inbox brief');
  // A later news check, quiet or without a «Needs you today» list, does not empty the box or count as a brief.
  const later = summariseRuns([run({}), run({ routineName: 'Cyprus criminal news (hourly)', startedAt: NOW - 60_000, answer: 'Nothing new since the previous run.', quiet: true }), run({ routineName: 'News', startedAt: NOW - 30_000, answer: '## Courts\n1. A judgment' })], NOW);
  assert.deepEqual([later.needs.length, later.lastBrief.name, later.done.briefs], [2, 'Morning inbox brief', 2]);
});
await check('route: nobody signed in sees the demo calendar and no runs; another site is refused', async () => {
  const handler = createTodayHandler({ composio: { key: () => '', authConfigs: () => ({}), ownerCode: () => '', fetcher: fetch }, store: null, now: () => NOW });
  const reply = await (await handler(new Request('http://localhost/api/today?tz=Europe/Nicosia'))).json();
  assert.deepEqual([reply.demo, reply.signedIn, reply.meetings.length, reply.needs.length], [true, false, 3, 0]);
  assert.equal((await handler(new Request('http://localhost/api/today', { headers: { Origin: 'https://evil.example' } }))).status, 403);
});
await check('mail links: «[m3]» leaves the text, stays with its line, and «Needs you» opens that e-mail', () => {
  const refs = new Map([['m3', { service: 'gmail', id: 'abc123', from: 'Bank <x@bank.example>', subject: 'Funds', date: '2026-11-12T06:00:00Z' }]]);
  // A ref alone on its line becomes the e-mail's subject and sender in words (12 Nov 2026: «… below:» then nothing).
  const alone = takeMailRefs('The two others are:\n- [m3]\n[m3]', refs);
  assert.ok(!/\[m\d\]/.test(alone.answer) && alone.answer.split('\n').slice(1).every(line => /«.+» from /.test(line)), alone.answer);
  const taken = takeMailRefs('## Needs you today\n1. **Confirm the funds** by 16:00. [m3]\n2. File the skeleton argument. [m9]', refs);
  assert.ok(!/\[m\d+\]/.test(taken.answer));
  assert.deepEqual(taken.links.map(link => [link.text, link.id]), [['**Confirm the funds** by 16:00.', 'abc123']]);
  const summary = summariseRuns([run({ answer: taken.answer, mails: taken.links })], NOW);
  assert.deepEqual(summary.needs.map(need => need.mail?.id ?? null), ['abc123', null]);
});
await check('mail route: signed out → 401, bad id or app → 400, another site → 403; nothing is read', async () => {
  let calls = 0;
  const handler = createMailHandler({ composio: { key: () => 'k', authConfigs: () => ({ gmail: 'ac' }), ownerCode: () => '', fetcher: async () => { calls++; return new Response('{}'); } }, now: () => NOW });
  assert.equal((await handler(new Request('http://localhost/api/mail?service=gmail&id=abc'))).status, 401);
  assert.equal((await handler(new Request('http://localhost/api/mail?service=github&id=abc'))).status, 400);
  assert.equal((await handler(new Request('http://localhost/api/mail?service=gmail&id=a%20b'))).status, 400);
  assert.equal((await handler(new Request('http://localhost/api/mail?service=gmail&id=abc', { headers: { Origin: 'https://evil.example' } }))).status, 403);
  assert.equal(calls, 0);
});

// 13 Nov 2026 (his «why do these 2 boxes show the same thing?»): the brief's column on Today leaves out the to-dos that
// «Needs you» shows; everything else in the brief stays.
await check('the column leaves out the «Needs you today» list that the Needs you box shows, and keeps the rest', async () => {
  const { withoutNeeds, needsOf: shared } = await import('../shared/needs.ts');
  const brief = 'Demo inbox: invented messages.\n\n## Needs you today\n1. **Court matter.** Prepare for Monday.\n2. **Billing.** Pay the invoice.\n\n## Changed\n- Drive: nothing new.';
  assert.equal(withoutNeeds(brief), 'Demo inbox: invented messages.\n\n## Changed\n- Drive: nothing new.');
  assert.deepEqual(shared(brief), needsOf(brief)); assert.equal(needsOf(brief).length, 2);
  assert.equal(withoutNeeds('## Needs you today\n1. Only this.'), '');
  assert.equal(withoutNeeds('## Changed\n- Nothing.'), '## Changed\n- Nothing.');
});
console.log(`${passed} today checks passed.`);
