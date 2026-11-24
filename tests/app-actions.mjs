// Doing things in the person's apps (12 Nov 2026): what an action may be, that the route acts only for a signed-in
// person on a connected app with a valid action, and which questions reach the apps.
import assert from 'node:assert/strict';
import { eventEnd, readAction, unseenAddresses } from '../shared/app-actions.ts';
import { createAppActionHandler } from '../server/app-action.ts';
import { appsAsked } from '../server/connected/ask.ts';
import { isScheduled, onAppsAlready, withoutDelivery } from '../server/agent-run.ts';

let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); process.exitCode = 1; } };
const event = { kind: 'event', service: 'googlecalendar', title: 'Meeting with Elias Neocleous', start: '2026-11-19T10:00', minutes: 60, timeZone: 'Asia/Nicosia', attendees: [], reminder: 15 };
const email = { kind: 'email', service: 'gmail', to: ['Maria@Example.com'], cc: ['maria@example.com', 'bob@example.org'], subject: 'Thursday', body: 'See you at ten.' };

await test('actions: a good event and e-mail pass, cleaned; anything off is refused', () => {
  assert.deepEqual(readAction(event), event);
  assert.deepEqual(readAction(email), { ...email, to: ['maria@example.com'], cc: ['bob@example.org'] }, 'addresses lower-cased, a cc that is already in to dropped');
  for (const bad of [{ ...event, start: '2026-11-19 10:00' }, { ...event, start: '2026-13-01T10:00' }, { ...event, minutes: 2 }, { ...event, minutes: 2000 }, { ...event, timeZone: 'Mars/Base' },
    { ...event, title: '' }, { ...event, service: 'gmail' }, { ...email, to: [] }, { ...email, to: ['not an address'] }, { ...email, subject: '' }, { ...email, service: 'googlecalendar' },
    { ...email, to: Array.from({ length: 11 }, (_, i) => `p${i}@example.com`) }, { kind: 'delete', service: 'gmail' }, null, 'x']) assert.equal(readAction(bad), null, JSON.stringify(bad));
  assert.equal(readAction({ ...event, reminder: undefined }).reminder, null, 'no reminder means the calendar\'s own');
});
await test('a reply: needs the message id and text; the card\'s «to» never decides where it goes', () => {
  const reply = { kind: 'reply', service: 'gmail', messageId: '19a4f2c7e8b1d', to: 'Legal Advice CY <info@legaladvice.cy>', subject: 'Re: Fwd: Attn: Mr Morgan', body: 'Thank you, I will review the documents.' };
  assert.deepEqual(readAction(reply), reply);
  for (const bad of [{ ...reply, messageId: '' }, { ...reply, messageId: 'id with spaces' }, { ...reply, body: ' ' }, { ...reply, service: 'googlecalendar' }]) assert.equal(readAction(bad), null);
  assert.deepEqual(unseenAddresses(readAction(reply), 'answer them'), [], 'the sender is found by the server, nothing to flag');
});
await test('a reply finds the sender of an e-mail with attachments (it took the attachment list for the message)', async () => {
  const { sendReplyAs } = await import('../server/send-reply.ts');
  const calls = [];
  const deps = { key: () => 'ak', authConfigs: () => ({ gmail: 'ac' }), ownerCode: () => '', user: 'u', fetcher: async (url, init) => {
    const slug = String(url).split('/').pop(); calls.push({ slug, args: JSON.parse(init.body).arguments });
    if (slug === 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID') return new Response(JSON.stringify({ successful: true, data: { attachmentList: [{ attachmentId: 'a1', filename: 'x.pdf', mimeType: 'application/pdf' }], messageId: 'm1', threadId: 't1', sender: 'Legal Advice CY <info@legaladvicecy.com>', subject: 'Fwd: Attn' } }));
    return new Response(JSON.stringify({ successful: true, data: {} }));
  } };
  assert.deepEqual(await sendReplyAs(deps, 'gmail', 'm1', 'Thank you.'), { to: 'info@legaladvicecy.com' });
  assert.deepEqual(calls.at(-1), { slug: 'GMAIL_REPLY_TO_THREAD', args: { thread_id: 't1', recipient_email: 'info@legaladvicecy.com', message_body: 'Thank you.', is_html: false, user_id: 'me' } });
});
await test('event end by the calendar: across midnight and the end of a month', () => {
  assert.equal(eventEnd('2026-11-19T10:00', 60), '2026-11-19T11:00');
  assert.equal(eventEnd('2026-11-30T23:30', 90), '2026-12-01T01:00');
});
await test('an address the person never typed is pointed out', () => {
  assert.deepEqual(unseenAddresses(readAction(email), 'email maria@example.com about thursday'), ['bob@example.org']);
  assert.deepEqual(unseenAddresses(readAction({ ...event, attendees: ['elias@neocleous.com'] }), 'add my meeting with Elias'), ['elias@neocleous.com']);
});
const CODE = 'owner-code-for-tests-0123456789';
const composio = (connected = ['googlecalendar', 'gmail']) => ({ key: () => 'ak_test', authConfigs: () => ({ googlecalendar: 'ac_1', gmail: 'ac_2' }), ownerCode: () => CODE,
  fetcher: async url => new Response(JSON.stringify({ items: connected.map((service, i) => ({ id: `ca_${i}`, status: 'ACTIVE', auth_config: { id: service === 'googlecalendar' ? 'ac_1' : 'ac_2' } })) }), { status: 200 }) });
const post = (body, headers = { 'X-Owner-Code': CODE }) => new Request('http://localhost:3000/api/app-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost:3000', ...headers }, body: JSON.stringify(body) });
await test('route: signed-in only, a valid action only, a connected app only; the action is checked again on the server', async () => {
  const done = [];
  const handler = (connected) => createAppActionHandler(composio(connected), async (_acting, action) => { done.push(action); return { link: 'https://calendar.google.com/event?eid=x' }; });
  assert.equal((await handler()(post({ action: event }, {}))).status, 401, 'no sign-in');
  assert.equal((await handler()(post({ action: { ...event, start: 'tomorrow' } }))).status, 400);
  assert.equal((await handler(['gmail'])(post({ action: event }))).status, 409, 'calendar not connected');
  const ok = await handler()(post({ action: { ...event, extra: 'ignored', reminder: 15 } }));
  assert.deepEqual([ok.status, (await ok.json()).link], [200, 'https://calendar.google.com/event?eid=x']);
  assert.deepEqual(done, [event], 'exactly the checked action, nothing the browser added');
  const failing = createAppActionHandler(composio(), async () => { throw new Error('composio_tool_403'); });
  assert.deepEqual(await (await failing(post({ action: event }))).json(), { error: 'needs_permission' });
  assert.equal((await handler()(new Request('http://localhost:3000/api/app-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'X-Owner-Code': CODE }, body: JSON.stringify({ action: event }) }))).status, 403);
});
await test('questions that add a meeting or send an e-mail reach the apps; a one-off reminder is not a routine', () => {
  for (const q of ['add a meeting with Elias on Thursday at 10', 'put the dentist in my calendar for Monday', 'remind me of my meeting with Elias', 'schedule a call with Maria tomorrow']) assert.ok(appsAsked(q)?.includes('googlecalendar'), q);
  for (const q of ['send an email to maria@example.com about the invoice', 'email bob@example.org that I am late', 'write and send an e-mail to the client']) assert.ok(appsAsked(q)?.includes('gmail'), q);
  assert.ok(!isScheduled('i need an agent to remind me of my meeting'));
  // His conversation of 12 Nov 2026: «answer to my email» is the inbox; the short follow-ups stay on it.
  assert.ok(appsAsked(withoutDelivery('hola can you answer to my email?'))?.includes('gmail'));
  const chat = [{ role: 'user', content: 'i have an email form the legal advice i want to answert hem' }, { role: 'assistant', content: 'What would you like to tell them?' }];
  assert.ok(onAppsAlready([...chat, { role: 'user', content: 'let them knwo ill review the documets' }]));
  assert.ok(onAppsAlready([...chat, { role: 'user', content: 'let them know' }, { role: 'assistant', content: 'Draft…' }, { role: 'user', content: 'send it' }]));
  assert.ok(!onAppsAlready([{ role: 'user', content: 'write me a poem' }, { role: 'assistant', content: '…' }, { role: 'user', content: 'shorter' }]));
  assert.ok(isScheduled('remind me every week what is new on netflix'));
});
console.log(`${passed} app-action checks passed.`);
