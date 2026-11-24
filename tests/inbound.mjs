// «Send work from anywhere»: the e-mail (Postmark) and WhatsApp (Meta Cloud API) channels against their documented
// webhook formats, with every network call played by a stub (OpenAI, Postmark, the Graph API). The real fetch throws.
// Run: node --experimental-transform-types tests/inbound.mjs
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../shared/zip-writer.ts';
import { placeDomains } from '../shared/official-sources.ts';
import { routeCatalogue } from '../server/agent-route.ts';
import { channelStatus, findPlace, rateCheck, readControls, resetInboundMemory, agentBySlug } from '../server/inbound/core.ts';
import { docxText, readAttachments, zipEntry } from '../server/inbound/documents.ts';
import { createInboundEmailHandler } from '../server/inbound/email.ts';
import { createWhatsAppHandler, splitMessage, whatsappText, GRAPH_BASE } from '../server/inbound/whatsapp.ts';

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('ok  ', name); } catch (error) { console.log('FAIL', name); console.log('     ', error.message); process.exitCode = 1; } };

// No real network in this file: anything that reaches the global fetch fails the test that caused it.
globalThis.fetch = async (url) => { throw new Error(`real network used: ${url}`); };

// ── Environment ──────────────────────────────────────────────────────────────────────────────────────────────
const ENV = {
  OPENAI_API_KEY: 'sk-test', INBOUND_EMAIL_USER: 'postmark', INBOUND_EMAIL_PASSWORD: 'correct horse battery staple',
  INBOUND_ALLOWED_SENDERS: 'owner@firm.example, partner@firm.example', POSTMARK_SERVER_TOKEN: 'pm-server-token', INBOUND_FROM_ADDRESS: 'agents@firm.example',
  WHATSAPP_VERIFY_TOKEN: 'verify-me', WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_NUMBER_ID: '106540352242922',
  WHATSAPP_ALLOWED_NUMBERS: '+357 99 000111, 447700900123',
};
const ALL_KEYS = [...Object.keys(ENV), 'INBOUND_SHOW_NAMES', 'INBOUND_ALLOW_IMAGES', 'INBOUND_MAX_PER_HOUR', 'WHATSAPP_GRAPH_VERSION', 'OFFICIAL_WEB_SEARCH'];
const setEnv = (values) => { for (const key of ALL_KEYS) delete process.env[key]; Object.assign(process.env, values); };
setEnv(ENV);

// ── The stubbed network ──────────────────────────────────────────────────────────────────────────────────────
const RESPONSES = 'https://api.openai.com/v1/responses';
const POSTMARK = 'https://api.postmarkapp.com/email';
const LOOKASIDE = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=987654321';
const message = (text, extra = {}) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [] }] }], ...extra });
/** A world of stubs: `answer(body)` plays OpenAI's runs, `pick` the picker's top pick; every call is recorded. */
function world({ answer = () => message('Done.'), pick, media = {}, mediaUrl = LOOKASIDE } = {}) {
  const calls = { openai: [], postmark: [], graph: [], other: [] };
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    if (url === RESPONSES) {
      const body = JSON.parse(init.body); calls.openai.push({ body, raw: init.body, headers: init.headers });
      if (body.text?.format?.name === 'agent_route') {
        const ref = String(routeCatalogue().byId.get(pick));
        return Response.json(message(JSON.stringify({ picks: [{ ref, reason: 'Does this task.' }], none_fits: false })));
      }
      return Response.json(answer(body, init.body));
    }
    if (url === POSTMARK) { calls.postmark.push({ body: JSON.parse(init.body), headers: init.headers }); return Response.json({ ErrorCode: 0, Message: 'OK', MessageID: 'b7bc2f4a-e38e-4336-af7d-e6c392c2f817' }); }
    if (url.startsWith(GRAPH_BASE)) {
      const path = url.slice(GRAPH_BASE.length);
      calls.graph.push({ path, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, headers: init.headers });
      if (path.endsWith('/messages')) return Response.json({ messaging_product: 'whatsapp', contacts: [{ input: '35799000111', wa_id: '35799000111' }], messages: [{ id: 'wamid.OUT' }] });
      if (path.endsWith('/media')) return Response.json({ id: '1037543291543636' });
      const id = /\/v[\d.]+\/(.+)$/.exec(path)?.[1];
      if (media[id]) return Response.json({ messaging_product: 'whatsapp', url: mediaUrl, mime_type: media[id].type, sha256: 'x', file_size: media[id].bytes.length, id });
      return Response.json({ error: { code: 100 } }, { status: 404 });
    }
    calls.other.push({ url, headers: init.headers });
    if (url === LOOKASIDE) { const file = Object.values(media)[0]; return new Response(file.bytes, { headers: { 'Content-Type': file.type } }); }
    throw new Error(`unexpected request to ${url}`);
  };
  return { fetcher, calls };
}
const handlers = (stub) => {
  const jobs = []; const deps = { key: () => 'sk-test', fetcher: stub.fetcher, retryMs: 0, defer: (work) => { jobs.push(work); } };
  return { email: createInboundEmailHandler(deps), whatsapp: createWhatsAppHandler(deps), settle: async () => { while (jobs.length) await jobs.shift(); } };
};

