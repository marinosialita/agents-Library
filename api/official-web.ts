import { randomBytes } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { FOLD_CHARS } from '../src/data/proof.ts';
import { cellarCelex, fetchOfficial, isCatalogueUrl, readCellar } from './official-page.ts';
import { allowedIn, pageScope, publicWebUrl, type PageScope } from '../server/public-web.ts';
import { assetPath, assetTicket, rebaseImports } from '../server/web-asset.ts';

// The real official page inside the app, looking as it does on its site. The page is fetched here (official sites
// refuse to be framed, and their cookies must never be sent) and shown in a sandboxed frame with its own styles,
// fonts and images, without its scripts, forms or cookies. Only catalogue hosts
// (shared/official-sources.ts); assets only from official hosts; EUR-Lex from CELLAR, its official text, set in a
// reading style. A PDF, a page built only by scripts or a page that will not load is reported to the viewer, which
// draws the PDF's pages or falls back to the text reader.
const MIN_TEXT = 280;
const READING_CSS = `body{max-width:860px;margin:0 auto;padding:28px 32px 56px;font:15px/1.7 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#20211f;background:#fff}h1,h2,h3,h4{line-height:1.3;color:#20211f}h1{font-size:24px}h2{font-size:19px}h3{font-size:16px}p{margin:0 0 .8em}table{border-collapse:collapse;max-width:100%}td,th{padding:4px 8px;border:1px solid #e6e3ee;vertical-align:top}a{color:#6744c3}img{max-width:100%;height:auto}`;
/** The Official Journal's own layout for CELLAR texts (its classes, as EUR-Lex shows them): centred titles and
 *  article headings, recitals and points as hanging lists, footnotes small; no cell borders. */
