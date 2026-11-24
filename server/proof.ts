// «Proof on every sentence», the server's half: the rules that make the agent mark each sentence it takes from a
// source and quote the source's own words, and the clean-up of the finished answer — a page outside the place's
// official sources is never kept as proof, the block is written in one form, numbered in reading order and capped.
// Reading the block, finding the quotes and counting the sentences without proof: src/data/proof.ts (shared with
// the browser).
import { PROOF_LIMITS, splitProofs, type ProofMark } from '../src/data/proof.ts';

/** Appended to the run's instruction. */
export const PROOF_RULES = `PROOF FOR EVERY SENTENCE TAKEN FROM A SOURCE
- After each sentence that states something taken from an attached document, the agent's reference material or an official web page, put a proof mark: [^1], [^2] and so on, numbered from 1 in the order they first appear, right after the sentence's final punctuation (e.g. "The rent is EUR 1,200 a month.[^1]"). In a list item or a table cell, put it at the end of the item or the cell. A sentence that rests on two passages gets two marks ([^1][^2]); a later sentence that rests on the same passage repeats its number.
- Your own analysis, advice and recommendations, questions and headings get no mark. Never write a mark without its proof line.
- At the very end of the answer, after everything else, write one block in exactly this form, one line per mark:
<proofs>
[^1]: doc "Lease.pdf" | "the exact words of the attached document"
[^2]: ref "Positions.docx" | "the exact words of the reference material"
[^3]: page https://official.site/the-exact-page | "the exact words of that page"
</proofs>
- doc is a document the user attached, ref is the agent's reference material, page is an official web page you opened in this run, with its full address. Write the file name exactly as it was given.
- The quote is the source's own words, copied character for character in the source's language (never translated or paraphrased): 8 to 40 consecutive words that prove the sentence, with no "..." and nothing left out inside. From a document shown as passages, quote one passage only, never across a «[…]».
- With no sentence taken from a source, leave the block out.`;

// Tracking parameters a search adds (utm_source=openai) are not part of the page.
const cleanUrl = (url: string) => url.trim().replace(/([?&])utm_[^&#]*&?/g, '$1').replace(/[?&]+(#|$)/, '$1');
function pageUrl(value: string): string | null {
  const url = cleanUrl(value);
  if (url.length > 2_000) return null;
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? url : null; } catch { return null; }
}
/** At most `limit` characters, cut at a word where one is near, without a dangling half of a surrogate pair. */
function clip(value: string, limit: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit); const space = cut.lastIndexOf(' ');
  return (space > limit * 0.7 ? cut.slice(0, space) : cut).replace(/[\uD800-\uDBFF]$/, '').trim();
}
const proofLine = (mark: ProofMark) => `[^${mark.n}]: ${mark.kind === 'page' ? `page ${mark.target}` : `${mark.kind} "${mark.target}"`} | "${mark.quote}"`;

/** The finished answer with its proofs made safe: a page proof is kept only when `allowedPage` accepts its address
 *  (doc and ref proofs are kept), a proof without a quote is dropped, quotes are one line of at most 400 characters,
 *  at most 120 proofs. Marks are renumbered in reading order; a mark left without a proof is removed from the
 *  sentence, which then counts as a sentence without proof. With no proof left the answer has no block. */
export function sanitizeProofs(answer: string, allowedPage: (url: string) => boolean): string {
  const { body, marks } = splitProofs(answer);
  const kept = new Map<number, ProofMark>();
  for (const mark of marks) {
    const quote = clip(mark.quote, PROOF_LIMITS.quote); if (!quote) continue;
    let target = clip(mark.target, PROOF_LIMITS.target);
    if (mark.kind === 'page') {
      const url = pageUrl(mark.target);
      let allowed = false; try { allowed = !!url && allowedPage(url); } catch { allowed = false; }
      if (!url || !allowed) continue;
      target = url;
    }
    kept.set(mark.n, { n: mark.n, kind: mark.kind, target, quote });
  }
  const order = new Map<number, number>();
  const text = body.replace(/([ \t]*)\[\^\s*(\d{1,3})\s*\]/g, (_whole, space: string, digits: string) => {
    const n = Number(digits);
    if (!kept.has(n)) return '';
    if (!order.has(n)) { if (order.size >= PROOF_LIMITS.proofs) return ''; order.set(n, order.size + 1); }
    return `${space}[^${order.get(n)}]`;
  }).replace(/(\[\^(\d+)\])(?:\s*\[\^\2\])+/g, '$1').trimEnd();
  if (!order.size) return text;
  const lines = [...order].sort((a, b) => a[1] - b[1]).map(([from, to]) => proofLine({ ...kept.get(from)!, n: to }));
  return `${text}\n\n<proofs>\n${lines.join('\n')}\n</proofs>`;
}
