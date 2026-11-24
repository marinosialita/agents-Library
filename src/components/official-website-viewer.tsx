// The real official page beside the conversation: the page as its site shows it, with browser controls, drawn by
// api/official-web.ts in a sandboxed frame. Official links inside it open here (Back/Forward); other sites open in
// a new tab. A PDF is drawn page by page; a page built only by scripts, or one that will not open as a page, falls
// back to its text (the official-page reader).
import { isCatalogueUrl } from '../../shared/official-sources.ts';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, FileText, Globe, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { sourceHost } from '../../shared/official-sources.ts';
import { PRODUCT_NAME } from '../../shared/product.ts';
import { OfficialPageBody, useOfficialPage } from './official-sources-list.tsx';

type Props = {
  url: string; title?: string; language: string;
  /** A proof's quote (src/data/proof.ts): the page opens marked and scrolled at that passage; the frame reports
   *  whether it found it, word for word (exact) or nearly. Only the page first opened carries it. */
  quote?: string; onQuote?(result: { found: boolean; exact: boolean }): void;
  onLink?(href: string): boolean; onClose(): void;
};
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'the site'; } };
/** What the reader says when a page fails, by the route's reason. */
const FAILURES: Record<string, string> = {
  not_found: 'This page no longer exists on the site.',
  busy: 'The site is busy right now.',
  refused: 'This site does not let other apps show its pages.',
  too_large: 'This file is too large to show here.',
};
type Status = 'loading' | 'ready' | 'pdf' | 'text' | 'error';

export const officialWebFrameUrl = (url: string, language: string, quote?: string) =>
  `/api/official-web?${new URLSearchParams({ url, lang: language, open: '1', ...(quote?.trim() ? { quote: quote.trim().slice(0, 400) } : {}) })}`;

const PDF_PAGE_LIMIT = 400; // pages are drawn only near the screen, so a long gazette can be read whole
/** The PDF page by page (pdf.js), fetched through the official-page route so no cookie or credential ever travels. */
function PdfPages({ url, language }: { url: string; language: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('Opening the PDF…');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const container = box.current; if (!container) return;
    let disposed = false; let cleanup = () => {}; const controller = new AbortController(); setFailed(false); setNote('Opening the PDF…');
    (async () => {
      try {
        const response = await fetch(`/api/official-page?${new URLSearchParams({ url, lang: language, open: '1' })}`, { signal: controller.signal, credentials: 'same-origin' });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw new Error('unavailable');
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const document = await pdfjs.getDocument({ data }).promise;
        if (disposed) return;
        const pages = Math.min(document.numPages, PDF_PAGE_LIMIT);
        const width = Math.max(320, container.clientWidth - 24);
        const total = document.numPages > pages ? `${pages} of ${document.numPages} pages shown; open the original for the rest.` : `${document.numPages} ${document.numPages === 1 ? 'page' : 'pages'}`;
        // 12 Nov 2026 (his «it sometimes breaks the browser»): every page was drawn at once at double sharpness — an
        // 80-page PDF held over a gigabyte of canvases. Now each page is an empty box of its own size; a page is drawn
        // when it comes near the screen and its picture is dropped again when it is far away (at most ~6 kept).
        const first = await document.getPage(1); const firstView = first.getViewport({ scale: 1 });
        if (disposed) return; // the effect ran again meanwhile (a reload, React's double run): only the newest one fills the box
        const ratio = Math.min(1.5, window.devicePixelRatio || 1);
        const drawn = new Map<number, HTMLCanvasElement>(); const drawing = new Set<number>();
        const draw = async (number: number, holder: HTMLElement) => {
          if (disposed || drawn.has(number) || drawing.has(number)) return; drawing.add(number);
          try {
            const page = number === 1 ? first : await document.getPage(number);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: (width / base.width) * ratio });
            const canvas = window.document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); canvas.style.width = `${width}px`;
            await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
            if (disposed) return;
            holder.style.height = ''; holder.replaceChildren(canvas); drawn.set(number, canvas);
          } catch { /* one bad page is left as an empty box */ } finally { drawing.delete(number); }
        };
        const drop = (number: number, holder: HTMLElement) => {
          const canvas = drawn.get(number); if (!canvas) return;
          holder.style.height = `${canvas.getBoundingClientRect().height}px`; canvas.width = 0; canvas.height = 0; holder.replaceChildren(); drawn.delete(number);
        };
        const watcher = new IntersectionObserver(entries => {
          for (const entry of entries) { const holder = entry.target as HTMLElement; const number = Number(holder.dataset.page);
            if (entry.isIntersecting) void draw(number, holder); else drop(number, holder); }
        }, { root: container.closest('.nomos-official-web-fallback'), rootMargin: '150% 0px' });
        cleanup = () => watcher.disconnect();
        for (let number = 1; number <= pages; number++) {
          const holder = window.document.createElement('div');
          holder.className = 'nomos-official-web-pdf-page'; holder.dataset.page = String(number);
          holder.style.width = `${width}px`; holder.style.height = `${Math.round(width * firstView.height / firstView.width)}px`;
          container.appendChild(holder); watcher.observe(holder);
        }
        setNote(total);
      } catch { if (!disposed && !controller.signal.aborted) setFailed(true); }
    })();
    return () => { disposed = true; cleanup(); controller.abort(); for (const canvas of container.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0; } container.replaceChildren(); };
  }, [url, language]);
  if (failed) return <p className="nomos-official-reader-note">The PDF did not open inside {PRODUCT_NAME}. Open the original.</p>;
  return <div className="nomos-official-web-pdf"><div ref={box} /><p className="nomos-official-reader-note">{note}</p></div>;
}