// ── Fixtures in the documented formats ───────────────────────────────────────────────────────────────────────
/** A .docx with its document part deflated, as Word writes it. */
function docx(paragraphs) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(text => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text.replace(/&/g, '&amp;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  const entries = [['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'], ['word/document.xml', xml]];
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of entries) {
    const data = new TextEncoder().encode(text); const packed = deflateRawSync(data); const file = new TextEncoder().encode(name); const crc = crc32(data);
    const local = Buffer.alloc(30 + file.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(file.length, 26); Buffer.from(file).copy(local, 30);
    const central = Buffer.alloc(46 + file.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(offset, 42); Buffer.from(file).copy(central, 46);
    locals.push(local, packed); centrals.push(central); offset += local.length + packed.length;
  }
  const size = centrals.reduce((n, item) => n + item.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
}
/** A one-page PDF with a text layer. */
function pdf(lines) {
  const stream = `BT /F1 12 Tf 72 720 Td ${lines.map((line, index) => `${index ? '0 -16 Td ' : ''}(${line}) Tj`).join(' ')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
// The private details in the fixtures: none of them may reach OpenAI.
const NAMES = ['John Papadopoulos', 'Papadopoulos', 'Alpha Trading Ltd', 'Alpha Trading', 'Maria Georgiou', 'Georgiou', 'john.papadopoulos@example.com', '+357 99 123456', 'owner@firm.example'];
const LEASE = docx(['LEASE AGREEMENT', 'This lease is made between Mr John Papadopoulos (the "Landlord") and Alpha Trading Ltd (the "Tenant").', 'Rent: EUR 2,400 a month, payable in advance.']);
const NOTE = new TextEncoder().encode('Note from the file: Maria Georgiou signed for Alpha Trading Ltd. Contact john.papadopoulos@example.com or tel. +357 99 123456.');
/** Postmark's inbound webhook JSON (postmarkapp.com/developer/webhooks/inbound-webhook). */
const postmarkInbound = (overrides = {}) => ({
  FromName: 'Firm Owner', MessageStream: 'inbound', From: 'owner@firm.example', FromFull: { Email: 'owner@firm.example', Name: 'Firm Owner', MailboxHash: '' },
  To: '"Agents" <plain-summary@in.firm.example>', ToFull: [{ Email: 'plain-summary@in.firm.example', Name: 'Agents', MailboxHash: '' }], Cc: '', CcFull: [], Bcc: '', BccFull: [],
  OriginalRecipient: 'plain-summary@in.firm.example', Subject: 'Fwd: Lease for review', MessageID: '73e6d360-66eb-11e1-8e72-a8904824019b', ReplyTo: 'someone-else@attacker.example', MailboxHash: '',
  Date: 'Sat, 7 Nov 2026 10:15:00 +0200', TextBody: 'Please summarise the attached lease for John Papadopoulos in plain words.\n\nThanks', HtmlBody: '<p>Please summarise the attached lease.</p>',
  StrippedTextReply: '', Tag: '', Headers: [{ Name: 'X-Spam-Status', Value: 'No' }, { Name: 'Received-SPF', Value: 'Pass (sender SPF authorized)' }, { Name: 'Message-ID', Value: '<CAF=lease-123@mail.firm.example>' }],
  Attachments: [
    { Name: 'lease.docx', Content: b64(LEASE), ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ContentLength: LEASE.length },
    { Name: 'note.txt', Content: b64(NOTE), ContentType: 'text/plain', ContentLength: NOTE.length },
  ], ...overrides });
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const emailPost = (body, auth = basic(ENV.INBOUND_EMAIL_USER, ENV.INBOUND_EMAIL_PASSWORD)) => new Request('https://agents.firm.example/api/inbound-email', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });
/** Meta's messages webhook (developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples). */
const waPayload = (messages, phoneNumberId = ENV.WHATSAPP_PHONE_NUMBER_ID) => ({ object: 'whatsapp_business_account', entry: [{ id: '102290129340398', changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { display_phone_number: '15550783881', phone_number_id: phoneNumberId },
  contacts: [{ profile: { name: 'Firm Owner' }, wa_id: messages[0]?.from ?? '35799000111' }], messages } }] }] });
const waText = (id, body, from = '35799000111') => ({ from, id, timestamp: '1762503300', type: 'text', text: { body } });
const waPost = (payload, secret = ENV.WHATSAPP_APP_SECRET) => {
  const raw = JSON.stringify(payload);
  return new Request('https://agents.firm.example/api/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` }, body: raw });
};
const noNames = (raw) => { for (const name of NAMES) assert.ok(!raw.includes(name), `the AI request contains «${name}»`); };

