// «Proof on every sentence»: reading the proofs, the server's clean-up, finding quotes, counting sentences without
// proof, the marks in rendered HTML, and the passage marked in the official page's frame.
// Run: node --experimental-transform-types tests/proof.mjs (no network, no key).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { marked } from 'marked';
import { isOfficialUrl } from '../shared/official-sources.ts';
import { splitProofs, findQuote, proofStatements, markBody, proofMarksHtml, proofSource, htmlToText, checkQuote, isClaim, isDraftedDocument } from '../src/data/proof.ts';
import { PROOF_RULES, sanitizeProofs } from '../server/proof.ts';
import { officialWebResponse } from '../api/official-web.ts';

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('ok  ', name); } catch (error) { console.log('FAIL', name); console.log('     ', error.message); process.exitCode = 1; } };

const BODY = `## Lease review

The rent is €1,200 a month.[^1] The term is five years from 1 March 2024.[^2]

Under section 5 of the Limitation Act 1980 a claim in contract must be brought within six years.[^3]

We recommend negotiating the break clause before signing.`;
const BLOCK = `<proofs>
[^1]: doc "Lease.pdf" | "The Tenant shall pay a rent of €1,200 per calendar month"
[^2]: ref "Positions.docx" | "a term of five years commencing on 1 March 2024"
[^3]: page https://www.legislation.gov.uk/ukpga/1980/58/section/5 | "An action founded on simple contract shall not be brought after the expiration of six years"
</proofs>`;
const FULL = `${BODY}\n\n${BLOCK}`;

