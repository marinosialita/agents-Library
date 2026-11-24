// «Watch and Learn»: what the route accepts, how the AI's procedure is read, and the hand-off to «Build it for me».
import assert from 'node:assert/strict';
import { createLearnHandler, readLearnRequest, readLearnedProcess } from '../server/learn.ts';
import { processAsTask } from '../shared/learn.ts';

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok   ${name}`); };
const FRAME = 'data:image/jpeg;base64,' + 'A'.repeat(1000);

await check('input: only small image frames, notes and up to three written processes; something to learn from', () => {
  assert.equal(readLearnRequest({ frames: [FRAME], notes: ' weekly report ' }).notes, 'weekly report');
  assert.throws(() => readLearnRequest({ frames: [], notes: 'x' }), 'nothing to learn from');
  assert.throws(() => readLearnRequest({ frames: ['https://evil.example/x.png'] }), 'a link is not a frame');
  assert.throws(() => readLearnRequest({ frames: Array(25).fill(FRAME) }));
  assert.throws(() => readLearnRequest({ frames: [], documents: [{ name: 'a', text: 'x' }, { name: 'b', text: 'x' }, { name: 'c', text: 'x' }, { name: 'd', text: 'x' }] }));
});
await check('reply: the procedure is read and clipped; a reply without steps is refused', () => {
  const wrap = value => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
  const read = readLearnedProcess(wrap({ title: 'Weekly client report', summary: 'S', tools: ['Sheets'], steps: [{ step: 'Open the tracking sheet', why: 'latest numbers' }], inputs: [], decisions: [], exceptions: [], result: 'R', questions: ['Which folder?'] }));
  assert.equal(read.steps[0].step, 'Open the tracking sheet');
  assert.equal(readLearnedProcess(wrap({ title: 'x', steps: [] })), null);
  assert.equal(readLearnedProcess({ output: [] }), null);
});
await check('hand-off: the procedure becomes a builder description under 4,000 characters', () => {
  const task = processAsTask({ title: 'Report', summary: 'Weekly.', tools: ['Sheets'], steps: Array.from({ length: 40 }, (_, i) => ({ step: `Step ${i} `.repeat(15), why: 'because' })), inputs: ['sheet'], decisions: [], exceptions: [], result: 'PDF', questions: [] });
  assert.ok(task.length <= 3_900 && task.startsWith('Build an agent that does this work the way I showed it: Report.'));
});
await check('route: without the AI key nothing is sent; frames go to the model as images with store off', async () => {
  const body = JSON.stringify({ frames: [FRAME], notes: 'n' });
  const req = () => new Request('http://localhost/api/learn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal((await createLearnHandler({ key: () => '', fetcher: async () => { throw new Error('never'); } })(req())).status, 503);
  let sent;
  const handler = createLearnHandler({ key: () => 'sk-test', fetcher: async (_url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ title: 'T', summary: '', tools: [], steps: [{ step: 'Do it', why: '' }], inputs: [], decisions: [], exceptions: [], result: '', questions: [] }) }] }] })); } });
  const reply = await (await handler(req())).json();
  assert.equal(reply.process.title, 'T');
  assert.equal(sent.store, false);
  assert.deepEqual(sent.input[0].content.slice(1), [{ type: 'input_image', image_url: FRAME, detail: 'low' }]);
});
console.log(`${passed} learn checks passed.`);
