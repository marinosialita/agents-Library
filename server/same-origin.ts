/** Whether a request's Origin names another site than the one serving the app. Compared by host, not by scheme: a
 *  platform proxy may hand the handler an http:// request URL for a page served over https. The Host header (or the
 *  forwarded one) is the site's own name; a page of another site cannot carry it without a preflight, which no route
 *  answers. */
export function crossOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin'); if (!origin) return false;
  const hosts = [request.headers.get('Host'), request.headers.get('X-Forwarded-Host'), new URL(request.url).host]
    .flatMap(value => value ? value.split(',') : []).map(value => value.trim().toLowerCase()).filter(Boolean);
  try { return !hosts.includes(new URL(origin).host.toLowerCase()); } catch { return true; }
}