await test('reading: a full answer gives the body without the block and every proof with its kind, name and words', () => {
  const { body, marks } = splitProofs(FULL);
  assert.equal(body, BODY);
  assert.deepEqual(marks.map(mark => [mark.n, mark.kind, mark.target]), [[1, 'doc', 'Lease.pdf'], [2, 'ref', 'Positions.docx'], [3, 'page', 'https://www.legislation.gov.uk/ukpga/1980/58/section/5']]);
  assert.equal(marks[2].quote, 'An action founded on simple contract shall not be brought after the expiration of six years');
});
await test('reading: the rules\' own example is read back as three proofs', () => {
  const { marks } = splitProofs(PROOF_RULES.slice(PROOF_RULES.indexOf('<proofs>')));
  assert.deepEqual(marks.map(mark => mark.kind), ['doc', 'ref', 'page']);
});
await test('reading while streaming: nothing of the block ever shows in the body, from «<» to the last character', () => {
  const start = FULL.indexOf('<proofs>');
  for (let cut = start; cut <= FULL.length; cut++) assert.equal(splitProofs(FULL.slice(0, cut)).body, BODY, `cut at ${cut}: ${JSON.stringify(FULL.slice(start, cut))}`);
  // Before the block: a half-written mark is not shown either.
  assert.equal(splitProofs('The rent is €1,200 a month.[^').body, 'The rent is €1,200 a month.');
  assert.equal(splitProofs('The rent is €1,200 a month.[^1').body, 'The rent is €1,200 a month.');
  // A quote still arriving is read as far as it goes.
  const half = splitProofs(`${BODY}\n\n<proofs>\n[^1]: doc "Lease.pdf" | "The Tenant shall pay a ren`);
  assert.equal(half.marks.length, 1); assert.equal(half.marks[0].quote, 'The Tenant shall pay a ren');
});
await test('reading: tolerant of how a model may write it', () => {
  const { body, marks } = splitProofs(`Text.[^1][^2][^3][^4][^5][^6]

\`\`\`
<proofs>
[^1] : document 'Owner's lease.pdf' – 'the landlord may enter the premises at reasonable times'
- [^2]: “Positions.docx” | “we never accept a cap below twelve months of fees”.
[^3]: https://www.legislation.gov.uk/ukpga/1980/58?utm_source=openai | "six years from the date on which the cause of action accrued"
[^4]: Lease.pdf | the tenant shall keep the premises in good repair
[^5]: page [Limitation Act 1980](https://www.legislation.gov.uk/ukpga/1980/58) | "An action founded on tort shall not be brought
after the expiration of six years"
[^1]: doc "Other.pdf" | "a second line for the same number is ignored"
[^6]: "the words only, with no name of the source at all here"
</proofs>
\`\`\``, { reference: ['Positions.docx'], documents: ["Owner's lease.pdf", 'Lease.pdf'] });
  assert.equal(body, 'Text.[^1][^2][^3][^4][^5][^6]');
  const by = Object.fromEntries(marks.map(mark => [mark.n, mark]));
  assert.deepEqual([by[1].kind, by[1].target, by[1].quote], ['doc', "Owner's lease.pdf", 'the landlord may enter the premises at reasonable times']);
  assert.deepEqual([by[2].kind, by[2].target, by[2].quote], ['ref', 'Positions.docx', 'we never accept a cap below twelve months of fees']);
  assert.equal(by[3].kind, 'page'); assert.ok(by[3].target.startsWith('https://www.legislation.gov.uk/ukpga/1980/58'));
  assert.deepEqual([by[4].kind, by[4].target, by[4].quote], ['doc', 'Lease.pdf', 'the tenant shall keep the premises in good repair']);
  assert.deepEqual([by[5].kind, by[5].target], ['page', 'https://www.legislation.gov.uk/ukpga/1980/58']);
  assert.equal(by[5].quote, 'An action founded on tort shall not be brought after the expiration of six years', 'a quote that ran on to the next line');
  assert.deepEqual([by[6].target, by[6].quote], ['', 'the words only, with no name of the source at all here']);
  assert.equal(marks.length, 6, 'a duplicate number keeps its first line');
});
await test('reading: footnote-style proofs without a block, and a «Proofs» heading before them', () => {
  const { body, marks } = splitProofs('The rent is €1,200.[^1]\n\n**Proofs**\n\n[^1]: doc "Lease.pdf" | "a rent of €1,200 per calendar month"\n');
  assert.equal(body, 'The rent is €1,200.[^1]');
  assert.deepEqual(marks.map(mark => [mark.n, mark.kind, mark.quote]), [[1, 'doc', 'a rent of €1,200 per calendar month']]);
});
await test('proofSource: the file a proof names, by exact name, case and accents, or without its extension', () => {
  const files = [{ name: 'Μίσθωση Γραφείου.pdf' }, { name: 'Lease.docx' }];
  assert.equal(proofSource('μισθωση γραφειου.pdf', files)?.name, 'Μίσθωση Γραφείου.pdf');
  assert.equal(proofSource('Lease', files)?.name, 'Lease.docx');
  assert.equal(proofSource('Other.pdf', files), undefined);
});

