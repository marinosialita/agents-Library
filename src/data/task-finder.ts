// «Tell me the task» (7 Nov 2026, his request): the user writes the job in their own words and the agents that do it
// come back from every field. Here, in the browser and at once, by the words of each agent: its name, what it does,
// what it asks for, its starters, its area and its field (BM25 over a light stem, so «leases» finds «lease»). The
// server's AI then reads the whole catalogue and picks the best, each with a reason (server/agent-route.ts); without
// AI the matches by wording stand.
import type { AgentDefinition } from '../../shared/agents.ts';
import { categoryOf, fieldById } from '../../shared/fields.ts';
import { AGENT_STARTERS, AGENT_TEMPLATES } from './templates/index.ts';

const STOP = new Set(`a an the and or of to in on for with by from at as is are be been was were it its this that these
those i me my we our us you your he she they them their his her what which who how can could would should will shall
may might must do does did done need needs want wants like please help me get make made some any all every each about
into onto over under than then so if not no yes also just only very more most one two my our an new use using
και ή το τα ο η οι του της των τον την για με σε στο στη στην από να θα που πως τι ένα μια μου μας σας`.split(/\s+/));

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
/** A light stem: plurals, -ing, -ed and a final e in English; the common endings in Greek. Enough for «leases»,
 *  «leasing» and «lease» to meet. */
export function stem(word: string): string {
  let w = word;
  if (/^[a-z]+$/.test(w)) {
    if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.endsWith('sses')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) w = w.slice(0, -1);
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
    if (/([bdfgmnprt])\1$/.test(w)) w = w.slice(0, -1);
  } else if (/^\p{Script=Greek}+$/u.test(w) && w.length > 4) w = w.replace(/(ουσ|ων|ος|ου|ης|ες|ας|εις|ια|α|η|ο|ι|ε)$/u, '');
  return w;
}
export function terms(text: string): string[] {
  return (fold(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 1 && !STOP.has(word)).map(stem);
}

type Doc = { agent: AgentDefinition; tf: Map<string, number>; length: number };
type Index = { docs: Doc[]; df: Map<string, number>; average: number };
const indexes = new WeakMap<AgentDefinition[], Index>();
// A ready Legal agent is also found by its Greek name, description and starters.
const greek = new Map(AGENT_TEMPLATES.map(template => [`ready-${template.id}`, [template.name.el, template.description.el, ...(AGENT_STARTERS[template.id] ?? template.starters).el].join(' ')]));

function build(agents: AgentDefinition[]): Index {
  const kept = indexes.get(agents); if (kept) return kept;
  const df = new Map<string, number>(); let total = 0;
  const docs = agents.map(agent => {
    const tf = new Map<string, number>();
    const add = (text: string, weight: number) => { for (const term of terms(text)) tf.set(term, (tf.get(term) ?? 0) + weight); };
    const area = categoryOf(agent.category)?.category.name ?? '';
    add(agent.name, 4); add(agent.description, 2); add(area, 2); add(fieldById(agent.field)?.name ?? '', 1.5);
    add(agent.needs, 0.5); add(agent.starters.join(' '), 0.6); add(greek.get(agent.id) ?? '', 1);
    let length = 0; for (const [term, count] of tf) { length += count; df.set(term, (df.get(term) ?? 0) + 1); }
    total += length;
    return { agent, tf, length };
  });
  const index = { docs, df, average: total / Math.max(1, docs.length) };
  indexes.set(agents, index); return index;
}

/** The agents whose words best match the task, best first; nothing when no word of the task is in any agent. */
export function rankAgents(task: string, agents: AgentDefinition[], limit = 6): { agent: AgentDefinition; score: number }[] {
  const query = [...new Set(terms(task))]; if (!query.length) return [];
  const { docs, df, average } = build(agents);
  const k1 = 1.2, b = 0.55, n = docs.length;
  const scored = docs.map(doc => {
    let score = 0; let hits = 0;
    for (const term of query) {
      const tf = doc.tf.get(term); if (!tf) continue;
      hits++;
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / average));
    }
    // An agent that meets more of the task's words ranks above one that meets a single rare word many times.
    return { agent: doc.agent, score: score * (0.5 + hits / query.length) };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  return scored.filter(item => item.score >= top * 0.2).slice(0, limit);
}
