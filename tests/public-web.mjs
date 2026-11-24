import assert from 'node:assert/strict';
import { privateAddress, publicWebUrl, reachablePublicUrl, pageScope } from '../server/public-web.ts';
import { assetPath, rebaseImports, ticketValid, handleWebAsset } from '../server/web-asset.ts';
import { createHmac } from 'node:crypto';

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok   ${name}`); };

await check('addresses: private, local and special networks are refused; public ones pass', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])
    assert.equal(privateAddress(address), true, address);
  for (const address of ['8.8.8.8', '172.32.0.1', '151.101.1.1', '2606:4700::1111']) assert.equal(privateAddress(address), false, address);
});
await check('urls: only http(s), usual ports, no credentials, no local names or private IPs', () => {
  for (const url of ['https://cyprus-mail.com/2026/11/12/x', 'http://philenews.com/', 'https://github.com/a/b', 'https://8.8.8.8/']) assert.ok(publicWebUrl(url), url);
  for (const url of ['file:///etc/passwd', 'ftp://x.com/', 'https://user:pw@x.com/', 'http://localhost:3000/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://intranet/', 'http://printer.local/', 'https://x.com:22/', 'http://10.0.0.5:8080/', 'javascript:alert(1)']) assert.equal(publicWebUrl(url), null, url);
});
await check('names: a name that resolves to a private address is refused', async () => {
  assert.equal(await reachablePublicUrl('http://localtest.me/'), false); // resolves to 127.0.0.1
  assert.equal(await reachablePublicUrl('http://no-such-name.invalid/'), false);
});
await check('scope: an official page for anyone; any other page only with open=1 and a signed-in person', async () => {
  assert.equal(await pageScope(new Request('http://localhost/api/official-web?url=x'), 'https://www.cylaw.org/index.html'), 'official');
  assert.equal(await pageScope(new Request('http://localhost/api/official-web?url=x'), 'https://cyprus-mail.com/'), null);
  assert.equal(await pageScope(new Request('http://localhost/api/official-web?url=x&open=1'), 'https://cyprus-mail.com/'), null); // nobody signed in
});
await check('module files: a ticket names one host and expires; root imports come back through the route', async () => {
  const secret = 'x'.repeat(40), now = Date.parse('2026-11-12T08:00:00Z'), expires = Math.floor(now / 1000) + 600;
  const ticket = `${expires}.${createHmac('sha256', secret).update(`web-asset|cyprus-mail.com|${expires}`).digest('base64url').slice(0, 32)}`;
  assert.equal(ticketValid(ticket, 'cyprus-mail.com', now, secret), true);
  assert.equal(ticketValid(ticket, 'evil.example', now, secret), false);
  assert.equal(ticketValid(ticket, 'cyprus-mail.com', now + 3_600_000, secret), false);
  assert.equal(ticketValid('123.abc', 'cyprus-mail.com', now, secret), false);
  assert.equal(assetPath('T', new URL('https://cyprus-mail.com/_astro/a.js?v=1')), '/api/web-asset/T/https/cyprus-mail.com/_astro/a.js?v=1');
  assert.equal(rebaseImports('import a from"/_astro/a.js";import("/b.js");import"./c.js";const u="//cdn.x/y"', 'P'), 'import a from"P/_astro/a.js";import("P/b.js");import"./c.js";const u="//cdn.x/y"');
  assert.equal((await handleWebAsset(new Request('http://localhost/api/web-asset/123.abc/https/cyprus-mail.com/x.js'))).status, 403);
  assert.equal((await handleWebAsset(new Request('http://localhost/api/web-asset/nope'))).status, 400);
});
// 13 Nov 2026 (review): IPv6 forms of internal IPv4 addresses (Node writes [::ffff:127.0.0.1] as ::ffff:7f00:1).
for (const inside of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/', 'http://[::127.0.0.1]/', 'http://[2002:7f00:1::]/', 'http://[2001:0:1::1]/', 'http://[::ffff:c0a8:101]/'])
  assert.equal(publicWebUrl(inside), null, inside);
assert.ok(publicWebUrl('http://[2606:4700:4700::1111]/')); assert.equal(privateAddress('::ffff:808:808'), false); assert.equal(privateAddress('2002:808:808::'), false);
passed++;
console.log(`${passed} public-web checks passed.`);
