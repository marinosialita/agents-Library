// «Proof on every sentence» (7 Nov 2026, his request): an answer with its proof marks checked. Each mark's quote is
// looked for in its source — the attached document or the reference material here in the browser, the official page
// through /api/official-page — and the mark says what was found: checked, close (the words differ slightly) or not
// found. The bar under the answer counts the statements with proof and lists the claims made without one.
import { sourceChipsHtml } from '../data/source-chips.ts';
import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { renderMarkdown } from '../data/markdown.ts';
import { checkQuote, findQuote, htmlToText, isDraftedDocument, markBody, proofMarksHtml, proofSource, proofStatements, splitProofs, type ProofMark, type ProofState } from '../data/proof.ts';

type File = { name: string; text: string };
export type ProofOpen = { kind: 'document'; name: string; text: string; start: number; end: number; exact: boolean } | { kind: 'page'; url: string; quote: string } | { kind: 'missing'; text: string };

// An official page is read once per session for all the answers that quote it.
const pages = new Map<string, Promise<string | null>>();
function pageText(url: string, language: string): Promise<string | null> {
  let kept = pages.get(url);
  if (!kept) {
    kept = fetch(`/api/official-page?${new URLSearchParams({ url, lang: language })}`).then(response => response.ok ? response.json() : null)
      .then(json => typeof json?.html === 'string' ? htmlToText(json.html) : typeof json?.text === 'string' ? json.text : null, () => null);
    pages.set(url, kept);
  }
  return kept;
}
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sourceOf(mark: ProofMark, documents: File[], reference: File[]): File | undefined {
  const files = mark.kind === 'doc' ? documents : mark.kind === 'ref' ? reference : [];
  return mark.target ? proofSource(mark.target, files) ?? proofSource(mark.target, [...documents, ...reference]) : [...files, ...documents, ...reference].find(file => checkQuote(file.text, mark.quote) !== 'missing');
}

/** Where a pressed mark leads: the document at the quoted words, the official page at them, or why neither. */
export function openProof(content: string, n: number, documents: File[], reference: File[]): ProofOpen | null {
  const mark = splitProofs(content, { documents: documents.map(file => file.name), reference: reference.map(file => file.name) }).marks.find(item => item.n === n);
  if (!mark) return null;
  if (mark.kind === 'page') return { kind: 'page', url: mark.target, quote: mark.quote };
  const file = sourceOf(mark, documents, reference);
  if (!file) return { kind: 'missing', text: `The source «${mark.target || 'named in the proof'}» is not in this conversation any more.` };
  const found = findQuote(file.text, mark.quote);
  return found ? { kind: 'document', name: file.name, text: file.text, ...found } : { kind: 'missing', text: `The quoted words were not found in ${file.name}.` };
}

export function ProofAnswer({ content, streaming, documents, reference, language, researched = false }: { content: string; streaming: boolean; documents: File[]; reference: File[]; language: string; /** The answer searched official sources. */ researched?: boolean }) {
  const { body, marks } = useMemo(() => splitProofs(content, { documents: documents.map(file => file.name), reference: reference.map(file => file.name) }), [content, documents, reference]);
  const [read, setRead] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (streaming) return;
    let live = true;
    for (const url of new Set(marks.filter(mark => mark.kind === 'page').map(mark => mark.target))) void pageText(url, language).then(text => { if (live) setRead(current => ({ ...current, [url]: text })); });
    return () => { live = false; };
  }, [marks, streaming, language]);
  const states = useMemo(() => new Map<number, ProofState>(marks.map(mark => [mark.n, streaming ? 'pending'
    : mark.kind === 'page' ? (mark.target in read ? checkQuote(read[mark.target], mark.quote) : 'pending')
    : (file => file ? checkQuote(file.text, mark.quote) : 'missing')(sourceOf(mark, documents, reference))])), [marks, read, streaming, documents, reference]);
  const quotes = useMemo(() => new Map(marks.map(mark => [mark.n, mark.quote])), [marks]);
  const html = useMemo(() => sourceChipsHtml(proofMarksHtml(renderMarkdown(markBody(body)), n => states.get(n) ?? (streaming ? 'pending' : 'none')))
    // The quote shows on hover; the button is ours, so the attribute is added here, escaped.
    .replace(/data-proof="(\d+)"/g, (whole, n: string) => quotes.has(Number(n)) ? `${whole} title="${escapeAttribute(`«${quotes.get(Number(n))}» · press to open the source`)}"` : whole), [body, states, quotes, streaming]);
  const drafted = useMemo(() => isDraftedDocument(body), [body]);
  const stats = useMemo(() => streaming ? null : proofStatements(body, marks, { lawOnly: drafted }), [body, marks, streaming, drafted]);
  const [showing, setShowing] = useState(false);
  const count = (state: ProofState) => [...states.values()].filter(value => value === state).length;
  const unsupported = stats?.statements.filter(statement => statement.claim && !statement.marks.length) ?? [];
  return <>
    <div className="mn-chat-ai-answer"><div className="ait ait--editorial"><div className="ait-md" dangerouslySetInnerHTML={{ __html: html }} /></div></div>
    {/* Without marks the bar shows only where there was something to quote: a drafting or creative answer with no
        source is not «unproved». */}
    {/* Only an answer that carries proofs gets the bar (12 Nov 2026: «No statement carries a proof · 3 claims…» under a scheduling reply). */}
    {stats && marks.length > 0 && <div className="mn-proof-bar" role="note">
      <ShieldCheck size={14} aria-hidden="true" />
      {marks.length ? <span><b>{stats.marked}</b> {stats.marked === 1 ? 'statement' : 'statements'} with proof · <span className="is-checked">{count('checked')} checked</span>
        {count('close') ? <> · {count('close')} close</> : null}{count('missing') ? <> · <span className="is-missing">{count('missing')} not found</span></> : null}{count('pending') ? <> · {count('pending')} being checked</> : null}</span>
        : <span>No statement carries a proof.</span>}
      {unsupported.length > 0 && <button type="button" aria-expanded={showing} onClick={() => setShowing(value => !value)}>{unsupported.length} {drafted ? (unsupported.length === 1 ? 'point of law' : 'points of law') : unsupported.length === 1 ? 'claim' : 'claims'} without a source</button>}
    </div>}
    {showing && unsupported.length > 0 && <ul className="mn-proof-unsupported">{unsupported.map((statement, index) => <li key={index}>{statement.text}</li>)}</ul>}
  </>;
}