// ── Tests ────────────────────────────────────────────────────────────────────────────────────────────────────
await test('status: both channels off without their values; on only when every value is set; no allow-list means nobody', async () => {
  // 13 Nov 2026: Telegram joined the status; without its two settings it is off.
  const telegramOff = { TELEGRAM_BOT_TOKEN: '', TELEGRAM_ALLOWED_CHATS: '' };
  setEnv({ ...telegramOff }); assert.deepEqual(channelStatus(), { email: false, whatsapp: false, telegram: false });
  setEnv({ ...ENV, ...telegramOff }); assert.deepEqual(channelStatus(), { email: true, whatsapp: true, telegram: false });
  setEnv({ ...ENV, ...telegramOff, INBOUND_ALLOWED_SENDERS: '', WHATSAPP_ALLOWED_NUMBERS: ' ' }); assert.deepEqual(channelStatus(), { email: false, whatsapp: false, telegram: false });
  setEnv({ ...ENV, ...telegramOff, OPENAI_API_KEY: '' }); assert.deepEqual(channelStatus(), { email: false, whatsapp: false, telegram: false });
  setEnv({ ...ENV, TELEGRAM_BOT_TOKEN: '123456:' + 'a'.repeat(35), TELEGRAM_ALLOWED_CHATS: '55501' }); assert.equal(channelStatus().telegram, true);
  setEnv(ENV);
  setEnv(ENV);
});

await test('unconfigured: both routes answer 503 channel_not_configured and call nothing', async () => {
  setEnv({}); resetInboundMemory();
  const stub = world(); const { email, whatsapp } = handlers(stub);
  for (const response of [await email(emailPost(postmarkInbound())), await whatsapp(waPost(waPayload([waText('wamid.1', 'hi')]))),
    await whatsapp(new Request('https://agents.firm.example/api/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1'))]) {
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'channel_not_configured' });
  }
  assert.equal(stub.calls.openai.length + stub.calls.postmark.length + stub.calls.graph.length, 0);
  setEnv(ENV);
});

