import { handleInboundEmail } from '../server/inbound/email.ts';
export const config = { maxDuration: 800 };
export default { fetch: (request: Request) => handleInboundEmail(request) };
