// Checks of the Office exports: branded Word, Excel and PowerPoint from an answer, and Word with tracked changes
// for contract edits. Each file is read back from its zip: parts present, XML well formed (python3 when installed),
// content types and relationships complete, then what each format must hold. LibreOffice, when installed, opens
// each file as a last check. Run: node --experimental-transform-types tests/office.mjs (no network, no key).
// OFFICE_KEEP=<folder> keeps the generated files there to open by hand.
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from '../shared/zip-writer.ts';
import { readNumber, parseBlocks, parseInline } from '../src/data/office/blocks.ts';
import { answerDocx } from '../src/data/office/docx.ts';
import { answerXlsx, sheetNames } from '../src/data/office/xlsx.ts';
import { answerPptx } from '../src/data/office/pptx.ts';
import { parseEdits, redlineDocx } from '../src/data/office/redline.ts';

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('ok  ', name); } catch (error) { console.log('FAIL', name); console.log('     ', error.message); process.exitCode = 1; } };
const notes = [];

// A real PNG (two colours, 120 × 40) built here: signature, IHDR, IDAT (zlib), IEND.
function png(width, height) {
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const at = y * (width * 3 + 1) + 1 + x * 3; const dark = x < height; raw[at] = dark ? 0x4b : 0xd9; raw[at + 1] = dark ? 0x2e : 0xcf; raw[at + 2] = dark ? 0x83 : 0xee; }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const BRAND = { name: 'Halida & Partners LLC', address: '12 Example Street\n1066 Nicosia, Cyprus', footer: 'Confidential · prepared for the client', color: '#4B2E83', logo: { bytes: png(120, 40), type: 'png', width: 120, height: 40 } };
const ACCENT = '4B2E83';
const DATE = new Date('2026-11-07T10:30:00Z');

// A stored-entry zip reader: the central directory, each local header, the CRC of every entry.
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22; while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'no end of central directory');
  const count = view.getUint16(end + 10, true); let at = view.getUint32(end + 16, true);
  const files = new Map(); const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let n = 0; n < count; n++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central directory entry');
    const method = view.getUint16(at + 10, true); const crc = view.getUint32(at + 16, true); const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true); const extra = view.getUint16(at + 30, true); const comment = view.getUint16(at + 32, true); const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, `${name}: local header`);
    assert.equal(method, 0, `${name} is not stored`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    assert.ok(!files.has(name), `duplicate entry ${name}`);
    files.set(name, data);
    at += 46 + nameLength + extra + comment;
  }
  return files;
}
const text = (files, name) => { assert.ok(files.has(name), `missing part ${name}`); return new TextDecoder().decode(files.get(name)); };
const unxml = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function resolve(dir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dir ? dir.replace(/\/$/, '').split('/') : [];
  for (const piece of target.split('/')) { if (piece === '..') parts.pop(); else if (piece !== '.') parts.push(piece); }
  return parts.join('/');
}