await test('email: no, wrong or partial Basic credentials are refused with 401 before anything is read or called', async () => {
  resetInboundMemory(); const stub = world(); const { email, settle } = handlers(stub);
  for (const auth of [null, basic('postmark', 'wrong'), basic('other', ENV.INBOUND_EMAIL_PASSWORD), basic('postmark', ''), 'Bearer abc', `Basic ${Buffer.from('postmark').toString('base64')}`]) {
    const response = await email(emailPost(postmarkInbound(), auth));
    assert.equal(response.status, 401); assert.ok(response.headers.get('WWW-Authenticate')?.startsWith('Basic'));
  }
  await settle(); assert.equal(stub.calls.openai.length + stub.calls.postmark.length, 0);
});

await test('email: a sender outside INBOUND_ALLOWED_SENDERS (or a forged one, SPF fail) gets 403 and no AI call', async () => {
  resetInboundMemory(); const stub = world(); const { email, settle } = handlers(stub);
  const stranger = await email(emailPost(postmarkInbound({ From: 'stranger@else.example', FromFull: { Email: 'stranger@else.example', Name: 'S' } })));
  assert.equal(stranger.status, 403); assert.equal((await stranger.json()).error, 'sender_not_allowed');
  const forged = await email(emailPost(postmarkInbound({ MessageID: 'forged-1', Headers: [{ Name: 'Received-SPF', Value: 'Fail (domain does not designate sender)' }] })));
  assert.equal(forged.status, 403); assert.equal((await forged.json()).error, 'sender_not_verified');
  const auto = await email(emailPost(postmarkInbound({ MessageID: 'auto-1', Headers: [{ Name: 'Auto-Submitted', Value: 'auto-replied' }] })));
  assert.equal(auto.status, 200); assert.equal((await auto.json()).ignored, 'automatic');
  await settle(); assert.equal(stub.calls.openai.length + stub.calls.postmark.length, 0);
});

await test('email: a .docx and a .txt go to the agent the address names, with every name hidden; the reply is threaded, restores the names and attaches Word', async () => {
  resetInboundMemory();
  // The stub answers with the placeholders it was given, as a model keeps them.
  const stub = world({ answer: (body) => { const input = JSON.stringify(body.input); const person = /\[PERSON \d+\]/.exec(input)?.[0] ?? '?'; const company = /\[COMPANY \d+\]/.exec(input)?.[0] ?? '?';
    return message(`## Summary\n${person} lets the premises to **${company}** for EUR 2,400 a month.\n\n- Rent is paid in advance.`); } });
  const { email, settle } = handlers(stub);
  const response = await email(emailPost(postmarkInbound()));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, accepted: true });
  await settle();
  assert.equal(stub.calls.openai.length, 1, 'one run, no picker: the address names the agent');
  const sent = stub.calls.openai[0];
  assert.equal(sent.headers.Authorization, 'Bearer sk-test'); assert.equal(sent.body.stream, undefined); assert.equal(sent.body.store, false);
  assert.ok(sent.body.instructions.includes(agentBySlug('plain-summary').instructions.slice(0, 60)), 'the plain-language summary agent ran');
  assert.ok(sent.body.instructions.includes('replaced by placeholders'), 'the instruction says names were hidden');
  assert.ok(!sent.body.tools, 'an agent that does not research gets no web search');
  const documents = sent.body.input.find(item => String(item.content).startsWith('DOCUMENTS ATTACHED'));
  assert.ok(documents && documents.content.includes('lease.docx') && documents.content.includes('note.txt') && documents.content.includes('EUR 2,400'), 'both files were read');
  assert.ok(sent.raw.includes('[PERSON 1]') && sent.raw.includes('[COMPANY 1]') && sent.raw.includes('[EMAIL 1]') && sent.raw.includes('[PHONE 1]'));
  noNames(sent.raw);
  assert.equal(stub.calls.postmark.length, 1);
  const mail = stub.calls.postmark[0];
  assert.equal(mail.headers['X-Postmark-Server-Token'], 'pm-server-token');
  assert.equal(mail.body.To, 'owner@firm.example', 'the answer goes to the allowed sender, never to the Reply-To the message names');
  assert.equal(mail.body.From, 'agents@firm.example'); assert.equal(mail.body.Subject, 'Re: Fwd: Lease for review'); assert.equal(mail.body.ReplyTo, 'plain-summary@in.firm.example');
  assert.deepEqual(mail.body.Headers.slice(0, 2), [{ Name: 'In-Reply-To', Value: '<CAF=lease-123@mail.firm.example>' }, { Name: 'References', Value: '<CAF=lease-123@mail.firm.example>' }]);
  assert.ok(mail.body.TextBody.includes('John Papadopoulos lets the premises to **Alpha Trading Ltd**') && !mail.body.TextBody.includes('[PERSON'), 'names restored in the text');
  assert.ok(mail.body.HtmlBody.includes('<strong>Alpha Trading Ltd</strong>') && mail.body.HtmlBody.includes('<li>Rent is paid in advance.</li>'));
  const [word] = mail.body.Attachments;
  assert.equal(word.ContentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); assert.ok(word.Name.startsWith('plain-language-summary-') && word.Name.endsWith('.docx'));
  const wordText = docxText(new Uint8Array(Buffer.from(word.Content, 'base64')));
  assert.ok(wordText.includes('Plain-language summary') && wordText.includes('John Papadopoulos lets the premises to Alpha Trading Ltd'), wordText);
});

