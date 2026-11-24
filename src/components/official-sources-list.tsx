// The official pages an answer cites: each page with its site, under the answer. Only pages of that place's official
// websites ever reach this list. A click opens the page inside the app: beside the conversation as the real page, or
// (the editor's narrow test) its title and main text in an overlay reader, the original a click away.
import { sourceMark } from '../data/source-chips.ts';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, LoaderCircle, X, ChevronDown } from 'lucide-react';
import { placeName, sourcePlace } from '../../shared/official-sources.ts';
import { PRODUCT_NAME } from '../../shared/product.ts';
import { EvidenceSummary } from './evidence-summary.tsx';

export type Source = { title: string; url: string; site: string };
export type Page = { state: 'loading' } | { state: 'html'; title: string; html: string; url: string } | { state: 'text'; text: string; url: string } | { state: 'failed'; url: string };

/** The page as text: its title and main text, read by api/official-page.ts. */
export function useOfficialPage(source: Source, language: string): Page {
  const [page, setPage] = useState<Page>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController(); setPage({ state: 'loading' });
    (async () => {
      const response = await fetch(`/api/official-page?${new URLSearchParams({ url: source.url, lang: language, open: '1' })}`, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('unavailable');
      if ((response.headers.get('content-type') || '').includes('application/pdf')) {
        const { extractDocumentText } = await import('../data/document-text.ts');
        const read = await extractDocumentText(new File([await response.blob()], 'page.pdf', { type: 'application/pdf' }), 400_000);
        return { state: 'text', text: read.text, url: response.headers.get('x-source-url') || source.url } as Page;
      }
      const value = await response.json();
      return { state: 'html', title: value.title || source.title, html: value.html || '', url: value.url || source.url } as Page;
    })().then(setPage, () => { if (!controller.signal.aborted) setPage({ state: 'failed', url: source.url }); });
    return () => controller.abort();
  }, [source.url, source.title, language]);
  return page;
}

export function OfficialPageBody({ page }: { page: Page }) {
  return <div className="nomos-official-reader-body">
    {page.state === 'loading' && <p className="nomos-official-reader-note"><LoaderCircle size={14} className="is-spinning" aria-hidden="true" />Opening the official page…</p>}
    {page.state === 'failed' && <p className="nomos-official-reader-note">{/eur-lex\.europa\.eu|publications\.europa\.eu/.test(page.url ?? '') ? 'The EU site did not answer just now. Try again in a minute, or open the original.' : `This page cannot be read inside ${PRODUCT_NAME} (it may need a sign-in or JavaScript). Open the original.`}</p>}
    {page.state === 'text' && <div className="nomos-official-reader-text">{page.text.split(/\n{2,}/).slice(0, 2000).map((block, index) => <p key={index}>{block}</p>)}</div>}
    {page.state === 'html' && (page.html.replace(/<[^>]+>/g, '').trim()
      ? <div className="nomos-official-reader-html" dangerouslySetInnerHTML={{ __html: page.html }} onClick={event => {
        const link = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
        if (link) { event.preventDefault(); window.open(link.href, '_blank', 'noopener,noreferrer'); }
      }} />
      : <p className="nomos-official-reader-note">The page has no text that can be read here. Open the original.</p>)}
  </div>;
}

export function OfficialPageReader({ source, language, onClose }: { source: Source; language: string; onClose(): void }) {
  const page = useOfficialPage(source, language);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const url = page.state === 'loading' ? source.url : page.url;
  return createPortal(<div className="nomos-official-reader-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="nomos-official-reader" role="dialog" aria-label={source.title}>
      <header>
        <span><b title={source.title}>{page.state === 'html' && page.title ? page.title : source.title}</b><small>{source.site}</small></span>
        <a className="nomos-btn" href={url} target="_blank" rel="noopener noreferrer" data-new-tab><ExternalLink size={13} aria-hidden="true" />Original</a>
        <button type="button" className="nomos-official-reader-close" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
      </header>
      <OfficialPageBody page={page} />
    </aside>
  </div>, document.body);
}

/** `onOpen`: where a page opens (beside the conversation as the real page); without it, the overlay text reader. */
export function OfficialSourcesList({ sources, place, label, language, children, onOpen }: { sources: Source[]; place?: string; label?: string; language: string; children?: React.ReactNode; onOpen?(source: Source): void }) {
  const where = sourcePlace(place);
  const [reading, setReading] = useState<Source | null>(null);
  return <details className="mn-chat-ai-evidence nomos-uk-evidence nomos-official-sources" open>
    <EvidenceSummary kind="laws" label={label ?? (where ? `Official sources · ${where.flag} ${placeName(where, true)}` : 'Official sources')} count={sources.length === 1 ? '1 page' : `${sources.length} pages`} />
    {children}
    <div className="nomos-external-cases">{sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="nomos-official-source"
      onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); if (onOpen) onOpen(source); else setReading(source); } }}>
      <span>{source.title}<small>{source.site}</small></span><ExternalLink size={13} aria-hidden="true" /></a>)}</div>
    {reading && <OfficialPageReader source={reading} language={language} onClose={() => setReading(null)} />}
  </details>;
}

/** Under an answer (11 Nov 2026, «like Montesquilex»): two quiet rows, closed — «Cited 3 sources 🇨🇾 ⌄» and
 *  «Also consulted 7 ⌄» — each opening its list; a click opens the page in the side reader. */
/** A source's name; when it has none of its own (the title is just the site), the page's own path, readable. */
function named(source: Source): string {
  const site = source.site.replace(/^www\./, '');
  if (source.title && source.title.replace(/^www\./, '') !== site) return source.title;
  try {
    const url = new URL(source.url);
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean).map(part => part.replace(/\.(?:html?|aspx?|nsf|php)$/i, '').replace(/[-_]+/g, ' ')).filter(part => part && part.length > 2 && !/^\$/.test(part) && !/^(?:\d+|all|index|default|home|main|en|el)$/i.test(part) && !/^[0-9a-f]{16,}$/i.test(part));
    const label = parts.slice(-2).join(' › ');
    return label ? `${site} › ${label}`.slice(0, 90) : site;
  } catch { return site; }
}

export function SourcesSummary({ cited, consulted, onOpen }: { cited: Source[]; consulted: Source[]; onOpen(source: Source): void }) {
  const extra = consulted.filter(item => !cited.some(source => source.url === item.url));
  const flags = (list: Source[]) => [...new Set(list.map(source => sourceMark(source.url)).filter(Boolean).map(mark => mark!.court ? '🏛' : mark!.flag))].slice(0, 4).join(' ');
  const row = (label: string, list: Source[]) => <details className="mn-sources-row">
    <summary><span>{label}</span>{flags(list) && <i aria-hidden="true">{flags(list)}</i>}<ChevronDown size={14} aria-hidden="true" /></summary>
    <ul>{list.map(source => { const mark = sourceMark(source.url); return <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer"
      onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); onOpen(source); } }}>
      <i aria-hidden="true">{mark ? (mark.court ? '🏛' : mark.flag) : '🔗'}</i><span><b>{named(source)}</b><small>{source.site}</small></span><ExternalLink size={12} aria-hidden="true" /></a></li>; })}</ul>
  </details>;
  if (!cited.length && !extra.length) return null;
  return <div className="mn-sources-summary">
    {cited.length > 0 && row(`Cited ${cited.length} source${cited.length === 1 ? '' : 's'}`, cited)}
    {extra.length > 0 && row(`Also consulted ${extra.length}`, extra)}
  </div>;
}
