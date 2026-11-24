// «Paste a link» (src/data/page-links.ts): which links are read, the page as text, and an unreadable page said plainly.
import assert from 'node:assert/strict';
import { htmlText, linksIn, pageDocument } from '../src/data/page-links.ts';
import { readablePage } from '../api/official-page.ts';
let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); process.exitCode = 1; } };
await test('links: at most two, trailing punctuation dropped, Sheets links left to «Every row», no repeats', () => {
  assert.deepEqual(linksIn('Summarise https://www.bbc.com/news/world-123. Also (https://example.org/a?b=1), and https://www.bbc.com/news/world-123'), ['https://www.bbc.com/news/world-123', 'https://example.org/a?b=1']);
  assert.deepEqual(linksIn('Run on https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit'), []);
  assert.deepEqual(linksIn('no links here, just www.example.com'), []);
  assert.equal(linksIn('a https://a.example b https://b.example c https://c.example').length, 2);
});
await test('a page as text: headings, paragraphs, lists and table cells readable', () => {
  assert.equal(htmlText('<h1>Title</h1><p>First &amp; second.</p><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table><script>x()</script>'), 'Title\nFirst & second.\n- One\n- Two\nA | B |');
});
await test('the file: title, address and text; an unreadable page tells the agent not to guess', () => {
  const doc = pageDocument('https://www.example.org/x', { title: 'Example', html: '<p>Hello</p>' });
  assert.deepEqual(doc, { name: 'Web page · Example', text: 'Example\nhttps://www.example.org/x\n\nHello' });
  const refused = pageDocument('https://apnews.com/article/1', null);
  assert.equal(refused.name, 'Web page · apnews.com (not readable)');
  assert.match(refused.text, /could not be read[^]*never guess what the page says/);
});
await test('the reader keeps the article: a feature class on <html> or a «sticky» container is not a cookie banner (Wikipedia came back empty)', () => {
  const page = `<html class="vector-feature-page-popup-enabled"><body class="skin-overlay-ready"><div class="vector-sticky-pinned-container">Tools</div>
    <div id="cookie-banner" class="cc-window">We use cookies</div><div class="cky-consent-container">Accept</div><main><h1>Limassol</h1><p>Limassol is a city on the southern coast of Cyprus, the second largest after Nicosia, with a busy port and a long seafront.</p><p>It has a population of about two hundred thousand people and is a centre of shipping, tourism and services in the region.</p></main></body></html>`;
  const read = readablePage(page, 'https://en.wikipedia.org/wiki/Limassol');
  assert.match(read.html, /Limassol is a city on the southern coast of Cyprus/);
  assert.doesNotMatch(read.html, /We use cookies|Accept/);
});

await test('a YouTube link: the video is named, never guessed, and the person is told how to paste its transcript', () => {
  const video = pageDocument('https://www.youtube.com/watch?v=aircAruvnKk', { title: 'But what is a neural network? - YouTube', html: '' });
  assert.equal(video.name, 'Video · But what is a neural network?');
  assert.match(video.text, /cannot watch videos[^]*Show transcript/);
  assert.match(pageDocument('https://youtu.be/aircAruvnKk', null).name, /^Video · YouTube$/);
});

await test('links keep their brackets; a bad character code does not break the page (13 Nov 2026, code review)', () => {
  assert.deepEqual(linksIn('Read https://en.wikipedia.org/wiki/Lease_(law) please'), ['https://en.wikipedia.org/wiki/Lease_(law)']);
  assert.deepEqual(linksIn('(see https://example.org/page).'), ['https://example.org/page']);
  assert.match(htmlText('<p>a &#99999999; b &#65;</p>'), /a\s+b A/);
});

console.log(`\n${passed} passed`);
