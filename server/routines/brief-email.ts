// The routine brief as an e-mail (11 Nov 2026): react-email (@react-email/components 1.0.12, MIT) lays it out so it
// reads the same in Gmail, Outlook and Apple Mail. The brief's body is our own Markdown → HTML (server/inbound/email.ts),
// which escapes everything, so a message the agent read cannot put its own HTML into the e-mail. No tracking pixel,
// no remote image. Written with createElement: the server tests run without a JSX step.
import { createElement as h } from 'react';
import { Body, Container, Head, Hr, Html, Preview, Section, Text, render } from '@react-email/components';
import { PRODUCT_NAME } from '../../shared/product.ts';
import { simpleHtml } from '../inbound/email.ts';

const INK = '#1d1d2b', MUTED = '#6b6878', BRAND = '#7352E8', LINE = '#ece9f6';
const font = 'Inter, -apple-system, Segoe UI, Arial, sans-serif';

/** The body of our Markdown → HTML, with e-mail-safe inline styles on its headings and lists. */
export function briefBodyHtml(markdown: string): string {
  const html = simpleHtml(markdown);
  const inner = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  return inner
    .replace(/<h([2-4]) style="margin:18px 0 6px">/g, (_, n) => `<h${n} style="margin:22px 0 8px;font-family:${font};font-size:${n === '2' ? 16 : 15}px;line-height:1.3;font-weight:650;color:${INK};letter-spacing:-0.01em">`)
    .replace(/<(ul|ol)>/g, (_, tag) => `<${tag} style="margin:0 0 12px;padding-left:20px">`)
    .replace(/<li>/g, '<li style="margin:0 0 6px">')
    .replace(/<hr>/g, `<hr style="border:0;border-top:1px solid ${LINE};margin:18px 0">`);
}

/** The first real line of the brief, as the inbox preview. */
export const previewLine = (markdown: string) => (markdown.split('\n').map(line => line.replace(/^[#>*\-\d.)\s]+/, '').replace(/[*_`]/g, '').trim()).find(line => line.length > 12) ?? '').slice(0, 140);

export async function briefEmailHtml(input: { routineName: string; day: string; answer: string; footer: string }): Promise<string> {
  const email = h(Html, { lang: 'en' },
    h(Head, null),
    h(Preview, null, previewLine(input.answer)),
    h(Body, { style: { margin: 0, padding: '24px 12px', backgroundColor: '#f6f5fb', fontFamily: font } },
      h(Container, { style: { maxWidth: '600px', margin: '0 auto' } },
        h(Section, { style: { padding: '0 4px 14px' } },
          h(Text, { style: { margin: 0, fontSize: '13px', lineHeight: '20px', color: MUTED } },
            h('span', { style: { display: 'inline-block', width: '22px', height: '22px', lineHeight: '22px', borderRadius: '6px', backgroundColor: BRAND, color: '#ffffff', textAlign: 'center', fontWeight: 700, fontSize: '12px', marginRight: '8px', verticalAlign: 'middle' } }, 'A'),
            h('span', { style: { verticalAlign: 'middle', fontWeight: 600, color: INK } }, PRODUCT_NAME),
            h('span', { style: { verticalAlign: 'middle' } }, ` · ${input.day}`))),
        h(Section, { style: { backgroundColor: '#ffffff', border: `1px solid ${LINE}`, borderRadius: '16px', padding: '26px 28px' } },
          h(Text, { style: { margin: '0 0 4px', fontSize: '12px', lineHeight: '16px', letterSpacing: '0.08em', textTransform: 'uppercase', color: BRAND, fontWeight: 600 } }, 'Your brief'),
          h(Text, { style: { margin: '0 0 6px', fontSize: '22px', lineHeight: '28px', fontWeight: 650, color: INK, letterSpacing: '-0.02em' } }, input.routineName),
          h('div', { style: { fontSize: '15px', lineHeight: '1.55', color: INK }, dangerouslySetInnerHTML: { __html: briefBodyHtml(input.answer) } })),
        h(Hr, { style: { border: 0, margin: '18px 0 10px' } }),
        h(Text, { style: { margin: '0 4px', fontSize: '12px', lineHeight: '18px', color: MUTED } }, input.footer))));
  return render(email);
}
