// «House style» (7 Nov 2026, his request): the user's tone, standing positions, the rules every agent has learned,
// templates and the letterhead. Every agent of every field follows it; the letterhead brands the Word, Excel and
// PowerPoint files. Saved as it is typed, in this browser.
import React, { useRef, useState } from 'react';
import { Check, FileText, FileUp, ImagePlus, ListChecks, MessageSquareText, Palette, Plus, Stamp, Trash2, X } from 'lucide-react';
import { AGENT_LIMITS } from '../../shared/agents.ts';
import { readHouse, saveHouse, useStoreVersion, type HouseStyle } from '../data/store.ts';
import { readFiles, ToolBar } from './nomos-chrome.tsx';

/** A logo scaled to at most 600 × 240 px (PNG keeps its transparency), small enough for the browser's storage. */
async function readLogo(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / bitmap.width, 240 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const png = /png$/i.test(file.type) || /\.png$/i.test(file.name);
  let dataUrl = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9);
  if (dataUrl.length > 380_000) dataUrl = canvas.toDataURL('image/jpeg', 0.75);
  if (dataUrl.length > 380_000) throw new Error('logo_too_large');
  return { dataUrl, width: canvas.width, height: canvas.height };
}

/** Accent colours offered at a click; any other through the colour picker. */
const ACCENTS = ['#7352E8', '#1F2A44', '#0F5132', '#8A1C1C', '#9A7B2F', '#1C1C1E'];