await test('sanitizeProofs: a page outside the place is dropped, doc and ref kept, marks renumbered, quotes capped', () => {
  const long = `${'word '.repeat(120)}end`;
  const answer = `Rent is €1,200.[^2] A blog says so.[^5] Six years apply.[^7] The term is five years.[^9] Unproved.[^11]

<proofs>
[^2]: doc "Lease.pdf" | "The Tenant shall pay a rent of €1,200 per calendar month"
[^5]: page https://en.wikipedia.org/wiki/Limitation_Act_1980 | "six years for contract claims under the act"
[^7]: page https://www.legislation.gov.uk/ukpga/1980/58/section/5?utm_source=openai | "${long}"
[^9]: ref "Positions.docx" | "a term of five years commencing on 1 March 2024"
[^11]: doc "Lease.pdf" | ""
</proofs>`;
  const clean = sanitizeProofs(answer, url => isOfficialUrl('ew', url));
  const { body, marks } = splitProofs(clean);
  assert.equal(body, 'Rent is €1,200.[^1] A blog says so. Six years apply.[^2] The term is five years.[^3] Unproved.');
  assert.deepEqual(marks.map(mark => [mark.n, mark.kind, mark.target]), [[1, 'doc', 'Lease.pdf'], [2, 'page', 'https://www.legislation.gov.uk/ukpga/1980/58/section/5'], [3, 'ref', 'Positions.docx']]);
  assert.ok(marks[1].quote.length <= 400 && marks[1].quote.startsWith('word word'));
  assert.ok(!clean.includes('wikipedia') && !clean.includes('utm_'));
  // Normalised once, it stays the same.
  assert.equal(sanitizeProofs(clean, url => isOfficialUrl('ew', url)), clean);
  // Without official search no page is proof; with no proof left there is no block.
  assert.equal(sanitizeProofs('A blog says so.[^1]\n<proofs>\n[^1]: page https://www.legislation.gov.uk/ukpga/1980/58 | "six years"\n</proofs>', () => false), 'A blog says so.');
});
await test('sanitizeProofs: at most 120 proofs', () => {
  const many = Array.from({ length: 130 }, (_, i) => `Fact ${i + 1}.[^${i + 1}]`).join(' ');
  const block = Array.from({ length: 130 }, (_, i) => `[^${i + 1}]: doc "Lease.pdf" | "clause ${i + 1} of the lease says exactly this"`).join('\n');
  const { body, marks } = splitProofs(sanitizeProofs(`${many}\n<proofs>\n${block}\n</proofs>`, () => true));
  assert.equal(marks.length, 120); assert.equal(marks.at(-1).n, 120);
  assert.ok(body.includes('Fact 120.[^120]') && body.includes('Fact 121.') && !body.includes('[^121]'));
});

