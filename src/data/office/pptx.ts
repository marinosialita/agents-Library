// An answer as a 16:9 deck that opens cleanly in PowerPoint, Keynote and LibreOffice: a title slide (title, brand,
// date), then one slide per H1/H2 section with its bullets (lists and paragraphs, H3 as a bold line; at most seven
// per slide and never more than fit, the rest on «(continued)» slides; long paragraphs cut at a sentence), tables as
// real PowerPoint tables (at most eight rows a slide, header on the accent fill), the logo top-right on every slide
// and an accent bar. Every part a package needs is here: presentation, master, two layouts, theme and properties.
import { type Brand, type Logo, accentOf, FONT, FONT_PANOSE, appPropsXml, contentTypesXml, corePropsXml, dateOr, EMU_PER_INCH, fitLogo, INK, inkAccent, LINE, logoFile, longDate, mix, MUTED, NS_REL, officeZip, onAccent, REL, type Rel, relsXml, rootRels, safeUrl, usableLogo, xml } from './brand.ts';
import { columnNumberStyle, foldTitle, type Inline, parseBlocks, plainText, readNumber, shortenInlines, type TableBlock } from './blocks.ts';

const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const IN = EMU_PER_INCH; const PT = 12700;
const SLIDE_W = 12192000; const SLIDE_H = 6858000;
const MARGIN = Math.round(0.6 * IN); const BODY_W = SLIDE_W - 2 * MARGIN;
const BODY_TOP = Math.round(1.62 * IN); const BODY_BOTTOM = SLIDE_H - Math.round(0.72 * IN);
const BUDGET = (BODY_BOTTOM - BODY_TOP) / PT - 12; // points of body height a slide may fill
const MAX_ITEMS = 7; const MAX_ROWS = 8;
const TITLE_LOGO = { w: 2.4 * IN, h: 0.9 * IN }; const SLIDE_LOGO = { w: 1.7 * IN, h: 0.6 * IN };

/** Hyperlink relationships of one slide. */
class SlideLinks {
  private ids = new Map<string, string>();
  id(url: string): string | null { const target = safeUrl(url); if (!target) return null; let id = this.ids.get(target); if (!id) { id = `rIdLink${this.ids.size + 1}`; this.ids.set(target, id); } return id; }
  rels(): Rel[] { return [...this.ids].map(([target, id]) => ({ id, type: REL.hyperlink, target, external: true })); }
}

