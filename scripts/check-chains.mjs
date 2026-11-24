// Checks the ready-made chains (src/data/chains-ready.ts) against the library.
// Run: node --experimental-transform-types scripts/check-chains.mjs
import { FIELDS } from '../shared/fields.ts';
import { AGENT_TEMPLATES, templateAgent, fieldAgents } from '../src/data/templates/index.ts';
import { READY_CHAIN_SPECS } from '../src/data/chains-ready.ts';

const WANT = 50;
const agents = new Map([...AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, '')), ...fieldAgents(0, '')].map(agent => [agent.id, agent]));
let failures = 0;
const fail = message => { failures++; console.log('FAIL', message); };
const ids = new Set(); const names = new Set(); const lead = new Map(); const used = new Map(); const leadAgents = new Set();
for (const chain of READY_CHAIN_SPECS) {
  const where = `«${chain?.name ?? chain?.id ?? '?'}»`;
  if (typeof chain.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(chain.id) || chain.id.length > 48) fail(`${where}: id must be kebab-case, at most 48 characters`);
  if (ids.has(chain.id)) fail(`${where}: duplicate id`); ids.add(chain.id);
  const name = String(chain.name ?? '');
  if (names.has(name.toLowerCase())) fail(`${where}: duplicate name`); names.add(name.toLowerCase());
  const parts = name.split(' → ');
  if (parts.length < 2 || parts.length > 4 || parts.some(part => !part.trim())) fail(`${where}: the name reads «A → B → C» (2 to 4 parts joined by « → »)`);
  if (name.length > 58) fail(`${where}: name over 58 characters (${name.length})`);
  const description = String(chain.description ?? '');
  if (description.length < 60 || description.length > 125) fail(`${where}: description must be 60 to 125 characters (now ${description.length})`);
  if ((description.match(/[.!?](\s|$)/g) ?? []).length !== 2) fail(`${where}: description is exactly two short sentences`);
  if (!Array.isArray(chain.steps) || chain.steps.length < 2 || chain.steps.length > 4) { fail(`${where}: 2 to 4 steps`); continue; }
  const seen = new Set();
  chain.steps.forEach(([agentId, ask], index) => {
    const agent = agents.get(agentId);
    if (!agent) fail(`${where}: step ${index + 1} names an agent that does not exist: ${agentId}`);
    if (seen.has(agentId)) fail(`${where}: the agent ${agentId} appears twice`); seen.add(agentId);
    used.set(agentId, (used.get(agentId) ?? 0) + 1);
    if (typeof ask !== 'string' || ask.length < 30 || ask.length > 200) fail(`${where}: step ${index + 1} ask must be 30 to 200 characters (now ${ask?.length})`);
    else if (!/[.]$/.test(ask)) fail(`${where}: step ${index + 1} ask ends with a full stop`);
    if (index === 0 && agent) { lead.set(agent.field, (lead.get(agent.field) ?? 0) + 1); if (leadAgents.has(agentId)) fail(`${where}: ${agentId} already opens another chain`); leadAgents.add(agentId); }
  });
}
if (READY_CHAIN_SPECS.length !== WANT) fail(`${READY_CHAIN_SPECS.length} chains; exactly ${WANT}`);
for (const field of FIELDS) { const count = lead.get(field.id) ?? 0; if (!count) fail(`no chain starts in the field «${field.name}» (${field.id})`); if (count > 4) fail(`${count} chains start in «${field.name}»; at most 4`); }
for (const [agentId, count] of used) if (count > 3) fail(`${agentId} is used in ${count} chains; at most 3`);
const three = READY_CHAIN_SPECS.filter(chain => chain.steps.length === 3).length;
if (three < 30) fail(`${three} chains have three steps; at least 30 (the card shows 1 → 2 → 3)`);
console.log(`${READY_CHAIN_SPECS.length} chains, ${three} with three steps, ${[...lead.keys()].length} fields lead a chain, ${used.size} agents used`);
console.log(failures ? `${failures} failure(s)` : 'all checks passed');
process.exit(failures ? 1 : 0);
