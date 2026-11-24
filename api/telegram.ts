import { handleTelegram } from '../server/inbound/telegram.ts';
export const config = { maxDuration: 300 };
export default { fetch: (request: Request) => handleTelegram(request) };
