// The agent's questions (12 Nov 2026): an «ask» block becomes a panel above the input; anything else stays an answer.
import assert from 'node:assert/strict';
import { askOnly, askReply, isAskStarting, parseAsk } from '../shared/ask-block.ts';
import { agentInstruction } from '../server/agent-run.ts';

const block = '```ask\n{"questions":[{"question":"Who do you act for?","options":["Landlord","Tenant"]},{"question":"Which country?","options":["Cyprus","Greece","UK","Other","Fifth"]},{"question":"third"},{"question":"fourth"}]}\n```';
const asked = parseAsk(block);
assert.equal(asked.length, 3, 'at most three questions a round');
assert.deepEqual(asked[1].options, ['Cyprus', 'Greece', 'UK', 'Other'], 'at most four answers');
assert.equal(parseAsk('Here is the answer.\n\n' + block), null, 'an answer with text is an answer');
assert.equal(parseAsk('```ask\nnot json\n```'), null);
assert.equal(parseAsk('```ask\n{"questions":[]}\n```'), null);
for (const part of ['`', '```', '```as', '```ask', '```ask\n{"que']) assert.ok(isAskStarting(part), part);
for (const part of ['I recommend', '```redline', '| a |']) assert.ok(!isAskStarting(part), part);
assert.equal(askReply(asked, ['Tenant', 'Cyprus', 'Yes']), 'Who do you act for? — Tenant\nWhich country? — Cyprus\nthird — Yes');
const base = { agent: { name: 'A', instructions: 'Do it.', jurisdiction: '', officialSearch: false, mode: 'fast', knowledge: [] }, messages: [{ role: 'user', content: 'hi' }], documents: [], language: 'en' };
assert.match(agentInstruction({ ...base, ask: true }), /```ask/, 'the chat may ask');
assert.doesNotMatch(agentInstruction(base), /```ask/, 'a routine or chain never gets the ask rule');
// 12 Nov 2026: questions mixed with words and another block are reduced to the questions alone.
const mixed = 'I will build it.\n\n```ask\n{"questions":[{"question":"Which country?"},{"question":"Which day and time?","options":["Monday 09:00","Friday 18:00"]}]}\n```\n```build\n{"description":"x"}\n```';
assert.deepEqual(parseAsk(askOnly(mixed)), [{ question: 'Which country?', options: [] }, { question: 'Which day and time?', options: ['Monday 09:00', 'Friday 18:00'] }]);
assert.equal(askOnly('Plain answer.'), 'Plain answer.');
assert.equal(askOnly('Text\n```ask\nnot json\n```'), 'Text\n```ask\nnot json\n```', 'a damaged block changes nothing');
console.log('13 ask-block checks passed.');
