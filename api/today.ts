import { handleToday } from '../server/today.ts';
// «Today»: what needs the person now, today's meetings, what their agents did (server/today.ts).
export default { fetch: (request: Request) => handleToday(request) };
