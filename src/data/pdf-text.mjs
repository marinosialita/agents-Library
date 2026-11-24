/** PDF.js getTextContent relies on ReadableStream async iteration, absent in Safari 18.
 * Consume its public stream with getReader instead; do not patch browser globals. */
export async function pdfTextItems(page) {
  const reader = page.streamTextContent().getReader();
  const items = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return items;
      items.push(...value.items);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Plain native lines for terminology preparation, never a replacement for page/layout transcription. */
export function pdfTextLines(items) {
  const lines=[];let line='',y;
  const flush=()=>{if(line.trim())lines.push(line.trim());line='';};
  for(const item of items){
    if(typeof item.str!=='string')continue;
    const nextY=item.transform?.[5];
    if(y!==undefined&&nextY!==undefined&&Math.abs(nextY-y)>2)flush();
    line+=(line?' ':'')+item.str;y=nextY;
    if(item.hasEOL)flush();
  }
  flush();return lines;
}