function Section({ icon: Icon, title, lead, aside, children }: { icon: typeof Palette; title: string; lead: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return <section className="mn-hs-card">
    <header className="mn-hs-card-head"><span className="mn-hs-card-icon"><Icon size={17} aria-hidden="true" /></span>
      <span className="mn-hs-card-title"><h2>{title}</h2><p>{lead}</p></span>{aside}</header>
    {children}
  </section>;
}

const count = (n: number, max: number) => <span className="mn-hs-count">{n.toLocaleString('en-GB')} / {max.toLocaleString('en-GB')}</span>;

export function HouseStylePage() {
  useStoreVersion();
  const [house, setHouse] = useState<HouseStyle>(readHouse);
  const [error, setError] = useState('');
  const [rule, setRule] = useState('');
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const logo = useRef<HTMLInputElement>(null);
  const save = (next: HouseStyle) => { setHouse(next); setError(saveHouse(next) ? '' : 'Not saved: the browser storage is full. Remove a template or an old conversation.'); };
  const head = house.letterhead;
  const setHead = (patch: Partial<HouseStyle['letterhead']>) => save({ ...house, letterhead: { ...head, ...patch } });
  const addRule = () => { const text = rule.trim(); if (!text) return; save({ ...house, rules: [...house.rules.filter(item => item !== text), text].slice(-AGENT_LIMITS.houseRules) }); setRule(''); };
  const used = house.files.reduce((sum, file) => sum + file.text.length, 0);
  const full = reading || house.files.length >= AGENT_LIMITS.houseFiles || used >= AGENT_LIMITS.houseFileChars;
  const attach = async (picked: File[]) => {
    if (!picked.length) return; setReading(true);
    try {
      const read = await readFiles(picked);
      let left = AGENT_LIMITS.houseFileChars - used; const added: { name: string; text: string }[] = [];
      for (const doc of read) { if (left <= 0 || house.files.length + added.length >= AGENT_LIMITS.houseFiles) break; const text = doc.text.slice(0, left); left -= text.length; added.push({ name: doc.name, text }); }
      save({ ...house, files: [...house.files, ...added] });
      if (added.length < picked.length) setError(read.length < picked.length ? 'Some files could not be read (PDF, Word, Excel or text).' : `At most ${AGENT_LIMITS.houseFiles} templates and ${AGENT_LIMITS.houseFileChars.toLocaleString('en-GB')} characters in all.`);
    } finally { setReading(false); }
  };
  const pickLogo = (file: File) => readLogo(file).then(read => setHead({ logo: read.dataUrl, logoWidth: read.width, logoHeight: read.height }), () => setError('The logo could not be read, or it is too large. Use a PNG or JPEG under 1 MB.'));
  const custom = !ACCENTS.some(colour => colour.toLowerCase() === head.color.toLowerCase());
  const filled = [house.tone.trim(), house.positions.trim(), house.rules.length, house.files.length, head.name.trim() || head.logo].filter(Boolean).length;

  return <div className="nomos-tool-scroll mn-hs">
    <ToolBar icon={Palette} title="House style" />
    <div className="mn-hs-page">
      <header className="mn-hs-hero">
        <h1>House style</h1>
        <p>Your voice, your positions and your letterhead. Every agent in every field writes this way, and every Word, Excel and PowerPoint file carries your name. Saved as you type, in this browser.</p>
        <span className="mn-hs-pills">
          <span className="mn-hs-pill" data-on={house.on}><span className="mn-conn-dot" data-on={house.on} />{house.on ? 'On for every agent' : 'Off: agents use their own voice'}</span>
          <span className="mn-hs-pill">{filled} of 5 parts set</span>
        </span>
      </header>
      {error && <p className="mn-conn-banner is-warn" role="alert">{error}</p>}

      <div className="mn-hs-layout">
        <div className="mn-hs-main">
          <Section icon={MessageSquareText} title="Voice" lead="How every answer reads, and what you always stand for."
            aside={<button type="button" role="switch" aria-checked={house.on} className="mn-hs-switch" onClick={() => save({ ...house, on: !house.on })}>
              <span className="mn-hs-switch-track"><span /></span><span>{house.on ? 'On' : 'Off'}</span></button>}>
            <label className="mn-hs-field"><span className="mn-hs-label">Tone and form {count(house.tone.length, AGENT_LIMITS.houseTone)}</span>
              <textarea rows={3} value={house.tone} maxLength={AGENT_LIMITS.houseTone} onChange={event => save({ ...house, tone: event.target.value })}
                placeholder="e.g. Plain British English, short sentences. Lead with the answer. Address the client as «you». Amounts as €1,000.00." /></label>
            <label className="mn-hs-field"><span className="mn-hs-label">Standing positions {count(house.positions.length, AGENT_LIMITS.housePositions)}</span>
              <textarea rows={5} value={house.positions} maxLength={AGENT_LIMITS.housePositions} onChange={event => save({ ...house, positions: event.target.value })}
                placeholder="e.g. We act for buyers. Liability is always capped. Payment within 30 days of invoice. Disputes go to arbitration in our home city." />
              <small className="mn-hs-hint">Applied in every conversation unless you say otherwise there.</small></label>
            {!house.on && <p className="mn-hs-hint is-off">Off: each agent answers in its own default voice. Your letterhead still brands the files.</p>}
          </Section>

          <Section icon={ListChecks} title="Rules every agent has learned" lead="Press «Teach it» under an answer and keep a lesson for «Every agent», or add a rule here."
            aside={count(house.rules.length, AGENT_LIMITS.houseRules)}>
            {house.rules.length ? <ol className="mn-hs-rules">{house.rules.map(item => <li key={item}><span>{item}</span>
              <button type="button" onClick={() => save({ ...house, rules: house.rules.filter(other => other !== item) })} aria-label={`Forget: ${item}`} title="Forget"><X size={14} aria-hidden="true" /></button></li>)}</ol>
              : <p className="mn-hs-empty">No rules yet.</p>}
            <span className="mn-hs-add"><input value={rule} onChange={event => setRule(event.target.value)} maxLength={AGENT_LIMITS.houseRule} placeholder="e.g. Never use the word «hereinafter»"
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addRule(); } }} aria-label="A new rule" />
              <button type="button" className="nomos-btn is-primary" onClick={addRule} disabled={!rule.trim() || house.rules.length >= AGENT_LIMITS.houseRules}><Plus size={14} aria-hidden="true" /><span>Add rule</span></button></span>
          </Section>

          <Section icon={FileText} title="Templates and examples" lead="Your letter template, a model report, a clause bank. Agents follow their form and wording when they write that kind of document."
            aside={count(house.files.length, AGENT_LIMITS.houseFiles)}>
            {house.files.length > 0 && <ul className="mn-hs-files">{house.files.map((file, index) => <li key={`${file.name}-${index}`}>
              <span className="mn-hs-file-icon"><FileText size={15} aria-hidden="true" /></span>
              <span className="mn-hs-file-name"><b>{file.name}</b><small>{file.text.length.toLocaleString('en-GB')} characters</small></span>
              <button type="button" onClick={() => save({ ...house, files: house.files.filter((_, at) => at !== index) })} aria-label={`Remove ${file.name}`} title="Remove"><Trash2 size={14} aria-hidden="true" /></button></li>)}</ul>}
            <button type="button" className="mn-hs-drop" data-dragging={dragging} disabled={full} onClick={() => files.current?.click()}
              onDragOver={event => { if (full) return; event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); if (!full) void attach([...event.dataTransfer.files]); }}>
              <FileUp size={18} aria-hidden="true" />
              <span><b>{reading ? 'Reading…' : full ? 'Templates are full' : 'Drop a template here, or choose a file'}</b><small>PDF, Word, Excel, TXT, Markdown or CSV · read on this device</small></span>
            </button>
            <span className="mn-hs-meter" aria-label={`${used.toLocaleString('en-GB')} of ${AGENT_LIMITS.houseFileChars.toLocaleString('en-GB')} characters used`}>
              <span style={{ width: `${Math.min(100, used / AGENT_LIMITS.houseFileChars * 100)}%` }} /></span>
            <small className="mn-hs-hint">{used.toLocaleString('en-GB')} of {AGENT_LIMITS.houseFileChars.toLocaleString('en-GB')} characters used</small>
            <input ref={files} type="file" hidden multiple accept=".pdf,.docx,.xlsx,.xlsm,.txt,.md,.csv" onChange={event => { const picked = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; void attach(picked); }} />
          </Section>

          <Section icon={Stamp} title="Letterhead" lead="Brands every Word, Excel and PowerPoint file an agent makes. The preview shows how.">
            <div className="mn-hs-row">
              <label className="mn-hs-field"><span className="mn-hs-label">Name</span><input value={head.name} maxLength={120} onChange={event => setHead({ name: event.target.value })} placeholder="Your name or your firm's" /></label>
              <div className="mn-hs-field"><span className="mn-hs-label">Accent colour</span>
                <span className="mn-hs-swatches" role="radiogroup" aria-label="Accent colour">
                  {ACCENTS.map(colour => { const on = colour.toLowerCase() === head.color.toLowerCase(); return <button key={colour} type="button" role="radio" aria-checked={on} aria-label={colour} title={colour}
                    className="mn-hs-swatch" style={{ background: colour }} onClick={() => setHead({ color: colour })}>{on && <Check size={13} aria-hidden="true" />}</button>; })}
                  <label className="mn-hs-swatch is-custom" data-on={custom} title="Another colour" style={custom ? { background: head.color } : undefined}>
                    <input type="color" value={head.color} onChange={event => setHead({ color: event.target.value })} aria-label="Another colour" />{custom ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}</label>
                </span></div>
            </div>
            <label className="mn-hs-field"><span className="mn-hs-label">Address and contact</span><textarea rows={2} value={head.address} maxLength={400} onChange={event => setHead({ address: event.target.value })} placeholder="12 Example Street, 10000 City · +00 00 000000 · office@example.com" /></label>
            <label className="mn-hs-field"><span className="mn-hs-label">Footer</span><input value={head.footer} maxLength={200} onChange={event => setHead({ footer: event.target.value })} placeholder="e.g. Confidential · Registered company no. 000000" /></label>
            <div className="mn-hs-field"><span className="mn-hs-label">Logo</span>
              <span className="mn-hs-logo">
                <span className="mn-hs-logo-box">{head.logo ? <img src={head.logo} alt="Your logo" /> : <ImagePlus size={18} aria-hidden="true" />}</span>
                <span className="mn-hs-logo-actions">
                  <button type="button" className="nomos-btn" onClick={() => logo.current?.click()}><ImagePlus size={14} aria-hidden="true" /><span>{head.logo ? 'Change' : 'Add a logo'}</span></button>
                  {head.logo && <button type="button" className="nomos-btn is-plain" onClick={() => setHead({ logo: '', logoWidth: 0, logoHeight: 0 })}><Trash2 size={14} aria-hidden="true" /><span>Remove</span></button>}
                  <small className="mn-hs-hint">PNG or JPEG, under 1 MB.</small></span>
              </span></div>
            <input ref={logo} type="file" hidden accept="image/png,image/jpeg" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void pickLogo(file); }} />
          </Section>
        </div>

        <aside className="mn-hs-side" aria-label="Letterhead preview">
          <span className="mn-hs-side-label">Preview</span>
          <div className="mn-hs-paper" style={{ ['--house-accent' as string]: head.color }}>
            <span className="mn-hs-paper-bar" />
            <div className="mn-hs-paper-head">
              {head.logo ? <img src={head.logo} alt="" /> : <span className="mn-hs-paper-mark">{(head.name.trim()[0] ?? 'A').toUpperCase()}</span>}
              <span><b>{head.name.trim() || 'Your name or firm'}</b><small>{head.address.trim() || 'Address · phone · e-mail'}</small></span>
            </div>
            <div className="mn-hs-paper-body" aria-hidden="true">
              <span className="mn-hs-paper-title" />
              <span /><span /><span className="is-short" />
              <span /><span className="is-mid" />
            </div>
            <span className="mn-hs-paper-foot">{head.footer.trim() || 'Footer'}</span>
          </div>
          <ul className="mn-hs-formats" aria-label="Files that carry it"><li>Word</li><li>Excel</li><li>PowerPoint</li></ul>
          <p className="mn-hs-side-note">{house.on ? `Agents follow ${house.rules.length} rule${house.rules.length === 1 ? '' : 's'} and ${house.files.length} template${house.files.length === 1 ? '' : 's'}.` : 'Voice is off. The letterhead still applies.'}</p>
        </aside>
      </div>
    </div>
  </div>;
}
