import { handleAgentRun } from '../server/agent-run.ts';
export const config = { maxDuration: 800 };
export default { fetch: (request: Request) => handleAgentRun(request) };