await test('email: the same Postmark MessageID delivered twice runs once', async () => {
  resetInboundMemory(); const stub = world(); const { email, settle } = handlers(stub);
  await email(emailPost(postmarkInbound({ MessageID: 'dup-1' })));
  const again = await email(emailPost(postmarkInbound({ MessageID: 'dup-1' })));
  assert.equal((await again.json()).ignored, 'duplicate');
  await settle(); assert.equal(stub.calls.openai.length, 1); assert.equal(stub.calls.postmark.length, 1);
});

await test('email: without an agent named, the AI picker reads the task with names hidden and its top pick runs', async () => {
  resetInboundMemory(); const stub = world({ pick: 'ready-finance-month-end-commentary', answer: () => message('Revenue rose 4% against budget.') });
  const { email, settle } = handlers(stub);
  await email(emailPost(postmarkInbound({ MessageID: 'pick-1', To: 'agents@in.firm.example', ToFull: [{ Email: 'agents@in.firm.example' }], OriginalRecipient: 'agents@in.firm.example', Subject: 'October variances',
    TextBody: 'Write the month-end variance commentary for October for Maria Georgiou, our CFO.', Attachments: [] })));
  await settle();
  assert.equal(stub.calls.openai.length, 2);
  assert.equal(stub.calls.openai[0].body.text.format.name, 'agent_route'); noNames(stub.calls.openai[0].raw);
  assert.ok(stub.calls.openai[1].body.instructions.includes(agentBySlug('finance-month-end-commentary').instructions.slice(0, 60))); noNames(stub.calls.openai[1].raw);
  assert.ok(stub.calls.postmark[0].body.TextBody.includes('Month-end variance commentary'));
});

await test('whatsapp: the verify GET echoes hub.challenge only with the right token', async () => {
  const { whatsapp } = handlers(world());
  const ok = await whatsapp(new Request('https://agents.firm.example/api/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444'));
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '1158201444');
  const wrong = await whatsapp(new Request('https://agents.firm.example/api/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1158201444'));
  assert.equal(wrong.status, 403);
});

