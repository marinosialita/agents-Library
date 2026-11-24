// Every field's ready agents but Legal's (base.ts, elite.ts): one catalogue per field, written to docs/field-agents-spec.md.
import type { AgentDefinition } from '../../../../shared/agents.ts';
import { CATALOGUE as business } from './business.ts';
import { CATALOGUE as communication } from './communication.ts';
import { CATALOGUE as compliance } from './compliance.ts';
import { CATALOGUE as creative } from './creative.ts';
import { CATALOGUE as data } from './data.ts';
import { CATALOGUE as education } from './education.ts';
import { CATALOGUE as everyday } from './everyday.ts';
import { CATALOGUE as finance } from './finance.ts';
import { CATALOGUE as healthcare } from './healthcare.ts';
import { CATALOGUE as hospitality } from './hospitality.ts';
import { CATALOGUE as hr } from './hr.ts';
import { CATALOGUE as insurance } from './insurance.ts';
import { fieldTemplateAgent, type FieldCatalogue } from './kit.ts';
import { CATALOGUE as languages } from './languages.ts';
import { CATALOGUE as marketing } from './marketing.ts';
import { CATALOGUE as operations } from './operations.ts';
import { CATALOGUE as product } from './product.ts';
import { CATALOGUE as publicSector } from './public.ts';
import { CATALOGUE as realestate } from './realestate.ts';
import { CATALOGUE as research } from './research.ts';
import { CATALOGUE as shipping } from './shipping.ts';
import { CATALOGUE as support } from './support.ts';
// The seven launch fields (10 Nov 2026).
import { CATALOGUE as it } from './it.ts';
import { CATALOGUE as finserv } from './finserv.ts';
import { CATALOGUE as retail } from './retail.ts';
import { CATALOGUE as manufacturing } from './manufacturing.ts';
import { CATALOGUE as sustainability } from './sustainability.ts';
import { CATALOGUE as startups } from './startups.ts';
import { CATALOGUE as projects } from './projects.ts';

export const FIELD_CATALOGUES: readonly FieldCatalogue[] = [finance, hr, marketing, operations, product, healthcare, education, languages, creative, communication,
  compliance, business, data, support, realestate, research, publicSector, hospitality, shipping, insurance,
  it, finserv, retail, manufacturing, sustainability, startups, projects, everyday];

/** The ready agents of every field but Legal, following the workspace's jurisdiction (fallback) when they research. */
export function fieldAgents(now = 0, fallback = ''): AgentDefinition[] {
  return FIELD_CATALOGUES.flatMap(catalogue => catalogue.agents.map(template => fieldTemplateAgent(catalogue.field, template, now, fallback)));
}
