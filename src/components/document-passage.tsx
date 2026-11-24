// «Proof on every sentence» (7 Nov 2026): an attached document (or the agent's reference material) opened beside the
// conversation at the words an answer quoted. Since 12 Nov 2026 (his «identical to the document I uploaded, not a wall
// of text») the panel shows the file itself when the browser kept it (src/data/file-store.ts): a PDF as its pages, the
// quoted words marked on the page; a Word file with its headings, bold, lists and tables. A file the browser did not
// keep (attached before, or too large) is shown as its text, as before.
import React, { useEffect, useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { keptFile } from '../data/file-store.ts';
import { zipEntryText } from '../data/document-text.ts';

type View = { kind: 'loading' } | { kind: 'pdf'; data: Uint8Array } | { kind: 'html'; html: string } | { kind: 'text' };
const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

export function DocumentPassageReader({ name, text, start, end, exact, fileId, onClose }: { name: string; text: string; start: number; end: number; exact: boolean; fileId?: string; onClose(): void }) {
  const panel = useRef<HTMLElement>(null);
  const [view, setView] = useState<View>(fileId ? { kind: 'loading' } : { kind: 'text' });
  const quote = end > start ? text.slice(start, end) : '';
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (!fileId) return;
    let live = true;
    void (async () => {
      const kept = await keptFile(fileId);
      if (!live) return;
      if (!kept) { setView({ kind: 'text' }); return; }
      const bytes = new Uint8Array(await kept.blob.arrayBuffer());
      if (/\.pdf$/i.test(kept.name) || kept.type === 'application/pdf') { if (live) setView({ kind: 'pdf', data: bytes }); return; }
      if (/\.docx$/i.test(kept.name)) { const html = await docxHtml(bytes).catch(() => null); if (live) setView(html ? { kind: 'html', html } : { kind: 'text' }); return; }
      if (live) setView({ kind: 'text' });
    })();
    return () => { live = false; };
  }, [fileId]);
  return <aside ref={panel} tabIndex={-1} className="mn-document-source-reader nomos-gov-uk-web nomos-official-web mn-doc-reader" aria-label={name}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <section className="registrar-web">
      <div className="registrar-web-toolbar">
        <div className="registrar-web-address" title={name}><FileText size={12} aria-hidden="true" /><span>{name}</span></div>
        <button type="button" className="nomos-gov-uk-web-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
      </div>
      {quote && <div className="registrar-web-announcement" role="status">{exact ? 'The quoted words are marked in the document.' : 'The closest passage is marked: the quote differs slightly.'}</div>}
      {view.kind === 'loading' ? <p className="nomos-official-reader-note">Opening {name}…</p>
        : view.kind === 'pdf' ? <PdfDocument data={view.data} quote={quote} />
        : view.kind === 'html' ? <WordDocument html={view.html} quote={quote} />
        : <TextDocument text={text} start={start} end={end} exact={exact} />}
    </section>
  </aside>;
}

function TextDocument({ text, start, end, exact }: { text: string; start: number; end: number; exact: boolean }) {
  const mark = useRef<HTMLElement>(null);
  useEffect(() => { mark.current?.scrollIntoView({ block: 'center' }); }, [start, end]);
  return <div className="mn-doc-reader-body">{text.slice(0, start)}<mark ref={mark} className={exact ? '' : 'is-close'}>{text.slice(start, end)}</mark>{text.slice(end)}</div>;
}

