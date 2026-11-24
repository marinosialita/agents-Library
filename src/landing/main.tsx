// The landing page (10 Nov 2026, his request before the launch): what the product is and how an agent is built,
// with a 3D globe of every real agent in the hero and live, scripted screens of the builder, the task finder, a
// chain, proof and hidden names. A separate entry (welcome.html) with its own small bundle: it reads the library's
// facts from library-index.json and never loads the app's catalogue. Every claim comes from claims.ts.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowRight, BookOpenCheck, CalendarClock, FileCheck2, FileSpreadsheet, Globe, ListChecks, Lock, Palette, Plug, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { PRODUCT_NAME } from '../../shared/product.ts';
import '../styles/tokens.css';
import './landing.css';
import { BuilderDemo } from './builder-demo.tsx';
import { CLAIMS, fmt, LIBRARY, N, plus } from './claims.ts';
import { Galaxy } from './galaxy.tsx';
import { CountUp, Reveal, Tilt } from './motion.tsx';
import { ChainScene, FilesScene, FinderScene, PrivacyScene, ProofScene } from './scenes.tsx';

/** The app, opened from the page: the visitor has now seen the welcome, so «/» shows the library from here on. */
const seen = () => { try { localStorage.setItem('ap-seen-v1', '1'); } catch { /* storage blocked: the link still works */ } };
const APP = '/?open';
const ink = (color: number) => ({ ['--ink' as string]: LIBRARY.colors[color] }) as React.CSSProperties;

