// Model choice stays on the server and is configurable by environment (brief: «keep model IDs server-side»).
// «quality» is the default, quality-first option; «balanced» the faster one. Both support the Responses API,
// streaming and the web_search tool.
export type ModelChoice = 'quality' | 'balanced';
export const MODEL_CHOICES: readonly ModelChoice[] = ['quality', 'balanced'];
export const isModelChoice = (value: unknown): value is ModelChoice => value === 'quality' || value === 'balanced';
export function modelId(choice: ModelChoice = 'quality'): string {
  return choice === 'balanced' ? (process.env.AGENT_MODEL_BALANCED || 'gpt-6.1-sol') : (process.env.AGENT_MODEL || 'gpt-6-astra');
}
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
/** The reasoning effort from the environment; anything the provider would refuse falls back to «medium». */
export const reasoningEffort = () => { const value = process.env.AGENT_REASONING_EFFORT || 'medium'; return EFFORTS.includes(value) ? value : 'medium'; };
export const apiKey = () => process.env.OPENAI_API_KEY || '';
/** The provider's address: OpenAI's default, or the address of the owner's EU data-residency project
 *  (OPENAI_BASE_URL, e.g. https://eu.api.openai.com/v1). Only an https openai.com address is accepted. */
const BASE_URL = (() => {
  const raw = process.env.OPENAI_BASE_URL?.trim(); const fallback = 'https://api.openai.com/v1';
  if (!raw) return fallback;
  try { const url = new URL(raw); return url.protocol === 'https:' && /(^|\.)openai\.com$/.test(url.hostname) ? url.href.replace(/\/$/, '') : fallback; } catch { return fallback; }
})();
export const RESPONSES_URL = `${BASE_URL}/responses`;
/** Whether requests go to OpenAI's European processing address. */
export const euProcessing = () => /^eu\./.test(new URL(RESPONSES_URL).hostname);
/** Where the server runs, when the host says (Vercel sets VERCEL_REGION), and whether that is in the EU. */
export const hostRegion = () => process.env.VERCEL_REGION || null;
export const hostedInEu = () => ['fra1', 'cdg1', 'dub1', 'arn1'].includes(process.env.VERCEL_REGION ?? '');
