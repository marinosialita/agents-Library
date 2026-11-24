// The landing page's facts (10 Nov 2026): counts, fields and every agent's name, read from the real catalogue so no
// number on the page is typed by hand. Run by `npm run build` and checked by the tests (the committed file must match).
// Run: node --experimental-transform-types scripts/build-landing-index.mjs [--check]
import fs from 'node:fs';
import { FIELDS } from '../shared/fields.ts';
import { OFFICIAL_SOURCE_PLACES } from '../shared/official-sources.ts';
import { AGENT_TEMPLATES, templateAgent, fieldAgents } from '../src/data/templates/index.ts';
import { READY_CHAINS } from '../src/data/chains.ts';

export function landingIndex() {
  const agents = [...AGENT_TEMPLATES.map(template => templateAgent(template, true, 0, '')), ...fieldAgents(0, '')];
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const colors = [...new Set(FIELDS.flatMap(field => field.categories.map(category => category.color.toLowerCase())))];
  const colorOf = new Map(FIELDS.flatMap(field => field.categories.map(category => [category.id, colors.indexOf(category.color.toLowerCase())])));
  const fields = FIELDS.map(field => ({ id: field.id, name: field.name, blurb: field.blurb, count: agents.filter(agent => agent.field === field.id).length,
    areas: field.categories.map(category => ({ name: category.name, color: colors.indexOf(category.color.toLowerCase()), count: agents.filter(agent => agent.category === category.id).length })).filter(area => area.count) }))
    .filter(field => field.count);
  const fieldAt = new Map(fields.map((field, index) => [field.id, index]));
  return {
    counts: { agents: agents.length, fields: fields.length, areas: fields.reduce((sum, field) => sum + field.areas.length, 0), starters: agents.reduce((sum, agent) => sum + agent.starters.length, 0),
      chains: READY_CHAINS.length, places: OFFICIAL_SOURCE_PLACES.filter(place => place.sources.length).length, sources: OFFICIAL_SOURCE_PLACES.reduce((sum, place) => sum + place.sources.length, 0),
      research: agents.filter(agent => agent.officialSearch).length },
    colors, fields,
    // [name, field, colour, id] — one row per agent, in the catalogue's order.
    agents: agents.map(agent => [agent.name, fieldAt.get(agent.field), colorOf.get(agent.category) ?? 0, agent.id]),
    chains: READY_CHAINS.map(chain => ({ id: chain.id, name: chain.name, description: chain.description ?? '', steps: chain.steps.map(step => byId.get(step.agentId)?.name ?? '') })),
  };
}

if (process.argv[1]?.endsWith('build-landing-index.mjs')) {
  const file = new URL('../src/landing/library-index.json', import.meta.url);
  const next = JSON.stringify(landingIndex());
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (now !== next) { console.error('src/landing/library-index.json is stale: run node --experimental-transform-types scripts/build-landing-index.mjs'); process.exit(1); }
    console.log('landing index is current');
  } else { fs.writeFileSync(file, next); const { counts } = JSON.parse(next); console.log('landing index written:', JSON.stringify(counts)); }
}