function Mark() {
  return <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
    <defs><linearGradient id="lp-mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#A58CFA" /><stop offset=".6" stopColor="#7352E8" /><stop offset="1" stopColor="#5B3DD1" /></linearGradient></defs>
    <rect width="32" height="32" rx="9" fill="url(#lp-mark)" /><path d="M10 23.5 16 9l6 14.5M12.6 18.6h6.8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Two rows of real agent names drifting in opposite directions. */
function Marquee() {
  const row = (offset: number) => Array.from({ length: 26 }, (_, index) => LIBRARY.agents[(offset + index * 37) % LIBRARY.agents.length]);
  return <div className="lp-marquee" aria-hidden="true">{[3, 19].map((offset, at) => <div key={offset} className={at ? 'is-back' : ''}>
    {[0, 1].map(copy => <span key={copy}>{row(offset).map(agent => <i key={`${copy}-${agent[3]}`} style={ink(agent[2])}>{agent[0]}</i>)}</span>)}</div>)}</div>;
}

function Page() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const onScroll = () => setScrolled(window.scrollY > 24); onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); return () => window.removeEventListener('scroll', onScroll); }, []);
  const features = [
    { Icon: ListChecks, title: 'A real working method', text: 'Each agent is one recurring task, done in the order a senior practitioner does it: role, steps, output, rules. Nine ready questions get you started.' },
    { Icon: Globe, title: 'Official sources first', text: `When an agent researches, it reads the official websites of the place you choose (${fmt(N.sources)} sources across ${N.places} jurisdictions) and only the other sites set on the agent, such as a newspaper. Never the open web.` },
    { Icon: BookOpenCheck, title: 'Proof on every sentence', text: 'Each sentence taken from a source carries a mark with the exact words quoted. One click opens the source at that passage.' },
    { Icon: Lock, title: 'Names hidden from the AI', text: 'In your questions and documents, names, companies, e-mails, phone and ID numbers become placeholders in your browser before anything is sent. The answer shows them again.' },
    { Icon: Palette, title: 'Your house style, everywhere', text: 'Set your tone, standing positions, templates and letterhead once. Every agent in every field follows them.' },
    { Icon: FileCheck2, title: 'Finished files', text: 'Answers leave as Word, Excel and PowerPoint with your letterhead, and as Word with tracked changes when an agent edits your document.' },
    // 13 Nov 2026: what was built overnight, in words that stay true (sending always needs a channel you set up).
    { Icon: CalendarClock, title: 'Works on its own', text: 'A routine runs an agent at the time you choose, each time a site you follow publishes something, or when another app calls it. It can wait for your OK before anything is sent.' },
    { Icon: FileSpreadsheet, title: 'Every row of a sheet', text: 'Give an agent an Excel file, a CSV or a shared Google Sheet and it works through each row, up to 200, then hands back the sheet with a result column.' },
    { Icon: Plug, title: 'Inside your apps', text: 'Agents read the apps you connect, such as Gmail, Outlook, Calendar, Slack and Drive. A reply, an event or a post goes out only when you press it.' },
  ];
  const faq = [
    ['What is an agent?', 'One recurring task, done the way a senior practitioner does it. It tells you what to give it, offers nine ready questions and returns a finished piece of work: a report, a letter, a table, a plan.'],
    ['Can I build my own?', 'Yes. Describe the work in your own words. The builder writes the role, the steps, the output and the rules, asks at most two questions, and opens your agent beside a test. You can also customise any ready-made agent.'],
    ['Where do the answers come from?', `From your documents and the agent’s method. When an agent researches, it reads the official websites of the place you choose (${fmt(N.sources)} catalogued sources across ${N.places} jurisdictions) and only the other sites set on the agent, such as a newspaper. It never searches the open web.`],
    ['How do I check an answer?', 'Every sentence taken from a source carries a numbered mark with the exact words quoted. The app checks each quote against the source and opens the source at that passage. In a research answer, statements without a source are counted and listed; in a drafted letter or contract, the points of law without one.'],
    ['What happens to my documents?', 'They are read in your browser. Names, companies, e-mail addresses, phone and ID numbers and addresses are replaced with placeholders before anything is sent to the AI, and the answer shows the real names again. Your conversations stay in your browser.'],
    ['What is a chain agent?', `Several agents working one after another on the same task: each reads your task, your documents and the result of the step before. There are ${N.chains} ready-made chains, and you can build your own.`],
    ['Does an agent replace a professional?', 'No. An agent prepares the work: it reads, drafts, checks and cites. Decisions that need a lawyer, a doctor, an accountant or a safety officer stay with them, and the agents say so.'],
  ];
  return <>
    <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}>
      <a className="lp-brand" href="#top" aria-label={PRODUCT_NAME}><Mark /><b>{PRODUCT_NAME}</b></a>
      <nav aria-label="Sections"><a href="#library">Library</a><a href="#build">Build</a><a href="#chains">Chains</a><a href="#proof">Proof</a><a href="#privacy">Privacy</a><a href="#faq">Questions</a></nav>
      <a className="lp-btn is-small" href={APP} onClick={seen}>Open the library<ArrowRight size={14} aria-hidden="true" /></a>
    </header>

    <main id="top">
      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="lp-hero-copy">
          <p className="lp-eyebrow"><i aria-hidden="true" />{CLAIMS.mission}</p>
          <h1><span>{CLAIMS.title[0]}</span> <em>{CLAIMS.title[1]}</em></h1>
          <p className="lp-lead">{CLAIMS.lead}</p>
          <p className="lp-cta"><a className="lp-btn" href={APP} onClick={seen}>Open the library<ArrowRight size={16} aria-hidden="true" /></a>
            <a className="lp-btn is-ghost" href="#build">Watch an agent get built<ArrowDown size={15} aria-hidden="true" /></a></p>
        </div>
        <div className="lp-hero-globe">
          <Galaxy onOpen={id => { seen(); location.href = `/agents/${encodeURIComponent(id)}`; }} />
          <p className="lp-globe-hint" aria-hidden="true"><Sparkles size={12} />Every dot is a real agent.<span> Drag the globe, hover a dot, click to open it.</span></p>
        </div>
        <ul className="lp-stats" aria-label="The library in numbers">{CLAIMS.stats.map(stat => <li key={stat.label}><b><CountUp value={stat.value} format={fmt} /></b><span>{stat.label}</span></li>)}</ul>
      </section>

      <section className="lp-section" id="library">
        <Reveal className="lp-head"><p className="lp-kicker">The library</p>
          <h2>One library for <em>every profession</em></h2>
          <p>{fmt(N.agents)} agents in {N.fields} fields and {N.areas} areas, each with nine questions ready to ask. Pick a field, or simply say what you need.</p></Reveal>
        <Marquee />
        <ul className="lp-fields">{LIBRARY.fields.map((field, index) => <Reveal as="li" key={field.id} delay={(index % 4) * 50}>
          <Tilt className="lp-field"><a href={`/?field=${field.id}`} onClick={seen}>
            <span className="lp-field-top"><b>{field.name}</b><em>{field.count}</em></span>
            <small>{field.blurb}</small>
            <span className="lp-field-areas">{field.areas.slice(0, 3).map(area => <i key={area.name} style={ink(area.color)}>{area.name}</i>)}{field.areas.length > 3 && <i className="is-more">+{field.areas.length - 3}</i>}</span>
          </a></Tilt></Reveal>)}</ul>
      </section>

      <section className="lp-section is-split" id="find">
        <Reveal className="lp-head"><p className="lp-kicker">Tell it the task</p>
          <h2>Say what you need. <em>It finds the agent.</em></h2>
          <p>No browsing {plus(N.agents, 1000)} cards. Write the job in your own words and the library answers with the agents that do it, from every field, each with a reason.</p>
          <a className="lp-link" href={APP} onClick={seen}>Try it in the library<ArrowRight size={14} aria-hidden="true" /></a></Reveal>
        <Reveal delay={120}><FinderScene /></Reveal>
      </section>

      <section className="lp-section is-dark" id="build">
        <Reveal className="lp-head is-centre"><p className="lp-kicker">Build your own</p>
          <h2>From a sentence to a working agent <em>in a minute</em></h2>
          <p>Describe the work you repeat. {PRODUCT_NAME} writes the role, the steps, the output and the rules, asks at most two questions, and opens your agent beside a test.</p></Reveal>
        <BuilderDemo />
        <p className="lp-centre"><a className="lp-btn" href="/new" onClick={seen}>Build your first agent<ArrowRight size={16} aria-hidden="true" /></a></p>
      </section>

      <section className="lp-section is-split is-flip" id="chains">
        <Reveal className="lp-head"><p className="lp-kicker"><Workflow size={13} aria-hidden="true" />Chain agents</p>
          <h2>One task. <em>A whole team of agents.</em></h2>
          <p>A chain runs agents one after another: each reads your task, your documents and the result of the step before. {N.chains} chains are ready-made, from a lease review that ends as a letter in Greek to month-end accounts that end as one board slide. Copy one, or build your own.</p>
          <a className="lp-link" href="/chains" onClick={seen}>See the {N.chains} chains<ArrowRight size={14} aria-hidden="true" /></a></Reveal>
        <Reveal delay={120}><ChainScene /></Reveal>
      </section>

      <section className="lp-section" id="proof">
        <Reveal className="lp-head is-centre"><p className="lp-kicker"><ShieldCheck size={13} aria-hidden="true" />Proof</p>
          <h2>Every sentence <em>shows its source</em></h2>
          <p>Other tools say they cite. Here each sentence taken from a document or an official page carries a mark, the exact words are checked against the source, and one click opens it at that passage.</p></Reveal>
        <Reveal><ProofScene /></Reveal>
      </section>

      <section className="lp-section is-tint" id="privacy">
        <Reveal className="lp-head is-centre"><p className="lp-kicker"><Lock size={13} aria-hidden="true" />Privacy</p>
          <h2>Names hidden <em>before anything is sent</em></h2>
          <p>Before a question or a document leaves your browser, names, companies, e-mail addresses, phone and ID numbers and addresses become placeholders. The answer comes back with the real names in place.</p></Reveal>
        <Reveal><PrivacyScene /></Reveal>
        <ul className="lp-promises">
          {['Your documents are read on your device', 'Your conversations stay in your browser', 'Your data is not used to train AI', 'Research reads official sites and the sites set on the agent'].map(text => <li key={text}><ShieldCheck size={15} aria-hidden="true" />{text}</li>)}
        </ul>
      </section>

      <section className="lp-section" id="features">
        <Reveal className="lp-head is-centre"><p className="lp-kicker">In every agent</p>
          <h2>Built for work you <em>put your name on</em></h2></Reveal>
        <ul className="lp-features">{features.map(({ Icon, title, text }, index) => <Reveal as="li" key={title} delay={(index % 3) * 70}><Tilt className="lp-feature" max={5}><span aria-hidden="true"><Icon size={18} /></span><b>{title}</b><p>{text}</p></Tilt></Reveal>)}</ul>
        <Reveal className="lp-files-wrap"><div><p className="lp-kicker">Finished files</p><h3>The answer leaves as a file you can send</h3>
          <p>Word, Excel and PowerPoint, with your letterhead and colours. When an agent edits a document you attached, you get Word with tracked changes and a comment on every change.</p></div><FilesScene /></Reveal>
      </section>

      <section className="lp-section is-narrow" id="faq">
        <Reveal className="lp-head is-centre"><p className="lp-kicker">Questions</p><h2>Before you start</h2></Reveal>
        <div className="lp-faq">{faq.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="lp-close">
        <div className="lp-hero-glow" aria-hidden="true" />
        <h2>{CLAIMS.close}</h2>
        <p>{fmt(N.agents)} agents, {N.chains} chains and a builder for everything else.</p>
        <a className="lp-btn is-large" href={APP} onClick={seen}>Open the library<ArrowRight size={18} aria-hidden="true" /></a>
      </section>
    </main>

    <footer className="lp-foot">
      <span className="lp-brand"><Mark /><b>{PRODUCT_NAME}</b></span>
      <small>Every number on this page is counted from the live library. Agents prepare work for a professional to check.</small>
      <small>© {new Date().getFullYear()} {PRODUCT_NAME}</small>
    </footer>
  </>;
}

// One root, kept across a hot reload in development.
const container = document.getElementById('root') as HTMLElement & { landingRoot?: ReturnType<typeof createRoot> };
(container.landingRoot ??= createRoot(container)).render(<React.StrictMode><Page /></React.StrictMode>);
