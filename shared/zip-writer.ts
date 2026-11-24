// Pure ZIP packaging shared by browser export and server document ingestion.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** Builds a zip archive with stored (uncompressed) entries. Enough for a small .docx. */
export function buildZip(entries: { name: string; data: Uint8Array }[], date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true); view.setUint16(8, 0, true);
    view.setUint16(10, time, true); view.setUint16(12, day, true); view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true); view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true); view.setUint16(28, 0, true);
    local.set(name, 30); local.set(entry.data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const cview = new DataView(central.buffer);
    cview.setUint32(0, 0x02014b50, true); cview.setUint16(4, 20, true); cview.setUint16(6, 20, true); cview.setUint16(8, 0x0800, true); cview.setUint16(10, 0, true);
    cview.setUint16(12, time, true); cview.setUint16(14, day, true); cview.setUint32(16, crc, true);
    cview.setUint32(20, entry.data.length, true); cview.setUint32(24, entry.data.length, true);
    cview.setUint16(28, name.length, true); cview.setUint16(30, 0, true); cview.setUint16(32, 0, true); cview.setUint16(34, 0, true); cview.setUint16(36, 0, true);
    cview.setUint32(38, 0, true); cview.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const eview = new DataView(end.buffer);
  eview.setUint32(0, 0x06054b50, true); eview.setUint16(4, 0, true); eview.setUint16(6, 0, true);
  eview.setUint16(8, entries.length, true); eview.setUint16(10, entries.length, true);
  eview.setUint32(12, centralSize, true); eview.setUint32(16, offset, true); eview.setUint16(20, 0, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const chunk of [...locals, ...centrals, end]) { out.set(chunk, cursor); cursor += chunk.length; }
  return out;
}

