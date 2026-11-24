// Whether the AI is connected, whether each model choice is the server's default or configured, whether the
// official-site search is on, what the privacy page may promise (7 Nov 2026) — only what this server really does — and
// whether the e-mail and WhatsApp channels are set up. No secret and no model id leaves the server.
import { channelStatus } from '../server/inbound/core.ts';
import { apiKey, euProcessing, hostedInEu, hostRegion } from '../server/models.ts';
import { officialWebSearchEnabled } from '../server/official-research.ts';
export default { fetch: () => Response.json({ configured: !!apiKey(),
  models: { quality: process.env.AGENT_MODEL ? 'configured' : 'default', balanced: process.env.AGENT_MODEL_BALANCED ? 'configured' : 'default' }, search: officialWebSearchEnabled(),
  privacy: { storeOff: true, euProcessing: euProcessing(), region: hostRegion(), hostedInEu: hostedInEu() }, channels: channelStatus() },
  { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }) };
