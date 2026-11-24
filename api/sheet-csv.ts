import { handleSheetCsv } from '../server/sheet-csv.ts';
export const config = { maxDuration: 30 };
export default { fetch: (request: Request) => handleSheetCsv(request) };
