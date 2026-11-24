// An agent's answer as a branded Word file: real styles (Normal, Title, Heading 1–3, Quote, code, table grid), Word
// numbering for bullets and numbered lists, tables whose header row is shaded in the accent colour, clickable links,
// a letterhead with the logo, name and address, a footer with «Page X of Y», and the sources at the end. Without a
// brand it is the same clean document in a neutral blue. The package builder is shared with the redline export.
import { type Brand, type Logo, accentOf, FONT, FONT_PANOSE, appPropsXml, contentTypesXml, corePropsXml, dateOr, EMU_PER_CM, fitLogo, INK, inkAccent, LINE, logoFile, longDate, mix, MUTED, officeZip, onAccent, REL, type Rel, relsXml, rootRels, safeUrl, usableLogo, xml } from './brand.ts';
import { type Block, foldTitle, type Inline, parseBlocks, plainText, readNumber, columnNumberStyle, type TableBlock } from './blocks.ts';

export const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DRAWING_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
/** A4 with 2 cm side margins: the text column in twentieths of a point. */
export const TEXT_WIDTH = 9638;

/** Hyperlink relationships of one part, one per address. */
export class LinkRels {
  private ids = new Map<string, string>();
  id(url: string): string | null {
    const target = safeUrl(url);
    if (!target) return null;
    let id = this.ids.get(target);
    if (!id) { id = `rIdLink${this.ids.size + 1}`; this.ids.set(target, id); }
    return id;
  }
  rels(): Rel[] { return [...this.ids].map(([target, id]) => ({ id, type: REL.hyperlink, target, external: true })); }
}

// Runs.
export type RunProps = { style?: string; font?: string; bold?: boolean; italic?: boolean; strike?: boolean; color?: string; size?: number };
export function rPr(props: RunProps): string {
  const inner = (props.style ? `<w:rStyle w:val="${props.style}"/>` : '') + (props.font ? `<w:rFonts w:ascii="${xml(props.font)}" w:hAnsi="${xml(props.font)}" w:cs="${xml(props.font)}"/>` : '')
    + (props.bold ? '<w:b/><w:bCs/>' : '') + (props.italic ? '<w:i/><w:iCs/>' : '') + (props.strike ? '<w:strike/>' : '')
    + (props.color ? `<w:color w:val="${props.color}"/>` : '') + (props.size ? `<w:sz w:val="${props.size}"/><w:szCs w:val="${props.size}"/>` : '');
  return inner ? `<w:rPr>${inner}</w:rPr>` : '';
}
/** Text as w:t pieces: «\n» a line break, «\t» a tab. `tag` is w:delText inside a deletion. */
export const textXml = (text: string, tag = 'w:t') => text.split('\n').map((line, index) => (index ? '<w:br/>' : '') + line.split('\t').map((part, at) => (at ? '<w:tab/>' : '') + (part ? `<${tag} xml:space="preserve">${xml(part)}</${tag}>` : '')).join('')).join('');
export const run = (text: string, props: RunProps = {}) => `<w:r>${rPr(props)}${textXml(text)}</w:r>`;

