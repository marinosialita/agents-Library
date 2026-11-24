// An agent that reads your apps (11 Nov 2026): which questions open the apps, names that never clash with the
// browser's placeholders, the stream held back mid-placeholder, the route's answers in words when the person is not
// signed in or the app is not connected, and a whole answer on the demo apps through the SDK's scripted model.
// Run: node --experimental-transform-types --no-warnings tests/agent-apps.mjs (no network, no key).
import assert from 'node:assert/strict';
import { ScriptedModel, functionCall, assistantMessage, modelResponder } from '@openai/agents-core/testing';
import { appsAsked, appsAskedIn, appNameList, deltaStream, runConnectedQuestion } from '../server/connected/ask.ts';
import { createAgentRunHandler } from '../server/agent-run.ts';
import { demoInbox } from '../server/connected/inbox.ts';
import { blankSecrets, githubCodeTools, isSecretPath, CODE_LIMITS } from '../server/connected/github-code.ts';

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('ok  ', name); } catch (error) { console.log('FAIL', name); console.log('     ', error.stack?.split('\n').slice(0, 3).join(' | ') ?? error.message); process.exitCode = 1; } };
const NOW = Date.parse('2026-11-10T06:00:00Z');

await test('questions: brand names and «my …» open the apps; ordinary words do not', async () => {
  assert.deepEqual(appsAsked('What happened in my GitHub this week?'), ['github']);
  // 12 Nov 2026: questions without «my» about meetings and files.
  for (const q of ['What meetings do I have this week?', 'Am I free tomorrow at 3?', 'what is on tomorrow', 'events on Monday']) assert.ok(appsAsked(q)?.includes('googlecalendar'), q);
  assert.ok(appsAsked('what files did I change recently?')?.includes('googledrive'));
  // 12 Nov 2026: e-mail questions without «my inbox»; and a mail agent reads the mail for any question.
  for (const q of ['Which emails in this batch need my reply first?', 'What needs a reply?', 'Which messages are urgent?', 'What is in the inbox?']) assert.ok(appsAsked(q)?.includes('gmail'), q);
  for (const q of ['Write a reply to this email', 'Draft an email to the client about fees']) assert.equal(appsAsked(q), null, q);
  for (const q of ['okdo i hve any meeting coming up?', 'any meetings tomorrow?', 'what is my next meeting', 'do I have calls coming up']) assert.ok(appsAsked(q)?.includes('googlecalendar'), q);
  for (const q of ['What is a meeting of creditors under Cyprus law?', 'Draft minutes for a board meeting', 'Summarise my documents']) assert.equal(appsAsked(q), null, q);
  assert.deepEqual(appsAsked('summarise my pull requests'), ['github', 'gitlab']);
  assert.ok(appsAsked('anything from the bank in my inbox?').includes('gmail'));
  assert.ok(appsAsked('what is on my calendar tomorrow').includes('googlecalendar'));
  assert.equal(appsAsked('Write a firm reply to this email'), null);
  assert.equal(appsAsked('Draft a meeting agenda for the board'), null);
  assert.ok(appsAsked('check my connected apps').length > 10);
  // 12 Nov 2026: «which was my last email» went to the plain model.
  for (const q of ['which was my last email', 'show my unread emails', 'what are the latest emails?', 'did anyone email me today', 'emails I got from the bank', 'when is my next meeting'])
    assert.ok(appsAsked(q)?.length, q);
  assert.equal(appsAsked('Reply to this email politely'), null);
  const chat = (...texts) => texts.map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content }));
  assert.ok(appsAskedIn(chat('can you read my emails?', 'Yes.', 'which one is the newest?')).includes('gmail'));
  assert.equal(appsAskedIn(chat('can you read my emails?', 'Yes.', 'reply to this'), 1), null);
  assert.equal(appsAskedIn(chat('Write a firm reply', 'Done.', 'shorter please')), null);
});

await test('names: the apps get «[APP …]» placeholders; the browser\'s «[PERSON 1]» is left alone', async () => {
  const names = appNameList(true);
  const masked = names.mask('Pull request by Helen Carter');
  assert.match(masked, /\[APP PERSON 1\]/);
  assert.equal(names.restore(`${masked} and [PERSON 1]`), 'Pull request by Helen Carter and [PERSON 1]');
});

