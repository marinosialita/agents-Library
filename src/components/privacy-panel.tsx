// «Names hidden» in the chat box (7 Nov 2026, his request): what the AI will not see in this conversation, each item
// with its placeholder; any item can be shown to the AI, any word added; one switch turns it off for the conversation.
import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Plus, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { KIND_NAME, type HiddenItem, type PrivacyChoice } from '../data/privacy.ts';

export function PrivacyPanel({ on, items, choice, onChange, onClose, onPrivacy }: { on: boolean; items: HiddenItem[]; choice: PrivacyChoice; onChange(next: PrivacyChoice): void; onClose(): void; onPrivacy?(): void }) {
  const [word, setWord] = useState('');
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const keep = (text: string) => onChange({ ...choice, keep: [...new Set([...(choice.keep ?? []), text])], hide: (choice.hide ?? []).filter(item => item !== text) });
  const hideAgain = (text: string) => onChange({ ...choice, keep: (choice.keep ?? []).filter(item => item !== text) });
  const add = () => { const text = word.trim(); if (!text) return; onChange({ ...choice, hide: [...new Set([...(choice.hide ?? []), text])], keep: (choice.keep ?? []).filter(item => item.toLocaleLowerCase() !== text.toLocaleLowerCase()) }); setWord(''); };
  return <div className="mn-agent-privacy" role="region" aria-label="Names hidden from the AI">
    <div className="mn-agent-privacy-top">
      <span className="mn-agent-privacy-title">{on ? <ShieldCheck size={14} aria-hidden="true" /> : <ShieldOff size={14} aria-hidden="true" />}{on ? 'Hidden from the AI' : 'Names are shown to the AI'}</span>
      <button type="button" role="switch" aria-checked={on} className="mn-agent-privacy-switch" onClick={() => onChange({ ...choice, on: !on })}><i aria-hidden="true" /><span>{on ? 'On' : 'Off'}</span></button>
      <button type="button" className="mn-agent-privacy-close" onClick={onClose} aria-label="Close"><X size={12} aria-hidden="true" /></button>
    </div>
    {on ? <>
      {items.length ? <ul className="mn-agent-privacy-list">{items.map(item => <li key={item.placeholder}>
        <small>{KIND_NAME[item.kind]}</small><b title={item.aliases.length ? `Also: ${item.aliases.join(', ')}` : undefined}>{item.text}</b><code>{item.placeholder}</code>
        <button type="button" onClick={() => item.kind === 'custom' ? onChange({ ...choice, hide: (choice.hide ?? []).filter(text => text !== item.text) }) : keep(item.text)} aria-label={`Show ${item.text} to the AI`} title="Show to the AI"><Eye size={13} aria-hidden="true" /></button>
      </li>)}</ul> : <p className="mn-agent-privacy-empty">Nothing to hide found yet. Attach documents or write the question: names, companies, e-mails, phone, ID and bank numbers and addresses are found as you go.</p>}
      {(choice.keep ?? []).length > 0 && <p className="mn-agent-privacy-kept"><span>Shown to the AI:</span>{(choice.keep ?? []).map(text => <button key={text} type="button" onClick={() => hideAgain(text)} title="Hide again"><EyeOff size={11} aria-hidden="true" />{text}</button>)}</p>}
      <div className="mn-agent-privacy-add">
        <input value={word} onChange={event => setWord(event.target.value)} maxLength={120} placeholder="Hide another name, word or number" aria-label="Hide another name, word or number"
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} />
        <button type="button" className="nomos-btn" onClick={add} disabled={!word.trim()}><Plus size={13} aria-hidden="true" /><span>Hide</span></button>
      </div>
      <small className="mn-agent-privacy-hint">Found in this browser before anything is sent; the answer shows the real names again. Check the list: an unusual name or an address can be missed.{onPrivacy && <> <button type="button" className="mn-agent-privacy-link" onClick={onPrivacy}>How your data is protected</button></>}</small>
    </> : <p className="mn-agent-privacy-empty">The AI reads the documents and messages as they are. Turn this on to replace names and numbers with placeholders first.</p>}
  </div>;
}
