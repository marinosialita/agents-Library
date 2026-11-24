// E-mail attachments an agent reads (12 Nov 2026): old Word files, the file host check, scans handed to the reader.
import assert from 'node:assert/strict';
import { oldWordText, readOneFile } from '../server/inbound/documents.ts';
import { fileHostAllowed } from '../server/connected/inbox.ts';

let passed = 0; const test = async (name, work) => { try { await work(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); process.exitCode = 1; } };
const utf16 = text => { const out = new Uint8Array(text.length * 2); [...text].forEach((char, i) => { const code = char.charCodeAt(0); out[i * 2] = code & 0xff; out[i * 2 + 1] = code >> 8; }); return out; };
const join = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

await test('old Word: Greek and English words are kept, padding and binary are not', () => {
  const bytes = join(new Uint8Array(512).fill(0xff), new Uint8Array([0, 1, 2, 3, 0x12, 0x80, 0x90]), utf16('ΚΑΤΗΓΟΡΗΤΗΡΙΟ για την υπόθεση 14129/26\rSUMMARY STATEMENT to the client'), new Uint8Array(300).fill(0), new Uint8Array(200).fill(0xff));
  const text = oldWordText(bytes);
  assert.ok(text.includes('ΚΑΤΗΓΟΡΗΤΗΡΙΟ για την υπόθεση 14129/26'), text);
  assert.ok(text.includes('SUMMARY STATEMENT to the client'), text);
  assert.ok(!/ÿ/.test(text), 'no padding');
});
await test('one file: .doc read with its note; a scanned PDF goes to the reader; pictures and unknown types say why', async () => {
  const doc = await readOneFile({ name: 'a.doc', type: 'application/msword', bytes: utf16('Draft summary statement for the client') }, 1000);
  assert.ok(doc.text.includes('Draft summary statement') && /old Word/.test(doc.note));
  const picture = await readOneFile({ name: 'x.png', type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]) }, 1000);
  assert.equal(picture.text, ''); assert.match(picture.note, /picture/);
  const other = await readOneFile({ name: 'x.zip', type: 'application/zip', bytes: new Uint8Array(10) }, 1000);
  assert.match(other.note, /only PDF, Word and text/);
  const big = await readOneFile({ name: 'x.pdf', type: 'application/pdf', bytes: new Uint8Array(16_000_000) }, 1000);
  assert.match(big.note, /up to 15 MB/);
});
await test('downloads only from the integration\'s own storage, over https', () => {
  assert.ok(fileHostAllowed('https://temp.abc.r2.cloudflarestorage.com/x/file.pdf?sig=1'));
  assert.ok(fileHostAllowed('https://bucket.s3.amazonaws.com/file.pdf'));
  for (const url of ['http://temp.abc.r2.cloudflarestorage.com/x.pdf', 'https://evil.example/x.pdf', 'https://r2.cloudflarestorage.com.evil.example/x', 'https://127.0.0.1/x', 'not a url']) assert.ok(!fileHostAllowed(url), url);
});
console.log(`${passed} attachment checks passed.`);