// DrawingML text.
type RunLook = { size: number; color: string; bold?: boolean; italic?: boolean; mono?: boolean };
function runsXml(inlines: Inline[], look: RunLook, links: SlideLinks, linkColor: string): string {
  return inlines.map(inline => {
    const link = inline.link ? links.id(inline.link) : null;
    const attrs = `lang="en-US" sz="${look.size}"${look.bold || inline.bold ? ' b="1"' : ''}${look.italic || inline.italic ? ' i="1"' : ''}${link ? ' u="sng"' : ''}${inline.strike ? ' strike="sngStrike"' : ''} dirty="0"`;
    const mono = inline.code || look.mono ? '<a:latin typeface="Consolas"/><a:cs typeface="Consolas"/>' : '';
    const props = `<a:rPr ${attrs}><a:solidFill><a:srgbClr val="${link ? linkColor : look.color}"/></a:solidFill>${mono}${link ? `<a:hlinkClick r:id="${link}"/>` : ''}</a:rPr>`;
    return inline.text.replace(/\t/g, ' ').split('\n').map(part => `<a:r>${props}<a:t>${xml(part)}</a:t></a:r>`).join(`<a:br><a:rPr ${attrs}/></a:br>`);
  }).join('');
}
const para = (pPr: string, runs: string, size: number) => `<a:p>${pPr}${runs}<a:endParaRPr lang="en-US" sz="${size}" dirty="0"/></a:p>`;
const xfrm = (x: number, y: number, cx: number, cy: number) => `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>`;
const rect = (id: number, name: string, box: [number, number, number, number], color: string) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(...box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
function textShape(id: number, name: string, placeholder: string | null, box: [number, number, number, number], anchor: 't' | 'ctr' | 'b', paragraphs: string, autofit = true, listStyle = '<a:lstStyle/>'): string {
  const locks = placeholder ? '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' : '<p:cNvSpPr txBox="1"/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/>${locks}<p:nvPr>${placeholder ?? ''}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(...box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="${anchor}">${autofit ? '<a:normAutofit/>' : '<a:noAutofit/>'}</a:bodyPr>${listStyle}${paragraphs}</p:txBody></p:sp>`;
}
const logoPic = (id: number, logo: Logo, name: string, box: { w: number; h: number }, top: number) => {
  const { cx, cy } = fitLogo(logo, box.w, box.h);
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Logo" descr="${xml(name ? `${name} logo` : 'Logo')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(SLIDE_W - MARGIN - cx, top + (box.h - cy) / 2, cx, cy)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
};
const slideXml = (shapes: string) => `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

// What goes on the slides.
/** group: the Markdown list an item belongs to (kept on one slide when it can be). */
type Item = { inlines: Inline[]; level: number; marker: 'bullet' | 'number' | 'none'; number?: number; bold?: boolean; italic?: boolean; mono?: boolean; heading?: boolean; group?: number };
type Page = { kind: 'items'; items: Item[] } | { kind: 'table'; table: TableBlock; rows: Inline[][][]; heights: number[] };
type Section = { title: string; content: (Item | TableBlock)[] };
const NUMBERING = ['arabicPeriod', 'alphaLcPeriod', 'romanLcPeriod'];
const itemSize = (item: Item) => (item.mono ? 1400 : item.level === 0 ? 1800 : 1600);
const charsPerLine = (widthPt: number, sizePt: number) => Math.max(8, Math.floor(widthPt / (sizePt * 0.53)));
function itemHeight(item: Item): number {
  const size = itemSize(item) / 100;
  const indent = 0.375 * 72 * (item.level + 1);
  const lines = plainText(item.inlines).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine(BODY_W / PT - indent, size))), 0);
  return lines * size * 1.2 + (item.level === 0 ? 9 : 4) + (item.heading ? 4 : 0);
}

function sections(markdown: string, title: string): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  let group = 0; let inList = false;
  const add = (part: Item | TableBlock) => { if (!current) { current = { title: 'Overview', content: [] }; out.push(current); } current.content.push(part); };
  for (const block of parseBlocks(markdown)) {
    const listItem = block.type === 'bullet' || block.type === 'numbered';
    if (listItem && !inList) group++;
    inList = listItem;
    switch (block.type) {
      case 'heading': {
        const text = plainText(block.inlines).trim();
        if (block.level <= 2) { current = { title: foldTitle(text) === foldTitle(title) ? 'Overview' : text, content: [] }; out.push(current); }
        else add({ inlines: shortenInlines(block.inlines, 120), level: 0, marker: 'none', bold: true, heading: true });
        break;
      }
      case 'paragraph': add({ inlines: shortenInlines(block.inlines, 260), level: 0, marker: 'bullet' }); break;
      case 'bullet': add({ inlines: shortenInlines(block.inlines, 260), level: Math.min(block.level, 4), marker: 'bullet', group }); break;
      case 'numbered': add({ inlines: shortenInlines(block.inlines, 260), level: Math.min(block.level, 4), marker: 'number', number: block.number, group }); break;
      case 'quote': add({ inlines: shortenInlines(block.inlines, 260), level: 0, marker: 'none', italic: true }); break;
      case 'code': { const lines = block.text.split('\n'); add({ inlines: [{ text: lines.slice(0, 8).map(line => (line.length > 110 ? line.slice(0, 109) + '…' : line)).join('\n') + (lines.length > 8 ? '\n…' : '') }], level: 0, marker: 'none', mono: true }); break; }
      case 'table': if (block.header.length) add(block); break;
      case 'rule': break;
    }
  }
  return out.filter(section => section.content.length);
}

// Tables on slides.
type TableLook = { size: number; widths: number[]; align: ('l' | 'ctr' | 'r')[] };
function tableLook(table: TableBlock): TableLook {
  const columns = table.header.length;
  const size = columns <= 3 ? 1400 : columns <= 5 ? 1200 : columns <= 7 ? 1100 : 1000;
  const all = [table.header, ...table.rows];
  const weights = Array.from({ length: columns }, (_, c) => Math.min(Math.max(...all.map(row => Math.min(plainText(row[c] ?? []).length, 140))), 40) + 4);
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(weight => Math.floor((weight / sum) * BODY_W));
  widths[widths.length - 1] += BODY_W - widths.reduce((a, b) => a + b, 0);
  const styles = Array.from({ length: columns }, (_, c) => columnNumberStyle(table.rows.map(row => plainText(row[c] ?? []))));
  const align = Array.from({ length: columns }, (_, c): 'l' | 'ctr' | 'r' => {
    const set = table.align[c]; if (set === 'center') return 'ctr'; if (set === 'right') return 'r'; if (set === 'left') return 'l';
    const filled = table.rows.map(row => plainText(row[c] ?? []).trim()).filter(Boolean);
    return filled.length && filled.every(text => readNumber(text, styles[c]) || /^[-–—]$/.test(text)) ? 'r' : 'l';
  });
  return { size, widths, align };
}
function rowHeight(row: Inline[][], look: TableLook): number {
  const size = look.size / 100;
  const lines = Math.max(1, ...row.map((cell, c) => plainText(cell).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine(look.widths[c] / PT - 15, size))), 0)));
  return lines * size * 1.2 + 9;
}
function tableXml(id: number, table: TableBlock, rows: Inline[][][], heights: number[], accent: string, links: SlideLinks): string {
  const look = tableLook(table);
  const line = (side: string) => `<a:${side} w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="${LINE}"/></a:solidFill><a:prstDash val="solid"/></a:${side}>`;
  const borders = ['lnL', 'lnR', 'lnT', 'lnB'].map(line).join('');
  const band = mix(accent, 'FFFFFF', 0.94); const ink = inkAccent(accent);
  const cell = (inlines: Inline[], c: number, fill: string | null, text: RunLook) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(`<a:pPr algn="${look.align[c]}"/>`, runsXml(inlines, text, links, fill === accent ? text.color : ink), look.size)}</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">${borders}${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>'}</a:tcPr></a:tc>`;
  const clip = (inlines: Inline[]) => shortenInlines(inlines, 140);
  const head = `<a:tr h="${Math.round(heights[0] * PT)}">${table.header.map((inlines, c) => cell(clip(inlines), c, accent, { size: look.size, color: onAccent(accent), bold: true })).join('')}</a:tr>`;
  const body = rows.map((row, r) => `<a:tr h="${Math.round(heights[r + 1] * PT)}">${row.map((inlines, c) => cell(clip(inlines), c, r % 2 ? band : null, { size: look.size, color: INK })).join('')}</a:tr>`).join('');
  const height = heights.reduce((a, b) => a + b, 0) * PT;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${MARGIN}" y="${BODY_TOP}"/><a:ext cx="${BODY_W}" cy="${Math.round(height)}"/></p:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${look.widths.map(width => `<a:gridCol w="${width}"/>`).join('')}</a:tblGrid>${head}${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** Items cut into as few slides as fit (at most seven items and the body's height each), then, among those, the cut
 *  that never leaves a bold line at a slide's foot, keeps lists (numbered ones above all) whole and evens the slides. */
function paginate(items: Item[]): Item[][] {
  const n = items.length;
  const heights = items.map(itemHeight);
  const numbered = new Set(items.filter(item => item.marker === 'number').map(item => item.group));
  const breakCost = (k: number) => {
    const before = items[k - 1]; const after = items[k]; let cost = 0;
    if (before.heading) cost += 1e5;
    if (before.group !== undefined && before.group === after.group) cost += numbered.has(before.group) ? 1e4 : 300;
    if (after.level > 0) cost += 1e3;
    return cost;
  };
  const best = new Array<number>(n + 1).fill(Infinity); const from = new Array<number>(n + 1).fill(0); best[0] = 0;
  for (let end = 1; end <= n; end++) {
    let height = 0;
    for (let start = end - 1; start >= 0 && end - start <= MAX_ITEMS; start--) {
      height += heights[start];
      if (height > BUDGET && end - start > 1) break;
      const cost = best[start] + 1e6 + (end - start) ** 2 * 10 + (start > 0 ? breakCost(start) : 0);
      if (cost < best[end]) { best[end] = cost; from[end] = start; }
    }
  }
  const out: Item[][] = [];
  for (let end = n; end > 0; end = from[end]) out.unshift(items.slice(from[end], end));
  return out;
}

/** A section's content cut into slides: items by count and height, tables by rows and height. */
function pages(section: Section): Page[] {
  const out: Page[] = [];
  let items: Item[] = [];
  const flush = () => { for (const page of paginate(items)) out.push({ kind: 'items', items: page }); items = []; };
  for (const part of section.content) {
    if ('type' in part) {
      flush();
      const look = tableLook(part);
      const clipRow = (row: Inline[][]) => row.map(cell => shortenInlines(cell, 140));
      const head = rowHeight(clipRow(part.header), look);
      const heights = part.rows.map(row => rowHeight(clipRow(row), look));
      // Rows by count and height; then the same number of slides with the rows spread evenly.
      const split = (max: number) => {
        const chunks: number[][] = []; let chunk: number[] = []; let total = head;
        heights.forEach((height, index) => { if (chunk.length && (chunk.length >= max || total + height > BUDGET)) { chunks.push(chunk); chunk = []; total = head; } chunk.push(index); total += height; });
        if (chunk.length || !chunks.length) chunks.push(chunk);
        return chunks;
      };
      const greedy = split(MAX_ROWS);
      const even = split(Math.ceil(part.rows.length / greedy.length));
      for (const chunk of even.length === greedy.length ? even : greedy) out.push({ kind: 'table', table: part, rows: chunk.map(index => part.rows[index]), heights: [head, ...chunk.map(index => heights[index])] });
      continue;
    }
    items.push(part);
  }
  flush();
  return out;
}

const STEP = 342900;
/** The body's list levels: indents, spacing and bullets live here, not on each paragraph, because Apple's
 *  renderer (Quick Look, Keynote's import) misplaces a bullet whose paragraph sets its own indent. */
const bodyListStyle = (accent: string) => `<a:lstStyle>${Array.from({ length: 5 }, (_, level) => `<a:lvl${level + 1}pPr marL="${(level + 1) * STEP}" indent="-${STEP}"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="${level ? 400 : 900}"/></a:spcBef><a:buClr><a:srgbClr val="${accent}"/></a:buClr><a:buSzPct val="100000"/><a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="${level % 2 ? '–' : '•'}"/><a:defRPr sz="${level ? 1600 : 1800}"/></a:lvl${level + 1}pPr>`).join('')}</a:lstStyle>`;
function itemXml(item: Item, accent: string, links: SlideLinks): string {
  const size = itemSize(item); const ink = inkAccent(accent);
  const lvl = item.level ? ` lvl="${item.level}"` : '';
  let pPr: string;
  if (item.marker === 'none') pPr = `<a:pPr marL="0" indent="0"><a:spcBef><a:spcPts val="${item.heading ? 1200 : 900}"/></a:spcBef><a:buNone/></a:pPr>`;
  else if (item.marker === 'number') pPr = `<a:pPr${lvl}><a:buClr><a:srgbClr val="${ink}"/></a:buClr><a:buFont typeface="+mj-lt"/><a:buAutoNum type="${NUMBERING[item.level % 3]}"${item.number && item.number !== 1 ? ` startAt="${Math.max(1, item.number)}"` : ''}/></a:pPr>`;
  else pPr = lvl ? `<a:pPr${lvl}/>` : '';
  const look: RunLook = { size, color: item.italic ? '4B5563' : item.heading ? ink : INK, bold: item.bold, italic: item.italic, mono: item.mono };
  return para(pPr, runsXml(item.inlines, look, links, ink), size);
}

// Master, layouts, theme.
function themeXml(accent: string): string {
  const color = (name: string, value: string) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
  const line = (width: number) => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const font = `<a:latin typeface="${xml(FONT)}" panose="${FONT_PANOSE}" pitchFamily="34" charset="0"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Agents"><a:themeElements>`
    + `<a:clrScheme name="Agents">${color('dk1', INK)}${color('lt1', 'FFFFFF')}${color('dk2', '374151')}${color('lt2', 'F3F4F6')}${color('accent1', accent)}${color('accent2', mix(accent, 'FFFFFF', 0.35))}${color('accent3', '64748B')}${color('accent4', 'A3A3A3')}${color('accent5', mix(accent, '000000', 0.35))}${color('accent6', 'CBD5E1')}${color('hlink', inkAccent(accent))}${color('folHlink', '6B21A8')}</a:clrScheme>`
    + `<a:fontScheme name="Agents"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme>`
    + '<a:fmtScheme name="Agents"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill></a:fillStyleLst>'
    + `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>`
    + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:shade val="90000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'
    + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}
const defRPr = (size: number, bold = false, font = '+mn') => `<a:defRPr sz="${size}"${bold ? ' b="1"' : ''} kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="${font}-lt"/><a:ea typeface="${font}-ea"/><a:cs typeface="${font}-cs"/></a:defRPr>`;
const levelStyles = (sizes: number[], bullets: boolean) => sizes.map((size, index) => `<a:lvl${index + 1}pPr marL="${bullets ? (index + 1) * 342900 : 0}" indent="${bullets ? -342900 : 0}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="${index ? 400 : 900}"/></a:spcBef>${bullets ? '<a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/>' : '<a:buNone/>'}${defRPr(size)}</a:lvl${index + 1}pPr>`).join('');
const TITLE_BOX: [number, number, number, number] = [MARGIN, 0.42 * IN, BODY_W, 0.9 * IN];
const BODY_BOX: [number, number, number, number] = [MARGIN, BODY_TOP, BODY_W, BODY_BOTTOM - BODY_TOP];
const COVER_TITLE: [number, number, number, number] = [1.1 * IN, 1.75 * IN, SLIDE_W - 2.1 * IN, 2.45 * IN];
const COVER_SUB: [number, number, number, number] = [1.1 * IN, 4.62 * IN, SLIDE_W - 2.1 * IN, 1.3 * IN];
const placeholder = (id: number, name: string, ph: string, box: [number, number, number, number], anchor: 't' | 'b', text: string) => textShape(id, name, ph, box, anchor, `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${text}</a:t></a:r></a:p>`);
const tree = (shapes: string) => `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree>`;
const masterXml = () => `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
  + tree(placeholder(2, 'Title Placeholder 1', '<p:ph type="title"/>', TITLE_BOX, 'b', 'Title') + placeholder(3, 'Text Placeholder 2', '<p:ph type="body" idx="1"/>', BODY_BOX, 't', 'Text'))
  + '</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
  + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst>'
  + `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="95000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>${defRPr(2800, true, '+mj')}</a:lvl1pPr></p:titleStyle>`
  + `<p:bodyStyle>${levelStyles([1800, 1600, 1600, 1600, 1600], true)}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${levelStyles([1800], false)}</p:otherStyle></p:txStyles></p:sldMaster>`;
const layoutXml = (cover: boolean) => `<p:sldLayout ${NS} type="${cover ? 'title' : 'obj'}" preserve="1"><p:cSld name="${cover ? 'Title Slide' : 'Title and Content'}">`
  + tree(cover
    ? placeholder(2, 'Title 1', '<p:ph type="ctrTitle"/>', COVER_TITLE, 'b', 'Title') + placeholder(3, 'Subtitle 2', '<p:ph type="subTitle" idx="1"/>', COVER_SUB, 't', 'Subtitle')
    : placeholder(2, 'Title 1', '<p:ph type="title"/>', TITLE_BOX, 'b', 'Title') + placeholder(3, 'Content Placeholder 2', '<p:ph idx="1"/>', BODY_BOX, 't', 'Text'))
  + '</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

export function answerPptx(input: { title: string; markdown: string; brand?: Brand; date?: Date }): Uint8Array {
  const date = dateOr(input.date); const accent = accentOf(input.brand); const ink = inkAccent(accent); const logo = usableLogo(input.brand);
  const title = String(input.title ?? '').trim() || 'Answer';
  const brandName = input.brand?.name?.trim() ?? '';
  const footerText = (input.brand?.footer?.trim() || brandName).replace(/\s*\n\s*/g, ' · ');
  const slides: { xml: string; rels: Rel[]; layout: number }[] = [];
  const rels = (layout: number, links: SlideLinks): Rel[] => [{ id: 'rIdLayout', type: `${NS_REL}/slideLayout`, target: `../slideLayouts/slideLayout${layout}.xml` }, ...(logo ? [{ id: 'rIdLogo', type: REL.image, target: `../media/${logoFile(logo)}` }] : []), ...links.rels()];

  // Title slide.
  {
    const links = new SlideLinks();
    const size = title.length > 100 ? 2800 : title.length > 60 ? 3400 : 4000;
    const titleText = title.length > 160 ? title.slice(0, 159) + '…' : title;
    const sub = (brandName ? para('<a:pPr><a:buNone/></a:pPr>', runsXml([{ text: brandName }], { size: 2000, color: INK, bold: true }, links, ink), 2000) : '')
      + para(`<a:pPr><a:spcBef><a:spcPts val="${brandName ? 400 : 0}"/></a:spcBef><a:buNone/></a:pPr>`, runsXml([{ text: longDate(date) }], { size: 1600, color: MUTED }, links, ink), 1600);
    const shapes = rect(2, 'Accent panel', [0, 0, 0.42 * IN, SLIDE_H], accent)
      + textShape(3, 'Title 1', '<p:ph type="ctrTitle"/>', COVER_TITLE, 'b', para('<a:pPr algn="l"><a:lnSpc><a:spcPct val="95000"/></a:lnSpc></a:pPr>', runsXml([{ text: titleText }], { size, color: INK, bold: true }, links, ink), size))
      + rect(4, 'Accent bar', [1.1 * IN, 4.36 * IN, 1.3 * IN, 0.07 * IN], accent)
      + textShape(5, 'Subtitle 2', '<p:ph type="subTitle" idx="1"/>', COVER_SUB, 't', sub)
      + (logo ? logoPic(6, logo, brandName, TITLE_LOGO, 0.6 * IN) : '');
    slides.push({ xml: slideXml(shapes), rels: rels(1, links), layout: 1 });
  }

  // One slide per page of each section.
  for (const section of sections(input.markdown, title)) {
    pages(section).forEach((page, index) => {
      const links = new SlideLinks();
      const number = slides.length + 1;
      const heading = (index ? `${section.title} (continued)` : section.title);
      const headingText = heading.length > 110 ? heading.slice(0, 109) + '…' : heading;
      const titleSize = headingText.length > 80 ? 2200 : headingText.length > 50 ? 2400 : 2800;
      const titleWidth = BODY_W - (logo ? SLIDE_LOGO.w + 0.3 * IN : 0);
      let shapes = textShape(2, 'Title 1', '<p:ph type="title"/>', [MARGIN, 0.42 * IN, titleWidth, 0.9 * IN], 'b', para('<a:pPr algn="l"><a:lnSpc><a:spcPct val="95000"/></a:lnSpc></a:pPr>', runsXml([{ text: headingText }], { size: titleSize, color: INK, bold: true }, links, ink), titleSize))
        + rect(3, 'Accent bar', [MARGIN, 1.4 * IN, 0.9 * IN, 0.055 * IN], accent);
      if (page.kind === 'items') shapes += textShape(4, 'Content Placeholder 2', '<p:ph idx="1"/>', BODY_BOX, 't', page.items.map(item => itemXml(item, accent, links)).join(''), true, bodyListStyle(accent));
      else shapes += tableXml(4, page.table, page.rows, page.heights, accent, links);
      const footer = (footerText ? para('<a:pPr algn="l"><a:buNone/></a:pPr>', runsXml([{ text: footerText.length > 120 ? footerText.slice(0, 119) + '…' : footerText }], { size: 1000, color: MUTED }, links, ink), 1000) : '');
      if (footer) shapes += textShape(5, 'Footer', null, [MARGIN, SLIDE_H - 0.5 * IN, BODY_W - 1.4 * IN, 0.3 * IN], 'ctr', footer, false);
      shapes += textShape(6, 'Slide Number', null, [SLIDE_W - MARGIN - 1.2 * IN, SLIDE_H - 0.5 * IN, 1.2 * IN, 0.3 * IN], 'ctr', para('<a:pPr algn="r"><a:buNone/></a:pPr>', `<a:fld id="{5B1D7C0E-2F4A-4C3B-9E1D-7A6B5C4D3E21}" type="slidenum"><a:rPr lang="en-US" sz="1000" dirty="0"><a:solidFill><a:srgbClr val="${MUTED}"/></a:solidFill></a:rPr><a:t>${number}</a:t></a:fld>`, 1000), false);
      if (logo) shapes += logoPic(7, logo, brandName, SLIDE_LOGO, 0.42 * IN + (0.9 * IN - SLIDE_LOGO.h) / 2);
      slides.push({ xml: slideXml(shapes), rels: rels(2, links), layout: 2 });
    });
  }

  const presentation = `<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>`
    + `<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${levelStyles([1800], false)}</p:defaultTextStyle></p:presentation>`;
  const extra = slides.length + 2;
  const presentationRels = relsXml([
    { id: 'rId1', type: `${NS_REL}/slideMaster`, target: 'slideMasters/slideMaster1.xml' },
    ...slides.map((_, index) => ({ id: `rId${index + 2}`, type: `${NS_REL}/slide`, target: `slides/slide${index + 1}.xml` })),
    { id: `rId${extra}`, type: `${NS_REL}/presProps`, target: 'presProps.xml' },
    { id: `rId${extra + 1}`, type: `${NS_REL}/viewProps`, target: 'viewProps.xml' },
    { id: `rId${extra + 2}`, type: REL.theme, target: 'theme/theme1.xml' },
    { id: `rId${extra + 3}`, type: `${NS_REL}/tableStyles`, target: 'tableStyles.xml' },
  ]);
  const overrides: [string, string][] = [
    ['/ppt/presentation.xml', `${PML}.presentation.main+xml`], ['/ppt/slideMasters/slideMaster1.xml', `${PML}.slideMaster+xml`],
    ['/ppt/slideLayouts/slideLayout1.xml', `${PML}.slideLayout+xml`], ['/ppt/slideLayouts/slideLayout2.xml', `${PML}.slideLayout+xml`],
    ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'], ['/ppt/presProps.xml', `${PML}.presProps+xml`],
    ['/ppt/viewProps.xml', `${PML}.viewProps+xml`], ['/ppt/tableStyles.xml', `${PML}.tableStyles+xml`],
    ...slides.map((_, index) => [`/ppt/slides/slide${index + 1}.xml`, `${PML}.slide+xml`] as [string, string]),
  ];
  const masterRel = relsXml([{ id: 'rId1', type: `${NS_REL}/slideMaster`, target: '../slideMasters/slideMaster1.xml' }]);
  const parts: [string, string | Uint8Array][] = [
    ['[Content_Types].xml', contentTypesXml(overrides)],
    ['_rels/.rels', rootRels('ppt/presentation.xml')],
    ['docProps/core.xml', corePropsXml(title, brandName || 'Agents', date)],
    ['docProps/app.xml', appPropsXml(brandName)],
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', presentationRels],
    ['ppt/presProps.xml', `<p:presentationPr ${NS}/>`],
    ['ppt/viewProps.xml', `<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`],
    ['ppt/tableStyles.xml', '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>'],
    ['ppt/theme/theme1.xml', themeXml(accent)],
    ['ppt/slideMasters/slideMaster1.xml', masterXml()],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml([{ id: 'rId1', type: `${NS_REL}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' }, { id: 'rId2', type: `${NS_REL}/slideLayout`, target: '../slideLayouts/slideLayout2.xml' }, { id: 'rId3', type: REL.theme, target: '../theme/theme1.xml' }])],
    ['ppt/slideLayouts/slideLayout1.xml', layoutXml(true)], ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', masterRel],
    ['ppt/slideLayouts/slideLayout2.xml', layoutXml(false)], ['ppt/slideLayouts/_rels/slideLayout2.xml.rels', masterRel],
  ];
  slides.forEach((slide, index) => { parts.push([`ppt/slides/slide${index + 1}.xml`, slide.xml]); parts.push([`ppt/slides/_rels/slide${index + 1}.xml.rels`, relsXml(slide.rels)]); });
  if (logo) parts.push([`ppt/media/${logoFile(logo)}`, logo.bytes]);
  return officeZip(parts, date);
}
