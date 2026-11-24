import { handleConnections } from '../server/connections.ts';
// «Connections»: the owner's Gmail, Google Calendar and Outlook through Composio (server/connections.ts). No AI call here.
export const config = { maxDuration: 60 };
export default { fetch: (request: Request) => handleConnections(request) };
