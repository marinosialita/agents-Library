// Checks one field's catalogue of ready agents (src/data/templates/fields/<field>.ts) against the platform's rules.
// Run: node --experimental-transform-types scripts/check-field-agents.mjs finance   (or «all»)
import { AGENT_LIMITS, isAgentDefinition } from '../shared/agents.ts';
import { FIELDS, fieldById } from '../shared/fields.ts';
import { fieldTemplateAgent } from '../src/data/templates/fields/kit.ts';
import { AGENT_TEMPLATES, templateAgent } from '../src/data/templates/index.ts';
// Legal's ready ids share the «ready-…» namespace: a field template must never take one of them.
const LEGAL_IDS = new Set(AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, '').id));

const want = process.argv[2];
if (!want) { console.error('usage: check-field-agents.mjs <field-id|all>'); process.exit(2); }
const ids = want === 'all' ? FIELDS.map(field => field.id).filter(id => id !== 'legal') : [want];
let failures = 0;
const fail = (message) => { failures++; console.log('FAIL', message); };

for (const id of ids) {
  const field = fieldById(id);
  if (!field) { fail(`unknown field ${id}`); continue; }
  let catalogue;
  try { ({ CATALOGUE: catalogue } = await import(`../src/data/templates/fields/${id}.ts`)); }
  catch (error) { fail(`${id}: cannot load src/data/templates/fields/${id}.ts — ${error.message}`); continue; }
  if (!catalogue || catalogue.field !== id || !Array.isArray(catalogue.agents)) { fail(`${id}: export CATALOGUE = { field: '${id}', agents: [...] }`); continue; }
  const agents = catalogue.agents;
  const seenIds = new Set(); const seenNames = new Set();
  const perCategory = Object.fromEntries(field.categories.map(category => [category.id, 0]));
  for (const t of agents) {
    const where = `${id}: «${t?.name ?? t?.id ?? '?'}»`;
    if (typeof t.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id) || t.id.length > 48) fail(`${where}: id must be kebab-case, at most 48 characters`);
    if (!t.id?.startsWith(`${id}-`)) fail(`${where}: id must start with «${id}-»`);
    if (seenIds.has(t.id)) fail(`${where}: duplicate id ${t.id}`); seenIds.add(t.id);
    if (LEGAL_IDS.has(`ready-${t.id}`)) fail(`${where}: id ready-${t.id} belongs to a Legal template`);
    if (!(t.category in perCategory)) fail(`${where}: category «${t.category}» is not one of ${field.id}'s`); else perCategory[t.category]++;
    const name = String(t.name ?? '');
    if (seenNames.has(name.toLowerCase())) fail(`${where}: duplicate name`); seenNames.add(name.toLowerCase());
    const words = name.trim().split(/\s+/).length;
    if (words < 2 || words > 6) fail(`${where}: name must be 2 to 6 words`);
    if (/\b(agent|assistant|ai|bot|gpt)\b/i.test(name)) fail(`${where}: the name must say the task, not «agent», «assistant» or «AI»`);
    if (typeof t.description !== 'string' || t.description.length > 220 || t.description.length < 60) fail(`${where}: description must be 60 to 220 characters (now ${t.description?.length})`);
    if (typeof t.needs !== 'string' || !t.needs.trim() || t.needs.length > AGENT_LIMITS.needs) fail(`${where}: needs must be one sentence (at most ${AGENT_LIMITS.needs} characters)`);
    if (!Array.isArray(t.starters) || t.starters.length !== AGENT_LIMITS.starters) fail(`${where}: exactly ${AGENT_LIMITS.starters} starters (now ${t.starters?.length})`);
    else {
      const seen = new Set();
      for (const s of t.starters) {
        if (typeof s !== 'string' || !s.trim() || s.length > AGENT_LIMITS.starter) fail(`${where}: starter too long or empty`);
        else if (s.trim().split(/\s+/).length > 16) fail(`${where}: starter over 16 words: «${s}»`);
        else if (/^(can|could|would) you\b/i.test(s.trim())) fail(`${where}: starter must be a request, not «Can you…»: «${s}»`);
        if (seen.has(s.toLowerCase())) fail(`${where}: duplicate starter «${s}»`); seen.add(s.toLowerCase());
      }
    }
    if (typeof t.instructions !== 'string' || t.instructions.length > AGENT_LIMITS.instructions) fail(`${where}: instructions over ${AGENT_LIMITS.instructions} characters`);
    else {
      for (const section of ['## Role', '## Task', '## Output', '## Rules']) if (!t.instructions.includes(section)) fail(`${where}: instructions lack «${section}» (use doc())`);
      const tasks = (t.instructions.split('## Task')[1] ?? '').split('## Output')[0].split('\n').filter(line => line.startsWith('- ')).length;
      if (tasks < 4 || tasks > 9) fail(`${where}: Task needs 4 to 9 steps (now ${tasks})`);
      const outputs = (t.instructions.split('## Output')[1] ?? '').split('## Rules')[0].split('\n').filter(line => line.startsWith('- ')).length;
      if (outputs < 2 || outputs > 7) fail(`${where}: Output needs 2 to 7 points (now ${outputs})`);
      if (t.instructions.length < 700) fail(`${where}: instructions too thin (${t.instructions.length} characters; a real method is at least 700)`);
    }
    if (t.officialSearch !== undefined && typeof t.officialSearch !== 'boolean') fail(`${where}: officialSearch must be boolean`);
    if (t.mode !== undefined && !['fast', 'deep'].includes(t.mode)) fail(`${where}: mode must be fast or deep`);
    const agent = fieldTemplateAgent(id, t);
    if (!isAgentDefinition(agent)) fail(`${where}: not a valid agent definition (limits: name ${AGENT_LIMITS.name}, description ${AGENT_LIMITS.description}, starter ${AGENT_LIMITS.starter})`);
  }
  for (const [category, count] of Object.entries(perCategory)) if (count < 3) fail(`${id}: category «${category}» has ${count} agents; at least 3`);
  if (agents.length < 24) fail(`${id}: ${agents.length} agents; at least 24`);
  if (agents.length > 40) fail(`${id}: ${agents.length} agents; at most 40 — fewer, better`);
  console.log(`${id}: ${agents.length} agents in ${field.categories.length} categories (${Object.entries(perCategory).map(([k, v]) => `${k.split('-').slice(1).join('-')} ${v}`).join(', ')})`);
}
console.log(failures ? `${failures} failure(s)` : 'all checks passed');
process.exit(failures ? 1 : 0);