const OJ_CSS = `table{border:0;width:100%}td,th{border:0;padding:2px 8px 2px 0}.oj-doc-ti{margin:18px 0 6px;font-weight:700;font-size:17px;text-align:center}.oj-ti-art{margin:26px 0 2px;font-style:italic;text-align:center}.oj-sti-art{margin:0 0 10px;font-weight:700;text-align:center}.oj-bold{font-weight:700}.oj-italic{font-style:italic}.oj-expanded{letter-spacing:.12em}.oj-super{vertical-align:super;font-size:.75em}.oj-note{font-size:12.5px;color:#5b544a}.oj-signatory,.oj-final{margin-top:14px}.oj-hd-date,.oj-hd-lg,.oj-hd-ti,.oj-hd-oj{color:#5b544a;font-size:12.5px}.oj-separator{border-top:1px solid #e4ddd0;margin:20px 0}td:first-child{white-space:nowrap;width:1%}`;
// Menus a page opens only by its scripts (12 Nov 2026: the EU's language picker covered every europa.eu page) stay shut.
const HIDE = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[class*="cmplz" i],[id*="onetrust" i],[class*="didomi" i],[class*="gdpr" i],.ecl-site-header__language-container,.ecl-site-header__search-container,.ecl-site-header__login-container,[class*="language-overlay" i],[class*="lang-overlay" i]{display:none!important}a[href]{cursor:pointer}img{max-width:100%}';
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** An asset of an official host, made https (an http asset would be blocked as mixed content). */
function assetUrl(raw: string, base: string, open = false): string | undefined {
  try {
    const url = new URL(raw, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    url.protocol = 'https:'; if (url.port === '80') url.port = '';
    // The open viewer loads any public site's pictures and styles (the browser fetches them, as on the site itself).
    return isCatalogueUrl(url.href) || (open && publicWebUrl(url.href)) ? url.href : undefined;
  } catch { return; }
}

/** The page's layout, styles and images; no scripts, forms, frames or handlers. Returns the asset origins used, for the CSP. */
export function prepareOfficialHtml(raw: string, base: string, open = false): { html: string; origins: string[]; styled: boolean; textLength: number } {
  const origins = new Set<string>(); let styled = false;
  const keep = (href: string | undefined) => { if (href) origins.add(new URL(href).origin); return href; };
  const html = sanitizeHtml(raw, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'html', 'head', 'body', 'title', 'meta', 'link', 'img', 'style', 'details', 'summary', 'font', 'center',
      'svg', 'g', 'path', 'circle', 'rect', 'polygon'],
    allowedAttributes: {
      '*': ['id', 'class', 'title', 'lang', 'dir', 'style', 'hidden', 'role', 'align', 'valign', 'aria-label', 'aria-hidden', 'aria-labelledby', 'aria-describedby', 'aria-current'],
      a: ['href', 'target', 'rel', 'name'], img: ['src', 'alt', 'width', 'height', 'loading'], font: ['color', 'size', 'face'],
      link: ['rel', 'href', 'media', 'type'], meta: ['name', 'content', 'charset'],
      table: ['width', 'border', 'cellpadding', 'cellspacing'], td: ['colspan', 'rowspan', 'width'], th: ['colspan', 'rowspan', 'scope', 'width'], col: ['span', 'width'],
      ol: ['start', 'type'], li: ['value'], details: ['open'],
      svg: ['xmlns', 'viewbox', 'viewBox', 'width', 'height', 'focusable', 'fill'], g: ['fill', 'transform'],
      path: ['d', 'fill', 'fill-rule', 'clip-rule'], circle: ['cx', 'cy', 'r', 'fill'], rect: ['x', 'y', 'width', 'height', 'fill'], polygon: ['points', 'fill'],
    },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'], allowProtocolRelative: false,
    allowVulnerableTags: true, // Styles are isolated by the opaque, script-less frame and the response CSP.
    // A form keeps its content (ASP.NET sites — the Bank of Greece, many ministries — wrap the whole page in one); its
    // fields, buttons and lists go.
    nonTextTags: ['script', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template', 'math', 'button', 'select', 'input'],
    transformTags: {
      form: () => ({ tagName: 'div', attribs: {} }),
      a: (tag: string, attributes: Record<string, string>) => {
        const next: Record<string, string> = {};
        if (attributes.name) next.name = attributes.name;
        if (attributes.title) next.title = attributes.title;
        if (attributes.class) next.class = attributes.class;
        if (attributes.href?.startsWith('#')) { next.href = attributes.href; next.target = '_self'; }
        else if (attributes.href) {
          try {
            const url = new URL(attributes.href, base);
            if (['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password) {
              next.href = url.href;
              // Official pages open in the viewer; anything else in a new tab.
              next.target = /^https?:$/.test(url.protocol) && (isCatalogueUrl(url.href) || (open && !!publicWebUrl(url.href))) ? '_self' : '_blank';
            }
          } catch { /* An invalid link cannot navigate. */ }
        }
        next.rel = 'noopener noreferrer';
        return { tagName: tag, attribs: next };
      },
      img: (tag: string, attributes: Record<string, string>) => {
        const next = { ...attributes }; const url = keep(assetUrl(attributes.src || '', base, open));
        delete next.src; if (url) next.src = url;
        return { tagName: tag, attribs: next };
      },
      link: (tag: string, attributes: Record<string, string>) => {
        const url = /\bstylesheet\b/i.test(attributes.rel || '') ? keep(assetUrl(attributes.href || '', base, open)) : undefined;
        if (url) styled = true;
        return url ? { tagName: tag, attribs: { rel: 'stylesheet', href: url, ...(attributes.media ? { media: attributes.media } : {}) } } : { tagName: 'span', attribs: {} };
      },
      style: (tag: string, attributes: Record<string, string>) => { styled = true; return { tagName: tag, attribs: attributes }; },
      meta: (tag: string, attributes: Record<string, string>) => {
        const attribs: Record<string, string> = attributes.name === 'viewport' ? { name: 'viewport', content: 'width=device-width, initial-scale=1' } : {};
        return { tagName: attributes.name === 'viewport' ? tag : 'span', attribs };
      },
    },
  });
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const textLength = body.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().length;
  return { html, origins: [...origins], styled, textLength };
}

type Kind = 'ready' | 'pdf' | 'empty' | 'error';
/** A value inside the script: JSON with «<» escaped, so no «</script>» or «<!--» in a quote can end or bend it. */
const scriptValue = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const QUOTE_CSS = '::highlight(mn-proof){background-color:#e4d9fb;color:inherit}mark.mn-proof{background:#e4d9fb;color:inherit;border-radius:2px}.mn-proof-outline{outline:2px solid #6744c3;outline-offset:3px;border-radius:2px}';
/** The passage a proof quotes, found in the page's text across element boundaries with findQuote's reading
 *  (src/data/proof.ts: FOLD_CHARS, case, accents, white space ignored), else the nearest passage with ≥ 85 % of its
 *  words in order. Marked with the CSS Custom Highlight API, else a <mark> within one text node, else an outline on
 *  the element that holds it; scrolled into view; the viewer is told {kind:'quote', found, exact}. */
const QUOTE_FINDER = String.raw`const fcache=new Map(),kcache=new Map();
const fold1=c=>{let v=fcache.get(c);if(v===undefined){v=Object.prototype.hasOwnProperty.call(FOLDS,c)?FOLDS[c]:c.toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/\u03c2/g,'\u03c3');fcache.set(c,v);}return v;};
const kindOf=code=>{if(code<128)return code===32||(code>=9&&code<=13)?1:(code>=48&&code<=57)||(code>=97&&code<=122)||(code>=65&&code<=90)?2:0;let k=kcache.get(code);if(k===undefined){const c=String.fromCharCode(code);k=/\s/.test(c)?1:/[\p{L}\p{N}]/u.test(c)?2:0;kcache.set(code,k);}return k;};
const foldAll=(texts,gaps)=>{const out=[],node=[],off=[],flag=[];let space=false;
for(let i=0;i<texts.length;i++){const t=texts[i];if(gaps[i])space=true;
for(let k=0;k<t.length;k++){const code=t.charCodeAt(k);let c=t[k];
if(code>=0xd800&&code<0xdc00&&k+1<t.length){const low=t.charCodeAt(k+1);if(low>=0xdc00&&low<0xe000)c=t.slice(k,k+2);}
const f=code<128?(code>=65&&code<=90?String.fromCharCode(code+32):code===96?"'":c):fold1(c);
for(let j=0;j<f.length;j++){const kind=kindOf(f.charCodeAt(j));if(kind===1){space=true;continue;}out.push(f[j]);node.push(i);off.push(k);flag.push((space?1:0)|(kind===2?2:0));space=false;}
k+=c.length-1;}}
return {norm:out.join(''),node,off,flag};};
const tokensOf=f=>{const s=[],e=[],w=[],n=f.norm.length;for(let i=0;i<n;){if(!(f.flag[i]&2)){i++;continue;}let j=i+1;while(j<n&&(f.flag[j]&2)&&!(f.flag[j]&1))j++;s.push(i);e.push(j);w.push(f.norm.slice(i,j));i=j;}return {s,e,w};};
const nearMatch=(page,quote)=>{const Q=tokensOf(quote).w,m=Q.length;if(m<4)return null;const P=tokensOf(page),total=P.w.length;if(!total)return null;
const need=Math.ceil(m*0.85),where=new Map();P.w.forEach((x,i)=>{const a=where.get(x);if(a)a.push(i);else where.set(x,[i]);});
const votes=new Int32Array((total>>2)+2);Q.forEach((x,i)=>{const a=where.get(x);if(!a||a.length>5000)return;for(const p of a)votes[Math.max(0,p-i)>>2]++;});
const cands=[];for(let b=0;b<votes.length;b++){const v=votes[b]+(votes[b+1]||0);if(v>=need*0.6)cands.push([v,b]);}cands.sort((x,y)=>y[0]-x[0]);
let best=null;for(const [,b] of cands.slice(0,8)){const from=Math.max(0,b*4-Math.ceil(m*0.2)-2),to=Math.min(total,b*4+4+m+Math.ceil(m*0.3)+2),w=to-from,row=w+1,d=new Uint16Array((m+1)*row);
for(let i=1;i<=m;i++)for(let j=1;j<=w;j++)d[i*row+j]=Q[i-1]===P.w[from+j-1]?d[(i-1)*row+j-1]+1:Math.max(d[(i-1)*row+j],d[i*row+j-1]);
const score=d[m*row+w];if(score<need||(best&&score<=best.score))continue;
let i=m,j=w,first=-1,last=-1;while(i>0&&j>0){if(Q[i-1]===P.w[from+j-1]&&d[i*row+j]===d[(i-1)*row+j-1]+1){if(last<0)last=from+j-1;first=from+j-1;i--;j--;}else if(d[(i-1)*row+j]>=d[i*row+j-1])i--;else j--;}
if(first<0||last-first+1>m+Math.ceil(m*0.5)+2)continue;best={score,a:P.s[first],b:P.e[last]-1};}
return best;};
const locate=(texts,gaps,text)=>{const page=foldAll(texts,gaps),q=foldAll([text],[false]);if(q.norm.length<3)return null;
const exact=s=>{const at=s.length>=3?page.norm.indexOf(s):-1;return at<0?null:{a:at,b:at+s.length-1,exact:true};};
let hit=exact(q.norm);
if(!hit){let a=0,b=q.norm.length-1;while(a<=b&&!(q.flag[a]&2))a++;while(b>=a&&!(q.flag[b]&2))b--;if(a>0||b<q.norm.length-1)hit=exact(q.norm.slice(a,b+1));}
if(!hit){const near=nearMatch(page,q);if(near)hit={a:near.a,b:near.b,exact:false};}
return hit&&{from:[page.node[hit.a],page.off[hit.a]],to:[page.node[hit.b],page.off[hit.b]],exact:hit.exact};};
const BLOCKS='p,div,li,td,th,h1,h2,h3,h4,h5,h6,section,article,header,footer,main,aside,nav,tr,table,ul,ol,dl,dt,dd,blockquote,pre,figure,figcaption,caption,center,body';
const showQuote=()=>{try{
const nodes=[],texts=[],gaps=[];let prev=null,prevBlock=null;
const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement&&!n.parentElement.closest('script,style,noscript,template,[hidden]')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
for(let n=walker.nextNode();n;n=walker.nextNode()){const block=n.parentElement.closest(BLOCKS);
gaps.push(!prev||block!==prevBlock||!!(prev.nextSibling&&prev.nextSibling.nodeName==='BR')||!!(n.previousSibling&&n.previousSibling.nodeName==='BR'));
nodes.push(n);texts.push(n.nodeValue||'');prev=n;prevBlock=block;}
const hit=locate(texts,gaps,quote);if(!hit){send({kind:'quote',found:false,exact:false});return;}
const t=texts[hit.to[0]];let end=hit.to[1]+1;const code=t.charCodeAt(end-1);if(code>=0xd800&&code<0xdc00)end++;while(end<t.length&&/\p{M}/u.test(t[end]))end++;
const range=document.createRange();range.setStart(nodes[hit.from[0]],hit.from[1]);range.setEnd(nodes[hit.to[0]],end);
const style=document.createElement('style');style.textContent=QUOTE_CSS;(document.head||document.documentElement).appendChild(style);
let shown=nodes[hit.from[0]].parentElement;
if(typeof CSS!=='undefined'&&CSS.highlights&&typeof Highlight==='function')CSS.highlights.set('mn-proof',new Highlight(range));
else if(range.startContainer===range.endContainer){const mark=document.createElement('mark');mark.className='mn-proof';range.surroundContents(mark);shown=mark;}
else{const box=range.commonAncestorContainer;shown=box&&box.nodeType===1?box:box&&box.parentElement;if(shown)shown.classList.add('mn-proof-outline');}
if(shown&&shown.scrollIntoView)shown.scrollIntoView({block:'center'});
send({kind:'quote',found:true,exact:hit.exact});
}catch{send({kind:'quote',found:false,exact:false});}};`;
function bridge(requested: string, url: string, kind: Kind, quote = '', live = false): string {
  // Only this application-owned script runs. No script of the official site is kept.
  const payload = scriptValue({ type: 'official-page', requested, url, kind });
  const finder = kind === 'ready' && quote ? `const quote=${scriptValue(quote)};const FOLDS=${scriptValue(FOLD_CHARS)};const QUOTE_CSS=${scriptValue(QUOTE_CSS)};\n${QUOTE_FINDER}` : '';
  return `(() => {
    const state=${payload};
    const send=(extra)=>parent.postMessage({...state,...extra},'*');
    ${finder}
    document.addEventListener('click',event=>{
      const link=event.target.closest && event.target.closest('a[href]');
      if(!link || event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const href=link.getAttribute('href');
      if(href.startsWith('#')) return;
      if(link.target==='_self'${live ? " || (/^https?:/i.test(link.href) && link.target!=='_blank')" : ''}){event.preventDefault();send({kind:'navigate',href:${live ? 'link.href' : 'href'}});}
    });
    addEventListener('load',()=>{send({});${finder ? 'showQuote();' : ''}},{once:true});
  })();`;
}

function pageResponse(document: string, requested: string, url: string, kind: Kind, origins: string[] = [], status = 200, quote = ''): Response {
  const nonce = randomBytes(18).toString('base64');
  const script = `<script nonce="${nonce}">${bridge(requested, url, kind, quote)}</script>`;
  // A replacer function: a replacement string would expand «$&», «$'» and the like out of the URLs inside the script.
  const html = /<\/body>/i.test(document) ? document.replace(/<\/body>/i, () => `${script}</body>`) : `${document}${script}`;
  const sources = origins.join(' ');
  return new Response(`<!doctype html>${/<meta charset/i.test(html) ? '' : '<meta charset="utf-8">'}${html}`, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' ${sources}; img-src ${sources} data:; font-src ${sources} data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads`,
  } });
}

