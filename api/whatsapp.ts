import { handleWhatsApp } from '../server/inbound/whatsapp.ts';
export const config = { maxDuration: 800 };
export default { fetch: (request: Request) => handleWhatsApp(request) };