const PYTHON = spawnSync('python3', ['-c', 'import xml.dom.minidom'], { encoding: 'utf8' }).status === 0;
/** Every .xml and .rels part of one package (or several) parsed by a namespace-aware XML parser (expat, minidom). */
function wellFormed(packages) {
  if (!PYTHON) return 'skipped (no python3)';
  const dir = mkdtempSync(join(tmpdir(), 'office-xml-'));
  try {
    (Array.isArray(packages) ? packages : [packages]).forEach((files, index) => { for (const [name, data] of files) if (/\.(xml|rels)$/.test(name)) writeFileSync(join(dir, `${index}-${encodeURIComponent(name)}`), data); });
    const script = 'import sys, os\nfrom xml.dom import minidom\nfor n in sorted(os.listdir(sys.argv[1])):\n  try: minidom.parse(os.path.join(sys.argv[1], n))\n  except Exception as e: print(n, e)\n';
    const result = spawnSync('python3', ['-I', '-c', script, dir], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '', `badly formed XML:\n${decodeURIComponent(result.stdout)}`);
    return 'checked';
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
/** Content types for every part, relationships to parts that exist, every r:id and r:embed declared. */
function checkPackage(files, main) {
  const types = text(files, '[Content_Types].xml');
  const defaults = new Set([...types.matchAll(/<Default Extension="([^"]+)"/g)].map(m => m[1].toLowerCase()));
  const overrides = new Set([...types.matchAll(/<Override PartName="([^"]+)"/g)].map(m => m[1]));
  for (const name of files.keys()) {
    if (name === '[Content_Types].xml' || name.endsWith('.rels')) continue;
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'xml') assert.ok(overrides.has(`/${name}`), `no content type for ${name}`);
    else assert.ok(defaults.has(ext) || overrides.has(`/${name}`), `no content type for ${name}`);
  }
  for (const part of overrides) assert.ok(files.has(part.slice(1)), `content type for a missing part ${part}`);
  const rootRels = text(files, '_rels/.rels');
  assert.ok(rootRels.includes(`Target="${main}"`), `root relationship to ${main}`);
  const relsOf = new Map();
  for (const [name, data] of files) {
    if (!name.endsWith('.rels')) continue;
    const dir = name.replace(/_rels\/[^/]*\.rels$/, '');
    const source = name.replace(/_rels\/([^/]*)\.rels$/, '$1');
    if (source) assert.ok(files.has(source), `${name} belongs to no part`);
    const ids = new Set();
    for (const match of new TextDecoder().decode(data).matchAll(/<Relationship ([^>]*)\/>/g)) {
      const attr = key => { const m = new RegExp(`\\b${key}="([^"]*)"`).exec(match[1]); return m ? unxml(m[1]) : undefined; };
      const id = attr('Id'); assert.ok(id && !ids.has(id), `${name}: duplicate or empty Id ${id}`); ids.add(id);
      if (attr('TargetMode') === 'External') { assert.match(attr('Target'), /^(https?:\/\/|mailto:)/, `${name}: odd external target`); assert.doesNotMatch(attr('Target'), /\s/); continue; }
      const target = resolve(dir, attr('Target'));
      assert.ok(files.has(target), `${name} points to a missing part ${target}`);
    }
    relsOf.set(source, ids);
  }
  for (const [name, data] of files) {
    if (!name.endsWith('.xml') || name === '[Content_Types].xml') continue;
    const used = [...new TextDecoder().decode(data).matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)].map(m => m[1]);
    for (const id of used) assert.ok(relsOf.get(name)?.has(id), `${name} uses ${id} without a relationship`);
  }
}
/** All the readable text of a package's XML parts. */
const allText = files => [...files].filter(([name]) => /\.(xml|rels)$/.test(name)).map(([, data]) => new TextDecoder().decode(data)).join('\n');

const SAMPLE = `# Lease review

**Summary.** The lease is *mostly* standard, but ***three*** clauses need attention [^1]. See the [official register](https://www.example.gov/register?id=12&lang=en) for the filing.\u0001 Bad\uD800 characters go.

## Key findings

- The rent review clause allows **upward-only** reviews.
  - Review every *five* years.
- The break clause needs six months' notice.
- Deposit terms are unclear; see \`clause 4.2\`.

### Next steps

1. Ask the landlord to cap increases.
2. Confirm the break date.
3. Register the lease.

## Costs

| Item | Amount | Share | Note |
|:-----|-------:|------:|------|
| Rent | €1,200.50 | 45% | monthly |
| Deposit | €3,600 | 12.5% | held by \\| agent |
| Service charge | (300) | 3% | credit |
| Total | **€5,100.50** | 60.5% | |

## Costs: Q1/Q2 [draft]?

| Code | Value | Ref |
|---|---|---|
| A-1 | 1.200 | 0042 |
| A-2 | 2.400 | [link](https://example.org/a) |

| Short | Rows |
|---|---|
| x |

> Note: amounts include VAT where it applies.

---

Closing paragraph with a bare link https://example.org/terms.

\`\`\`redline
[{"find": "SECRET-REDLINE-FIND", "replace": "SECRET-REDLINE-REPLACE"}]
\`\`\`

<proofs>[{"id": 1, "quote": "SECRET-PROOF-QUOTE"}]</proofs>
`;
const SOURCES = [{ title: 'Official register', url: 'https://www.example.gov/register?id=12&lang=en' }, { title: 'Not a web address', url: 'javascript:alert(1)' }, { title: 'Twice', url: 'https://www.example.gov/register?id=12&lang=en' }, { title: '', url: 'https://example.org/terms' }];
const keep = process.env.OFFICE_KEEP; if (keep) mkdirSync(keep, { recursive: true });
const outputs = [];
const save = (name, bytes) => { outputs.push([name, bytes]); if (keep) writeFileSync(join(keep, name), bytes); };

// The shared reading.
await test('blocks: headings, nested bullets, numbered runs, tables with escaped pipes, padding and alignment', () => {
  const blocks = parseBlocks(SAMPLE);
  const kinds = blocks.map(block => block.type);
  assert.deepEqual(kinds.slice(0, 4), ['heading', 'paragraph', 'heading', 'bullet']);
  assert.ok(blocks.some(block => block.type === 'bullet' && block.level === 1));
  const numbered = blocks.filter(block => block.type === 'numbered');
  assert.deepEqual(numbered.map(block => block.number), [1, 2, 3]);
  assert.equal(new Set(numbered.map(block => block.list)).size, 1);
  const tables = blocks.filter(block => block.type === 'table');
  assert.equal(tables.length, 3);
  assert.equal(tables[0].rows[1][3][0].text, 'held by | agent');
  assert.deepEqual(tables[0].align, ['left', 'right', 'right', null]);
  assert.equal(tables[2].rows[0].length, 2, 'a short row is padded');
  assert.ok(!kinds.includes('code'), 'the redline block is not content');
  const all = JSON.stringify(blocks);
  for (const secret of ['SECRET-', '[^1]', 'proofs']) assert.ok(!all.includes(secret), `${secret} leaked into the blocks`);
});
await test('blocks: inline bold, italic, both, code, links; a lone marker stays text', () => {
  const runs = parseInline('a **b** *c* ***d*** `e*f` [g](https://x.org/h_(i)) 5 * 3 * 2 snake_case_name');
  assert.deepEqual(runs.find(r => r.text === 'b'), { text: 'b', bold: true });
  assert.deepEqual(runs.find(r => r.text === 'c'), { text: 'c', italic: true });
  assert.deepEqual(runs.find(r => r.text === 'd'), { text: 'd', bold: true, italic: true });
  assert.deepEqual(runs.find(r => r.text === 'e*f'), { text: 'e*f', code: true });
  assert.deepEqual(runs.find(r => r.text === 'g'), { text: 'g', link: 'https://x.org/h_(i)' });
  assert.ok(runs.map(r => r.text).join('').endsWith(' 5 * 3 * 2 snake_case_name'));
});
await test('numbers: thousand marks, currency, percent, brackets; ambiguous and leading-zero values stay text', () => {
  assert.deepEqual(readNumber('€1,200.50'), { value: 1200.5, format: '"€"#,##0.00', decimals: 2 });
  assert.equal(readNumber('(300)').value, -300);
  assert.equal(readNumber('12.5%').value, 0.125);
  assert.equal(readNumber('1.200,50').value, 1200.5);
  assert.equal(readNumber('1,200').value, 1200);
  assert.equal(readNumber('1.200'), null, '1.200 is 1.2 or 1200');
  assert.equal(readNumber('1.200', 'eu').value, 1200);
  assert.equal(readNumber('0042'), null);
  assert.equal(readNumber('5 days'), null);
  assert.equal(readNumber('2026').format, 'General');
});

// Word.
await test('docx: branded answer is a complete, well-formed package with styles, numbering, letterhead and footer', () => {
  const bytes = answerDocx({ title: 'Lease review', markdown: SAMPLE, brand: BRAND, sources: SOURCES, date: DATE });
  save('answer-branded.docx', bytes);
  const files = unzip(bytes);
  for (const part of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/settings.xml', 'word/fontTable.xml', 'word/header1.xml', 'word/footer1.xml', 'word/_rels/header1.xml.rels', 'word/media/logo.png', 'docProps/core.xml', 'docProps/app.xml']) assert.ok(files.has(part), `missing ${part}`);
  checkPackage(files, 'word/document.xml');
  notes.push(`XML well-formedness: ${wellFormed(files)}`);
  const doc = text(files, 'word/document.xml'); const styles = text(files, 'word/styles.xml');
  assert.match(styles, /w:styleId="Heading1"[\s\S]*?<w:color w:val="4B2E83"\/>/, 'Heading 1 in the accent colour');
  assert.match(styles, /w:styleId="Normal"/); assert.match(styles, /w:styleId="Title"/); assert.match(styles, /w:styleId="TableGrid"/);
  assert.match(styles, /w:ascii="Arial"/); assert.match(text(files, 'word/fontTable.xml'), /<w:altName w:val="Calibri"\/>/);
  assert.match(doc, /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">Lease review<\/w:t>/);
  assert.equal((doc.match(/>Lease review</g) ?? []).length, 1, 'the opening H1 equal to the title is not repeated');
  assert.match(doc, /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="1"\/><\/w:numPr>/, 'a nested bullet');
  assert.match(text(files, 'word/numbering.xml'), /<w:startOverride w:val="1"\/>/);
  assert.match(doc, new RegExp(`<w:shd w:val="clear" w:color="auto" w:fill="${ACCENT}"/>`), 'header row on the accent');
  assert.match(doc, /<w:tblHeader\/>/);
  assert.match(doc, /<w:b\/><w:bCs\/><w:color w:val="FFFFFF"\/>/, 'white bold header text');
  assert.ok((doc.match(/<w:hyperlink r:id=/g) ?? []).length >= 4, 'links in the text and the sources');
  const rels = text(files, 'word/_rels/document.xml.rels');
  assert.ok(rels.includes('Target="https://www.example.gov/register?id=12&amp;lang=en" TargetMode="External"'));
  assert.ok(!rels.includes('javascript'), 'only web addresses become links');
  assert.equal((rels.match(/register\?id=12/g) ?? []).length, 1, 'one relationship per address');
  assert.match(doc, />Sources</);
  const header = text(files, 'word/header1.xml');
  assert.match(header, /<w:drawing>/); assert.match(header, /Halida &amp; Partners LLC/); assert.match(header, /1066 Nicosia, Cyprus/);
  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(header);
  assert.ok(+extent[1] <= 3.5 * 360000 && Math.abs(+extent[1] / +extent[2] - 3) < 0.01, 'logo at most 3.5 cm wide, aspect kept');
  const footer = text(files, 'word/footer1.xml');
  assert.match(footer, / PAGE /); assert.match(footer, / NUMPAGES /); assert.match(footer, /Confidential/);
  assert.match(text(files, 'docProps/core.xml'), /<dc:title>Lease review<\/dc:title>/);
  const everything = allText(files);
  for (const secret of ['SECRET-', '[^1]', '\u0001', 'proofs']) assert.ok(!everything.includes(secret), `${JSON.stringify(secret)} in the file`);
});
await test('docx: without a brand there is no letterhead and the file is still complete', () => {
  const bytes = answerDocx({ title: 'Plain', markdown: SAMPLE, date: DATE });
  save('answer-plain.docx', bytes);
  const files = unzip(bytes);
  assert.ok(!files.has('word/header1.xml'));
  checkPackage(files, 'word/document.xml'); wellFormed(files);
  assert.ok(!text(files, 'word/document.xml').includes('headerReference'));
  assert.match(text(files, 'word/footer1.xml'), / NUMPAGES /);
});

// Excel.
await test('xlsx: one sheet per table, safe unique names, numbers as numbers, frozen bold header on the accent', () => {
  const bytes = answerXlsx({ title: 'Lease review', markdown: SAMPLE, brand: BRAND, date: DATE });
  save('answer.xlsx', bytes);
  const files = unzip(bytes);
  checkPackage(files, 'xl/workbook.xml'); wellFormed(files);
  const workbook = text(files, 'xl/workbook.xml');
  const names = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(m => unxml(m[1]));
  assert.deepEqual(names, ['Costs', 'Costs Q1 Q2 draft', 'Costs Q1 Q2 draft (2)']);
  const sheet = text(files, 'xl/worksheets/sheet1.xml');
  const cell = ref => new RegExp(`<c r="${ref}"[^>]*?(?:/>|>.*?</c>)`).exec(sheet)?.[0] ?? '';
  assert.match(cell('B2'), /^<c r="B2" s="\d+"><v>1200.5<\/v><\/c>$/, 'euro amount is a number');
  assert.match(cell('B3'), /<v>3600<\/v>/); assert.match(cell('B4'), /<v>-300<\/v>/); assert.match(cell('C3'), /<v>0.125<\/v>/);
  assert.match(cell('B5'), /<v>5100.5<\/v>/, 'a bold total is still a number');
  assert.match(cell('A2'), /t="inlineStr"/); assert.match(cell('D3'), /held by \| agent/);
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  const styles = text(files, 'xl/styles.xml');
  assert.match(styles, new RegExp(`<fgColor rgb="FF${ACCENT}"/>`)); assert.match(styles, /<font><b\/><sz val="11"\/><color rgb="FFFFFFFF"\/>/);
  assert.match(styles, /formatCode="&quot;€&quot;#,##0.00"/);
  const xfs = [...styles.matchAll(/<xf [^>]*?(?:\/>|>.*?<\/xf>)/g)].slice(1).map(m => m[0]);
  const headerStyle = +/<c r="A1"[^>]* s="(\d+)"/.exec(sheet)[1];
  assert.match(xfs[headerStyle], /fontId="1" fillId="2"/, 'the header cells use the bold accent style');
  assert.ok(/<cols><col min="1" max="1" width="(\d+(?:\.\d+)?)"/.test(sheet), 'column widths set');
  const second = text(files, 'xl/worksheets/sheet2.xml');
  assert.match(second, /<c r="B2" t="inlineStr"[^>]*><is><t xml:space="preserve">1.200<\/t>/, 'an ambiguous 1.200 stays text');
  assert.match(second, /<c r="C2" t="inlineStr"[^>]*><is><t xml:space="preserve">0042<\/t>/, 'a leading zero stays text');
  assert.match(second, /<hyperlink ref="C3" r:id="rId1"\/>/);
  assert.match(sheet, /<oddHeader>&amp;L&amp;&quot;-,Bold&quot;Halida &amp;&amp; Partners LLC&amp;RLease review<\/oddHeader>/, 'brand in the print header, «&» doubled');
  assert.match(sheet, /<oddFooter>&amp;LConfidential[^<]*&amp;RPage &amp;P of &amp;N<\/oddFooter>/);
  assert.ok(!allText(files).includes('SECRET-'));
});
await test('xlsx: no table, no workbook; sheet names obey Excel rules', () => {
  assert.equal(answerXlsx({ title: 'x', markdown: '# Only text\n\n- a bullet' }), null);
  const names = sheetNames(['', 'History', "'quoted'", 'A'.repeat(40), 'A'.repeat(40), 'a/b\\c*d?e:f[g]h']);
  assert.deepEqual(names, ['Table 1', 'History table', 'quoted', 'A'.repeat(31), `${'A'.repeat(27)} (2)`, 'a b c d e f g h']);
  for (const name of names) { assert.ok(name.length <= 31); assert.doesNotMatch(name, /[[\]:*?/\\]/); }
});

// PowerPoint.
const DECK = `${SAMPLE}

## Many points

${Array.from({ length: 12 }, (_, i) => `- Point number ${i + 1} about the lease terms`).join('\n')}

## Long reasoning

${'The tenant bears the repair costs under clause 7. '.repeat(14)}

## Big table

| # | Party | Amount |
|---|---|---:|
${Array.from({ length: 20 }, (_, i) => `| ${i + 1} | Party ${i + 1} | €${(i + 1) * 1000} |`).join('\n')}
`;
await test('pptx: 16:9 deck with title slide, sections, continued slides, real tables and the logo on every slide', () => {
  const bytes = answerPptx({ title: 'Lease review', markdown: DECK, brand: BRAND, date: DATE });
  save('answer.pptx', bytes);
  const files = unzip(bytes);
  for (const part of ['ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/slideLayout2.xml', 'ppt/theme/theme1.xml', 'ppt/presProps.xml', 'ppt/viewProps.xml', 'ppt/tableStyles.xml', 'docProps/core.xml', 'docProps/app.xml', 'ppt/media/logo.png']) assert.ok(files.has(part), `missing ${part}`);
  checkPackage(files, 'ppt/presentation.xml'); wellFormed(files);
  const presentation = text(files, 'ppt/presentation.xml');
  assert.match(presentation, /<p:sldSz cx="12192000" cy="6858000"\/>/);
  const slideParts = [...files.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal((presentation.match(/<p:sldId /g) ?? []).length, slideParts.length);
  const slides = slideParts.map((_, i) => text(files, `ppt/slides/slide${i + 1}.xml`));
  assert.match(slides[0], /Lease review/); assert.match(slides[0], /Halida &amp; Partners LLC/); assert.match(slides[0], /7 November 2026/);
  const titles = slides.map(slide => unxml(/name="Title 1"[\s\S]*?<a:t>([^<]*)<\/a:t>/.exec(slide)?.[1] ?? ''));
  for (const name of ['Overview', 'Key findings', 'Costs', 'Many points', 'Many points (continued)', 'Long reasoning', 'Big table', 'Big table (continued)']) assert.ok(titles.includes(name), `no slide «${name}» in ${JSON.stringify(titles)}`);
  for (const slide of slides) {
    assert.match(slide, /r:embed="rIdLogo"/, 'logo on every slide');
    const body = /name="Content Placeholder 2"[\s\S]*?<\/p:txBody>/.exec(slide)?.[0];
    if (body) {
      assert.ok((body.match(/<a:p>/g) ?? []).length <= 7, 'at most seven bullets a slide');
      for (const paragraph of body.split('<a:p>').slice(1)) assert.ok([...paragraph.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => unxml(m[1])).join('').length <= 265, 'long paragraphs shortened');
    }
    const rows = (slide.match(/<a:tr /g) ?? []).length;
    if (rows) { assert.ok(rows <= 9, 'at most eight rows plus the header'); assert.match(slide, new RegExp(`<a:solidFill><a:srgbClr val="${ACCENT}"/></a:solidFill></a:tcPr>`)); }
  }
  assert.equal(titles.filter(title => title.startsWith('Big table')).length, 3, 'twenty rows: 8 + 8 + 4 over three slides');
  assert.equal(slides.filter(slide => slide.includes('<a:tbl>') && slide.includes('>Party<')).length, 3, 'the header row repeats on every table slide');
  assert.ok(slides.some(slide => /<a:buAutoNum type="arabicPeriod"/.test(slide)), 'numbered list');
  assert.ok(slides.some(slide => /<a:hlinkClick r:id="rIdLink1"\/>/.test(slide)), 'clickable link');
  const everything = allText(files);
  for (const secret of ['SECRET-', '[^1]', 'proofs']) assert.ok(!everything.includes(secret), `${secret} in the deck`);
});
await test('pptx: without a brand there is no logo and the deck is still complete', () => {
  const bytes = answerPptx({ title: 'Plain', markdown: 'Just one paragraph.', date: DATE });
  save('answer-plain.pptx', bytes);
  const files = unzip(bytes);
  checkPackage(files, 'ppt/presentation.xml'); wellFormed(files);
  assert.ok(![...files.keys()].some(name => name.startsWith('ppt/media/')));
  assert.equal((text(files, 'ppt/presentation.xml').match(/<p:sldId /g) ?? []).length, 2);
});

// Tracked changes.
const ORIGINAL = `SERVICES AGREEMENT

1. The Supplier shall deliver the “Goods” within 30 days of the order.
2. The Buyer shall pay   promptly and in full.
3. Either party may terminate on notice — in writing.`;
const EDITS_ANSWER = `Here are the edits I propose.

\`\`\`redline
[
  {“find”: “within 30 days”, “replace”: “within 60 days”, “note”: “Longer delivery window.”},
  {"find": "the "Goods"", "replace": "the "Products""},
  {"find": "", "replace": "x"},
  {"find": "pay promptly and", "replace": "pay and",},
  {"find": 42, "replace": "x"},
  {"find": "30 days", "replace": "45 days"},
  {"find": "in full.\\n3. Either", "replace": "in full; either"},
  {"find": "on notice - in writing", "replace": "on 30 days' written notice", "note": "Fixed notice period."},
  {"find": "NOT IN THE TEXT", "replace": "anything"},
  {"find": "SERVICES AGREEMENT", "replace": ""},
  {"find": "cut off at the end", "repl`;
await test('parseEdits: smart quotes, inner quotes, trailing commas, a missing closing fence, invalid items dropped', () => {
  const edits = parseEdits(EDITS_ANSWER);
  assert.deepEqual(edits.map(edit => edit.find), ['within 30 days', 'the "Goods"', 'pay promptly and', '30 days', 'in full.\n3. Either', 'on notice - in writing', 'NOT IN THE TEXT', 'SERVICES AGREEMENT']);
  assert.equal(edits[0].note, 'Longer delivery window.');
  assert.equal(edits.at(-1).replace, '', 'replace "" is a deletion');
  assert.deepEqual(parseEdits('```redline\n[{"find":"a","replace":"b"}]\n```\nno other block'), [{ find: 'a', replace: 'b' }]);
  assert.deepEqual(parseEdits('no block at all'), []);
  assert.deepEqual(parseEdits('```redline\nnot json\n```'), []);
});
/** The document's paragraphs with every change accepted, or every change rejected. */
function readBack(doc, accept) {
  const paragraphs = [...doc.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(m => m[1]);
  const out = []; let joinNext = false;
  for (const raw of paragraphs) {
    const markDeleted = /^<w:pPr><w:rPr><w:del /.test(raw);
    let body = raw.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '');
    body = accept ? body.replace(/<w:del\b[^>]*?(?:\/>|>[\s\S]*?<\/w:del>)/g, '') : body.replace(/<w:ins\b[^>]*?(?:\/>|>[\s\S]*?<\/w:ins>)/g, '');
    const value = [...body.matchAll(/<w:(?:t|delText)[^>]*>([^<]*)<\/w:(?:t|delText)>|<w:br\/>/g)].map(m => (m[0] === '<w:br/>' ? '\n' : unxml(m[1]))).join('');
    if (joinNext) out[out.length - 1] += value; else out.push(value);
    joinNext = accept && markDeleted;
  }
  return out;
}
await test('redlineDocx: tracked insertions and deletions, word level, tolerant match, comments, missed edits', () => {
  const edits = parseEdits(EDITS_ANSWER);
  const result = redlineDocx({ title: 'Services agreement — redline', original: ORIGINAL, edits, author: 'Alex Morgan', date: DATE, brand: BRAND });
  save('redline.docx', result.bytes);
  assert.equal(result.applied, 6);
  assert.deepEqual(result.missed.map(edit => edit.find), ['30 days', 'NOT IN THE TEXT'], 'not found, or inside an earlier edit');
  const files = unzip(result.bytes);
  checkPackage(files, 'word/document.xml'); wellFormed(files);
  assert.match(text(files, 'word/settings.xml'), /<w:trackRevisions\/>/);
  const doc = text(files, 'word/document.xml');
  assert.match(doc, /<w:del w:id="\d+" w:author="Alex Morgan" w:date="2026-11-07T10:30:00Z"><w:r><w:delText xml:space="preserve">30<\/w:delText><\/w:r><\/w:del><w:ins w:id="\d+" w:author="Alex Morgan" w:date="2026-11-07T10:30:00Z"><w:r><w:t xml:space="preserve">60<\/w:t>/, 'only the changed word');
  const ids = [...doc.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'revision ids unique');
  assert.match(doc, /<w:pPr><w:rPr><w:del w:id=/, 'a deletion across paragraphs deletes the paragraph mark');
  const comments = text(files, 'word/comments.xml');
  assert.equal((comments.match(/<w:comment /g) ?? []).length, 2);
  assert.match(comments, /Longer delivery window\./); assert.match(comments, /w:initials="MS"/);
  for (const id of [...comments.matchAll(/<w:comment w:id="(\d+)"/g)].map(m => m[1])) {
    assert.ok(!ids.includes(id), 'comment ids apart from revision ids');
    for (const mark of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) assert.match(doc, new RegExp(`<w:${mark} w:id="${id}"/>`));
  }
  assert.deepEqual(readBack(doc, true), ['', '1. The Supplier shall deliver the "Products" within 60 days of the order.', "2. The Buyer shall pay   and in full; either party may terminate on 30 days' written notice."]);
  assert.deepEqual(readBack(doc, false), ORIGINAL.split('\n').filter(line => line.trim()));
  assert.match(text(files, 'word/header1.xml'), /<w:drawing>/);
});
await test('redlineDocx: whole words first, a deletion takes one space with it, notes become comments on the words', () => {
  const result = redlineDocx({ title: 'x', original: 'Payment within 130 days, then within 30 days, strictly and promptly.', edits: [{ find: '30 days', replace: '45 days' }, { find: 'strictly', replace: '' }, { find: 'promptly', replace: 'at once', note: 'Plainer.' }], date: DATE });
  assert.equal(result.applied, 3);
  const files = unzip(result.bytes); wellFormed(files);
  const doc = text(files, 'word/document.xml');
  assert.deepEqual(readBack(doc, true), ['Payment within 130 days, then within 45 days, and at once.']);
  assert.deepEqual(readBack(doc, false), ['Payment within 130 days, then within 30 days, strictly and promptly.']);
  assert.match(doc, /<w:delText xml:space="preserve">strictly <\/w:delText>/);
  assert.match(doc, /<w:commentRangeStart w:id="(\d+)"\/><w:del [^>]*><w:r><w:delText xml:space="preserve">promptly<\/w:delText><\/w:r><\/w:del><w:ins [^>]*><w:r><w:t xml:space="preserve">at once<\/w:t><\/w:r><\/w:ins><w:commentRangeEnd w:id="\1"\/>/);
  assert.match(text(files, 'word/_rels/document.xml.rels'), /comments\.xml/);
});
await test('redlineDocx: no edits and no brand still give a valid document with the original text', () => {
  const result = redlineDocx({ title: 'x', original: 'One line.\n\nTwo <lines> & more.', edits: [] });
  const files = unzip(result.bytes);
  checkPackage(files, 'word/document.xml'); wellFormed(files);
  assert.equal(result.applied, 0); assert.deepEqual(result.missed, []);
  assert.ok(!files.has('word/comments.xml'));
  assert.deepEqual(readBack(text(files, 'word/document.xml'), true), ['One line.', 'Two <lines> & more.']);
});

await test('odd input never breaks a file: empty, emoji, RTL, unclosed markers, deep lists, wide tables, a broken logo', () => {
  const odd = [
    '',
    '   \n\n  ',
    '# 📄 Title with emoji 🇨🇾 and Ελληνικά\n\nمرحبا بالعالم — RTL text. **unclosed bold and `unclosed code and [broken](link\n\n* * *',
    Array.from({ length: 10 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n'),
    `| ${Array.from({ length: 30 }, (_, i) => `C${i}`).join(' | ')} |\n|${'---|'.repeat(30)}\n| ${Array.from({ length: 30 }, (_, i) => i * 1000).join(' | ')} |`,
    '```\nunclosed code block <w:t> & </xml>\n',
    '\u0000\u0007 control \uFFFE characters \uD83D alone',
    'x'.repeat(5000),
    '<proofs>only machine data',
    '```redline\n[{"find":"a","replace":"b"}',
  ];
  const brands = [undefined, { name: '' }, { name: 'X <&> "Y"', color: 'not a colour', logo: { bytes: new Uint8Array([1, 2, 3]), type: 'png', width: 0, height: 10 } }, { name: 'Light', color: '#FFE', footer: 'a\nb' }];
  const all = [];
  const check = (bytes, main) => { const files = unzip(bytes); checkPackage(files, main); all.push(files); };
  for (const markdown of odd) for (const brand of brands) {
    check(answerDocx({ title: markdown.slice(0, 40), markdown, brand, sources: [{ title: '<b>', url: 'https://x.org/a b?c="d"' }] }), 'word/document.xml');
    check(answerPptx({ title: markdown.slice(0, 40), markdown, brand }), 'ppt/presentation.xml');
    const xlsx = answerXlsx({ title: 'x', markdown, brand });
    if (xlsx) check(xlsx, 'xl/workbook.xml');
    check(redlineDocx({ title: markdown.slice(0, 20), original: markdown, edits: parseEdits(markdown).concat([{ find: 'x', replace: '' }, { find: 'level 3', replace: 'level three', note: '<note> & "quote"' }]), brand }).bytes, 'word/document.xml');
  }
  wellFormed(all);
  const light = text(unzip(answerXlsx({ title: 'x', markdown: '| a |\n|---|\n| 1 |', brand: { name: 'L', color: '#FFEE88' } })), 'xl/styles.xml');
  assert.match(light, /<font><b\/><sz val="11"\/><color rgb="FF1A1A1A"\/>/, 'dark header text on a light accent');
});

// LibreOffice, when installed, must open every file (headless conversion to PDF).
const SOFFICE = ['soffice', 'libreoffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].find(bin => spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0);
if (SOFFICE) {
  await test('LibreOffice opens every generated file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-open-'));
    try {
      for (const [name, bytes] of outputs) {
        writeFileSync(join(dir, name), bytes);
        const result = spawnSync(SOFFICE, ['--headless', `-env:UserInstallation=file://${join(dir, 'profile')}`, '--convert-to', 'pdf', '--outdir', dir, join(dir, name)], { encoding: 'utf8', timeout: 120000 });
        assert.ok(existsSync(join(dir, name.replace(/\.\w+$/, '.pdf'))), `${name} did not convert: ${result.stderr || result.stdout}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
} else notes.push('LibreOffice: not installed, the "opens" check was skipped');

for (const note of notes) console.log('note', note);
console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
