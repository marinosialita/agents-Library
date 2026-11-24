// «Share to Agents» (7 Nov 2026): what another app shared with the installed app, picked up once from the cache the
// service worker (public/sw.js) filled, then cleared.
export type Shared = { text: string; files: File[] };

export async function takeShared(): Promise<Shared | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open('ap-shared');
    const meta = await (await cache.match('/shared/meta'))?.json().catch(() => null);
    if (!meta) return null;
    const files: File[] = [];
    for (const [index, entry] of (Array.isArray(meta.files) ? meta.files : []).entries()) {
      const response = await cache.match(`/shared/${index}`); if (!response) continue;
      files.push(new File([await response.blob()], String(entry.name || `shared-${index + 1}`), { type: String(entry.type || '') }));
    }
    for (const key of await cache.keys()) await cache.delete(key);
    const text = [meta.title, meta.text, meta.url].map((part: unknown) => typeof part === 'string' ? part.trim() : '').filter(Boolean).join('\n');
    return text || files.length ? { text, files } : null;
  } catch { return null; }
}

/** The worker only answers shares; it is registered where the browser allows it (https, or this computer). */
export function registerShareWorker() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
