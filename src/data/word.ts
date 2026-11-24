// An agent's answer as a Word file: its headings, bold words, lists and tables, in plain Word styling so it opens
// cleanly anywhere. Links keep their words and add the address in brackets.
import { buildZip } from '../../shared/zip-writer.ts';

const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Runs for one line: **bold**, *italic*, ***both*** and `code` (nested too), Markdown links as «words (address)».
 *  A marker without its pair stays as text. */
function runs(line: string, base = ''): string {
  const text = line.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
  const parts = text.split(/(\*\*\*|\*\*|\*|`)/g).filter(part => part !== '');
  const markers = ['***', '**', '*', '`'];
  // Each marker's last occurrence is plain text when that marker appears an odd number of times.
  const literal = new Set<number>();
  for (const marker of markers) {
    const at = parts.flatMap((part, index) => part === marker ? [index] : []);
    if (at.length % 2) literal.add(at.at(-1)!);
  }
  let bold = false; let italic = false; let code = false; const out: string[] = [];
  parts.forEach((part, index) => {
    if (markers.includes(part) && !literal.has(index) && (!code || part === '`')) {
      if (part === '***') { bold = !bold; italic = !italic; } else if (part === '**') bold = !bold; else if (part === '*') italic = !italic; else code = !code;
      return;
    }
    out.push(`<w:r><w:rPr>${base}${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(part)}</w:t></w:r>`);
  });
  return out.join('');
}
/** A table row's cells; «\|» is a pipe inside a cell, not a border. */
const rowCells = (line: string) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(value => value.replace(/\\\|/g, '|'));
const cell = (text: string, header: boolean) => `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/></w:tcBorders></w:tcPr><w:p>${runs(text.trim(), header ? '<w:b/>' : '')}</w:p></w:tc>`;

export function agentAnswerWord(title: string, markdown: string): Uint8Array {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const body: string[] = [`<w:p><w:pPr><w:spacing w:after="200"/></w:pPr>${runs(title, '<w:b/><w:sz w:val="32"/>')}</w:p>`];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        const cells = rowCells(lines[index]);
        if (!cells.every(value => /^\s*:?-{2,}:?\s*$/.test(value))) rows.push(cells);
        index++;
      }
      index--;
      // Every row as wide as the header: short rows padded, extra cells joined into the last one.
      const width = rows[0]?.length ?? 0;
      const even = rows.map(row => row.length > width ? [...row.slice(0, width - 1), row.slice(width - 1).join(' | ')] : [...row, ...Array(width - row.length).fill('')]);
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>${even.map((row, r) => `<w:tr>${row.map(value => cell(value, r === 0)).join('')}</w:tr>`).join('')}</w:tbl><w:p/>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { body.push(`<w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>${runs(heading[2].replace(/\s+#+\s*$/, ''), `<w:b/><w:sz w:val="${[30, 26, 24, 22, 22, 22][heading[1].length - 1]}"/>`)}</w:p>`); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { body.push('<w:p/>'); continue; }
    if (/^\s*```/.test(line)) continue;
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { body.push(`<w:p><w:pPr><w:ind w:left="360"/></w:pPr>${runs(quote[1], '<w:i/>')}</w:p>`); continue; }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) { body.push(`<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>${runs(`• ${bullet[1]}`)}</w:p>`); continue; }
    const numbered = /^\s*(\d+[.)])\s+(.*)$/.exec(line);
    if (numbered) { body.push(`<w:p><w:pPr><w:ind w:left="360" w:hanging="300"/></w:pPr>${runs(`${numbered[1]} ${numbered[2]}`)}</w:p>`); continue; }
    body.push(line.trim() ? `<w:p>${runs(line)}</w:p>` : '<w:p/>');
  }
  const parts: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
  };
  const encoder = new TextEncoder();
  return buildZip(Object.entries(parts).map(([name, value]) => ({ name, data: encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value) })));
}