await test('whatsapp: a bad signature is refused with 401; an unknown number or another phone number id is acknowledged and ignored; no AI call', async () => {
  resetInboundMemory(); const stub = world(); const { whatsapp, settle } = handlers(stub);
  const forged = await whatsapp(waPost(waPayload([waText('wamid.A', '/agent plain-summary\nhello')]), 'wrong-secret'));
  assert.equal(forged.status, 401);
  const tampered = waPost(waPayload([waText('wamid.B', 'hello')])); const body = (await tampered.text()).replace('hello', 'HELLO');
  assert.equal((await whatsapp(new Request(tampered.url, { method: 'POST', headers: tampered.headers, body }))).status, 401);
  const stranger = await whatsapp(waPost(waPayload([waText('wamid.C', 'hello', '15551234567')])));
  assert.equal(stranger.status, 200);
  const otherNumber = await whatsapp(waPost(waPayload([waText('wamid.D', 'hello')], '999999999999')));
  assert.equal(otherNumber.status, 200);
  await settle(); assert.equal(stub.calls.openai.length + stub.calls.graph.length, 0);
});

await test('whatsapp: «/agent name» picks the agent; a long answer is split at 4,096 characters on paragraphs; the Word file follows as a document', async () => {
  resetInboundMemory();
  const paragraphs = ['A'.repeat(3_000), 'B'.repeat(3_000), 'C'.repeat(1_000), 'D'.repeat(3_500)];
  const stub = world({ answer: () => message(paragraphs.join('\n\n')) }); const { whatsapp, settle } = handlers(stub);
  const response = await whatsapp(waPost(waPayload([waText('wamid.HBgLMzU3OTkwMDAxMTEVAgASGBQzQTk', '/agent Month-end variance commentary\nRevenue 1.2m vs budget 1.1m; costs flat.')])));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  await settle();
  assert.equal(stub.calls.openai.length, 1);
  assert.ok(stub.calls.openai[0].body.instructions.includes(agentBySlug('finance-month-end-commentary').instructions.slice(0, 60)));
  assert.ok(!JSON.stringify(stub.calls.openai[0].body.input).includes('/agent'), 'the control line is not part of the task');
  const texts = stub.calls.graph.filter(call => call.path.endsWith('/messages') && call.body.type === 'text');
  assert.equal(stub.calls.graph[0].body.status, 'read', 'the message is marked read first');
  assert.ok(texts.every(call => call.body.text.body.length <= 4_096 && call.body.to === '35799000111'));
  assert.equal(texts[0].body.context.message_id, 'wamid.HBgLMzU3OTkwMDAxMTEVAgASGBQzQTk'); assert.equal(texts[1].body.context, undefined);
  assert.equal(texts[0].body.text.body, paragraphs[0], 'A alone: A + B would pass 4,096');
  assert.equal(texts[1].body.text.body, `${paragraphs[1]}\n\n${paragraphs[2]}`, 'B and C together');
  assert.ok(texts[2].body.text.body.startsWith(paragraphs[3]), 'D starts a message of its own');
  assert.equal(texts.length, 3);
  const upload = stub.calls.graph.find(call => call.path === `/v24.0/${ENV.WHATSAPP_PHONE_NUMBER_ID}/media`);
  assert.ok(upload && upload.body instanceof FormData && upload.body.get('messaging_product') === 'whatsapp' && upload.body.get('file').name.endsWith('.docx'));
  assert.equal(upload.headers.Authorization, 'Bearer wa-token');
  const document = stub.calls.graph.find(call => call.body?.type === 'document');
  assert.equal(document.body.document.id, '1037543291543636'); assert.ok(document.body.document.filename.startsWith('month-end-variance-commentary-'));
});

await test('whatsapp: the same message id delivered twice (Meta redelivers) runs once', async () => {
  resetInboundMemory(); const stub = world(); const { whatsapp, settle } = handlers(stub);
  const payload = waPayload([waText('wamid.DUP', '/agent plain-summary\nSummarise: the meeting moved to Friday.')]);
  await whatsapp(waPost(payload)); await whatsapp(waPost(payload));
  await settle(); assert.equal(stub.calls.openai.length, 1);
});

