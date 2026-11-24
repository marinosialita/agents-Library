// «Every row» (13 Nov 2026): the pure parts of the batch panel (src/components/batch-panel.tsx), testable in Node.
import { markdownToText } from './markdown.ts';

export type RowRun = { index: number; key: string; status: 'waiting' | 'working' | 'done' | 'failed'; answer?: string; error?: string; /** Its row number in the sheet. */ n?: number };

/** An answer as one table cell: plain text on one line; a one-row table reads as «Header: value» pairs. */
export function cellOf(answer: string): string {
  const clean = answer.replace(/<proofs>[\s\S]*$/i, '').replace(/\[\^\d+\]/g, '').trim();
  // A one-row table (the usual shape of a row's result) reads as «Header: value» pairs.
  const lines = clean.split('\n');
  const at = lines.findIndex((line, index) => /^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '') && /^\s*\|.*\|\s*$/.test(lines[index + 2] ?? ''));
  if (at >= 0 && !/^\s*\|.*\|\s*$/.test(lines[at + 3] ?? '')) {
    const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => markdownToText(cell.trim()));
    const head = cells(lines[at]); const row = cells(lines[at + 2]);
    const pairs = head.map((name, index) => row[index] ? `${name}: ${row[index]}` : '').filter(Boolean).join(' · ');
    const rest = markdownToText([...lines.slice(0, at), ...lines.slice(at + 3)].join('\n')).replace(/\s*\n+\s*/g, ' ').trim();
    return `${pairs}${rest ? ` · ${rest}` : ''}`.replace(/\|/g, '/');
  }
  return markdownToText(clean).replace(/\s*\n+\s*/g, ' · ').replace(/(^|· )(?:[-*•]|\d+[.)])\s+/g, '$1').replace(/\|/g, '/').trim();
}

/** Text cut at a word with «…» (13 Nov 2026: «…needs for a 35–pe» was cut mid-word in the chat's table). */
export const clipAtWord = (text: string, max: number) => { if (text.length <= max) return text; const cut = text.slice(0, max); const at = cut.lastIndexOf(' '); return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s·,;:–-]+$/, '')}…`; };

/** The results as a chat answer: one row per table row, the key and the first lines of its result. */
export function batchSummary(task: string, label: string, runs: RowRun[]): string {
  const done = runs.filter(row => row.status === 'done').length;
  const lines = runs.map(row => `| ${row.n ?? row.index + 2} | ${row.key.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ')} | ${row.status === 'done' ? clipAtWord(cellOf(row.answer ?? ''), 500) : 'Not finished'} |`);
  return `**Every row of ${label}:** ${done} of ${runs.length} done.\n\n| Row | Name | Result |\n| --- | --- | --- |\n${lines.join('\n')}\n\nThe full answer for each row is in the panel and in the Excel file.`;
}
