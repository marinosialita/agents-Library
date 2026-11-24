// promptfoo provider: asks the app running on this Mac (npm run dev, port 3000 or EVAL_APP_URL) exactly as the browser
// does — POST /api/agent-run — and returns the finished answer from the NDJSON stream. The AI key stays in the app's
// .env.local; nothing here holds one.
export default class AgentsProvider {
  constructor(options = {}) { this.base = (options.config?.url || process.env.EVAL_APP_URL || 'http://localhost:3000').replace(/\/$/, ''); }
  id() { return 'agents-local'; }
  async callApi(prompt, context) {
    const vars = context?.vars ?? {};
    const body = { agent: vars.agent, messages: [{ role: 'user', content: String(vars.question ?? prompt) }], documents: vars.documents ?? [], language: 'en', model: 'quality' };
    let response;
    try { response = await fetch(`${this.base}/api/agent-run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) }); }
    catch (error) { return { error: `The app at ${this.base} did not answer (${error.message}). Start it with npm run dev.` }; }
    if (!response.ok) return { error: `agent-run ${response.status}: ${(await response.text()).slice(0, 200)}` };
    let answer = '', text = '', failure = '';
    for (const line of (await response.text()).split('\n')) {
      if (!line.trim()) continue;
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'delta') text += event.text ?? '';
      else if (event.type === 'done') answer = event.answer ?? text;
      else if (event.type === 'error') failure = event.error ?? 'agent_failed';
    }
    return failure && !answer ? { error: failure } : { output: answer || text };
  }
}
