// Chat on Telegram (server/inbound/telegram.ts): only allowed chats, each update once, the answer and its Word copy back
// to the same chat, files fetched by the bot, the backlog skipped when listening starts, the webhook's secret.
import assert from 'node:assert/strict';
import { createTelegramHandler, handleTelegramUpdate, pollTelegram, telegramParts, telegramTexts } from '../server/inbound/telegram.ts';

let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.stack?.split('\n').slice(0, 2).join(' | ')}`); process.exitCode = 1; } };
const config = { token: '123456:' + 'a'.repeat(35), allowed: new Set(['55501']), secret: 's3cret-value' };
const setup = (result, files = {}) => { const calls = []; const runs = [];
  const fetcher = async (url, init = {}) => { const method = String(url).split('/').pop(); const body = init.body instanceof FormData ? Object.fromEntries([...init.body.keys()].map(key => [key, init.body.get(key)])) : init.body ? JSON.parse(init.body) : null; calls.push([method, body]);
    if (method === 'getFile') return Response.json({ ok: true, result: { file_path: 'documents/file_1.pdf', file_size: 10 } });
    if (String(url).includes('/file/bot')) return new Response(new Uint8Array([37, 80, 68, 70]));
    if (method === 'getUpdates') return Response.json({ ok: true, result: files.updates?.(body) ?? [] });
    return Response.json({ ok: true, result: {} }); };
  return { calls, runs, deps: { key: () => 'k', fetcher, run: async message => { runs.push(message); return result; } } };
};
const answer = { kind: 'answer', agent: { id: 'a', name: 'Lease review' }, place: 'Cyprus', answer: '**Short answer:** yes.[^1]\n\n<proofs>x</proofs>', sources: [{ title: 'Rent Control Law', url: 'https://www.cylaw.org/x' }], gaps: [], notes: [], hidden: 2, word: new Uint8Array([1, 2]), wordName: 'Lease review.docx' };
let id = 1000;
const update = message => ({ update_id: ++id, message: { message_id: 1, chat: { id: 55501 }, ...message } });

await test('a chat not on the list is ignored, nothing is sent or run', async () => {
  const { calls, runs, deps } = setup(answer);
  assert.equal(await handleTelegramUpdate({ update_id: ++id, message: { chat: { id: 999 }, text: 'hi' } }, config, deps), 'ignored');
  assert.deepEqual([calls.length, runs.length], [0, 0]);
});
await test('an allowed text runs once: typing, the answer as plain text with sources, then the Word copy', async () => {
  const { calls, runs, deps } = setup(answer);
  const one = update({ text: 'Can my landlord raise the rent?' });
  assert.equal(await handleTelegramUpdate(one, config, deps), 'answered');
  assert.equal(await handleTelegramUpdate(one, config, deps), 'ignored', 'the same update is never run twice');
  assert.deepEqual(runs[0], { channel: 'telegram', from: '55501', text: 'Can my landlord raise the rent?', attachments: [] });
  assert.deepEqual(calls.map(([method]) => method), ['sendChatAction', 'sendMessage', 'sendDocument']);
  assert.match(calls[1][1].text, /^Short answer: yes\.\n\nSources\n1\. Rent Control Law: https:\/\/www\.cylaw\.org\/x\n\n— Lease review \(Cyprus\) · .* · 2 hidden from the AI$/);
  assert.equal(calls[2][1].chat_id, '55501'); assert.equal(calls[2][1].document.name, 'Lease review.docx');
});
await test('/start is the help; a document with a caption is fetched by the bot and sent with the task', async () => {
  const help = setup({ kind: 'reply', reason: 'help', text: 'How to send work…' });
  await handleTelegramUpdate(update({ text: '/start' }), config, help.deps);
  assert.equal(help.runs[0].text, 'help');
  const file = setup(answer);
  await handleTelegramUpdate(update({ caption: 'Review this lease', document: { file_id: 'F1', file_name: 'lease.pdf', mime_type: 'application/pdf' } }), config, file.deps);
  assert.equal(file.runs[0].text, 'Review this lease');
  assert.deepEqual(file.runs[0].attachments.map(item => [item.name, item.type, [...item.bytes]]), [['lease.pdf', 'application/pdf', [37, 80, 68, 70]]]);
});
await test('listening starts after the backlog: what was waiting is acknowledged, not answered', async () => {
  const { calls, runs, deps } = setup(answer, { updates: body => body.offset === -1 ? [{ update_id: 70, message: { chat: { id: 55501 }, text: 'old' } }] : body.offset === 71 ? [{ update_id: 71, message: { chat: { id: 55501 }, text: 'new task' } }] : [] });
  const state = {};
  await pollTelegram(config, deps, state, 0);
  assert.equal(state.offset, 72);
  assert.deepEqual(runs.map(run => run.text), ['new task']);
  assert.deepEqual(calls.filter(([method]) => method === 'getUpdates').map(([, body]) => body.offset), [-1, 71]);
});
await test('if the first look at the backlog fails, it is tried again later and nothing old is answered (13 Nov 2026, code review)', async () => {
  const { runs, deps } = setup(answer);
  const failing = { ...deps, fetcher: async () => { throw new Error('offline'); } };
  const state = {};
  await assert.rejects(pollTelegram(config, failing, state, 0));
  assert.equal(state.offset, undefined); assert.equal(runs.length, 0);
});
await test('the webhook: no secret set → off; a wrong secret → 403; long answers split on paragraphs', async () => {
  assert.equal((await createTelegramHandler(setup(answer).deps, () => ({ ...config, secret: '' }))(new Request('http://x/api/telegram', { method: 'POST', body: '{}' }))).status, 503);
  assert.equal((await createTelegramHandler(setup(answer).deps, () => config)(new Request('http://x/api/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'nope' }, body: '{}' }))).status, 403);
  assert.equal((await createTelegramHandler(setup(answer).deps, () => config)(new Request('http://x/api/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 's3cret-value' }, body: '{}' }))).status, 200);
  const parts = telegramParts(`${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`);
  assert.deepEqual(parts.map(part => part.length), [3000, 3000]);
  assert.equal(telegramTexts({ kind: 'reply', reason: 'help', text: 'Hi' })[0], 'Hi');
});

console.log(`\n${passed} passed`);
