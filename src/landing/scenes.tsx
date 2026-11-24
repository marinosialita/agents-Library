// The landing page's smaller live scenes (10 Nov 2026): the task finder, a chain at work, proof on a sentence, names
// hidden, and the finished files. Each is a short scripted loop over real names from the library (agents, chains);
// the example answers and documents are written for the page and every scene says «Demo» or «Example».
import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, FileSpreadsheet, FileText, Loader2, Presentation, Search, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { LIBRARY } from './claims.ts';
import { span, still, Tilt, usePlayhead } from './motion.tsx';

const agentById = new Map(LIBRARY.agents.map(agent => [agent[3], agent]));
const ink = (color: number) => ({ ['--ink' as string]: LIBRARY.colors[color] }) as React.CSSProperties;

// ——— «Tell me the task»
const TASKS = [
  { task: 'Check a lease for the tenant’s risks', picks: [['ready-lease-report', 'Reports the lease point by point, from the tenant’s side.'], ['ready-realestate-lease-abstract', 'Pulls out the dates, the rent and every obligation.'], ['ready-realestate-occupier-communication', 'Writes the letter that raises the points.']] },
  { task: 'Write the month-end commentary for the board', picks: [['ready-finance-month-end-commentary', 'Explains every material variance and its driver.'], ['ready-communication-one-slide-summary', 'Turns the commentary into one slide.'], ['ready-business-quarterly-board-paper', 'Builds the full board paper around it.']] },
  { task: 'Answer an angry customer about a late delivery', picks: [['ready-support-angry-customer-reply', 'Calms the customer and fixes the problem.'], ['ready-communication-difficult-reply', 'Words a firm, polite answer.'], ['ready-support-complaint-response', 'Writes the formal complaint response.']] },
].map(item => ({ ...item, picks: item.picks.filter(([id]) => agentById.has(id)) }));
const TASK_MS = 6800;

export function FinderScene() {
  const { t, ref } = usePlayhead(TASKS.length * TASK_MS, TASK_MS - 1);
  const at = Math.floor(t / TASK_MS) % TASKS.length; const local = t - at * TASK_MS; const item = TASKS[at];
  const typed = item.task.slice(0, Math.round(span(local, 300, 2100) * item.task.length));
  const shown = Math.round(span(local, 2700, 3700) * item.picks.length);
  return <div className="lp-card lp-finder" ref={ref} role="img" aria-label={`A demo of the task finder: the task «${item.task}» is typed and three agents are suggested`}>
    <span className="lp-demo-tag" aria-hidden="true">Demo</span>
    <p className="lp-finder-box" aria-hidden="true"><Wand2 size={16} /><span>{typed}{local < 2400 && <i className="lp-caret" />}</span><b><Search size={13} />Find agents</b></p>
    <p className="lp-finder-head" aria-hidden="true">{local > 2200 && local < 2700 ? <><Loader2 size={12} className="lp-spin" />Reading {LIBRARY.counts.agents.toLocaleString('en-GB')} agents…</> : local >= 2700 ? <b>Best agents for this task</b> : <>&nbsp;</>}</p>
    <ul aria-hidden="true">{item.picks.map(([id, why], index) => { const agent = agentById.get(id)!; return <li key={id} className={index < shown ? 'is-in' : ''}>
      <span className="lp-chip" style={ink(agent[2])}>{LIBRARY.fields[agent[1]].name}</span><b>{agent[0]}</b><small>{why}</small><ArrowRight size={14} /></li>; })}</ul>
  </div>;
}

// ——— a chain at work
const CHAIN_MS = 6400;
export function ChainScene() {
  const chains = LIBRARY.chains.filter(chain => chain.steps.length === 3 && chain.steps.every(Boolean)).slice(0, 6);
  const list = chains.length ? chains : LIBRARY.chains.slice(0, 1);
  const { t, ref } = usePlayhead(list.length * CHAIN_MS, CHAIN_MS - 1);
  const at = Math.floor(t / CHAIN_MS) % list.length; const local = t - at * CHAIN_MS; const chain = list[at];
  const per = 1500; const working = Math.min(chain.steps.length, Math.floor(local / per)); const done = local >= per * chain.steps.length;
  return <div className="lp-card lp-chain" ref={ref} role="img" aria-label={`A demo of a chain: ${chain.name}. ${chain.steps.join(', then ')}.`}>
    <span className="lp-demo-tag" aria-hidden="true">Demo</span>
    <p className="lp-chain-name" aria-hidden="true"><b>{chain.name}</b><small>{chain.description}</small></p>
    <ol aria-hidden="true" style={{ ['--flow' as string]: Math.min(1, local / (per * chain.steps.length)) }}>
      {chain.steps.map((name, index) => <li key={index} className={index < working || done ? 'is-done' : index === working ? 'is-now' : ''}>
        <i>{index < working || done ? <Check size={14} /> : index === working ? <Loader2 size={14} className="lp-spin" /> : index + 1}</i>
        <span><small>Step {index + 1}</small><b>{name}</b><em>{index < working || done ? 'Done · handed to the next step' : index === working ? 'Working…' : 'Waiting for the step before'}</em></span></li>)}
    </ol>
    <p className={`lp-chain-done${done ? ' is-in' : ''}`} aria-hidden="true"><Sparkles size={13} />One task, {chain.steps.length} agents, every result with its files</p>
  </div>;
}