/** The PDF's own pages, drawn as they come near the screen; the page holding the quote is opened and its words marked. */
function PdfDocument({ data, quote }: { data: Uint8Array; quote: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('Opening the PDF…');
  useEffect(() => {
    const container = box.current; if (!container) return;
    let disposed = false; let cleanup = () => {};
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
        if (disposed) return;
        const count = Math.min(doc.numPages, 400);
        const width = Math.max(300, container.clientWidth - 8);
        const first = await doc.getPage(1); const firstView = first.getViewport({ scale: 1 });
        if (disposed) return;
        // Where the quote is: the page whose text holds its first words, and the text items that make it up.
        const wanted = squash(quote).slice(0, 160);
        let target = 0; let targetItems: any[] = [];
        if (wanted.length >= 6) for (let number = 1; number <= count && !target; number++) {
          const page = number === 1 ? first : await doc.getPage(number);
          const items = ((await page.getTextContent()).items as any[]).filter(item => typeof item.str === 'string');
          let joined = ''; const spans: { from: number; to: number; item: any }[] = [];
          for (const item of items) { const piece = squash(item.str); if (!piece) continue; const from = joined.length + (joined ? 1 : 0); joined += (joined ? ' ' : '') + piece; spans.push({ from, to: joined.length, item }); }
          const at = joined.indexOf(wanted.slice(0, 60));
          if (at >= 0) { target = number; const stop = at + wanted.length; targetItems = spans.filter(span => span.to > at && span.from < stop).map(span => span.item); }
        }
        const ratio = Math.min(1.5, window.devicePixelRatio || 1);
        const drawn = new Set<number>();
        const draw = async (number: number, holder: HTMLElement) => {
          if (disposed || drawn.has(number)) return; drawn.add(number);
          try {
            const page = number === 1 ? first : await doc.getPage(number);
            const base = page.getViewport({ scale: 1 }); const scale = width / base.width;
            const viewport = page.getViewport({ scale: scale * ratio });
            const canvas = window.document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); canvas.style.width = `${width}px`;
            await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
            if (disposed) return;
            holder.style.height = ''; holder.replaceChildren(canvas);
            if (number === target) {
              const cssView = page.getViewport({ scale });
              for (const item of targetItems) {
                const [, , c, d, e, f] = item.transform as number[];
                const height = item.height || Math.hypot(c, d);
                const [x1, y1, x2, y2] = cssView.convertToViewportRectangle([e, f, e + item.width, f + height]);
                const hl = window.document.createElement('span'); hl.className = 'mn-doc-pdf-mark';
                Object.assign(hl.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` });
                holder.appendChild(hl);
              }
            }
          } catch { /* a page that will not draw stays empty */ }
        };
        const watcher = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) void draw(Number((entry.target as HTMLElement).dataset.page), entry.target as HTMLElement); },
          { root: container.closest('.mn-doc-pdf'), rootMargin: '120% 0px' });
        cleanup = () => watcher.disconnect();
        let targetHolder: HTMLElement | null = null;
        for (let number = 1; number <= count; number++) {
          const holder = window.document.createElement('div');
          holder.className = 'mn-doc-pdf-page'; holder.dataset.page = String(number);
          holder.style.width = `${width}px`; holder.style.height = `${Math.round(width * firstView.height / firstView.width)}px`;
          container.appendChild(holder); watcher.observe(holder);
          if (number === target) targetHolder = holder;
        }
        setNote(`${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}${target ? ` · the quote is on page ${target}` : ''}`);
        if (targetHolder) { await draw(target, targetHolder); window.requestAnimationFrame(() => (targetHolder!.querySelector('.mn-doc-pdf-mark') ?? targetHolder!).scrollIntoView({ block: 'center' })); }
      } catch { if (!disposed) setNote('The PDF could not be drawn here.'); }
    })();
    return () => { disposed = true; cleanup(); for (const canvas of container.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0; } container.replaceChildren(); };
  }, [data, quote]);
  return <div className="mn-doc-pdf"><p className="nomos-official-reader-note">{note}</p><div ref={box} className="mn-doc-pdf-pages" /></div>;
}

/** A Word file as a page: its HTML (headings, bold, lists, tables) with the quote marked. */
function WordDocument({ html, quote }: { html: string; quote: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = box.current; if (!root) return;
    root.innerHTML = html;
    const wanted = squash(quote).slice(0, 80); if (wanted.length < 6) return;
    for (const block of root.querySelectorAll('p, li, td, h1, h2, h3, h4')) {
      if (!squash(block.textContent ?? '').includes(wanted.slice(0, 40))) continue;
      block.classList.add('mn-doc-word-mark'); block.scrollIntoView({ block: 'center' }); break;
    }
  }, [html, quote]);
  return <div className="mn-doc-word"><div ref={box} className="mn-doc-word-page" /></div>;
}

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** A .docx's body as simple, safe HTML: paragraphs, headings by style, bold / italic / underline, line breaks, bullet
 *  and numbered items, and tables. Built from the XML, never from markup inside it, so no script or link can get in. */
export async function docxHtml(bytes: Uint8Array): Promise<string | null> {
  const xml = await zipEntryText(bytes, 'word/document.xml'); if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const kids = (node: Element, name: string) => Array.from(node.children).filter(child => child.namespaceURI === W && child.localName === name);
  const first = (node: Element, name: string) => kids(node, name)[0];
  const on = (props: Element | undefined, name: string) => { const found = props && first(props, name); return !!found && !/^(?:0|false|none)$/.test(found.getAttributeNS(W, 'val') ?? ''); };
  const run = (r: Element) => {
    const props = first(r, 'rPr'); let out = '';
    for (const child of Array.from(r.children)) {
      if (child.localName === 't') out += escapeHtml(child.textContent ?? '');
      else if (child.localName === 'tab') out += '&emsp;';
      else if (child.localName === 'br' || child.localName === 'cr') out += '<br>';
    }
    if (!out) return '';
    if (on(props, 'b')) out = `<strong>${out}</strong>`;
    if (on(props, 'i')) out = `<em>${out}</em>`;
    if (on(props, 'u')) out = `<u>${out}</u>`;
    return out;
  };
  const inline = (p: Element): string => Array.from(p.children).map(child => child.localName === 'r' ? run(child) : child.localName === 'hyperlink' || child.localName === 'ins' || child.localName === 'smartTag' ? inline(child) : '').join('');
  const paragraph = (p: Element) => {
    const props = first(p, 'pPr'); const style = props ? first(props, 'pStyle')?.getAttributeNS(W, 'val') ?? '' : '';
    const align = props ? first(props, 'jc')?.getAttributeNS(W, 'val') ?? '' : '';
    const body = inline(p) || '&nbsp;';
    const css = align === 'center' ? ' style="text-align:center"' : align === 'right' || align === 'end' ? ' style="text-align:right"' : align === 'both' ? ' style="text-align:justify"' : '';
    const heading = /^(?:heading|kop|titre|überschrift)\s*([1-4])$/i.exec(style) ?? (/^title$/i.test(style) ? [, '1'] : null);
    if (heading) return { list: false, html: `<h${heading[1]}${css}>${body}</h${heading[1]}>` };
    if (props && first(props, 'numPr')) return { list: true, html: `<li${css}>${body}</li>` };
    return { list: false, html: `<p${css}>${body}</p>` };
  };
  const block = (parent: Element): string => {
    let out = ''; let listOpen = false;
    for (const child of Array.from(parent.children)) {
      if (child.namespaceURI !== W) continue;
      if (child.localName === 'p') { const part = paragraph(child); if (part.list && !listOpen) { out += '<ul>'; listOpen = true; } if (!part.list && listOpen) { out += '</ul>'; listOpen = false; } out += part.html; }
      else if (child.localName === 'tbl') {
        if (listOpen) { out += '</ul>'; listOpen = false; }
        out += `<table>${kids(child, 'tr').map(tr => `<tr>${kids(tr, 'tc').map(tc => `<td>${block(tc)}</td>`).join('')}</tr>`).join('')}</table>`;
      } else if (child.localName === 'sdt') { const content = first(child, 'sdtContent'); if (content) out += block(content); }
    }
    return listOpen ? `${out}</ul>` : out;
  };
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  return body ? block(body) : null;
}
