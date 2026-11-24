import { handleRoutinesTick } from '../server/routines/routes.ts';
// The host's scheduler calls this every few minutes with «Authorization: Bearer <CRON_SECRET>» (docs/routines.md).
export const config = { maxDuration: 300 };
export default { fetch: (request: Request) => handleRoutinesTick(request) };