await test('whatsapp: a research agent without a place gets «which place?» and no AI call; «Place: Cyprus» then runs it on Cyprus\'s official sources only', async () => {
  resetInboundMemory();
  const domain = placeDomains('cy')[0];
  const stub = world({ answer: () => ({ status: 'completed', output: [{ type: 'web_search_call', action: { query: 'cysec', sources: [{ url: `https://${domain}/en/` }] } },
    { type: 'message', content: [{ type: 'output_text', text: `The rule is in [the official page](https://${domain}/en/rules).`, annotations: [{ type: 'url_citation', url: `https://${domain}/en/rules`, title: 'Rules' }] }] }] }) });
  const { whatsapp, settle } = handlers(stub);
  await whatsapp(waPost(waPayload([waText('wamid.P1', '/agent Financial regulation gap analysis\nCheck our onboarding policy against the AML rules.')])));
  await settle();
  assert.equal(stub.calls.openai.length, 0, 'no AI call without a place');
  const question = stub.calls.graph.find(call => call.body?.type === 'text');
  assert.ok(question.body.text.body.includes('researches the official sources of one place') && question.body.text.body.includes('Place: France'), question.body.text.body);
  await whatsapp(waPost(waPayload([waText('wamid.P2', 'Place: Cyprus')])));
  await settle();
  assert.equal(stub.calls.openai.length, 1, 'the waiting message runs once the place is given');
  const run = stub.calls.openai[0].body;
  assert.equal(run.tool_choice, 'required'); assert.deepEqual(run.include, ['web_search_call.action.sources']);
  assert.deepEqual(run.tools[0].filters.allowed_domains, placeDomains('cy'));
  assert.ok(run.instructions.includes('GOVERNING JURISDICTION: Cyprus') && JSON.stringify(run.input).includes('onboarding policy'));
  const answer = stub.calls.graph.filter(call => call.body?.type === 'text').at(-1).body.text.body;
  assert.ok(answer.includes(`Rules: https://${domain}/en/rules`) && answer.includes('(Cyprus)'), answer);
});

await test('whatsapp: with names hidden a photo is not sent (PDF/Word asked for); with INBOUND_ALLOW_IMAGES=1 it goes as an input_image data URL; the token goes only to Meta hosts', async () => {
  resetInboundMemory();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
  const photo = (id) => ({ from: '35799000111', id, timestamp: '1762503300', type: 'image', image: { caption: '/agent plain-summary\nWhat does this receipt say?', mime_type: 'image/jpeg', sha256: 'x', id: '1312406452870581' } });
  let stub = world({ media: { '1312406452870581': { type: 'image/jpeg', bytes: jpeg } } }); let run = handlers(stub);
  await run.whatsapp(waPost(waPayload([photo('wamid.I1')]))); await run.settle();
  assert.equal(stub.calls.openai.length, 0);
  assert.ok(stub.calls.graph.find(call => call.body?.type === 'text').body.text.body.includes('PDF'));
  setEnv({ ...ENV, INBOUND_ALLOW_IMAGES: '1' }); resetInboundMemory();
  stub = world({ media: { '1312406452870581': { type: 'image/jpeg', bytes: jpeg } } }); run = handlers(stub);
  await run.whatsapp(waPost(waPayload([photo('wamid.I2')]))); await run.settle();
  assert.equal(stub.calls.openai.length, 1);
  const last = stub.calls.openai[0].body.input.at(-1);
  assert.equal(last.content[0].type, 'input_text'); assert.equal(last.content[1].type, 'input_image'); assert.equal(last.content[1].image_url, `data:image/jpeg;base64,${b64(jpeg)}`);
  assert.equal(stub.calls.other[0].headers.Authorization, 'Bearer wa-token');
  // A media URL off Meta's hosts is never fetched with the token.
  resetInboundMemory(); stub = world({ media: { '1312406452870581': { type: 'image/jpeg', bytes: jpeg } }, mediaUrl: 'https://collector.example/steal' }); run = handlers(stub);
  await run.whatsapp(waPost(waPayload([photo('wamid.I3')]))); await run.settle();
  assert.equal(stub.calls.other.length, 0); assert.equal(stub.calls.openai.length, 0);
  setEnv(ENV);
});

