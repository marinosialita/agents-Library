import { handleSendReply } from '../server/send-reply.ts';
// Approve and send: a reply the person read, edited and confirmed, to the sender of one message (server/send-reply.ts).
export default { fetch: (request: Request) => handleSendReply(request) };
