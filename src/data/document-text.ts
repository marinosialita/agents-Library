// Reads the text of a document in the browser, for the chat attachments. Loaded lazily: the PDF
// reader is a large chunk. PDF via pdf.js, Word (.docx) through its own zip + XML, text files as they are.
import { pdfTextItems } from './pdf-text.mjs';
import { workbookText } from './xlsx-text.ts';

export const DOCUMENT_FILE_CHARS = 400_000;
/** The document kinds the on-device reader accepts, by file name. */
export function attachmentKind(name: string): 'pdf' | 'docx' | 'xlsx' | 'text' | null {
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.docx$/i.test(name)) return 'docx';
  if (/\.(xlsx|xlsm)$/i.test(name)) return 'xlsx';
  if (/\.(txt|md|markdown|csv)$/i.test(name)) return 'text';
  return null;
}

export type ExtractedDocument = { text: string; pages?: number; truncated: boolean };

export type DocumentReadOptions = { includeFormFields?: boolean; signal?: AbortSignal; onProgress?: (progress: { page: number; total: number }) => void; readImagePage?: (canvas: HTMLCanvasElement, page: number, total: number) => Promise<string> };

export async function extractDocumentText(file: File, limit: number = DOCUMENT_FILE_CHARS, options: DocumentReadOptions = {}): Promise<ExtractedDocument> {
  options.signal?.throwIfAborted();
  const kind = attachmentKind(file.name);
  if (/\.(png|jpe?g|webp|heic|heif|gif|bmp|tiff?)$/i.test(file.name)) throw new Error('Images cannot be read by this on-device text reader yet. Use a PDF with selectable text, a Word (.docx) file, or paste the text. Nothing was uploaded.');
  if (/\.doc$/i.test(file.name)) throw new Error('Save this older Word file as .docx and try again. Nothing was uploaded.');
  if (/\.xls$/i.test(file.name)) throw new Error('Save this older Excel file as .xlsx and try again. Nothing was uploaded.');
  if (!kind) throw new Error('Unsupported file type. Accepted: PDF, Word (.docx), Excel (.xlsx), TXT, Markdown, CSV.');
  const raw: { text: string; pages?: number } = kind === 'pdf' ? await pdfText(file, limit, options) : kind === 'docx' ? { text: await docxText(file) } : kind === 'xlsx' ? { text: await xlsxText(file) } : { text: await file.text() };
  options.signal?.throwIfAborted();
  const text = tidy(raw.text);
  if (!text) throw new Error(kind === 'pdf' ? 'No text was found in the PDF. If it is a scan, a copy with a text layer (OCR) is needed.' : 'No text was found in the file.');
  return { text: text.slice(0, limit), ...(raw.pages ? { pages: raw.pages } : {}), truncated: text.length > limit };
}

