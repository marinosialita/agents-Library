// Reproducible checks of the research guarantees and the request contract. Run: npm test (no network, no key).
import assert from 'node:assert/strict';
import { placeDomains, isOfficialUrl, sourcePlace, OFFICIAL_SOURCE_PLACES, isCatalogueUrl } from '../shared/official-sources.ts';
import { validateAgentRunRequest, isAgentDefinition, AGENT_LIMITS } from '../shared/agents.ts';
import { FIELDS, ALL_CATEGORY_IDS } from '../shared/fields.ts';
import { AGENT_TEMPLATES, templateAgent, FIELD_CATALOGUES, fieldAgents } from '../src/data/templates/index.ts';
import { readOfficialSourcesResponse } from '../server/official-research.ts';
import { createAgentRunHandler, agentInstruction, dayIn } from '../server/agent-run.ts';
import { readAgentBuildResponse, validateAgentBuildRequest } from '../server/agent-build.ts';

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('ok  ', name); } catch (error) { console.log('FAIL', name); console.log('     ', error.message); process.exitCode = 1; } };

await test('catalogue: 208 places, every allow-list at most 100 hosts, never empty for a place with sources', () => {
  assert.equal(OFFICIAL_SOURCE_PLACES.length, 208);
  for (const place of OFFICIAL_SOURCE_PLACES) {
    const domains = placeDomains(place.code);
    assert.ok(domains.length <= 100, `${place.code} has ${domains.length} hosts`);
    assert.ok(placeDomains(place.code, Infinity).length <= 100, `${place.code}: the allow-list would be cut (${placeDomains(place.code, Infinity).length} hosts)`);
    if (place.sources.length) assert.ok(domains.length > 0, `${place.code} has sources but no hosts`);
  }
});
await test('allow-list chain: a member state also searches the EU; a region also its country', () => {
  assert.ok(placeDomains('gr').includes('eur-lex.europa.eu'));
  assert.ok(placeDomains('de-by').some(host => placeDomains('de').includes(host)));
  assert.ok(!placeDomains('us').includes('eur-lex.europa.eu'));
});
await test('isOfficialUrl: host or subdomain of the place only; never another place', () => {
  assert.ok(isOfficialUrl('ew', 'https://www.legislation.gov.uk/ukpga/1980/58'));
  assert.ok(!isOfficialUrl('ew', 'https://en.wikipedia.org/wiki/Limitation_Act_1980'));
  assert.ok(!isOfficialUrl('gr', 'https://www.legislation.gov.uk/ukpga/1980/58'));
  assert.ok(isCatalogueUrl('https://eur-lex.europa.eu/eli/reg/2016/679/oj'));
  assert.ok(!isCatalogueUrl('https://example.com/'));
});
await test('response reading: citations outside the place are dropped and their links reduced to text', () => {
  const result = { status: 'completed', output: [
    { type: 'web_search_call', action: { query: 'limitation act 1980 section 5', sources: [{ url: 'https://www.legislation.gov.uk/ukpga/1980/58' }, { url: 'https://example.com/blog' }] } },
    { type: 'message', content: [{ type: 'output_text', text: 'See [s. 5](https://www.legislation.gov.uk/ukpga/1980/58/section/5?utm_source=openai) and [a blog](https://example.com/blog).', annotations: [
      { type: 'url_citation', url: 'https://www.legislation.gov.uk/ukpga/1980/58/section/5', title: 'Limitation Act 1980' }, { type: 'url_citation', url: 'https://example.com/blog', title: 'Blog' } ] }] } ] };
  const read = readOfficialSourcesResponse(result, 'ew');
  assert.equal(read.sources.length, 1); assert.equal(read.sources[0].site, 'legislation.gov.uk');
  assert.ok(read.answer.includes('and a blog.'), read.answer);
  assert.ok(!read.answer.includes('utm_source'));
  assert.equal(read.consulted.length, 1); assert.equal(read.searches, 1); assert.deepEqual(read.gaps, []);
});
await test('response reading: no search and no citation are reported as gaps', () => {
  const read = readOfficialSourcesResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer from memory.', annotations: [] }] }] }, 'gr');
  assert.equal(read.gaps.length, 2);
});
const agent = { name: 'Test', instructions: '## Role\nTest', jurisdiction: 'ew', officialSearch: true, mode: 'fast', knowledge: [] };
const request = (overrides = {}) => ({ agent, messages: [{ role: 'user', content: 'Hello' }], documents: [], language: 'en', ...overrides });
await test('request validation: unknown jurisdiction, bad language and odd turn order are refused', () => {
  validateAgentRunRequest(request());
  assert.throws(() => validateAgentRunRequest(request({ agent: { ...agent, jurisdiction: 'zz' } })));
  assert.throws(() => validateAgentRunRequest(request({ language: 'xx' })));
  assert.throws(() => validateAgentRunRequest(request({ messages: [{ role: 'assistant', content: 'Hi' }] })));
  assert.throws(() => validateAgentRunRequest(request({ model: 'turbo' })));
});
await test('instruction: names the governing jurisdiction and the output language, lists the place sources', () => {
  const text = agentInstruction(request({ language: 'de' }));
  assert.ok(text.includes('GOVERNING JURISDICTION: England and Wales'));
  assert.ok(text.includes('write in German'));
  assert.ok(text.includes('legislation.gov.uk'));
});
const post = (body, origin = 'http://localhost') => new Request(`${origin}/api/agent-run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
await test('handler: a place without sources is refused as unsupported before any provider call', async () => {
  const empty = OFFICIAL_SOURCE_PLACES.find(place => !place.sources.length);
  if (!empty) { console.log('      (every catalogued place has sources; skipped the empty-place branch)'); return; }
  let calls = 0; const handler = createAgentRunHandler({ noLoop: true, key: () => 'k', fetcher: async () => { calls++; return new Response('{}'); } });
  const response = await handler(post(request({ agent: { ...agent, jurisdiction: empty.code } })));
  assert.equal(response.status, 422); assert.equal((await response.json()).error, 'jurisdiction_unsupported'); assert.equal(calls, 0);
});
await test('handler: without a key the run is «agent_unavailable», never simulated', async () => {
  const handler = createAgentRunHandler({ noLoop: true, key: () => '', fetcher: async () => new Response('{}') });
  const response = await handler(post(request())); assert.equal(response.status, 503); assert.equal((await response.json()).error, 'agent_unavailable');
});
await test('handler: the provider call carries the allow-list, required tool choice and the sources include', async () => {
  let sent = null;
  const sse = [ 'data: {"type":"response.web_search_call.searching"}', 'data: {"type":"response.output_item.done","item":{"type":"web_search_call","action":{"query":"limitation act"}}}',
    'data: {"type":"response.output_text.delta","delta":"Hello "}', 'data: {"type":"response.output_text.delta","delta":"world"}',
    'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"web_search_call","action":{"sources":[{"url":"https://www.legislation.gov.uk/ukpga/1980/58"}]}},{"type":"message","content":[{"type":"output_text","text":"Hello world [s. 5](https://www.legislation.gov.uk/ukpga/1980/58/section/5)","annotations":[{"type":"url_citation","url":"https://www.legislation.gov.uk/ukpga/1980/58/section/5","title":"Limitation Act 1980"}]}]}]}}', 'data: [DONE]' ].map(line => `${line}\n\n`).join('');
  const handler = createAgentRunHandler({ noLoop: true, key: () => 'k', fetcher: async (_url, init) => { sent = JSON.parse(init.body); return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }); } });
  const response = await handler(post(request())); assert.equal(response.status, 200);
  assert.equal(sent.tool_choice, 'required'); assert.deepEqual(sent.include, ['web_search_call.action.sources']);
  assert.ok(sent.tools[0].filters.allowed_domains.includes('legislation.gov.uk')); assert.ok(sent.tools[0].filters.allowed_domains.length <= 100);
  const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines[0].type, 'status'); assert.ok(lines.some(line => line.type === 'status' && line.query === 'limitation act'));
  const done = lines.at(-1); assert.equal(done.type, 'done'); assert.equal(done.sources.length, 1); assert.equal(done.consulted.length, 1); assert.equal(done.searches, 1);
});
await test('handler: cross-origin posts are refused', async () => {
  const handler = createAgentRunHandler({ noLoop: true, key: () => 'k', fetcher: async () => new Response('{}') });
  const response = await handler(new Request('http://localhost/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.test' }, body: '{}' }));
  assert.equal(response.status, 403);
});
await test('builder reading: fields are clipped to the limits; an unknown place falls back to the workspace place or none, an empty one stays empty, a refinement keeps the current place', () => {
  const raw = JSON.stringify({ questions: [], summary: 'Built', agent: { name: 'Lease review', description: 'd', category: 'real-estate', jurisdiction: 'xx', officialSearch: true, mode: 'fast', needs: 'n', starters: Array(12).fill('q'), instructions: '## Role' } });
  const read = readAgentBuildResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: raw }] }] }, { language: 'en', description: 'x', appLaw: 'de' });
  assert.equal(read.agent.jurisdiction, 'de'); assert.equal(read.agent.starters.length, 9);
  const noLaw = readAgentBuildResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: raw }] }] }, { language: 'en', description: 'x' });
  assert.equal(noLaw.agent.jurisdiction, '');
  const none = JSON.parse(raw); none.agent.jurisdiction = '';
  const empty = readAgentBuildResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(none) }] }] }, { language: 'en', description: 'x', appLaw: 'de' });
  assert.equal(empty.agent.jurisdiction, '');
  const kept = readAgentBuildResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(none) }] }] }, { language: 'en', description: 'x', appLaw: 'de', current: { ...none.agent, jurisdiction: 'cy', starters: [] } });
  assert.equal(kept.agent.jurisdiction, 'cy');
});
await test('fields: twenty-nine fields with unique category ids; every Legal template is a valid Legal agent with nine starters', () => {
  assert.equal(FIELDS.length, 29);
  assert.equal(new Set(ALL_CATEGORY_IDS).size, ALL_CATEGORY_IDS.length);
  for (const field of FIELDS) assert.ok(field.categories.length >= 6, `${field.id} has ${field.categories.length} categories`);
  const legal = AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, ''));
  assert.equal(legal.length, 109);
  for (const agent of legal) { assert.ok(isAgentDefinition(agent), agent.id); assert.equal(agent.field, 'legal'); assert.equal(agent.starters.length, 9, agent.id); }
});

await test('fields: every other field has at least 24 valid agents, 3 per category, 9 starters each, unique ids', () => {
  const agents = fieldAgents(0, '');
  const legalIds = AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, '').id);
  assert.equal(new Set([...legalIds, ...agents.map(agent => agent.id)]).size, legalIds.length + agents.length, 'duplicate agent ids across Legal and the fields');
  for (const catalogue of FIELD_CATALOGUES) {
    const field = FIELDS.find(item => item.id === catalogue.field);
    assert.ok(field, catalogue.field);
    const own = agents.filter(agent => agent.field === field.id);
    assert.ok(own.length >= 24, `${field.id}: ${own.length} agents`);
    for (const category of field.categories) assert.ok(own.filter(agent => agent.category === category.id).length >= 3, `${field.id}/${category.id}`);
    for (const agent of own) { assert.ok(isAgentDefinition(agent), agent.id); assert.equal(agent.starters.length, AGENT_LIMITS.starters, agent.id); assert.ok(agent.description.length <= 220, agent.id); }
  }
});

await test('run: an agent that does not research may run without a jurisdiction, and the instruction then names none', () => {
  const base = { messages: [{ role: 'user', content: 'hi' }], documents: [], language: 'en' };
  const quiet = { ...base, agent: { name: 'x', instructions: 'x', jurisdiction: '', officialSearch: false, mode: 'fast', knowledge: [] } };
  validateAgentRunRequest(quiet);
  const text = agentInstruction(quiet);
  assert.ok(!text.includes('GOVERNING JURISDICTION'));
  assert.ok(text.includes('No jurisdiction was chosen'));
  assert.throws(() => validateAgentRunRequest({ ...base, agent: { ...quiet.agent, officialSearch: true } }), /invalid_agent_request/);
  const placed = { ...base, agent: { ...quiet.agent, jurisdiction: 'ew' } };
  assert.ok(agentInstruction(placed).includes('GOVERNING JURISDICTION: England and Wales'));
});

await test('handler: the Origin is matched by host, so a page served over https behind a proxy is its own site', async () => {
  const handler = createAgentRunHandler({ noLoop: true, key: () => '', fetcher: async () => new Response('{}') });
  const direct = await handler(new Request('http://localhost/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://localhost' }, body: '{}' }));
  assert.equal(direct.status, 503);
  const forwarded = await handler(new Request('http://internal/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.example', 'X-Forwarded-Host': 'app.example' }, body: '{}' }));
  assert.equal(forwarded.status, 503);
  const other = await handler(new Request('http://internal/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'X-Forwarded-Host': 'app.example' }, body: '{}' }));
  assert.equal(other.status, 403);
});
await test('handler: a chunked body beyond the limit is refused as too large while it arrives, not buffered first', async () => {
  const handler = createAgentRunHandler({ noLoop: true, key: () => 'k', fetcher: async () => new Response('{}') });
  const chunk = new TextEncoder().encode('a'.repeat(100_000)); let sent = 0;
  const body = new ReadableStream({ pull(controller) { if (sent >= 60) controller.close(); else { sent++; controller.enqueue(chunk); } } });
  const response = await handler(new Request('http://localhost/api/agent-run', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body, duplex: 'half' }));
  assert.equal(response.status, 413); assert.equal((await response.json()).error, 'request_too_large'); assert.ok(sent < 60, `read ${sent} chunks of 60`);
});
await test('builder validation: a refined agent is checked field by field, never passed to the prompt unchecked', () => {
  const current = { name: 'Lease review', description: 'd', category: 'real-estate', jurisdiction: 'cy', officialSearch: false, mode: 'fast', needs: 'n', starters: ['Review the lease.'], instructions: '## Role' };
  assert.doesNotThrow(() => validateAgentBuildRequest({ language: 'en', description: 'act for the tenant', current }));
  assert.throws(() => validateAgentBuildRequest({ language: 'en', description: 'x', current: { ...current, starters: ['q'.repeat(AGENT_LIMITS.starter + 1)] } }));
  assert.throws(() => validateAgentBuildRequest({ language: 'en', description: 'x', current: { ...current, starters: Array(AGENT_LIMITS.starters + 1).fill('q') } }));
  assert.throws(() => validateAgentBuildRequest({ language: 'en', description: 'x', current: { ...current, mode: 'slow' } }));
  assert.throws(() => validateAgentBuildRequest({ language: 'en', description: 'x', current: { ...current, officialSearch: 'yes' } }));
});
await test('official URLs: only http(s) pages without credentials or an odd port count, for a place and for the catalogue', () => {
  assert.ok(isOfficialUrl('ew', 'https://www.legislation.gov.uk/ukpga/1980/58'));
  for (const url of ['javascript://legislation.gov.uk/%0aalert(1)', 'ftp://legislation.gov.uk/x', 'https://u:p@legislation.gov.uk/', 'https://legislation.gov.uk:8443/']) {
    assert.ok(!isOfficialUrl('ew', url), url); assert.ok(!isCatalogueUrl(url), url);
  }
});
await test('conversation window: the last forty turns sent start with a question and end with one', async () => {
  const { agentTurns } = await import('../src/data/store.ts');
  const messages = Array.from({ length: 41 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `m${index}`, at: index }));
  const turns = agentTurns(messages);
  assert.equal(turns[0].role, 'user'); assert.equal(turns.at(-1).role, 'user'); assert.ok(turns.length <= AGENT_LIMITS.messages);
  assert.doesNotThrow(() => validateAgentRunRequest(request({ messages: turns })));
});

await test('names hidden: people, companies, contacts and numbers become placeholders; headings, case names and law vocabulary stay; the answer gets the names back', async () => {
  const { findPrivate, makeMasker } = await import('../src/data/privacy.ts');
  const text = 'Share Purchase Agreement\n\nThis Agreement is made between John Michael Smith, of 12 Main Street, Nicosia (the "Seller") and Alpha Trading Ltd (the "Buyer"). '
    + 'Contact john.smith@example.com, tel. +357 99 123456, IBAN CY17 0020 0128 0000 0012 0052 7600, passport no: K1234567. Mr Smith relies on Donoghue v Stevenson before the Supreme Court. Η κα Ελένη Παπαδοπούλου υπογράφει.';
  const items = findPrivate([text]);
  const masked = makeMasker(items).mask(text);
  for (const secret of ['John', 'Smith', 'Alpha Trading', '12 Main Street', 'john.smith@example.com', '+357 99 123456', 'CY17', 'K1234567', 'Παπαδοπούλου']) assert.ok(!masked.includes(secret), `${secret} leaked: ${masked}`);
  for (const kept of ['Share Purchase Agreement', 'Donoghue v Stevenson', 'Supreme Court', 'Nicosia']) assert.ok(masked.includes(kept), `${kept} was hidden: ${masked}`);
  assert.ok(masked.includes('[PERSON 1]') && masked.includes('[COMPANY 1]') && masked.includes('[EMAIL 1]') && masked.includes('[IBAN 1]'));
  const { restore } = makeMasker(items);
  assert.equal(restore('[PERSON 1] sells to [COMPANY 1]; write to [EMAIL 1]; [PERSON 9] is unknown.'), 'John Michael Smith sells to Alpha Trading Ltd; write to john.smith@example.com; [PERSON 9] is unknown.');
  const kept = findPrivate([text], { keep: ['Alpha Trading Ltd'], hide: ['Nicosia'] });
  assert.ok(!kept.some(item => item.text === 'Alpha Trading Ltd'));
  assert.ok(kept.some(item => item.kind === 'custom' && item.text === 'Nicosia'));
});
await test('names hidden: the request the AI receives carries placeholders only, stays valid, and the answer gets the names back', async () => {
  const { maskRunRequest } = await import('../src/data/privacy.ts');
  const raw = request({ agent: { ...agent, knowledge: [{ name: 'Template for Alpha Trading Ltd', text: 'Signed by Maria Georgiou for Alpha Trading Ltd.' }] },
    messages: [{ role: 'user', content: 'Review the lease of Mr Peter Brown, email peter.brown@example.com.' }],
    documents: [{ name: 'Brown lease.pdf', text: 'Lease between Peter Brown (the "Tenant") and Alpha Trading Ltd (the "Landlord"). Tel. +357 99 765432.' }] });
  const { request: sent, restore } = maskRunRequest(raw, {});
  const wire = JSON.stringify(sent);
  for (const secret of ['Peter', 'Brown', 'Maria', 'Georgiou', 'Alpha Trading', 'peter.brown@example.com', '765432']) assert.ok(!wire.includes(secret), `${secret} reached the AI`);
  assert.equal(sent.anonymised, true); assert.doesNotThrow(() => validateAgentRunRequest(sent));
  assert.equal(restore('Advise [PERSON 2] about [COMPANY 1].'), 'Advise Peter Brown about Alpha Trading Ltd.');
  assert.equal(maskRunRequest(raw, null).request, raw);
});
await test('names hidden: the run request says so and the instruction keeps the placeholders; an odd flag is refused', () => {
  const masked = request({ anonymised: true });
  assert.doesNotThrow(() => validateAgentRunRequest(masked));
  assert.ok(agentInstruction(masked).includes('Keep every placeholder exactly as written'));
  assert.ok(!agentInstruction(request()).includes('Keep every placeholder'));
  assert.throws(() => validateAgentRunRequest(request({ anonymised: 'yes' })));
});
await test('tell me the task: the browser ranks every agent by the words of the task', async () => {
  const { rankAgents } = await import('../src/data/task-finder.ts');
  const all = [...AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, '')), ...fieldAgents(0, '')];
  assert.equal(rankAgents('Write the month-end variance commentary for the board', all, 3)[0].agent.id, 'ready-finance-month-end-commentary');
  assert.equal(rankAgents('translate my contract into French', all, 3)[0].agent.field, 'languages');
  assert.equal(rankAgents('draft a privacy notice under GDPR for my website', all, 3)[0].agent.name, 'Privacy policy drafter');
  assert.deepEqual(rankAgents('the and of', all), []);
});
await test('tell me the task: the route sends the whole catalogue once, maps the AI picks to agent ids and drops unknown ones', async () => {
  const { createAgentRouteHandler, agentRouteInstruction, routeCatalogue } = await import('../server/agent-route.ts');
  const { agents } = routeCatalogue();
  assert.equal(agents.length, AGENT_TEMPLATES.length + fieldAgents(0, '').length);
  assert.ok(agents.length > 1000, `${agents.length} agents in the route catalogue`);
  const instruction = agentRouteInstruction();
  const n = agents.findIndex(agent => agent.id === 'ready-finance-month-end-commentary') + 1;
  assert.ok(instruction.includes(`${n}|Month-end variance commentary`));
  let sent = null;
  const fetcher = async (_url, init) => { sent = JSON.parse(init.body); return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ none_fits: false, picks: [{ ref: String(n), reason: 'Writes it.' }, { ref: '99999', reason: 'x' }, { ref: 'M1', reason: 'Yours.' }, { ref: String(n), reason: 'twice' }] }) }] }] }); };
  const handler = createAgentRouteHandler({ key: () => 'k', fetcher });
  const post = body => new Request('http://localhost/api/agent-route', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: JSON.stringify(body) });
  const response = await handler(post({ task: 'month-end commentary', language: 'en', likely: ['ready-finance-month-end-commentary'], mine: [{ id: 'mine-1', name: 'My commentary', description: 'Mine.' }] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { picks: [{ id: 'ready-finance-month-end-commentary', reason: 'Writes it.' }, { id: 'mine-1', reason: 'Yours.' }], noneFits: false });
  assert.equal(sent.text.format.type, 'json_schema'); assert.equal(sent.instructions, instruction);
  assert.ok(JSON.parse(sent.input[0].content).likely[0].description.length > 0);
  const off = createAgentRouteHandler({ key: () => '', fetcher });
  assert.equal((await off(post({ task: 'x', language: 'en' }))).status, 503);
  assert.equal((await handler(post({ task: '', language: 'en' }))).status, 400);
});
await test('«/» in the chat box: the token at the caret, commands and other agents by name', async () => {
  const { slashToken, slashItems } = await import('../src/data/slash.ts');
  assert.deepEqual(slashToken('/lea', 4), { start: 0, query: 'lea' });
  assert.deepEqual(slashToken('Please /doc', 11), { start: 7, query: 'doc' });
  assert.equal(slashToken('1/2 of the rent', 3), null);
  const all = [...AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, '')), ...fieldAgents(0, '')];
  const here = all.find(agent => agent.id === 'ready-lease-report');
  const items = slashItems('privacy', { agent: here, agents: all, favourites: [], recent: [], test: false, hiding: true });
  assert.ok(items.some(item => item.kind === 'agent' && item.agent.name === 'Privacy policy drafter'));
  assert.ok(slashItems('doc', { agent: here, agents: all, favourites: [], recent: [], test: false, hiding: true })[0].id === 'documents');
  assert.ok(!slashItems('', { agent: here, agents: all, favourites: [], recent: [], test: true, hiding: true }).some(item => item.kind === 'agent' || item.id === 'new'));
});

await test('house style: every agent gets the tone, positions, rules and templates; names in it are hidden too', async () => {
  const { maskRunRequest } = await import('../src/data/privacy.ts');
  const { agentInput } = await import('../server/agent-run.ts');
  const house = { tone: 'Plain British English.', positions: 'We act for Alpha Trading Ltd as buyer.', rules: ['Write amounts as €1,000.00'], files: [{ name: 'Letter template.docx', text: 'Dear Sir or Madam, … Yours faithfully, Maria Georgiou' }] };
  const raw = request({ house });
  assert.doesNotThrow(() => validateAgentRunRequest(raw));
  const instruction = agentInstruction(raw);
  assert.ok(instruction.includes("THE USER'S HOUSE STYLE") && instruction.includes('Plain British English.') && instruction.includes('- Write amounts as €1,000.00'));
  assert.ok(JSON.stringify(agentInput(raw)).includes("THE USER'S HOUSE TEMPLATES"));
  assert.ok(!agentInstruction(request()).includes('HOUSE STYLE'));
  const wire = JSON.stringify(maskRunRequest(raw, {}).request);
  assert.ok(!wire.includes('Alpha Trading') && !wire.includes('Georgiou'), wire);
  assert.throws(() => validateAgentRunRequest(request({ house: { ...house, rules: Array(41).fill('x') } })));
  assert.throws(() => validateAgentRunRequest(request({ house: { ...house, tone: 'x'.repeat(1_001) } })));
});
await test('photos: valid images go with the latest question as input_image; anything else is refused', async () => {
  const { agentInput } = await import('../server/agent-run.ts');
  const photo = { name: 'receipt.jpg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };
  const raw = request({ images: [photo] });
  assert.doesNotThrow(() => validateAgentRunRequest(raw));
  const last = agentInput(raw).at(-1);
  assert.equal(last.content[0].type, 'input_text'); assert.equal(last.content[1].type, 'input_image'); assert.equal(last.content[1].image_url, photo.dataUrl);
  assert.throws(() => validateAgentRunRequest(request({ images: [{ name: 'x.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }] })));
  assert.throws(() => validateAgentRunRequest(request({ images: Array(5).fill(photo) })));
});
await test('chains: every ready-made chain uses real agents; a step reads the task, the documents and the step before', async () => {
  const { READY_CHAINS, chainStepRequest } = await import('../src/data/chains.ts');
  const all = new Map([...AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, '')), ...fieldAgents(0, '')].map(item => [item.id, item]));
  for (const chain of READY_CHAINS) for (const step of chain.steps) assert.ok(all.has(step.agentId), `${chain.name}: ${step.agentId}`);
  const settings = { language: 'en', model: 'quality', jurisdiction: null };
  const agentOne = all.get('ready-realestate-occupier-communication');
  const req = chainStepRequest({ agent: agentOne, ask: 'Write the letter.' }, 'For the tenant.', [{ id: 'd', name: 'Lease.pdf', text: 'The lease.', truncated: false, size: 10 }], { label: 'Result of step 1 · Lease report', answer: 'The report.' }, '', settings);
  assert.doesNotThrow(() => validateAgentRunRequest(req));
  assert.ok(req.messages[0].content.startsWith('Write the letter.') && req.messages[0].content.includes('For the tenant.'));
  assert.equal(req.documents[0].name, 'Result of step 1 · Lease report'); assert.equal(req.documents[1].name, 'Lease.pdf');
});
await test('privacy promise: the status route reports only what this server does; EU processing needs its address', async () => {
  const status = (await import('../api/status.ts')).default;
  const body = await (await status.fetch()).json();
  assert.equal(body.privacy.storeOff, true); assert.equal(body.privacy.euProcessing, false); assert.equal(body.privacy.hostedInEu, false);
  assert.ok(!JSON.stringify(body).includes('gpt-'));
});

await test('launch claims: over 1,000 ready agents, fifty checked chains, and the landing page counts match the library', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const { landingIndex } = await import('../scripts/build-landing-index.mjs');
  const live = landingIndex();
  assert.ok(live.counts.agents > 1000, `${live.counts.agents} agents`);
  assert.equal(live.counts.chains, 50);
  assert.equal(live.counts.fields, FIELDS.length);
  // The file the landing page reads is the one the catalogue produces today: no number on the page is stale.
  assert.equal(readFileSync(new URL('../src/landing/library-index.json', import.meta.url), 'utf8'), JSON.stringify(live), 'run scripts/build-landing-index.mjs');
  const chains = execFileSync(process.execPath, ['--experimental-transform-types', '--no-warnings', new URL('../scripts/check-chains.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.ok(chains.includes('all checks passed'), chains);
});

await test('today is the user\'s day: 00:15 in Cyprus is already 13 November while UTC is still the 12th', () => {
  const late = new Date('2026-11-12T22:15:00Z');
  assert.equal(dayIn('Europe/Nicosia', late), '2026-11-13');
  assert.equal(dayIn('UTC', late), '2026-11-12');
  assert.match(dayIn('Not/AZone', late), /^\d{4}-\d{2}-\d{2}$/);
});

await test('«@name» opens the agents only; an e-mail address never opens the menu (13 Nov 2026)', async () => {
  const { slashToken, slashItems } = await import('../src/data/slash.ts');
  assert.deepEqual(slashToken('Ask @transl', 11), { start: 4, query: 'transl', mention: true });
  assert.equal(slashToken('write to anna@firm.com', 22), null);
  assert.deepEqual(slashToken('/doc', 4), { start: 0, query: 'doc' });
  const make = (id, name) => ({ id, name, starters: [], description: '', instructions: '', needs: '', category: 'litigation', field: 'legal', jurisdiction: '', knowledge: [] });
  const agent = make('a', 'Letter before action');
  const items = slashItems('trans', { agent, agents: [agent, make('b', 'Legal translation')], favourites: [], recent: [], test: false, hiding: false, mention: true });
  assert.ok(items.length && items.every(item => item.kind === 'agent'));
});

console.log(`\n${passed} checks passed${process.exitCode ? ', with failures' : ''}`);
