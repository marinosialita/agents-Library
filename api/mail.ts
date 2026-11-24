import { handleMail } from '../server/mail.ts';
// One e-mail for the reading panel (server/mail.ts).
export default { fetch: (request: Request) => handleMail(request) };
