// 13 Nov 2026 (his fact-checking agent answered «corporate tax in Cyprus» from memory): an agent without live search
// searches the official sources of the conversation's country when the answer needs current facts (tool_choice auto);
// without a country it says it could not check; a language its instructions name is used from the first word.
import assert from 'node:assert/strict';
import { agentInstruction, createAgentRunHandler, searchOnNeed } from '../server/agent-run.ts';
import { CHECK_RULES } from '../server/agent-loop.ts';
import { placeDomains } from '../shared/official-sources.ts';

let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); process.exitCode = 1; } };
const agent = { name: 'Evidence-Based Fact Checking', instructions: 'Answer in clear, formal Greek.', jurisdiction: 'cy', officialSearch: false, mode: 'fast', knowledge: [] };
const request = (patch = {}) => ({ agent: { ...agent, ...(patch.agent ?? {}) }, messages: [{ role: 'user', content: 'what is the corporate tax in cyprus' }], documents: [], language: 'en', ...patch, ...(patch.agent ? { agent: { ...agent, ...patch.agent } } : {}) });
const sse = text => new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: {"type":"response.completed","response":{}}\n\n`);
const sent = async body => { let seen = null;
  const handler = createAgentRunHandler({ noLoop: true, key: () => 'sk-test', retryMs: 0, fetcher: async (_url, init) => { seen = JSON.parse(init.body); return sse('Answer.'); } });
  const response = await handler(new Request('http://localhost/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  await response.text(); return seen; };

await test('with a country set, an agent without live search may search that country\'s official sources (model decides)', async () => {
  assert.equal(searchOnNeed(request()), true);
  const body = await sent(request());
  assert.equal(body.tool_choice, 'auto');
  assert.deepEqual(body.tools[0].filters.allowed_domains, [...new Set(placeDomains('cy'))].slice(0, 100));
  assert.match(body.instructions, /never give such facts from memory/);
});
await test('live search on: it must search; no country: no search, and it says it could not check', async () => {
  assert.equal((await sent(request({ agent: { officialSearch: true } }))).tool_choice, 'required');
  const none = await sent(request({ agent: { jurisdiction: '' } }));
  assert.equal(none.tools, undefined);
  assert.equal(searchOnNeed(request({ agent: { jurisdiction: '' } })), false);
  assert.match(none.instructions, /Never state current law, tax or other rates[^.]*from memory/);
  assert.match(none.instructions, /the button under your answer checks it online; never ask for screenshots/);
});
await test('Ask Agents never searches on need, and the switch OFF_WEB stops it', async () => {
  assert.equal(searchOnNeed({ ...request(), assistant: true }), false);
  process.env.OFFICIAL_WEB_SEARCH = 'off';
  try { assert.equal(searchOnNeed(request()), false); } finally { delete process.env.OFFICIAL_WEB_SEARCH; }
});
await test('the language the instructions name is used from the first word, and the check never fails a draft for it', async () => {
  const brief = agentInstruction(request(), '2026-11-13');
  assert.match(brief, /if THE AGENT'S INSTRUCTIONS below say which language answers are written in, write every answer in that language from the first word/);
  assert.match(CHECK_RULES, /Do not fail for style, for the language the draft is written in/);
});

console.log(`\n${passed} passed`);
