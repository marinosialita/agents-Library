import { handleConnectedRun } from '../server/connected-run.ts';
// A brief on the owner's connected apps, or on the demo inbox (server/connected-run.ts).
export const config = { maxDuration: 300 };
export default { fetch: (request: Request) => handleConnectedRun(request) };
