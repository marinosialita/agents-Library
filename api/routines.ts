import { handleRoutines } from '../server/routines/routes.ts';
// «Routines»: briefs that run on their own and are sent to the owner (server/routines/routes.ts). Run now waits for the brief.
export const config = { maxDuration: 300 };
export default { fetch: (request: Request) => handleRoutines(request) };
