// «Share to Agents» (7 Nov 2026): when the app is installed on a phone, a document, a photo or a piece of text shared
// from any other app arrives here as a POST; it is kept for a moment in this browser's cache and the app opens with it.
// Nothing else goes through this worker: every other request reaches the network as usual (no offline cache).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') event.respondWith(receive(event.request));
});
async function receive(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open('ap-shared');
    for (const key of await cache.keys()) await cache.delete(key);
    const files = form.getAll('files').filter(item => typeof item !== 'string').slice(0, 10);
    const meta = { title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''), files: files.map(file => ({ name: file.name, type: file.type })), at: Date.now() };
    await Promise.all(files.map((file, index) => cache.put(`/shared/${index}`, new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }))));
    await cache.put('/shared/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch (error) { /* nothing was shared: the app opens as usual */ }
  return Response.redirect('/?shared=1', 303);
}