/** A line's runs; links grouped into one w:hyperlink each. `base` is laid under every run (table header colours). */
export function runsXml(inlines: Inline[], links: LinkRels, base: RunProps = {}): string {
  const out: string[] = [];
  for (let index = 0; index < inlines.length;) {
    const inline = inlines[index];
    const props = (item: Inline): RunProps => ({ ...base, style: item.link ? 'Hyperlink' : item.code ? 'InlineCode' : base.style, bold: base.bold || item.bold, italic: base.italic || item.italic, strike: item.strike });
    if (inline.link) {
      const group: Inline[] = [];
      while (index < inlines.length && inlines[index].link === inline.link) group.push(inlines[index++]);
      const id = links.id(inline.link);
      const body = group.map(item => run(item.text, props(item))).join('');
      out.push(id ? `<w:hyperlink r:id="${id}" w:history="1">${body}</w:hyperlink>` : group.map(item => run(item.text, { ...props(item), style: base.style })).join(''));
      continue;
    }
    out.push(run(inline.text, props(inline)));
    index++;
  }
  return out.join('');
}
const paragraph = (style: string | null, content: string, extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${content}</w:p>`;

// Parts.
const fonts = (name: string) => `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:eastAsia="${name}" w:cs="${name}"/>`;
function stylesXml(accent: string): string {
  const ink = inkAccent(accent);
  const heading = (level: number, size: number, before: number, after: number) => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="${ink}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  const border = (side: string, color = LINE) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${color}"/>`;
  return `<w:styles ${W_NS}>`
    + `<w:docDefaults><w:rPrDefault><w:rPr>${fonts(FONT)}<w:color w:val="${INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    // The font on the Normal style too: Word reads the defaults above, Mac and iPhone previews only the styles.
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr>${fonts(FONT)}</w:rPr></w:style>`
    + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
    + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="60" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="${ink}"/><w:kern w:val="28"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="11"/><w:qFormat/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="8" w:color="${accent}"/></w:pBdr><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>`
    + heading(1, 32, 360, 120) + heading(2, 26, 280, 100) + heading(3, 23, 220, 80)
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>'
    + `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${accent}"/></w:pBdr><w:spacing w:before="120" w:after="160"/><w:ind w:left="284" w:right="284"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="4B5563"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:customStyle="1" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="39"/><w:pPr><w:pBdr>${border('top', 'E5E7EB')}${border('left', 'E5E7EB')}${border('bottom', 'E5E7EB')}${border('right', 'E5E7EB')}</w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F5F6F8"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/><w:ind w:left="113" w:right="113"/></w:pPr><w:rPr>${fonts('Consolas')}<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="right" w:pos="${TEXT_WIDTH}"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="right" w:pos="${TEXT_WIDTH}"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>`
    + '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
    + `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="${ink}"/><w:u w:val="single"/></w:rPr></w:style>`
    + `<w:style w:type="character" w:customStyle="1" w:styleId="InlineCode"><w:name w:val="Inline Code"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="39"/><w:rPr>${fonts('Consolas')}<w:sz w:val="19"/><w:szCs w:val="19"/><w:shd w:val="clear" w:color="auto" w:fill="F1F2F4"/></w:rPr></w:style>`
    + '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>'
    + `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => border(side)).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`
    + '</w:styles>';
}

/** Bullets (abstract 0, accent-coloured marks) and one numbering definition (1. a. i.) per numbered list, starting at
 *  its first number: a list of its own restarts in every reader, where a shared one with a start override does not. */
function numberingXml(accent: string, lists: Map<number, { numId: number; level: number; start: number }>): string {
  const marks = ['•', '–', '▪'];
  const formats: [string, string][] = [['decimal', ''], ['lowerLetter', ''], ['lowerRoman', '']];
  const level = (ilvl: number, content: string, indent: number) => `<w:lvl w:ilvl="${ilvl}">${content}<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent * (ilvl + 1)}" w:hanging="${indent}"/></w:pPr>`;
  const bullets = Array.from({ length: 9 }, (_, ilvl) => `${level(ilvl, `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${marks[ilvl % 3]}"/>`, 357)}<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:hint="default"/><w:color w:val="${accent}"/></w:rPr></w:lvl>`).join('');
  const numbers = (list: { level: number; start: number }) => Array.from({ length: 9 }, (_, ilvl) => `${level(ilvl, `<w:start w:val="${ilvl === list.level ? Math.max(0, list.start) : 1}"/><w:numFmt w:val="${formats[ilvl % 3][0]}"/><w:lvlText w:val="%${ilvl + 1}."/>`, 425)}</w:lvl>`).join('');
  const all = [...lists.values()];
  const abstracts = all.map(list => `<w:abstractNum w:abstractNumId="${list.numId}"><w:multiLevelType w:val="hybridMultilevel"/>${numbers(list)}</w:abstractNum>`).join('');
  const nums = all.map(list => `<w:num w:numId="${list.numId}"><w:abstractNumId w:val="${list.numId}"/><w:lvlOverride w:ilvl="${list.level}"><w:startOverride w:val="${Math.max(0, list.start)}"/></w:lvlOverride></w:num>`).join('');
  return `<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bullets}</w:abstractNum>${abstracts}<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums}</w:numbering>`;
}

const fontTableXml = () => `<w:fonts ${W_NS}>`
  + `<w:font w:name="${xml(FONT)}"><w:altName w:val="Calibri"/><w:panose1 w:val="${FONT_PANOSE}"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>`
  + '<w:font w:name="Calibri"><w:panose1 w:val="020F0502020204030204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>'
  + '<w:font w:name="Arial"><w:panose1 w:val="020B0604020202020204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>'
  + '<w:font w:name="Consolas"><w:panose1 w:val="020B0609020204030204"/><w:charset w:val="00"/><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font></w:fonts>';
