// Cloudflare Pages demo (no AI key): every /api route answers honestly that the AI is not connected,
// instead of falling through to the app's index.html. The full server lives in api/ and server/ (Vercel/Node).
export function onRequest() {
  return new Response(JSON.stringify({ error: 'agent_unavailable', demo: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