function TextFallback({ url, title, language }: { url: string; title: string; language: string }) {
  const page = useOfficialPage({ url, title, site: sourceHost(url) ?? '' }, language);
  return <OfficialPageBody page={page} />;
}

export function OfficialWebsiteViewer({ url, title, language, quote, onQuote, onLink, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [history, setHistory] = useState([url]);
  const [index, setIndex] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  /** Why the page failed, as the route says it (X-Page-Error). */
  const [failure, setFailure] = useState('');

  const passage = index === 0 ? quote?.trim() || undefined : undefined;
  /** 12 Nov 2026 (his «some open, some stay blank»): a site outside the official sources opens as clean text first.
   *  Shown as the site sent it, without its scripts, many look broken (Anthropic's headline vanished, the EU's
   *  language menu covered the page); with its scripts, many went blank. «Page» still shows the original. */
  const readerFirst = (target: string, at = 0) => !isCatalogueUrl(target) && !/\.pdf(?:$|[?#])/i.test(target) && !(at === 0 && quote?.trim());
  // «Text»: any page can be switched to its plain text, and back.
  const [asText, setAsText] = useState(() => readerFirst(url));
  const current = history[index];
  // A PDF is never read as text: its pages are drawn.
  useEffect(() => { if (status === 'pdf') setAsText(false); }, [status]);
  const shown = current.replace(/^https?:\/\/(www\.)?/, '');
  /** The official page as the route made it (scripts removed, assets from official hosts), with its security rule. */
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setPage(null); setFailure('');
    const limit = window.setTimeout(() => { if (live) setStatus(value => value === 'loading' ? 'error' : value); }, 90_000);
    // Same-origin credentials: a page outside the official sources opens only for a signed-in person (server/public-web.ts).
    void fetch(officialWebFrameUrl(current, language, passage), { credentials: 'same-origin', referrerPolicy: 'no-referrer' }).then(async response => {
      const html = await response.text();
      if (live) setFailure(response.headers.get('x-page-error') ?? '');
      // frame-ancestors and sandbox cannot be set by a meta tag; the frame's own sandbox attribute does that part.
      const rule = (response.headers.get('content-security-policy') ?? "default-src 'none'").split(';').map(part => part.trim()).filter(part => part && !/^(?:frame-ancestors|sandbox)\b/.test(part)).join('; ');
      // No referrer for the page's images and styles: set inside the page (a referrerpolicy attribute on a srcdoc frame
      // left it blank in some browsers).
      const meta = `<meta http-equiv="Content-Security-Policy" content="${rule.replace(/"/g, '&quot;')}"><meta name="referrer" content="no-referrer">`;
      if (live) setPage(/^<!doctype html>/i.test(html) ? html.replace(/^<!doctype html>/i, match => `${match}${meta}`) : `${meta}${html}`);
    }, () => { if (live) setStatus('error'); }).finally(() => window.clearTimeout(limit));
    return () => { live = false; window.clearTimeout(limit); };
  }, [current, refresh, passage, language]);
  /** If the frame's signal never comes, read the kind the route wrote into the page. */
  const kindFromPage = (html: string) => {
    const kind = /"type":"official-page"[^}]*"kind":"(ready|pdf|empty|error)"/.exec(html)?.[1];
    setStatus(value => value !== 'loading' ? value : kind === 'pdf' ? 'pdf' : kind === 'error' ? 'error' : kind === 'empty' ? 'text' : 'ready');
  };

  useEffect(() => {
    setStatus('loading');
    // No timer here (11 Nov 2026): a slow official site (EUR-Lex through CELLAR takes ~8 s) kept loading past it and
    // fell to the text reader, which cannot read a PDF. The page's own arrival decides (kindFromPage), with a 90 s limit below.
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.source !== frame.current?.contentWindow || !message || message.type !== 'official-page' || message.requested !== current) return;
      if (message.kind === 'navigate' && typeof message.href === 'string') {
        if (onLink?.(message.href)) return;
        setHistory(previous => [...previous.slice(0, index + 1), message.href]); setIndex(index + 1); setAsText(readerFirst(message.href, index + 1));
        return;
      }
      if (message.kind === 'quote') { onQuote?.({ found: message.found === true, exact: message.exact === true }); return; }
      setStatus(message.kind === 'ready' ? 'ready' : message.kind === 'pdf' ? 'pdf' : message.kind === 'empty' ? 'text' : 'error');
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); };
  }, [current, index, refresh, passage]);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);

  const frameShown = !asText && (status === 'loading' || status === 'ready');
  return <aside ref={panel} tabIndex={-1} className="mn-document-source-reader nomos-gov-uk-web nomos-official-web" aria-label={title || 'Official page'}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <section className="registrar-web">
      <div className="registrar-web-toolbar">
        <button type="button" aria-label="Previous page" title="Back" disabled={index === 0} onClick={() => { setIndex(i => i - 1); setAsText(readerFirst(history[index - 1], index - 1)); }}><ArrowLeft size={15} /></button>
        <button type="button" aria-label="Next page" title="Forward" disabled={index === history.length - 1} onClick={() => { setIndex(i => i + 1); setAsText(readerFirst(history[index + 1], index + 1)); }}><ArrowRight size={15} /></button>
        <button type="button" aria-label="Reload page" title="Reload" onClick={() => setRefresh(n => n + 1)}>{status === 'loading' && !asText ? <LoaderCircle size={14} className="lcp-spin" /> : <RefreshCw size={14} />}</button>
        <div className="registrar-web-address" title={current}><Globe size={12} aria-hidden="true" /><span>{shown}</span></div>
        {(status === 'ready' || asText) && <button type="button" className="nomos-official-web-mode" aria-pressed={asText} onClick={() => setAsText(value => !value)}
          title={asText ? 'The page as on the site' : 'Text only'}><FileText size={14} /><span>{asText ? 'Page' : 'Text'}</span></button>}
        <a className="nomos-official-web-original" href={current} target="_blank" rel="noopener noreferrer" data-new-tab title="Open on the site, in your browser" aria-label="Open on the site, in your browser"><ExternalLink size={14} /></a>
        <button type="button" className="nomos-gov-uk-web-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="registrar-web-announcement" role="status">
        {status === 'loading' ? 'Loading the page…' : status === 'error' ? 'The page did not open.' : 'The page is open.'}
      </div>
      {/* The frame stays mounted while it loads, so its first message can arrive. */}
      {/* The page is fetched here and given to the sandboxed frame as srcdoc (11 Nov 2026): some browsers will not
          display a sandboxed frame loaded from the app's own address. Its security rule travels with it as a meta tag. */}
      <iframe key={`${current}:${refresh}:${passage ?? ''}`} ref={frame} srcDoc={page ?? ''} title={title || shown} className="registrar-web-frame" hidden={!frameShown || !page}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads" onError={() => setStatus('error')}
        onLoad={() => { if (page) window.setTimeout(() => kindFromPage(page), 1_500); }} />
      {!frameShown && <div className="nomos-official-web-fallback">
        {status === 'pdf' && !asText ? <PdfPages url={current} language={language} />
          // A site that blocks apps (12 Nov 2026: AP, Reuters) blocks its text too: say which site, and offer only what works.
          : status === 'error' && !asText ? <div className="registrar-web-error" role="alert">{failure === 'refused'
              ? `${hostOf(current)} blocks other apps from showing its pages, so it cannot open inside ${PRODUCT_NAME}. Open it on the site below.`
              : FAILURES[failure] ?? `This site did not open inside ${PRODUCT_NAME}.`}
            {failure !== 'not_found' && failure !== 'refused' && <button type="button" onClick={() => failure === 'busy' ? setRefresh(n => n + 1) : setAsText(true)}>{failure === 'busy' ? 'Try again' : 'See the text'}</button>}
            <a href={current} target="_blank" rel="noopener noreferrer" data-new-tab>Open on {hostOf(current)}</a></div>
          : <TextFallback key={current} url={current} title={title || shown} language={language} />}
      </div>}
    </section>
  </aside>;
}