await test('findQuote: exact once folded, with offsets into the original text', () => {
  const text = 'Recitals.\nThe Tenant shall pay   a rent of\n€1,200 per calendar month, in advance.';
  const hit = findQuote(text, 'the tenant shall pay a rent of €1,200 per calendar month');
  assert.ok(hit?.exact); assert.equal(text.slice(hit.start, hit.end), 'The Tenant shall pay   a rent of\n€1,200 per calendar month');
  // Curly quotes, dashes, a ligature and the quote's own end punctuation.
  const typed = 'the “Premises” — as defined in clause 1 — include the ﬁxtures; and';
  const second = findQuote(typed, '"the \'Premises\' - as defined in clause 1 - include the fixtures."'.replace(/'/g, '"'));
  assert.ok(second?.exact); assert.equal(typed.slice(second.start, second.end), 'the “Premises” — as defined in clause 1 — include the ﬁxtures');
});
await test('findQuote: Greek with accents, capitals, final sigma and decomposed accents', () => {
  const greek = 'Άρθρο 3. Ο ΜΙΣΘΩΤΉΣ υποχρεούται να καταβάλλει το μίσθωμα έως την πέμπτη ημέρα κάθε μήνος.';
  const hit = findQuote(greek, 'ο μισθωτης υποχρεουται να καταβαλλει το μισθωμα εως την πεμπτη ημερα καθε μηνος');
  assert.ok(hit?.exact); assert.equal(greek.slice(hit.start, hit.end), 'Ο ΜΙΣΘΩΤΉΣ υποχρεούται να καταβάλλει το μίσθωμα έως την πέμπτη ημέρα κάθε μήνος');
  const decomposed = `Πρόλογος. ${'Η σύμβαση λύεται με έγγραφη καταγγελία'.normalize('NFD')} τριών μηνών.`;
  const again = findQuote(decomposed, 'Η σύμβαση λύεται με έγγραφη καταγγελία');
  assert.ok(again?.exact); assert.equal(decomposed.slice(again.start, again.end), 'Η σύμβαση λύεται με έγγραφη καταγγελία'.normalize('NFD'));
});
await test('findQuote: a nearly-exact quote is found as close; an absent or too-short one is not', () => {
  const text = 'Section 5. An action founded on simple contract shall not be brought after the expiration of six years from the date on which the cause of action accrued. Section 6 follows.';
  const close = findQuote(text, 'An action based on simple contract shall not be brought after expiry of six years from the date on which the cause of action accrued');
  assert.ok(close && close.exact === false);
  assert.ok(text.slice(close.start, close.end).startsWith('An action') && text.slice(close.start, close.end).endsWith('accrued'));
  assert.equal(findQuote(text, 'The landlord may terminate the lease at any time by giving notice in writing'), null);
  assert.equal(findQuote(text, 'seven years accrued'), null);
  assert.equal(checkQuote(text, 'shall not be brought after the expiration of six years'), 'checked');
  assert.equal(checkQuote(undefined, 'anything'), 'pending'); assert.equal(checkQuote(null, 'anything'), 'missing');
});
await test('findQuote: 120 quotes against a 400,000-character document in under a second', () => {
  let seed = 7; const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const vocabulary = Array.from({ length: 4000 }, (_, i) => `w${i.toString(36)}${'aeiou'[i % 5]}`);
  const parts = []; let size = 0;
  while (size < 400_000) { const word = random() < 0.15 ? 'the' : vocabulary[Math.floor(random() * random() * vocabulary.length)]; parts.push(word); size += word.length + 1; }
  const text = parts.join(' ').slice(0, 400_000); const words = text.split(' ');
  const quotes = [];
  for (let i = 0; i < 120; i++) {
    const at = Math.floor(random() * (words.length - 40)); const piece = words.slice(at, at + 20);
    if (i % 4 === 1) piece[7] = 'changed';
    if (i % 4 === 2) piece.splice(11, 1);
    quotes.push({ kind: i % 4 === 3 ? 'absent' : i % 4 === 0 ? 'exact' : 'close', text: i % 4 === 3 ? Array.from({ length: 20 }, (_, k) => `zz${i}x${k}`).join(' ') : piece.join(' ') });
  }
  const started = performance.now();
  const results = quotes.map(quote => findQuote(text, quote.text));
  const took = performance.now() - started;
  assert.ok(took < 1_000, `${Math.round(took)} ms`);
  quotes.forEach((quote, i) => {
    if (quote.kind === 'absent') assert.equal(results[i], null);
    else { assert.ok(results[i], `quote ${i} not found`); assert.equal(results[i].exact, quote.kind === 'exact', `quote ${i}`); }
  });
  console.log(`      (${Math.round(took)} ms for 120 quotes)`);
});

await test('proofStatements: marked sentences, unmarked claims, and what is not a claim', () => {
  const body = `# Summary

Here is my review of the lease.

The rent is €1,200 a month.[^1] The tenant pays the service charge quarterly in advance. Is the landlord's consent needed?

- Under clause 7 the tenant may not sublet.
- We recommend asking for a cap on the service charge.
- Break option: none[^2]

| Term | Value |
|---|---|
| Deposit | 3 months' rent |

\`\`\`
Rent: 1,200 per month
\`\`\`

See [the Act](https://www.legislation.gov.uk/ukpga/1980/58), s. 5. In summary, the lease is broadly standard. The deposit is held by the landlord's agent.[^9]`;
  const { marks } = splitProofs(`x\n<proofs>\n[^1]: doc "Lease.pdf" | "a rent of €1,200 per calendar month"\n[^2]: doc "Lease.pdf" | "there is no break option for either party"\n</proofs>`);
  const result = proofStatements(body, marks);
  const by = text => result.statements.find(statement => statement.text.startsWith(text));
  assert.equal(result.marked, 2);
  // Unmarked claims: the service charge sentence, clause 7, the deposit row and the sentence whose mark has no proof.
  assert.equal(result.unmarkedClaims, 4, JSON.stringify(result.statements.filter(s => s.claim && !s.marks.some(n => n <= 2))));
  assert.equal(by('Here is').claim, false); assert.equal(by('Is the landlord').claim, false); assert.equal(by('We recommend').claim, false);
  assert.equal(by('See the Act').claim, false); assert.equal(by('In summary').claim, false);
  assert.ok(by('The tenant pays').claim && by('Under clause 7').claim && by('Deposit;').claim);
  assert.deepEqual(by('The deposit is held').marks, [9]);
  assert.ok(!result.statements.some(statement => statement.text.includes('Summary') || statement.text.includes('Rent: 1,200') || statement.text.startsWith('Term')));
  assert.equal(isClaim('Η προθεσμία είναι έξι έτη από την ημέρα της γέννησης της αξίωσης.'), true);
  assert.equal(isClaim('Ποια είναι η προθεσμία;'), false);
});

await test('markBody + proofMarksHtml: marks survive the Markdown renderer and become buttons; code is left alone', () => {
  const body = 'The rent is **€1,200**.[^1] The term is five years.[^2] Unknown.[^9] In code: `[^3]`.\n\n```\nraw [^4]\n```';
  const marked1 = markBody(body);
  assert.ok(!marked1.includes('[^1]') && marked1.includes('`[^3]`') && marked1.includes('raw [^4]'));
  const html = marked.parse(marked1, { async: false });
  const states = { 1: 'checked', 2: 'close' };
  const out = proofMarksHtml(html, n => states[n] ?? 'none');
  assert.ok(out.includes('<button type="button" class="mn-proof-mark is-checked" data-proof="1" aria-label="Proof 1">1</button>'));
  assert.ok(out.includes('class="mn-proof-mark is-close" data-proof="2"'));
  assert.ok(!out.includes('data-proof="9"') && out.includes('Unknown.'), 'a mark without a proof becomes nothing');
  assert.ok(out.includes('<code>[^3]</code>') && out.includes('raw [^4]'));
  assert.ok(!/[]/.test(out));
  // A placeholder inside a tag is removed, never turned into markup there; a forged state draws nothing.
  assert.equal(proofMarksHtml('<a title="x1">y</a>', () => 'checked'), '<a title="x1">y</a>');
  assert.equal(proofMarksHtml('a1', () => '"><script>'), 'a');
});
await test('htmlToText: the reader HTML of an official page as text to check quotes against', () => {
  const text = htmlToText('<h2>Section 5</h2><p>An action founded on <b>simple</b> contract shall not be brought&nbsp;after &ldquo;six years&rdquo; &#8212; &amp; more.</p><ul><li>One</li><li>Two</li></ul>');
  assert.equal(text, 'Section 5\nAn action founded on simple contract shall not be brought after “six years” — & more.\nOne\nTwo');
  assert.equal(checkQuote(text, 'founded on simple contract shall not be brought after "six years"'), 'checked');
});

// --- The official page's frame -------------------------------------------------------------------------------
const PAGE_URL = 'https://www.legislation.gov.uk/ukpga/1980/58/section/5';
const PAGE = `<html><head><title>Limitation Act 1980, s. 5</title></head><body><main><h1>Limitation Act 1980</h1><h2>5 Time limit for actions founded on simple contract.</h2>
<p>An action founded on simple contract shall not be brought after the expiration of six years from the date on which the cause of action accrued.</p>
<p>${'This paragraph is here so the page has enough text of its own to be shown as a page and not as text. '.repeat(4)}</p></main></body></html>`;
async function frame(quote, url = PAGE_URL) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  try {
    const params = new URLSearchParams({ url, lang: 'en', ...(quote === undefined ? {} : { quote }) });
    const response = await officialWebResponse(new Request(`http://localhost/api/official-web?${params}`));
    return { response, html: await response.text() };
  } finally { globalThis.fetch = real; }
}
/** The bridge script run against a stand-in for the page: text nodes in blocks, a range, the highlight registry. */
function runBridge(script, texts, { highlight = true } = {}) {
  const messages = []; let onload; const added = [];
  const element = (name, block) => { const node = { nodeType: 1, nodeName: name, classList: { add: value => added.push(value) }, scrollIntoView() { node.scrolled = true; } }; node.closest = selector => selector.startsWith('script') ? null : block ?? node; return node; };
  const blocks = new Map(); const nodes = [];
  for (const [value, blockName, inline] of texts) {
    if (!blocks.has(blockName)) blocks.set(blockName, element('P'));
    const block = blocks.get(blockName);
    nodes.push({ nodeType: 3, nodeValue: value, parentElement: inline ? element('B', block) : block, nextSibling: null, previousSibling: null });
  }
  const ranges = [];
  const document = {
    head: { appendChild() {} }, body: {}, addEventListener() {},
    createTreeWalker(_root, _what, filter) { const list = nodes.filter(node => filter.acceptNode(node) === 1); let at = -1; return { nextNode: () => list[++at] ?? null }; },
    createRange() {
      const range = { setStart(node, offset) { range.startContainer = node; range.startOffset = offset; }, setEnd(node, offset) { range.endContainer = node; range.endOffset = offset; },
        surroundContents(mark) { range.surrounded = mark; }, get commonAncestorContainer() { return range.startContainer.parentElement.closest('p'); } };
      ranges.push(range); return range;
    },
    createElement: name => element(name.toUpperCase()),
  };
  const context = { document, parent: { postMessage: message => messages.push(message) }, addEventListener: (type, fn) => { if (type === 'load') onload = fn; },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    ...(highlight ? { CSS: { highlights: new Map() }, Highlight: class { constructor(range) { this.range = range; } } } : {}) };
  vm.createContext(context); vm.runInContext(script, context); onload?.();
  return { messages, ranges, nodes, added, context };
}
const scriptOf = html => { const found = /<script nonce="([^"]+)">([\s\S]*?)<\/script>/.exec(html); assert.ok(found, 'no bridge script'); return { nonce: found[1], script: found[2] }; };

