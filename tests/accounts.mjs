// Accounts (Better Auth on node:sqlite): who may join, the settings, and a whole sign-up → session → sign-in → sign-out
// on an in-memory database. No network.
import assert from 'node:assert/strict';
import { accountsFor, mayJoin, readAllowed, readAuthConfig, signedInUser } from '../server/auth/auth.ts';

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok   ${name}`); };
const SECRET = 'x'.repeat(40);
const ORIGIN = 'http://localhost:3999';

await check('allow-list: addresses and @domains, junk dropped', () => {
  assert.deepEqual(readAllowed('a@b.example, @firm.example; nope ,  C@D.example'), ['a@b.example', '@firm.example', 'c@d.example']);
  const list = { signup: 'list', allowed: ['me@x.example', '@firm.example'] };
  assert.equal(mayJoin('Me@X.example', list), true);
  assert.equal(mayJoin('anyone@firm.example', list), true);
  assert.equal(mayJoin('other@x.example', list), false);
  assert.equal(mayJoin('x@y.example', { signup: 'closed', allowed: [] }), false);
  assert.equal(mayJoin('x@y.example', { signup: 'open', allowed: [] }), true);
  assert.equal(mayJoin(undefined, { signup: 'open', allowed: [] }), false);
});

await check('settings: a serverless host never invents a secret or a database; sign-up closed there without a list', () => {
  assert.deepEqual(readAuthConfig({ VERCEL: '1', BETTER_AUTH_SECRET: SECRET }), { off: 'no_database' });
  assert.deepEqual(readAuthConfig({ VERCEL: '1', AUTH_DB_PATH: '/tmp/x.sqlite' }), { off: 'no_secret' });
  assert.deepEqual(readAuthConfig({ AUTH_DB_PATH: ':memory:', BETTER_AUTH_SECRET: 'short' }), { off: 'weak_secret' });
  assert.equal(readAuthConfig({ VERCEL: '1', AUTH_DB_PATH: '/tmp/x.sqlite', BETTER_AUTH_SECRET: SECRET }).signup, 'closed');
  assert.equal(readAuthConfig({ VERCEL: '1', AUTH_DB_PATH: '/tmp/x.sqlite', BETTER_AUTH_SECRET: SECRET, AUTH_ALLOWED_EMAILS: 'a@b.example' }).signup, 'list');
  assert.equal(readAuthConfig({ AUTH_DB_PATH: ':memory:', BETTER_AUTH_SECRET: SECRET }).signup, 'open');
  assert.equal(readAuthConfig({ AUTH_DB_PATH: ':memory:', BETTER_AUTH_SECRET: SECRET, AUTH_SIGNUP: 'closed' }).signup, 'closed');
});

const config = { dbPath: ':memory:', secret: SECRET, signup: 'list', allowed: ['owner@agents.example'] };
const auth = await accountsFor(ORIGIN, config);
const post = (route, body, cookie = '') => auth.handler(new Request(`${ORIGIN}/api/auth${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }));
const cookieOf = response => (response.headers.getSetCookie?.() ?? []).map(line => line.split(';')[0]).join('; ');
const asUser = cookie => new Request(`${ORIGIN}/api/anything`, { headers: { Cookie: cookie } });

let cookie = '';
await check('sign-up: an allowed address gets an account and a session; others are refused', async () => {
  const refused = await post('/sign-up/email', { email: 'stranger@else.example', password: 'long-enough-pass', name: 'S' });
  assert.equal(refused.status, 403);
  const short = await post('/sign-up/email', { email: 'owner@agents.example', password: 'short', name: 'Owner' });
  assert.equal(short.status, 400);
  const made = await post('/sign-up/email', { email: 'owner@agents.example', password: 'long-enough-pass', name: 'Owner' });
  assert.equal(made.status, 200, await made.clone().text());
  cookie = cookieOf(made);
  assert.match(cookie, /agents\.session_token=/);
});

await check('session: the cookie names the user; no cookie, a forged one or accounts off give nobody', async () => {
  const user = await signedInUser(asUser(cookie), config);
  assert.equal(user?.email, 'owner@agents.example');
  assert.equal(await signedInUser(new Request(`${ORIGIN}/x`), config), null);
  assert.equal(await signedInUser(asUser('agents.session_token=forged.value'), config), null);
  assert.equal(await signedInUser(asUser(cookie), { off: 'no_database' }), null);
});

await check('sign-in: a wrong password is refused; the right one signs in; sign-out ends the session', async () => {
  assert.equal((await post('/sign-in/email', { email: 'owner@agents.example', password: 'wrong-password-1' })).status, 401);
  const ok = await post('/sign-in/email', { email: 'owner@agents.example', password: 'long-enough-pass' });
  assert.equal(ok.status, 200);
  const second = cookieOf(ok);
  assert.equal((await signedInUser(asUser(second), config))?.email, 'owner@agents.example');
  const out = await post('/sign-out', {}, second);
  assert.equal(out.status, 200);
  assert.equal(await signedInUser(asUser(second), config), null);
});

console.log(`${passed} account checks passed.`);
