import { handleAgentBuild } from '../server/agent-build.ts';
export const config = { maxDuration: 200 };
export default { fetch: (request: Request) => handleAgentBuild(request) };