await test('official page frame: a hostile quote is embedded as data, «</script>» and «$\'» included, under the nonce', async () => {
  const quote = `six years</script><script>alert(1)</script> $' $& $\` <!-- end`;
  const { response, html } = await frame(quote);
  assert.equal(response.status, 200);
  assert.equal(html.match(/<\/script/gi).length, 1, 'only the bridge closes a script');
  const { nonce, script } = scriptOf(html);
  assert.ok(response.headers.get('content-security-policy').includes(`script-src 'nonce-${nonce}'`));
  const embedded = /const quote=("(?:[^"\\]|\\.)*");/.exec(script);
  assert.ok(embedded, 'the quote is in the script'); assert.equal(JSON.parse(embedded[1]), quote);
  assert.ok(!embedded[1].includes('<'));
  const run = runBridge(script, [['nothing to see here', 'a']]);
  assert.deepEqual(run.messages.map(message => [message.kind, message.found]), [['ready', undefined], ['quote', false]]);
});
await test('official page frame: the quote is at most 400 characters; a page without one has no finder', async () => {
  const { html } = await frame('word '.repeat(200));
  assert.ok(JSON.parse(/const quote=("(?:[^"\\]|\\.)*");/.exec(scriptOf(html).script)[1]).length <= 400);
  const plain = await frame(undefined);
  assert.ok(!scriptOf(plain.html).script.includes('showQuote'));
});
await test('official page frame: the passage is found across elements, highlighted, scrolled to, and reported', async () => {
  const quote = 'An action founded on simple contract shall not be brought after the expiration of six years';
  const { html } = await frame(quote);
  const { script } = scriptOf(html);
  const texts = [['5 Time limit for actions founded on simple contract.', 'h2'], ['An action founded on ', 'p'], ['simple contract', 'p', true], [' shall not be brought after the expiration of six years from the date.', 'p']];
  const run = runBridge(script, texts);
  assert.deepEqual({ ...run.messages.at(-1) }, { type: 'official-page', requested: PAGE_URL, url: PAGE_URL, kind: 'quote', found: true, exact: true });
  const range = run.context.CSS.highlights.get('mn-proof').range;
  assert.equal(range.startContainer, run.nodes[1]); assert.equal(range.startOffset, 0);
  assert.equal(range.endContainer, run.nodes[3]); assert.equal(range.endOffset, ' shall not be brought after the expiration of six years'.length);
  assert.ok(run.nodes[1].parentElement.scrolled, 'scrolled to the passage');
  // Without the Highlight API: a <mark> inside one text node, else an outline on the block that holds the passage.
  const single = runBridge(script, [['Before. An action founded on simple contract shall not be brought after the expiration of six years. After.', 'p']], { highlight: false });
  assert.equal(single.ranges[0].surrounded?.nodeName, 'MARK'); assert.equal(single.ranges[0].startOffset, 8);
  const split = runBridge(script, texts, { highlight: false });
  assert.ok(split.added.includes('mn-proof-outline')); assert.equal(split.messages.at(-1).found, true);
});
await test('official page frame: a nearly-exact quote is found as close; Greek folds as in findQuote', async () => {
  const near = await frame('An action based on simple contract shall not be brought after expiry of six years from the date on which');
  const run = runBridge(scriptOf(near.html).script, [['An action founded on simple contract shall not be brought after the expiration of six years from the date on which the cause of action accrued.', 'p']]);
  assert.deepEqual([run.messages.at(-1).found, run.messages.at(-1).exact], [true, false]);
  const greek = await frame('ο μισθωτης υποχρεουται να καταβαλλει το μισθωμα');
  const again = runBridge(scriptOf(greek.html).script, [['Άρθρο 3. Ο ΜΙΣΘΩΤΉΣ ', 'p'], ['υποχρεούται να καταβάλλει το μίσθωμα έως την πέμπτη.', 'p']]);
  assert.deepEqual([again.messages.at(-1).found, again.messages.at(-1).exact], [true, true]);
  assert.equal(again.ranges[0].startOffset, 'Άρθρο 3. '.length); assert.equal(again.ranges[0].endOffset, 'υποχρεούται να καταβάλλει το μίσθωμα'.length);
});

await test('a drafted letter: only its points of law count as without a source, not its facts and prose (13 Nov 2026)', () => {
  const letter = 'Dear [Tenant],\n\nI write as your landlord to demand payment of €2,400 in unpaid rent for the above property. Your monthly rent is €800. Section 37(1) of the Contract Law, Cap. 149, requires parties to perform their promises. Your failure to pay is a breach of clause 4 of the lease.\n\nYours sincerely,\n\n[Landlord]';
  assert.equal(isDraftedDocument(letter), true);
  assert.equal(proofStatements(letter, [], { lawOnly: true }).unmarkedClaims, 2);
  assert.equal(proofStatements(letter, []).unmarkedClaims, 4);
  assert.equal(isDraftedDocument('The standard VAT rate in Cyprus is 19%. Section 3 applies to services.'), false);
  assert.equal(isDraftedDocument('THIS AGREEMENT is made on 1 May 2026 between A and B.'), true);
  assert.equal(isDraftedDocument('Prices rose.\nBetween 2019 and 2023 the index doubled (Section 4).'), false, 'research is not a contract');
  assert.equal(isDraftedDocument('[Landlord]\n[Address]\n\n12 November 2026\n\nDear [Tenant],\n\nPay.'), true, 'a letter with address blocks');
  // Code review (13 Nov 2026): research that only mentions signing, a price «με τιμή», or reviews a lease is not a draft.
  for (const research of ['The tenancy agreement was signed by both parties in 2020. Rent is €800.', 'Το ακίνητο πωλήθηκε με τιμή €200.000.', 'This lease favours the landlord in three ways.'])
    assert.equal(isDraftedDocument(research), false, research);
  assert.equal(proofStatements('The contract has no liability cap. The tenant must pay €5,000 within 10 days.', []).statements.length, 2, '«cap.» ends a sentence unless a number follows');
  // «Cap. 149» and «Κεφ. 149» are one sentence, not two.
  assert.equal(proofStatements('Section 37(1) of the Contract Law, Cap. 149, requires parties to perform. Το άρθρο 37 του Κεφ. 149 ισχύει.', []).statements.length, 2);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', with failures' : ''}`);
