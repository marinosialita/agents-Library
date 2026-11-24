import { handleAgentTeach } from '../server/agent-teach.ts';
export const config = { maxDuration: 60 };
export default { fetch: (request: Request) => handleAgentTeach(request) };
