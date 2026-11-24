// The row under an answer (7 Nov 2026): Copy; the finished files — Word, Excel when the answer has a table,
// PowerPoint, and Word with tracked changes when the agent marked up an attached document — all branded with the
// house style's letterhead; and «Teach it» (12 Nov 2026): what should change, which redoes the answer and offers the
// lessons in it to keep (agent-run.tsx). Where there is no chat to redo in (a chain's step), «Remember» keeps a rule
// for every agent, as before.
import React, { useState } from 'react';
import { BookmarkPlus, Check, Copy, FilePen, FileSpreadsheet, FileText, GraduationCap, Presentation, X } from 'lucide-react';
import { markdownToText } from '../data/markdown.ts';
import { addHouseRule } from '../data/store.ts';
import type { Citation } from '../data/store.ts';

export const fileName = (name: string, extension: string) => `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Answer'}.${extension}`;
export function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
const TYPES = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
/** The answer as the reader sees it: no proof block, no proof marks, no machine-readable edits. */
export const readableAnswer = (content: string) => content.replace(/<proofs>[\s\S]*$/i, '').replace(/\[\^\d+\]/g, '').replace(/```redline[\s\S]*?(?:```|$)/g, '').trim();
const hasTable = (content: string) => /^\s*\|.*\|\s*$/m.test(content) && /^\s*\|?\s*:?-{3,}/m.test(content);

export function AnswerActions({ title, content, sources = [], original, onNotice, onTeach, noTeach = false }: { title: string; content: string; sources?: Citation[]; original?: { name: string; text: string }; onNotice(text: string): void;
  /** 13 Nov 2026: an older answer in a chat (only the newest can be redone) shows neither «Teach it» nor «Remember». */ noTeach?: boolean;
  /** «Teach it»: the person's feedback on this answer (the chat redoes it and offers the lessons). */ onTeach?(feedback: string): void }) {
  const [copied, setCopied] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [rule, setRule] = useState('');
  const [taught, setTaught] = useState(false);
  const edits = /```redline/.test(content);
  const remember = () => {
    const text = rule.trim(); if (!text) return;
    if (onTeach) { onTeach(text); setTeaching(false); setRule(''); return; }
    if (addHouseRule(text)) { setTaught(true); setTeaching(false); setRule(''); window.setTimeout(() => setTaught(false), 4000); }
    else onNotice('The rule was not saved: the browser storage is full.');
  };
  // The writers load on the first press: they are not needed to read an answer.
  const make = (kind: 'docx' | 'xlsx' | 'pptx' | 'redline') => {
    void Promise.all([import('../data/office/index.ts'), import('../data/office-brand.ts')]).then(([office, brand]) => {
      const input = { title, markdown: content, brand: brand.houseBrand() };
      if (kind === 'docx') return download(office.answerDocx({ ...input, sources: sources.map(source => ({ title: source.title, url: source.url })) }), fileName(title, 'docx'), TYPES.docx);
      if (kind === 'pptx') return download(office.answerPptx(input), fileName(title, 'pptx'), TYPES.pptx);
      if (kind === 'xlsx') { const bytes = office.answerXlsx(input); if (bytes) download(bytes, fileName(title, 'xlsx'), TYPES.xlsx); else onNotice('This answer has no table to put in a spreadsheet.'); return; }
      if (!original) { onNotice('Attach the document that was marked up, then press again.'); return; }
      const result = office.redlineDocx({ title: original.name, original: original.text, edits: office.parseEdits(content), brand: brand.houseBrand() });
      download(result.bytes, fileName(`${original.name.replace(/\.[a-z0-9]+$/i, '')} (tracked changes)`, 'docx'), TYPES.docx);
      onNotice(result.missed.length ? `${result.applied} changes are tracked; ${result.missed.length} could not be placed because their words were not found in ${original.name}.` : `${result.applied} changes are tracked in ${original.name}.`);
    }, () => onNotice('The file could not be made. Please try again.'));
  };
  return <>
    <span className="mn-agent-msg-actions">
      <button type="button" className="mn-agent-copy" onClick={() => { void (navigator.clipboard?.writeText(markdownToText(readableAnswer(content))) ?? Promise.reject()).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => onNotice('Copying is not allowed here: select the text and copy it.')); }}>
        {copied ? <><Check size={12} aria-hidden="true" />Copied</> : <><Copy size={12} aria-hidden="true" />Copy</>}</button>
      <button type="button" className="mn-agent-copy" onClick={() => make('docx')} title="Word, with your letterhead"><FileText size={12} aria-hidden="true" />Word</button>
      {hasTable(content) && <button type="button" className="mn-agent-copy" onClick={() => make('xlsx')} title="Every table of the answer as a sheet"><FileSpreadsheet size={12} aria-hidden="true" />Excel</button>}
      <button type="button" className="mn-agent-copy" onClick={() => make('pptx')} title="The answer as slides, with your letterhead"><Presentation size={12} aria-hidden="true" />PowerPoint</button>
      {edits && <button type="button" className="mn-agent-copy is-strong" onClick={() => make('redline')} title="The attached document with the agent's changes as Word tracked changes"><FilePen size={12} aria-hidden="true" />Tracked changes</button>}
      {noTeach ? null : onTeach ? <button type="button" className="mn-agent-copy" aria-expanded={teaching} onClick={() => setTeaching(value => !value)} title="Say what should change: the agent redoes the answer and learns from it">
        <GraduationCap size={12} aria-hidden="true" />Teach it</button>
      : <button type="button" className="mn-agent-copy" aria-expanded={teaching} onClick={() => setTeaching(value => !value)} title="Teach every agent a rule from this answer">
        {taught ? <><Check size={12} aria-hidden="true" />Every agent will follow it</> : <><BookmarkPlus size={12} aria-hidden="true" />Remember</>}</button>}
    </span>
    {teaching && <span className="mn-agent-teach">
      <input value={rule} onChange={event => setRule(event.target.value)} maxLength={onTeach ? 2000 : 300} autoFocus
        placeholder={onTeach ? 'What should change? e.g. Too long, and always show VAT separately' : 'What should every agent remember? e.g. Always write amounts as €1,000.00'}
        aria-label={onTeach ? 'What should change in this answer' : 'A rule for every agent'} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); remember(); } if (event.key === 'Escape') setTeaching(false); }} />
      <button type="button" className="nomos-btn is-primary" onClick={remember} disabled={!rule.trim()}>{onTeach ? 'Redo and learn' : 'Remember'}</button>
      <button type="button" className="mn-agent-teach-close" onClick={() => setTeaching(false)} aria-label="Close"><X size={12} aria-hidden="true" /></button>
    </span>}
  </>;
}
