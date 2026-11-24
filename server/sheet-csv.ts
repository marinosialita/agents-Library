// GET /api/sheet-csv?url=<Google Sheets link> (13 Nov 2026, «every row»): a Google Sheet shared as «anyone with the
// link» read as CSV, for the browser (which cannot fetch it across sites). Only docs.google.com spreadsheet exports, at
// most 5 MB, no cookies sent; a private sheet answers «private» so the page can say how to share it or attach it.
import { sheetCsvUrl } from '../shared/table-rows.ts';
import { crossOrigin } from './same-origin.ts';
import { readBoundedText } from './read-bounded-json.ts';
import { actorOf, liveComposioDeps } from './connections.ts';

export const SHEET_BYTES = 5_000_000;
export function createSheetCsvHandler(deps: { fetcher: typeof fetch; /** 13 Nov 2026 (code review): only a signed-in person may make the server fetch a sheet. */ signedIn?(request: Request): Promise<boolean> }) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
    if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
    if (crossOrigin(request)) return reply({ error: 'invalid_origin' }, 403);
    if (deps.signedIn && !(await deps.signedIn(request))) return reply({ error: 'sign_in' }, 401);
    const target = sheetCsvUrl(new URL(request.url).searchParams.get('url') ?? '');
    if (!target) return reply({ error: 'not_a_sheet' }, 400);
    try {
      const response = await deps.fetcher(target, { redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]), headers: { Accept: 'text/csv' } });
      // A private sheet redirects to Google's sign-in (or answers 401/403): never followed.
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location') ?? '';
        if (!/^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//.test(next)) return reply({ error: 'private' }, 403);
        const moved = await deps.fetcher(next, { redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
        return read(moved);
      }
      return read(response);
    } catch { return reply({ error: 'unavailable' }, 502); }
    async function read(response: Response): Promise<Response> {
      if (response.status === 401 || response.status === 403 || /text\/html/i.test(response.headers.get('content-type') ?? '')) return reply({ error: 'private' }, 403);
      if (!response.ok) return reply({ error: response.status === 404 ? 'not_found' : 'unavailable' }, response.status === 404 ? 404 : 502);
      const text = await readBoundedText(response, SHEET_BYTES); if (text === null) return reply({ error: 'too_large' }, 413);
      return reply({ csv: text });
    }
  };
}
export const handleSheetCsv = createSheetCsvHandler({ fetcher: (...args) => fetch(...args), signedIn: async request => !!(await actorOf(request, liveComposioDeps)) });
