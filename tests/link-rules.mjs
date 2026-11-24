// Which links stay in the app's right panel and which go to the person's own browser (src/data/link-rules.ts),
// and that every link made to leave the app is marked for it in the components.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { panelUrl } from '../src/data/link-rules.ts';

const origin = 'http://localhost:3000';
const link = (href, extra = {}) => ({ href, newTab: false, download: false, ownLinks: false, ...extra });
assert.equal(panelUrl(link('https://www.netflix.com/cy/title/81678020'), origin), 'https://www.netflix.com/cy/title/81678020', 'a web link opens in the panel');
assert.equal(panelUrl(link('https://www.netflix.com/cy/title/81678020', { newTab: true }), origin), null, '«Open on the site» goes to the browser');
assert.equal(panelUrl(link('https://example.com/file.pdf', { download: true }), origin), null, 'a download is left alone');
assert.equal(panelUrl(link('https://example.com/', { ownLinks: true }), origin), null, 'a panel that opens its own links');
assert.equal(panelUrl(link('http://localhost:3000/routines'), origin), null, 'the app\'s own pages');
assert.equal(panelUrl(link('mailto:someone@example.com'), origin), null, 'not a web address');
// Every link whose label says it leaves the app carries the mark.
const marked = (file, needle) => { const line = fs.readFileSync(file, 'utf8').split('\n').find(text => text.includes(needle)); assert.ok(line && line.includes('data-new-tab'), `${file}: ${needle}`); };
marked('src/components/official-website-viewer.tsx', 'className="nomos-official-web-original"');
marked('src/components/official-website-viewer.tsx', '>Open on {hostOf(current)}<');
marked('src/components/mail-panel.tsx', 'className="mn-mail-open"');
marked('src/components/official-sources-list.tsx', '/>Original</a>');
console.log('10 link-rule checks passed.');