function tidy(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t ]+\n/g, '\n').replace(/[ \t ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function pdfText(file: File, limit: number, options: DocumentReadOptions): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  options.signal?.throwIfAborted();
  const task = pdfjs.getDocument({ data });
  let destroying: Promise<void> | undefined;
  const destroy = () => destroying ??= task.destroy().catch(() => {});
  const stop = () => { void destroy(); };
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    const document = await task.promise;
    options.signal?.throwIfAborted();
    options.onProgress?.({ page: 0, total: document.numPages });
    const parts: string[] = [];
    let length = 0;
    for (let number = 1; number <= document.numPages && length < limit * 1.2; number++) {
      options.signal?.throwIfAborted();
      const page = await document.getPage(number);
      try {
        const items = await pdfTextItems(page);
        options.signal?.throwIfAborted();
        const lines: string[] = [];
        let line = '';
        for (const item of items) {
          if (!('str' in item)) continue;
          // Fragments arrive without the spaces between them; a missing space costs more than an extra one.
          if (line && item.str && !/\s$/.test(line) && !/^[\s,.;:·)\]»%]/.test(item.str)) line += ' ';
          line += item.str;
          if (item.hasEOL) { lines.push(line); line = ''; }
        }
        if (line) lines.push(line);
        if (options.includeFormFields) {
          // AcroForm values live in widgets, not the page text stream. Read their
          // stored text locally; do not execute actions or follow annotation URLs.
          const annotations = await page.getAnnotations({ intent: 'display' });
          options.signal?.throwIfAborted();
          for (const field of annotations) {
            if (field.subtype !== 'Widget' || !['Tx', 'Ch'].includes(field.fieldType)) continue;
            const values = Array.isArray(field.fieldValue) ? field.fieldValue : [field.fieldValue];
            for (const value of values) {
              if (typeof value !== 'string' || !value.trim()) continue;
              const label = field.alternativeText || field.fieldName;
              lines.push(typeof label === 'string' && label.trim() ? `${label}: ${value}` : value);
              const choice = field.fieldType === 'Ch' && field.options?.find((option: { exportValue?: string; displayValue?: string }) => option.exportValue === value);
              if (choice && typeof choice.displayValue === 'string' && choice.displayValue !== value) lines.push(choice.displayValue);
            }
          }
        }
        let pageText = lines.join('\n').trim();
        // A selectable footer/header does not mean the scanned body was read.
        // Only the private reader supplies OCR; ordinary chat extraction is unchanged.
        const imageOps = options.readImagePage ? await page.getOperatorList() : undefined;
        options.signal?.throwIfAborted();
        const imagePaint = options.readImagePage ? new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
          pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintInlineImageXObjectGroup,
          pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageMaskXObjectGroup,
          pdfjs.OPS.paintImageMaskXObjectRepeat]) : new Set<number>();
        const hasImages = imageOps?.fnArray.some(op => imagePaint.has(op));
        if (options.readImagePage && (!pageText || hasImages)) {
          const original = page.getViewport({ scale: 1 });
          const scale = Math.min(2, Math.sqrt(4_000_000 / (original.width * original.height)));
          const viewport = page.getViewport({ scale });
          const canvas = window.document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          try {
            const textPaint = new Set([pdfjs.OPS.showText, pdfjs.OPS.showSpacedText,
              pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText]);
            const rendering = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport,
              // Read raster content without re-OCRing the already extracted native text.
              ...(pageText && imageOps ? { operationsFilter: (index: number) => !textPaint.has(imageOps.fnArray[index]) } : {}),
            });
            const cancel = () => rendering.cancel();
            options.signal?.addEventListener('abort', cancel, { once: true });
            try { await rendering.promise; } finally { options.signal?.removeEventListener('abort', cancel); }
            options.signal?.throwIfAborted();
            const imageText = (await options.readImagePage(canvas, number, document.numPages)).trim();
            if (imageText) {
              // Existing searchable OCR layers may duplicate image text. Keep every
              // new line, including identifiers, without fuzzy spelling correction.
              const native = ` ${pageText.normalize('NFC').replace(/\s+/gu, ' ')} `;
              const additional = imageText.split(/\r?\n/).filter(line => {
                const value = line.normalize('NFC').replace(/\s+/gu, ' ').trim();
                return value && !native.includes(` ${value} `);
              }).join('\n');
              pageText = [pageText, additional].filter(Boolean).join('\n');
            }
            if (!pageText) throw new Error(`No readable text was found on page ${number}. Use a clearer scan or a text document; no partial copy was opened.`);
          } finally { canvas.width = 0; canvas.height = 0; }
        }
        options.onProgress?.({ page: number, total: document.numPages });
        if (!pageText) continue;
        const block = `[p. ${number}]\n${pageText}`;
        parts.push(block);
        length += block.length;
      } finally { page.cleanup(); }
    }
    return { text: parts.join('\n\n'), pages: document.numPages };
  } finally {
    options.signal?.removeEventListener('abort', stop);
    await destroy();
  }
}

async function xlsxText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return (await workbookText(path => zipEntryText(bytes, path))).text;
}

async function docxText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const xml = await zipEntryText(bytes, 'word/document.xml');
  if (!xml) throw new Error('The Word file could not be read. Save it again as .docx.');
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('The Word document contains damaged XML. Save a new .docx copy and try again.');
  const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs: string[] = [];
  for (const paragraph of Array.from(parsed.getElementsByTagNameNS(wordNamespace, 'p'))) {
    let text = '';
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        const element = child as Element;
        const name = element.namespaceURI === wordNamespace ? element.localName : '';
        if (name === 't') text += child.textContent || '';
        else if (name === 'tab') text += '\t';
        else if (name === 'br' || name === 'cr') text += '\n';
        else if (child.childNodes.length) walk(child);
      }
    };
    walk(paragraph);
    paragraphs.push(text);
  }
  return paragraphs.join('\n');
}

/** One entry of a zip file (a .docx is one), inflated by the browser. Large zip64 archives are not documents. */
export async function zipEntryText(bytes: Uint8Array, wanted: string): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let directoryEnd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 22 - 65_535); index--) {
    if (view.getUint32(index, true) === 0x06054b50) { directoryEnd = index; break; }
  }
  if (directoryEnd < 0) return null;
  const count = view.getUint16(directoryEnd + 10, true);
  let offset = view.getUint32(directoryEnd + 16, true);
  const decoder = new TextDecoder();
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return null;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(start, start + compressedSize);
    if (method === 0) return decoder.decode(data);
    if (method !== 8) return null;
    const inflated = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(inflated).text();
  }
  return null;
}
