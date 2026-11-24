// One-off setup (11 Nov 2026, his «yes, set them up»): creates a Composio-managed auth config for every app on the
// Connections page that has none yet, and writes their ids into .env.local as COMPOSIO_AUTH_CONFIGS. The key is read
// from .env.local and never printed. Calls (docs.composio.dev/reference/v3/api-reference/auth-configs, read 11 Nov 2026):
//   GET  /api/v3/auth_configs?toolkit_slug=…&limit=200          (what exists already: nothing is made twice)
//   POST /api/v3/auth_configs { toolkit: { slug }, auth_config: { type: 'use_composio_managed_auth' } }
// Run: node --experimental-transform-types --no-warnings scripts/setup-composio.mjs        (add --dry to only look)
import fs from 'node:fs';
import { CONNECTORS } from '../shared/connections.ts';

const FILE = new URL('../.env.local', import.meta.url);
const dry = process.argv.includes('--dry');
const text = fs.readFileSync(FILE, 'utf8');
const key = /^COMPOSIO_API_KEY=(.*)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
if (!key) { console.log('COMPOSIO_API_KEY is empty in .env.local. Paste your key there, save, and run this again.'); process.exit(1); }
const BASE = 'https://backend.composio.dev/api/v3/auth_configs';
const headers = { 'x-api-key': key, 'Content-Type': 'application/json' };
const safe = value => String(value).replaceAll(key, '[key]').slice(0, 300);

const list = await fetch(`${BASE}?limit=200&toolkit_slug=${encodeURIComponent(CONNECTORS.map(item => item.toolkit).join(','))}`, { headers });
if (list.status === 401 || list.status === 403) { console.log(`Composio refused the key (${list.status}). Check it was copied whole, from Settings → API Keys of the right project.`); process.exit(1); }
if (!list.ok) { console.log(`Could not list auth configs: ${list.status} ${safe(await list.text())}`); process.exit(1); }
const existing = new Map();
for (const item of (await list.json()).items ?? []) { const slug = String(item?.toolkit?.slug ?? '').toUpperCase(); if (slug && item?.id && item?.status !== 'DISABLED' && !existing.has(slug)) existing.set(slug, item.id); }

const configs = {}; const made = [], kept = [], failed = [];
for (const connector of CONNECTORS) {
  const found = existing.get(connector.toolkit);
  if (found) { configs[connector.id] = found; kept.push(connector.name); continue; }
  if (dry) { failed.push(`${connector.name} (would create)`); continue; }
  const response = await fetch(BASE, { method: 'POST', headers, body: JSON.stringify({ toolkit: { slug: connector.toolkit.toLowerCase() }, auth_config: { type: 'use_composio_managed_auth' } }) });
  const body = await response.json().catch(() => null);
  const id = body?.auth_config?.id;
  if (response.ok && typeof id === 'string') { configs[connector.id] = id; made.push(connector.name); }
  else failed.push(`${connector.name}: ${response.status} ${safe(body?.error?.message ?? '')}`);
}

console.log(`Already there: ${kept.length ? kept.join(', ') : 'none'}`);
console.log(`Created now:   ${made.length ? made.join(', ') : 'none'}`);
if (failed.length) console.log(`Not done:      ${failed.join(' | ')}`);
if (!dry && Object.keys(configs).length) {
  const line = `COMPOSIO_AUTH_CONFIGS=${JSON.stringify(configs)}`;
  const next = /^COMPOSIO_AUTH_CONFIGS=.*$/m.test(text) ? text.replace(/^COMPOSIO_AUTH_CONFIGS=.*$/m, line) : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(FILE, next, { mode: 0o600 });
  console.log(`Saved ${Object.keys(configs).length} of ${CONNECTORS.length} apps in .env.local (COMPOSIO_AUTH_CONFIGS). Restart the app to use them.`);
}
