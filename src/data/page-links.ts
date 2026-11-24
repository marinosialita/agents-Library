// «Paste a link» (13 Nov 2026, the n8n / Make study: «scrape and summarise a web page» is among their most used): a
// link in a question is read first (api/official-page.ts: public pages only, every redirect checked, no cookies) and
// joins the conversation's files as the page's text, so any agent works from what the page says.
export const PAGE_LIMITS = { links: 2, chars: 60_000 } as const;

/** The web links in a question (at most two), without trailing punctuation; Google Sheets links belong to «Every row». */
export function linksIn(text: string): string[] {
  // 13 Nov 2026 (code review): brackets inside a link are kept («…/wiki/Lease_(law)»); a closing one with no opening
  // one is the sentence's («(see https://x.org/page)»).
  const found = [...text.matchAll(/https?:\/\/[^\s<>"'«»]+/g)].map(match => {
    let link = match[0].replace(/[.,;:!?]+$/, '');
    while (link.endsWith(')') && (link.match(/\(/g)?.length ?? 0) < (link.match(/\)/g)?.length ?? 0)) link = link.slice(0, -1).replace(/[.,;:!?]+$/, '');
    return link;
  });
  return [...new Set(found)].filter(link => { try { const url = new URL(link); return /^https?:$/.test(url.protocol) && url.hostname.includes('.') && !/docs\.google\.com\/spreadsheets/.test(link); } catch { return false; } }).slice(0, PAGE_LIMITS.links);
}

/** Readable HTML (from the page route) as plain text: headings and paragraphs on their own lines, lists as «- ». */
export function htmlText(html: string): string {
  return html.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, '\n- ').replace(/<(br|p|div|h[1-6]|tr|section|article|blockquote|table|ul|ol)\b[^>]*>/gi, '\n').replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : ' ')
    .replace(/[ \t]+/g, ' ').replace(/ +([.,;:!?])/g, '$1').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A page as a conversation file: its title, address and text; a page that could not be read says so plainly. */
export function pageDocument(link: string, read: { title?: string; html?: string } | null): { name: string; text: string } {
  const host = (() => { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return 'web page'; } })();
  // 13 Nov 2026: a YouTube link gave the agent only «the page could not be read». Videos are not watched and their
  // transcripts are not taken from YouTube (its terms forbid automated reading): the person is told how to paste it.
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) {
    const title = (read?.title ?? '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
    return { name: `Video · ${(title || 'YouTube').slice(0, 120)}`, text: `The user linked a YouTube video${title ? ` titled «${title}»` : ''}: ${link}\nThe app cannot watch videos or hear what is said in them. Unless the user also pasted the transcript or notes, say so in one line, without guessing what the video says, and tell them how to get it: on YouTube, open the video, press «…» (More) under it, then «Show transcript», and copy the text into this chat.` };
  }
  if (!read?.html) return { name: `Web page · ${host} (not readable)`, text: `The user linked ${link}, but the page could not be read: the site refused automated readers or did not answer. Say so in one line and work from what the user wrote; never guess what the page says.` };
  const text = htmlText(read.html);
  return { name: `Web page · ${(read.title || host).slice(0, 120)}`, text: `${read.title ? `${read.title}\n` : ''}${link}\n\n${text}`.slice(0, PAGE_LIMITS.chars) };
}
