import { handleRoutineHook } from '../server/routines/hook.ts';
export const config = { maxDuration: 300 };
export default { fetch: (request: Request) => handleRoutineHook(request) };