const settingsXml = (track: boolean) => `<w:settings ${W_NS}><w:zoom w:percent="100"/>${track ? '<w:trackRevisions/>' : ''}<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

/** The logo as an inline picture (rIdLogo in the header's relationships). */
function logoDrawing(logo: Logo, cx: number, cy: number): string {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Logo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${logoFile(logo)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
/** Letterhead: logo on the left (at most 3.5 × 1.5 cm), name and address on the right, an accent rule below. */
function headerXml(brand: Brand, logo: Logo | undefined, accent: string): string {
  const name = brand.name.trim(); const address = (brand.address ?? '').trim().replace(/\n{2,}/g, '\n');
  const ink = inkAccent(accent);
  const nameRun = name ? run(name, { bold: true, color: ink, size: 22 }) : '';
  const addressRun = address ? run(address, { color: MUTED, size: 16 }) : '';
  const rule = `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="6" w:color="${accent}"/></w:pBdr>`;
  if (!logo) {
    const body = paragraph('Header', nameRun, `${address ? '' : rule}<w:spacing w:after="${address ? 20 : 0}"/>`) + (address ? paragraph('Header', addressRun, rule) : '');
    return `<w:hdr ${W_NS}>${body}</w:hdr>`;
  }
  const { cx, cy } = fitLogo(logo, 3.5 * EMU_PER_CM, 1.5 * EMU_PER_CM);
  const logoWidth = Math.min(Math.max(Math.round(cx / 635) + 120, 1700), 4000);
  const textWidth = TEXT_WIDTH - logoWidth;
  const none = ['top', 'left', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="nil"/>`);
  const borders = `<w:tblBorders>${none[0]}${none[1]}<w:bottom w:val="single" w:sz="8" w:space="0" w:color="${accent}"/>${none[2]}${none[3]}${none[4]}</w:tblBorders>`;
  const cell = (width: number, content: string) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="bottom"/></w:tcPr>${content}</w:tc>`;
  const right = '<w:jc w:val="right"/>';
  const texts = (name ? paragraph('Header', nameRun, `<w:spacing w:after="20"/>${right}`) : '') + paragraph('Header', addressRun, `<w:spacing w:after="100"/>${right}`);
  const table = `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="${logoWidth}"/><w:gridCol w:w="${textWidth}"/></w:tblGrid><w:tr>${cell(logoWidth, paragraph('Header', logoDrawing(logo, cx, cy), '<w:spacing w:after="100"/>'))}${cell(textWidth, texts)}</w:tr></w:tbl>`;
  return `<w:hdr ${W_NS} ${DRAWING_NS}>${table}${paragraph('Header', '', '<w:spacing w:after="0" w:line="120" w:lineRule="exact"/>')}</w:hdr>`;
}
const field = (code: string, shown: string) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(shown)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
/** Footer: the brand's footer line on the left, «Page X of Y» on the right, a hairline above. */
function footerXml(text: string): string {
  const page = `${run('Page ')}${field('PAGE', '1')}${run(' of ')}${field('NUMPAGES', '1')}`;
  return `<w:ftr ${W_NS}>${paragraph('Footer', `${text ? run(text.replace(/\s*\n\s*/g, ' · ')) : ''}<w:r><w:tab/></w:r>${page}`, `<w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="E5E7EB"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${TEXT_WIDTH}"/></w:tabs>`)}</w:ftr>`;
}

export type WordPackage = {
  title: string; body: string; brand?: Brand; date: Date; links: LinkRels;
  numbering?: Map<number, { numId: number; level: number; start: number }>; comments?: string; trackRevisions?: boolean;
};
/** A complete .docx around a body (paragraphs and tables, without w:sectPr). */
export function wordPackage(input: WordPackage): Uint8Array {
  const accent = accentOf(input.brand); const logo = usableLogo(input.brand);
  const brandName = input.brand?.name?.trim() ?? '';
  const letterhead = !!input.brand && (!!brandName || !!logo || !!input.brand.address?.trim());
  const brand: Brand = { ...(input.brand ?? { name: '' }), name: brandName };
  const rels: Rel[] = [
    { id: 'rIdStyles', type: REL.styles, target: 'styles.xml' },
    { id: 'rIdSettings', type: REL.settings, target: 'settings.xml' },
    { id: 'rIdFonts', type: REL.fontTable, target: 'fontTable.xml' },
    { id: 'rIdNumbering', type: REL.numbering, target: 'numbering.xml' },
    { id: 'rIdFooter', type: REL.footer, target: 'footer1.xml' },
    ...(letterhead ? [{ id: 'rIdHeader', type: REL.header, target: 'header1.xml' }] : []),
    ...(input.comments ? [{ id: 'rIdComments', type: REL.comments, target: 'comments.xml' }] : []),
    ...input.links.rels(),
  ];
  const sectPr = `<w:sectPr>${letterhead ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : ''}<w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${letterhead ? (logo ? 1871 : 1701) : 1418}" w:right="1134" w:bottom="1304" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
  const overrides: [string, string][] = [
    ['/word/document.xml', `${WML}.document.main+xml`], ['/word/styles.xml', `${WML}.styles+xml`], ['/word/settings.xml', `${WML}.settings+xml`],
    ['/word/fontTable.xml', `${WML}.fontTable+xml`], ['/word/numbering.xml', `${WML}.numbering+xml`], ['/word/footer1.xml', `${WML}.footer+xml`],
    ...(letterhead ? [['/word/header1.xml', `${WML}.header+xml`] as [string, string]] : []),
    ...(input.comments ? [['/word/comments.xml', `${WML}.comments+xml`] as [string, string]] : []),
  ];
  const parts: [string, string | Uint8Array][] = [
    ['[Content_Types].xml', contentTypesXml(overrides)],
    ['_rels/.rels', rootRels('word/document.xml')],
    ['docProps/core.xml', corePropsXml(input.title, brandName || 'Agents', input.date)],
    ['docProps/app.xml', appPropsXml(brandName)],
    ['word/document.xml', `<w:document ${W_NS}><w:body>${input.body}${sectPr}</w:body></w:document>`],
    ['word/_rels/document.xml.rels', relsXml(rels)],
    ['word/styles.xml', stylesXml(accent)],
    ['word/settings.xml', settingsXml(!!input.trackRevisions)],
    ['word/fontTable.xml', fontTableXml()],
    ['word/numbering.xml', numberingXml(accent, input.numbering ?? new Map())],
    ['word/footer1.xml', footerXml(input.brand?.footer?.trim() ?? '')],
  ];
  if (letterhead) {
    parts.push(['word/header1.xml', headerXml(brand, logo, accent)]);
    if (logo) { parts.push(['word/_rels/header1.xml.rels', relsXml([{ id: 'rIdLogo', type: REL.image, target: `media/${logoFile(logo)}` }])]); parts.push([`word/media/${logoFile(logo)}`, logo.bytes]); }
  }
  if (input.comments) parts.push(['word/comments.xml', input.comments]);
  return officeZip(parts, input.date);
}