/** A public page as a browser shows it (12 Nov 2026): its own scripts run, because most sites build their layout with
 *  them, but only inside the frame's sandbox, whose origin is opaque: no cookies, no storage, no reach into the app, no
 *  forms sent, no navigation of the app. Links come back to the viewer. Official pages keep the script-less reader. */
function livePage(raw: string, requested: string, url: string, origin: string): Response {
  // The sandbox has no storage and no cookies, and touching them throws, which breaks most sites' scripts; they get
  // throw-away ones that live as long as the page.
  const shim = `<script>(()=>{const mem=()=>{const m=new Map();return{get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>{m.set(String(k),String(v))},removeItem:k=>{m.delete(String(k))},clear:()=>m.clear()}};
for(const name of ['localStorage','sessionStorage']){try{window[name].length}catch{try{Object.defineProperty(window,name,{value:mem(),configurable:true})}catch{}}}
try{document.cookie}catch{let jar={};try{Object.defineProperty(document,'cookie',{configurable:true,get:()=>Object.entries(jar).map(([k,v])=>k+'='+v).join('; '),set:v=>{const p=String(v).split(';')[0];const i=p.indexOf('=');if(i>0)jar[p.slice(0,i).trim()]=p.slice(i+1).trim();}})}catch{}}
try{indexedDB}catch{try{Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true})}catch{}}})();</script>`;
  const head = `<base href="${escape(url)}"><meta name="referrer" content="no-referrer">${shim}<style>${HIDE}</style>`;
  // Module scripts come through the app (server/web-asset.ts): the sandbox may not load them from the site itself.
  const tickets = new Map<string, string | null>();
  const through = (raw: string): string | null => {
    try {
      const target = new URL(raw.replace(/&amp;/g, '&'), url);
      if (!/^https?:$/.test(target.protocol) || !publicWebUrl(target.href)) return null;
      if (!tickets.has(target.host)) tickets.set(target.host, assetTicket(target.host));
      const ticket = tickets.get(target.host);
      return ticket ? origin + assetPath(ticket, target) : null;
    } catch { return null; }
  };
  const pageTicket = assetTicket(new URL(url).host);
  const rootImports = (code: string) => pageTicket ? rebaseImports(code, `${origin}/api/web-asset/${pageTicket}/${new URL(url).protocol.replace(':', '')}/${new URL(url).host}`) : code;
  const cleaned = raw.replace(/<base\b[^>]*>/gi, '').replace(/<meta[^>]+http-equiv=["']?(?:content-security-policy|refresh)["']?[^>]*>/gi, '')
    .replace(/<script\b([^>]*\btype\s*=\s*["']?module["']?[^>]*)>([\s\S]*?)<\/script>/gi, (whole, attributes: string, code: string) => {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
      if (src) { const next = through(src); return next ? `<script${attributes.replace(/\s(?:src|integrity|crossorigin)\s*=\s*["'][^"']*["']/gi, '')} src="${escape(next)}"></script>` : whole; }
      return `<script${attributes}>${rootImports(code)}</script>`;
    })
    .replace(/<link\b([^>]*\brel\s*=\s*["']?modulepreload["']?[^>]*)>/gi, (whole, attributes: string) => {
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]; const next = href ? through(href) : null;
      return next ? `<link rel="modulepreload" href="${escape(next)}">` : whole;
    });
  const withHead = /<head\b[^>]*>/i.test(cleaned) ? cleaned.replace(/<head\b[^>]*>/i, match => `${match}${head}`) : `${head}${cleaned}`;
  const script = `<script>${bridge(requested, url, 'ready', '', true)}</script>`;
  const html = /<\/body>/i.test(withHead) ? withHead.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${script}</body>`) : `${withHead}${script}`;
  return new Response(/^\s*<!doctype/i.test(html) ? html : `<!doctype html>${html}`, { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  } });
}

const notice = (text: string, url: string) => `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${READING_CSS}</style></head><body><p>${escape(text)}</p><p><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a></p></body></html>`;

function render(raw: string, requested: string, url: string, reading = false, quote = '', open = false, origin = ''): Response {
  const page = prepareOfficialHtml(raw, url, open);
  // A public page is shown as its server sent it, without its scripts (12 Nov 2026: with them, news and blog pages went
  // blank in the panel — their scripts wipe or redirect the page inside the sandbox). Only a page that has no text until
  // its scripts build it (an app-like site) still runs them.
  if (open && page.textLength < MIN_TEXT) return livePage(raw, requested, url, origin);
  if (page.textLength < MIN_TEXT) return pageResponse(notice('This page is built by scripts; its text is shown instead.', url), requested, url, 'empty');
  // A page without its own styles (EUR-Lex from CELLAR, old plain pages) is set in the reading style.
  const style = `<style>${reading || !page.styled ? READING_CSS : ''}${reading ? OJ_CSS : ''}${HIDE}</style>`;
  const document = /<\/head>/i.test(page.html) ? page.html.replace(/<\/head>/i, `${style}</head>`) : `${style}${page.html}`;
  return pageResponse(document, requested, url, 'ready', page.origins, 200, quote);
}

/** Where a page with no text of its own sends the reader: a meta refresh, or the main frame of a frameset (old court
 *  and ministry sites, e.g. the Areios Pagos). Only an official page, never the same one. */
export function onwardUrl(raw: string, base: string, open = false): string | null {
  if (raw.length > 60_000) return null;
  const refresh = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i.exec(raw)?.[1];
  const frames = [...raw.matchAll(/<i?frame\b[^>]*>/gi)].map(match => match[0]);
  const main = frames.find(tag => /\bname=["']?(?:main|content|body|mainframe|contents?main)\b/i.test(tag)) ?? frames.at(-1);
  const src = refresh ?? (main ? /\bsrc=["']?([^"'>\s]+)/i.exec(main)?.[1] : undefined);
  if (!src) return null;
  try {
    const next = new URL(src.replace(/&amp;/g, '&'), base).href;
    return next !== base && (isCatalogueUrl(next) || (open && !!publicWebUrl(next))) ? next : null;
  } catch { return null; }
}

/** A public, read-only official page. Never forwards browser cookies or authorization. */
export async function officialWebResponse(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const params = new URL(request.url).searchParams;
  const requested = params.get('url') || '';
  const scope: PageScope | null = await pageScope(request, requested);
  if (!scope) return new Response('Not an official page', { status: 400 });
  const open = scope === 'open';
  const language = params.get('lang') === 'el' ? 'el' : 'en';
  // The passage a proof quotes (src/data/proof.ts), marked in the page: one line, at most 400 characters.
  const quote = (params.get('quote') || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400).replace(/[\uD800-\uDBFF]$/, '');
  const celex = open ? null : cellarCelex(requested);
  if (celex) {
    try {
      const { type, bytes } = await readCellar(celex, language, AbortSignal.timeout(20_000));
      if (type.includes('pdf')) return pageResponse(notice('PDF', requested), requested, requested, 'pdf');
      return render(new TextDecoder().decode(bytes), requested, requested, true, quote);
    } catch (error) { console.warn('official-web', { host: 'publications.europa.eu', celex, failure: error instanceof Error ? error.message : 'unknown' }); }
  }
  try {
    const signal = AbortSignal.timeout(15_000);
    let page = await fetchOfficial(requested, signal, undefined, allowedIn(scope), open, true);
    // A frameset or a meta refresh is followed (twice at most) to the page that holds the text.
    for (let hop = 0; hop < 2 && page.kind === 'html'; hop++) {
      const next = prepareOfficialHtml(page.text, page.url, open).textLength < MIN_TEXT ? onwardUrl(page.text, page.url, open) : null;
      if (!next) break;
      page = await fetchOfficial(next, signal, undefined, allowedIn(scope), open, true);
    }
    if (page.kind === 'pdf') return pageResponse(notice('PDF', page.url), requested, page.url, 'pdf');
    if (page.kind === 'html') return render(page.text, requested, page.url, false, quote, open, new URL(request.url).origin);
    const failed = pageResponse(notice(open ? 'This page did not open in the reader.' : 'This official page did not open in the reader.', page.url), requested, page.url, 'error', [], 502);
    // The reason (not_found, busy, refused, too_large, unavailable) for the viewer's message.
    failed.headers.set('X-Page-Error', page.error);
    return failed;
  } catch (error) {
    console.warn('official-web', { host: new URL(requested).hostname, failure: error instanceof Error ? (error.cause as { code?: string } | undefined)?.code || error.name : 'unknown' });
    return pageResponse(notice(open ? 'This page did not open in the reader.' : 'This official page did not open in the reader.', requested), requested, requested, 'error', [], 502);
  }
}

// CELLAR (up to 20 s) and then the page itself (up to 15 s) must both fit: 30 s cut the fallback short.
export const config = { maxDuration: 60 };
export default { fetch: (request: Request) => officialWebResponse(request) };
