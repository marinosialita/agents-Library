export function pdfTextItems(page: { streamTextContent(): ReadableStream<{ items: unknown[] }> }): Promise<any[]>;
export function pdfTextLines(items: any[]): string[];