await test('stream: only growth is sent, and a placeholder being written is held back', async () => {
  const sent = []; const push = deltaStream(text => sent.push(text));
  push('Merged by [APP PER'); push('Merged by Helen Carter'); push('Merged by Helen Carter today.');
  assert.deepEqual(sent, ['Merged by ', 'Helen Carter', ' today.']);
});

const body = (question, extra = {}) => ({ agent: { name: 'Helper', instructions: 'Answer the user.', jurisdiction: '', officialSearch: false, mode: 'fast', knowledge: [] },
  messages: [{ role: 'user', content: question }], documents: [], language: 'en', timeZone: 'Europe/Nicosia', ...extra });
const post = (value) => new Request('http://localhost:3000/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' }, body: JSON.stringify(value) });
const lines = async (response) => (await response.text()).trim().split('\n').map(line => JSON.parse(line));
const composio = (over = {}) => ({ key: () => 'ak_test_key_1234567890', authConfigs: () => ({ github: 'ac_gh' }), ownerCode: () => '', fetcher: async () => new Response('{}', { status: 404 }), account: async () => null, ...over });

await test('route: not signed in → told to sign in, no AI call; no question about apps → the usual path', async () => {
  let called = 0;
  const handler = createAgentRunHandler({ noLoop: true, key: () => 'sk-test', fetcher: async () => { called++; return new Response('x', { status: 500 }); }, retryMs: 0,
    apps: { composio: composio(), provider: () => { throw new Error('never'); }, now: () => NOW } });
  const out = await lines(await handler(post(body('What happened in my GitHub this week?'))));
  assert.match(out.at(-1).answer, /sign in first/);
  assert.equal(called, 0);
  const plain = await handler(post(body('Write a polite reply to this email')));
  assert.equal(plain.status, 502); assert.equal(called, 2);
});

await test('route: signed in but the app not connected → told to connect it', async () => {
  const fetcher = async (url) => String(url).includes('connected_accounts') ? Response.json({ items: [] }) : new Response('{}', { status: 404 });
  const handler = createAgentRunHandler({ noLoop: true, key: () => 'sk-test', fetcher: async () => { throw new Error('never'); },
    apps: { composio: composio({ fetcher, account: async () => ({ id: 'u1', email: 'me@example.com' }) }), provider: () => { throw new Error('never'); }, now: () => NOW } });
  const out = await lines(await handler(post(body('What happened in my GitHub?'))));
  assert.match(out.at(-1).answer, /GitHub is not connected yet/);
});

await test('answer: the agent reads the apps with read-only tools, names stay hidden from the model and come back', async () => {
  let seen = '';
  const model = new ScriptedModel([[functionCall('list_updates', { service: 'slack', hours: 168 }, { callId: 'c1' })],
    modelResponder(call => { seen = JSON.stringify(call.request.input); return [assistantMessage('Slack: one item from [APP PERSON 1].')]; })]);
  const events = [];
  const outcome = await runConnectedQuestion({ inbox: demoInbox(NOW), instructions: 'You are a helper.', input: 'USER:\nwhat happened in my slack', namesHidden: true, timeZone: 'UTC', now: NOW,
    provider: { getModel: () => model }, model: 'm', effort: 'low', onEvent: event => events.push(event) });
  assert.ok(events.some(event => event.type === 'status' && event.service === 'slack'));
  assert.ok(!/propose_reply/.test(JSON.stringify(model)), 'no reply tool');
  assert.ok(!seen.includes('@'), 'no address reaches the model');
  assert.ok(!seen.includes('Helen Carter'), 'the sender\'s name never reaches the model');
  assert.equal(outcome.answer, 'Slack: one item from Helen Carter.');
});