// ——— proof on every sentence
const PROOFS = [
  { sentence: 'The lease runs for ten years from 1 May 2024.', before: 'The Landlord lets the Premises to the Tenant ', quote: 'for a term of ten years commencing on 1 May 2024', after: ' (the “Term”).', where: 'clause 2.1' },
  { sentence: 'Rent is reviewed every five years and can only go up.', before: 'On each fifth anniversary of the Term ', quote: 'the Rent shall be reviewed and shall not be reduced', after: ' below the Rent then payable.', where: 'clause 6.3' },
  { sentence: 'To use the break option you must give six months’ notice.', before: 'The Tenant may end this Lease on the fifth anniversary by giving ', quote: 'not less than six months’ prior written notice', after: ' to the Landlord.', where: 'clause 14.1' },
];
export function ProofScene() {
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => { if (held || still()) return; const timer = window.setInterval(() => setActive(value => (value + 1) % PROOFS.length), 2800); return () => window.clearInterval(timer); }, [held]);
  const proof = PROOFS[active];
  return <div className="lp-proof" onPointerLeave={() => setHeld(false)}>
    <div className="lp-card lp-proof-answer">
      <span className="lp-demo-tag">Example</span>
      <small>The agent’s answer</small>
      <p>{PROOFS.map((item, index) => <React.Fragment key={index}><span className={index === active ? 'is-active' : ''}>{item.sentence}</span>
        <button type="button" className={index === active ? 'is-active' : ''} aria-label={`Proof ${index + 1}: ${item.quote}`} aria-pressed={index === active}
          onPointerEnter={() => { setActive(index); setHeld(true); }} onFocus={() => { setActive(index); setHeld(true); }} onClick={() => { setActive(index); setHeld(true); }}>{index + 1}</button>{' '}</React.Fragment>)}
        <span className="lp-proof-advice">You should ask for a cap on the service charge.</span></p>
      <p className="lp-proof-bar"><ShieldCheck size={13} /><b>3</b> statements with proof · <em>3 checked</em> · 1 is the agent’s own advice</p>
    </div>
    <div className="lp-card lp-proof-source" aria-live="polite">
      <small><FileText size={12} />Lease.pdf · {proof.where}</small>
      <p key={active}>{proof.before}<mark>{proof.quote}</mark>{proof.after}</p>
      <span>The source opens at the exact words.</span>
    </div>
  </div>;
}

// ——— names hidden
const LINE: (string | [real: string, placeholder: string])[] = ['This Agreement is made between ', ['John Smith', 'PERSON 1'], ', of ', ['12 Main Street', 'ADDRESS 1'], ', and ', ['Alpha Trading Ltd', 'COMPANY 1'],
  '. Notices go to ', ['john@alpha-trading.com', 'EMAIL 1'], ' or ', ['+357 99 123456', 'PHONE 1'], '.'];
export function PrivacyScene() {
  const { t, ref } = usePlayhead(7600, 7599);
  const tokens = LINE.filter(part => typeof part !== 'string').length;
  const hidden = Math.round(span(t, 900, 3600) * tokens);
  let seen = 0;
  return <div className="lp-privacy" ref={ref} role="img" aria-label="An example: a sentence with a name, an address, a company, an e-mail address and a phone number; the AI receives the same sentence with placeholders instead">
    <div className="lp-card" aria-hidden="true"><small>Your document</small>
      <p>{LINE.map((part, index) => typeof part === 'string' ? <React.Fragment key={index}>{part}</React.Fragment> : <b key={index}>{part[0]}</b>)}</p></div>
    <div className="lp-privacy-gate" aria-hidden="true"><ShieldCheck size={18} /><span>Hidden in your browser</span></div>
    <div className="lp-card is-ai" aria-hidden="true"><small>What the AI receives</small>
      <p>{LINE.map((part, index) => { if (typeof part === 'string') return <React.Fragment key={index}>{part}</React.Fragment>; const done = seen++ < hidden; return <code key={index} className={done ? 'is-in' : ''}>{done ? `[${part[1]}]` : part[0]}</code>; })}</p></div>
  </div>;
}

// ——— finished files
export function FilesScene() {
  const files = [
    { Icon: FileText, name: 'Word', note: 'Letterhead, headings, tables, sources', kind: 'doc' },
    { Icon: FileSpreadsheet, name: 'Excel', note: 'Every table as a sheet, numbers as numbers', kind: 'sheet' },
    { Icon: Presentation, name: 'PowerPoint', note: 'A deck with your logo on every slide', kind: 'deck' },
  ];
  return <div className="lp-files">{files.map(({ Icon, name, note, kind }) => <Tilt key={name} className={`lp-file is-${kind}`} max={10}>
    <div className="lp-file-page" aria-hidden="true"><i /><span /><span /><span className="is-short" />{kind === 'sheet' ? <div className="lp-file-grid">{Array.from({ length: 12 }, (_, index) => <b key={index} />)}</div> : kind === 'deck' ? <div className="lp-file-slide" /> : <><span /><span className="is-short" /></>}</div>
    <p><Icon size={15} aria-hidden="true" /><b>{name}</b><small>{note}</small></p>
  </Tilt>)}</div>;
}
