import { handleAppAction } from '../server/app-action.ts';
// Carries out one calendar event or e-mail the person approved on its card (server/app-action.ts).
export default { fetch: (request: Request) => handleAppAction(request) };