await test('documents: Word (deflated) and PDF text are read; tab stops are not text; unknown and old types are skipped with a note', async () => {
  assert.equal(docxText(LEASE).split('\n')[0], 'LEASE AGREEMENT');
  assert.ok(zipEntry(LEASE, 'word/document.xml'));
  const read = await readAttachments([
    { name: 'lease.docx', type: '', bytes: LEASE }, { name: 'scan.pdf', type: 'application/pdf', bytes: pdf(['Invoice 42', 'Total EUR 100']) },
    { name: 'data.csv', type: 'text/csv', bytes: new TextEncoder().encode('﻿a,b\n1,2') }, { name: 'old.doc', type: 'application/msword', bytes: new Uint8Array(10) },
    { name: 'archive.zip', type: 'application/zip', bytes: new Uint8Array(10) }, { name: 'broken.docx', type: '', bytes: new Uint8Array(40) } ]);
  assert.deepEqual(read.documents.map(file => file.name), ['lease.docx', 'scan.pdf', 'data.csv']);
  assert.ok(read.documents[0].text.includes('Mr John Papadopoulos (the "Landlord")') && !read.documents[0].text.startsWith('\t'));
  assert.equal(read.documents[1].text, '[p. 1]\nInvoice 42\nTotal EUR 100');
  assert.equal(read.documents[2].text, 'a,b\n1,2');
  assert.equal(read.notes.length, 3); assert.ok(read.notes[0].includes('.docx') && read.notes[1].includes('only PDF') && read.notes[2].includes('could not be read'));
});

await test('reading the message: control lines only in the sender\'s own words; places by code, name or local name; the UK is three places', () => {
  const parsed = readControls('agent: Plain-language summary\nJurisdiction: cy\n\nPlease summarise.\n\n---------- Forwarded message ---------\nPlace: Greece\nbody', 'Fwd: x');
  assert.equal(parsed.agentName, 'Plain-language summary'); assert.equal(parsed.placeQuery, 'cy'); assert.ok(parsed.body.startsWith('Please summarise.') && parsed.body.includes('Place: Greece'));
  assert.equal(readControls('Please read this.\n\n> Jurisdiction: Greece').placeQuery, undefined);
  assert.deepEqual(findPlace('Κύπρος').map(place => place.code), ['cy']); assert.deepEqual(findPlace('England & Wales').map(place => place.code), ['ew']);
  assert.deepEqual(findPlace('UK').map(place => place.code), ['ew', 'gb-sct', 'gb-nir']); assert.deepEqual(findPlace('Atlantis'), []);
});

await test('limits: the rate limit tells the sender once and then drops quietly; WhatsApp text is formatted and split on words when a line is too long', () => {
  setEnv({ ...ENV, INBOUND_MAX_PER_HOUR: '2' }); resetInboundMemory();
  assert.deepEqual([1, 2, 3, 4].map(() => rateCheck('email:x@y.example')), ['ok', 'ok', 'first', 'limited']);
  assert.equal(rateCheck('email:x@y.example', Date.now() + 3_700_000), 'ok', 'an hour later');
  setEnv(ENV); resetInboundMemory();
  assert.equal(whatsappText('## Terms\n- **Rent** is *monthly*: see [s. 5](https://example.gov/s5)'), '*Terms*\n• *Rent* is _monthly_: see s. 5 (https://example.gov/s5)');
  const words = splitMessage(Array(1_000).fill('word').join(' '), 100);
  assert.ok(words.every(part => part.length <= 100 && !part.startsWith(' ') && !/wor$/.test(part))); assert.equal(words.join(' '), Array(1_000).fill('word').join(' '));
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
