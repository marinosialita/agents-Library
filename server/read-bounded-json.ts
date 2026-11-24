export class JsonBodyError extends Error {
  constructor(readonly status: 400 | 413) { super(status === 413 ? 'request_too_large' : 'invalid_json'); }
}

/** Enforce bytes while reading, including chunked bodies without Content-Length. */
export async function readBoundedJson(request: Pick<Request, 'headers' | 'body'>, limit: number): Promise<unknown> {
  if (Number(request.headers.get('Content-Length')) > limit) throw new JsonBodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new JsonBodyError(400);
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel().catch(() => {}); throw new JsonBodyError(413); }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } catch (error) {
    if (error instanceof JsonBodyError) throw error;
    throw new JsonBodyError(400);
  } finally { reader.releaseLock(); }
}

/** A response body as text, at most `limit` bytes while it arrives (13 Nov 2026, code review: a chunked body has no
 *  Content-Length, and reading it whole before cutting kept it all in memory). Null when it is larger. */
export async function readBoundedText(response: Pick<Response, 'headers' | 'body'>, limit: number): Promise<string | null> {
  if (Number(response.headers.get('Content-Length')) > limit) { await response.body?.cancel().catch(() => {}); return null; }
  const reader = response.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder(); const parts: string[] = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel().catch(() => {}); return null; }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally { reader.releaseLock(); }
}
