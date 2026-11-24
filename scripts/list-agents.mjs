// Lists every ready-made agent: id | field | area | research? | name — description. For writers of chains.
// Run: node --experimental-transform-types scripts/list-agents.mjs [field-id]
import { categoryOf } from '../shared/fields.ts';
import { AGENT_TEMPLATES, templateAgent, fieldAgents } from '../src/data/templates/index.ts';
const want = process.argv[2];
const agents = [...AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, '')), ...fieldAgents(0, '')];
for (const agent of agents) if (!want || agent.field === want)
  console.log(`${agent.id} | ${agent.field} | ${categoryOf(agent.category)?.category.name ?? agent.category} | ${agent.officialSearch ? 'research' : '-'} | ${agent.name} — ${agent.description}`);