// The answer's blocks as Word body XML.
function tableXml(block: TableBlock, accent: string, links: LinkRels): string {
  const columns = block.header.length;
  const all = [block.header, ...block.rows];
  const weights = Array.from({ length: columns }, (_, c) => Math.min(Math.max(...all.map(row => Math.max(...plainText(row[c] ?? []).split('\n').map(line => line.length))), 4), 48));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let widths = weights.map(weight => Math.max(720, Math.round((weight / sum) * TEXT_WIDTH)));
  const over = widths.reduce((a, b) => a + b, 0) - TEXT_WIDTH;
  if (over > 0) { const widest = widths.indexOf(Math.max(...widths)); widths[widest] = Math.max(720, widths[widest] - over); }
  if (widths.reduce((a, b) => a + b, 0) > TEXT_WIDTH) widths = widths.map(() => Math.floor(TEXT_WIDTH / columns));
  const style = Array.from({ length: columns }, (_, c) => columnNumberStyle(block.rows.map(row => plainText(row[c] ?? []))));
  const numeric = Array.from({ length: columns }, (_, c) => { const filled = block.rows.map(row => plainText(row[c] ?? []).trim()).filter(Boolean); return filled.length > 0 && filled.every(text => readNumber(text, style[c]) || /^[-–—]$/.test(text)); });
  const jc = (c: number) => { const align = block.align[c] ?? (numeric[c] ? 'right' : null); return align === 'right' ? '<w:jc w:val="right"/>' : align === 'center' ? '<w:jc w:val="center"/>' : ''; };
  const headFill = accent; const headText = onAccent(accent); const band = mix(accent, 'FFFFFF', 0.94);
  const cell = (inlines: Inline[], c: number, fill: string | null, base: RunProps) => `<w:tc><w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${jc(c)}</w:pPr>${runsXml(inlines, links, base)}</w:p></w:tc>`;
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/>`;
  const head = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${block.header.map((inlines, c) => cell(inlines, c, headFill, { bold: true, color: headText })).join('')}</w:tr>`;
  const body = block.rows.map((row, r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((inlines, c) => cell(inlines, c, r % 2 ? band : null, {})).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${head}${body}</w:tbl>`
    + paragraph(null, '', '<w:spacing w:before="0" w:after="120"/>');
}

/** Word numbering for the numbered lists: list id → w:num id, level and first number. */
function numberedLists(blocks: Block[], first = 2): Map<number, { numId: number; level: number; start: number }> {
  const lists = new Map<number, { numId: number; level: number; start: number }>();
  for (const block of blocks) if (block.type === 'numbered' && !lists.has(block.list)) lists.set(block.list, { numId: first + lists.size, level: block.level, start: block.number });
  return lists;
}
function bodyXml(blocks: Block[], accent: string, links: LinkRels, lists: Map<number, { numId: number; level: number; start: number }>): string {
  const listPr = (numId: number, level: number) => `<w:numPr><w:ilvl w:val="${Math.min(level, 8)}"/><w:numId w:val="${numId}"/></w:numPr>`;
  return blocks.map(block => {
    switch (block.type) {
      case 'heading': return paragraph(`Heading${Math.min(block.level, 3)}`, runsXml(block.inlines, links));
      case 'paragraph': return paragraph(null, runsXml(block.inlines, links));
      case 'bullet': return paragraph('ListParagraph', runsXml(block.inlines, links), listPr(1, block.level));
      case 'numbered': return paragraph('ListParagraph', runsXml(block.inlines, links), listPr(lists.get(block.list)!.numId, block.level));
      case 'quote': return paragraph('Quote', runsXml(block.inlines, links));
      case 'rule': return paragraph(null, '', `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${LINE}"/></w:pBdr><w:spacing w:before="120" w:after="240"/>`);
      case 'code': return paragraph('CodeBlock', run(block.text));
      case 'table': return tableXml(block, accent, links);
    }
  }).join('');
}

