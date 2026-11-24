// «Watch an agent get built» (10 Nov 2026): the builder as a looping, scripted screen inside a tilted window. It
// follows the real flow — describe the work, the four build stages, the agent beside its test — with an example
// contract, and it is marked «Demo»: nothing here is a recording of a real answer. One playhead drives every frame,
// so the three step tabs can jump to any moment.
import React from 'react';
import { Check, FileText, Globe, Loader2, Paperclip, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { span, useEnter, usePlayhead } from './motion.tsx';

const DESCRIPTION = 'Reviews supplier contracts for the buyer, flags risky terms and writes counter-proposals.';
const STAGES = ['Reading what you need', 'Choosing the area, jurisdiction and sources', 'Writing the steps of the task', 'Setting the output and the rules'];
const STARTERS = ['Flag every clause that creates risk for us.', 'Which terms differ from our standard position?', 'Write counter-proposals for the liability cap.', 'Summarise the payment and termination terms.'];
const ANSWER: { text: string; mark?: number }[] = [
  { text: 'Three clauses need your attention.' },
  { text: ' The liability cap protects only the supplier.', mark: 1 },
  { text: ' Payment falls due in 15 days, half your standard 30.', mark: 2 },
  { text: ' The supplier may end the contract on 7 days’ notice.', mark: 3 },
];
const WORDS = ANSWER.flatMap((part, at) => part.text.split(/(?<= )/).map(word => ({ word, at })));
const T = { type: 600, typed: 3900, build: 4400, built: 8000, sheet: 8500, test: 11600, answer: 12300, answered: 15600, checked: 17200, end: 20500 };
const STEPS = [{ label: 'Describe the work', at: 0 }, { label: 'The agent is built', at: T.built }, { label: 'Test it, then save', at: T.test }];

export function BuilderDemo() {
  const { t, ref, seek } = usePlayhead(T.end, T.end - 1);
  const enter = useEnter();
  const typed = DESCRIPTION.slice(0, Math.round(span(t, T.type, T.typed) * DESCRIPTION.length));
  const scene = t < T.build ? 'describe' : t < T.built ? 'building' : 'agent';
  const stage = Math.min(STAGES.length, Math.floor((t - T.build) / ((T.built - T.build) / STAGES.length)));
  const starters = Math.round(span(t, T.sheet + 900, T.test - 300) * STARTERS.length);
  const words = Math.round(span(t, T.answer, T.answered) * WORDS.length);
  const checked = Math.round(span(t, T.answered + 200, T.checked) * 3);
  const step = t < T.built ? 0 : t < T.test ? 1 : 2;
  return <div className="lp-build" ref={ref}>
    <ol className="lp-build-steps" aria-label="How an agent is built">
      {STEPS.map((item, index) => <li key={item.label} className={index === step ? 'is-now' : index < step ? 'is-done' : ''}>
        <button type="button" onClick={() => seek(item.at)}><i aria-hidden="true">{index < step ? <Check size={13} /> : index + 1}</i><span>{item.label}</span></button></li>)}
    </ol>
    <div className="lp-stage" ref={enter.ref}>
      <div className="lp-win" role="img" aria-label="A demo of the builder: a description is typed, the agent is built in four stages, then tested on a contract with a proof mark on every sentence">
        <div className="lp-win-bar" aria-hidden="true"><span><i /><i /><i /></span><b>Agents · New agent</b><em>Demo</em></div>
        {scene !== 'agent' ? <div className="lp-win-home" aria-hidden="true">
          <small>Legal agents · Builder</small>
          <h4>Describe the agent you <em>need</em></h4>
          <div className={`lp-win-composer${scene === 'building' ? ' is-sent' : ''}`}>
            <p>{typed || <span className="lp-win-placeholder">Say in your own words which task you do again and again…</span>}{scene === 'describe' && t > T.type - 300 && t < T.typed + 300 && <i className="lp-caret" />}</p>
            <span><span><Paperclip size={13} />Examples</span><b className={t > T.typed + 150 && scene === 'describe' ? 'is-ready' : ''}><Wand2 size={14} /></b></span>
          </div>
          {scene === 'building' && <ol className="lp-win-stages">{STAGES.map((label, index) => <li key={label} className={index < stage ? 'is-done' : index === stage ? 'is-now' : ''}>
            <span>{index < stage ? <Check size={11} /> : index === stage ? <Loader2 size={11} className="lp-spin" /> : null}</span>{label}</li>)}</ol>}
        </div> : <div className="lp-win-agent" aria-hidden="true" style={{ opacity: span(t, T.built, T.built + 350) }}>
          <div className="lp-win-form">
            <label>Name</label><p className="lp-win-field"><b>Supplier contract review</b></p>
            <label>Area and research</label>
            <p className="lp-win-chips"><span className="is-area">Legal · Sales &amp; commercial</span><span><Globe size={11} />Official sources</span><span><ShieldCheck size={11} />Names hidden</span></p>
            <label>What it asks you for</label><p className="lp-win-field">The supplier’s contract, and which terms matter most to you.</p>
            <label>Conversation starters</label>
            <ul>{STARTERS.map((starter, index) => <li key={starter} className={index < starters ? 'is-in' : ''}><Sparkles size={11} />{starter}</li>)}</ul>
          </div>
          <div className="lp-win-test">
            <small>Test</small>
            {t >= T.test && <p className="lp-win-q">{STARTERS[0]}<span><FileText size={10} />Supply-agreement.pdf</span></p>}
            {t >= T.answer && <p className="lp-win-a">{WORDS.slice(0, words).map((item, index) => {
              const mark = ANSWER[item.at].mark; const last = WORDS[index + 1]?.at !== item.at;
              return <React.Fragment key={index}>{item.at === 0 ? <b>{item.word}</b> : item.word}{mark && last && <i className={mark <= checked ? 'is-checked' : ''}>{mark}</i>}</React.Fragment>; })}
              {words < WORDS.length && <i className="lp-caret" />}</p>}
            {t >= T.answered + 500 && <div className="lp-win-source" style={{ opacity: span(t, T.answered + 500, T.answered + 900), transform: `translateY(${(1 - span(t, T.answered + 500, T.answered + 900)) * 10}px)` }}>
              <small><FileText size={10} />Supply-agreement.pdf · clause 11.2</small>
              <q>The Supplier’s total liability shall not exceed <mark>the fees paid in the preceding three months</mark>.</q></div>}
            {checked >= 3 && <p className="lp-win-proof"><ShieldCheck size={12} />3 statements with proof · 3 checked</p>}
          </div>
        </div>}
      </div>
    </div>
  </div>;
}
