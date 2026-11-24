import { handleAgentExplain } from '../server/agent-explain.ts';
export const config = { maxDuration: 120 };
export default { fetch: (request: Request) => handleAgentExplain(request) };
