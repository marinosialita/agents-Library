// An answer's Markdown as safe HTML: marked renders it, and only a whitelist of tags and attributes survives the
// DOM walk below. Links keep their address; nothing else of the page (scripts, handlers, styles) can get through.
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });
const TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'sup', 'sub', 'span']);
const ATTRS: Record<string, Set<string>> = { a: new Set(['href', 'title']), td: new Set(['colspan', 'rowspan', 'align']), th: new Set(['colspan', 'rowspan', 'align']), ol: new Set(['start']) };

function clean(node: Node, document: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element; const tag = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map(child => clean(child, document)).filter((child): child is Node => !!child);
  if (!TAGS.has(tag)) { const fragment = document.createDocumentFragment(); for (const child of children) fragment.appendChild(child); return fragment; }
  const next = document.createElement(tag);
  for (const name of ATTRS[tag] ?? []) {
    const value = element.getAttribute(name); if (value === null) continue;
    if (name === 'href') { try { const url = new URL(value, 'https://invalid.local'); if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.hostname === 'invalid.local') continue; } catch { continue; } }
    next.setAttribute(name, value);
  }
  if (tag === 'a') { next.setAttribute('rel', 'noopener noreferrer'); next.setAttribute('target', '_blank'); }
  for (const child of children) next.appendChild(child);
  return next;
}

/** A table whose divider row has more or fewer cells than its header (a model's slip: 6 titles, 7 dividers) is not
 *  a table to Markdown and showed as raw «| Day | Meal |» text (12 Nov 2026): the divider is rebuilt to the header. */
export function repairTables(markdown: string): string {
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
  const lines = markdown.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const divider = lines[i].trim(), header = lines[i - 1].trim();
    if (!/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(divider) || !header.includes('|') || /^\|?\s*:?-{3,}/.test(header)) continue;
    const want = cells(header);
    if (cells(divider) !== want) lines[i] = `|${Array(want).fill('---').join('|')}|`;
  }
  return lines.join('\n');
}

export function renderMarkdown(markdown: string): string {
  const html = marked.parse(repairTables(markdown), { async: false }) as string;
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const out = parsed.createElement('div');
  for (const child of Array.from(parsed.body.childNodes)) { const safe = clean(child, parsed); if (safe) out.appendChild(safe); }
  // Each table sits in its own frame (12 Nov 2026: a table drawn as a block filled only part of its outline): the frame
  // carries the outline and scrolls a wide table; the table itself is a real table at full width.
  for (const table of Array.from(out.querySelectorAll('table'))) {
    const frame = parsed.createElement('div'); frame.className = 'ait-table'; table.replaceWith(frame); frame.appendChild(table);
    // Each cell knows its column's heading, so a narrow place (a routine's column on Today) can show a row as a short
    // list with its labels instead of a table squeezed letter by letter.
    const heads = Array.from(table.querySelectorAll('thead th')).map(cell => (cell.textContent ?? '').trim().slice(0, 60));
    for (const row of Array.from(table.querySelectorAll('tbody tr'))) Array.from(row.children).forEach((cell, index) => { if (heads[index]) cell.setAttribute('data-label', heads[index]); });
  }
  return out.innerHTML;
}

/** Plain text of an answer for the clipboard: links keep their address in brackets. */
export function markdownToText(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)').replace(/^#{1,6}\s+/gm, '').replace(/\*\*|__/g, '').replace(/`/g, '');
}
