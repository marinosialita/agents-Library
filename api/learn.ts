import { handleLearn } from '../server/learn.ts';
// «Watch and Learn»: frames, notes and a written process become a written procedure (server/learn.ts).
export const config = { maxDuration: 180 };
export default { fetch: (request: Request) => handleLearn(request) };
