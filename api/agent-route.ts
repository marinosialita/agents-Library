import { handleAgentRoute } from '../server/agent-route.ts';
export const config = { maxDuration: 60 };
export default { fetch: (request: Request) => handleAgentRoute(request) };