/** The answer as a .docx: title, date, the answer's blocks, then the sources as numbered links. */
export function answerDocx(input: { title: string; markdown: string; brand?: Brand; sources?: { title: string; url: string }[]; date?: Date }): Uint8Array {
  const date = dateOr(input.date); const accent = accentOf(input.brand);
  const title = String(input.title ?? '').trim() || 'Answer';
  const blocks = parseBlocks(input.markdown);
  // The answer often opens with its own title: once is enough.
  if (blocks[0]?.type === 'heading' && foldTitle(plainText(blocks[0].inlines)) === foldTitle(title)) blocks.shift();
  const links = new LinkRels();
  const lists = numberedLists(blocks);
  const parts = [paragraph('Title', run(title)), paragraph('Subtitle', run(longDate(date))), bodyXml(blocks, accent, links, lists)];
  const seen = new Set<string>();
  const sources = (input.sources ?? []).filter(source => source && typeof source.url === 'string' && safeUrl(source.url) && !seen.has(source.url) && seen.add(source.url));
  if (sources.length) {
    const numId = 2 + lists.size;
    lists.set(-1, { numId, level: 0, start: 1 });
    parts.push(paragraph('Heading1', run('Sources')));
    for (const source of sources) {
      const label = String(source.title ?? '').trim() || source.url;
      const link = runsXml([{ text: label, link: source.url }], links);
      const address = label === source.url ? '' : `<w:r><w:br/></w:r>${run(source.url, { color: MUTED, size: 17 })}`;
      parts.push(paragraph('ListParagraph', link + address, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr><w:spacing w:after="100"/>`));
    }
  }
  return wordPackage({ title, body: parts.join(''), brand: input.brand, date, links, numbering: lists });
}