await test('code: secret files are never opened, keys inside files are blanked, at most 40 files, noise left out of the tree', async () => {
  const calls = [];
  const exec = async (slug, args) => { calls.push([slug, args]);
    if (slug === 'GITHUB_GET_A_TREE') return { tree: [{ type: 'blob', path: 'src/app.ts', size: 10 }, { type: 'blob', path: '.env.local' }, { type: 'blob', path: 'node_modules/x/i.js' }, { type: 'blob', path: 'logo.png' }, { type: 'tree', path: 'src' }] };
    if (slug === 'GITHUB_GET_REPOSITORY_CONTENT') return { content: { type: 'file', encoding: 'base64', content: Buffer.from('const key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";\nexport {}').toString('base64'), html_url: 'https://github.com/me/app/blob/main/src/app.ts' } };
    return {}; };
  const state = { filesRead: 0, skipped: [], blanked: 0 };
  const tools = githubCodeTools(exec, state, { onEvent() {} });
  const call = (name, args) => tools.find(item => item.name === name).invoke({}, JSON.stringify(args));
  const tree = JSON.parse(await call('github_tree', { repo: 'me/app', branch: null, under: null }));
  assert.deepEqual(tree.paths, ['src/app.ts (10 B)']);
  assert.match(await call('github_file', { repo: 'me/app', path: '.env.local', branch: null }), /never read/);
  assert.ok(!calls.some(([slug, args]) => slug === 'GITHUB_GET_REPOSITORY_CONTENT' && args.path === '.env.local'));
  const file = JSON.parse(await call('github_file', { repo: 'me/app', path: 'src/app.ts', branch: null }));
  assert.match(file.text, /^1\tconst key = "\[SECRET REMOVED\]";/);
  assert.equal(state.blanked, 1);
  state.filesRead = CODE_LIMITS.files;
  assert.match(await call('github_file', { repo: 'me/app', path: 'src/b.ts', branch: null }), /limit of 40 files/);
  assert.ok(isSecretPath('deploy/id_rsa') && isSecretPath('.aws/credentials') && !isSecretPath('src/env.ts'));
  assert.equal(blankSecrets('token ghp_abcdefghijklmnopqrstuvwxyz0123456789').text, 'token [SECRET REMOVED]');
});

await test('code: with GitHub connected the agent gets the code tools and reads a file before answering', async () => {
  const inbox = { ...demoInbox(NOW), services: ['github'] };
  let toolNames = [];
  const model = new ScriptedModel([[functionCall('github_file', { repo: 'me/app', path: 'src/app.ts', branch: null }, { callId: 'c1' })],
    modelResponder(call => { toolNames = (call.request.tools ?? []).map(item => item.name); return [assistantMessage('One finding in [src/app.ts:1](https://github.com/me/app/blob/HEAD/src/app.ts#L1).')]; })]);
  const exec = async () => ({ content: { type: 'file', encoding: 'base64', content: Buffer.from('let x = 1').toString('base64') } });
  const outcome = await runConnectedQuestion({ inbox, instructions: 'Review code.', input: 'USER:\ncode quality of my repositories', namesHidden: true, timeZone: 'UTC', now: NOW,
    provider: { getModel: () => model }, model: 'm', effort: 'low', onEvent() {}, github: exec });
  assert.deepEqual(['github_repos', 'github_tree', 'github_file', 'github_pull', 'github_ci'].filter(name => toolNames.includes(name)).length, 5);
  assert.equal(outcome.code.filesRead, 1);
  assert.match(outcome.answer, /src\/app\.ts:1/);
});

await test('chosen websites: the search reaches only them (plus official sources when on); other links lose their address', async () => {
  let sent = null;
  const done = { type: 'response.completed', response: { output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'New: [a post](https://lawzana.com/q/1) and [elsewhere](https://evil.example/x).', annotations: [] }] }] } };
  const fetcher = async (url, init) => { sent = JSON.parse(init.body); return new Response(`data: ${JSON.stringify(done)}\n\n`, { status: 200 }); };
  const handler = createAgentRunHandler({ noLoop: true, key: () => 'sk-test', fetcher, retryMs: 0 });
  const request = body('New questions on Lawzana?', {});
  request.agent.sites = ['lawzana.com'];
  const out = await lines(await handler(post(request)));
  assert.deepEqual(sent.tools[0].filters.allowed_domains, ['lawzana.com']);
  assert.match(sent.instructions, /limited to the websites the person chose:\n- lawzana\.com/);
  const answer = out.find(line => line.type === 'done').answer;
  assert.match(answer, /\[a post\]\(https:\/\/lawzana\.com\/q\/1\)/); assert.ok(!answer.includes('evil.example'));
  const both = body('Cyprus criminal news', {}); both.agent = { ...both.agent, jurisdiction: 'cy', officialSearch: true, sites: ['cyprus-mail.com'] };
  await lines(await handler(post(both)));
  assert.ok(sent.tools[0].filters.allowed_domains.includes('cylaw.org') && sent.tools[0].filters.allowed_domains.includes('cyprus-mail.com'));
  const bad = body('x', {}); bad.agent.sites = ['https://lawzana.com'];
  assert.equal((await handler(post(bad))).status, 400, 'only bare domains are accepted');
});

console.log(`\n${passed} agent-on-apps checks passed${process.exitCode ? ', some FAILED' : ''}.`);
