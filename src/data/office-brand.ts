// The house style's letterhead as the brand of the Word, Excel and PowerPoint files (7 Nov 2026).
import type { Brand } from './office/brand.ts';
import { readHouse } from './store.ts';

export function houseBrand(): Brand | undefined {
  const head = readHouse().letterhead;
  if (!head.name.trim() && !head.logo) return undefined;
  let logo: Brand['logo'];
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(head.logo);
  if (match && head.logoWidth && head.logoHeight) {
    const binary = atob(match[2]); const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    logo = { bytes, type: match[1] as 'png' | 'jpeg', width: head.logoWidth, height: head.logoHeight };
  }
  return { name: head.name.trim(), ...(head.address.trim() ? { address: head.address.trim() } : {}), ...(head.footer.trim() ? { footer: head.footer.trim() } : {}), color: head.color, ...(logo ? { logo } : {}) };
}
