// Brief lines that point at one e-mail (12 Nov 2026, his «press and open the emails in the right panel»).
// list_mail gives every message a short ref («m3»); the brief ends a line about a message with «[m3]»; the server takes
// the refs out of the text and keeps, per line, which message it was about. The text people read never shows a ref.
import type { ConnectorId } from './connections.ts';

export type MailLink = { text: string; service: ConnectorId; id: string; from: string; subject: string; date: string };
export type MailRefTarget = { service: ConnectorId; id: string; from: string; subject: string; date: string };

const REF = /[ \t]*\[(m\d{1,3})\]/g;
/** A line's words without its list mark and refs, for matching a «Needs you» item to its link. */
export const lineKey = (line: string) => line.replace(REF, '').replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').replace(/\s+/g, ' ').trim();
export const withoutMailRefs = (text: string) => text.replace(REF, '');

export function takeMailRefs(answer: string, refs: Map<string, MailRefTarget>): { answer: string; links: MailLink[] } {
  const links: MailLink[] = [];
  // A line that was only a ref (12 Nov 2026: «… below:» and then nothing) gets the e-mail's subject and sender in words.
  const lines = answer.split('\n').map(line => {
    const ref = [...line.matchAll(REF)].map(match => refs.get(match[1])).find(Boolean);
    if (!ref || lineKey(line).replace(/^(?:\d+[.)]|[-*•])$/, '')) return line;
    return `${line.match(/^\s*(?:\d+[.)]|[-*•])?\s*/)?.[0] ?? ''}«${ref.subject || 'no subject'}» from ${ref.from || 'an unknown sender'}${line.match(REF)?.join('') ?? ''}`;
  });
  for (const line of lines) {
    const ref = [...line.matchAll(REF)].map(match => refs.get(match[1])).find(Boolean);
    const text = lineKey(line);
    if (ref && text && links.length < 40) links.push({ text: text.slice(0, 600), ...ref });
  }
  return { answer: withoutMailRefs(lines.join('\n')), links };
}
