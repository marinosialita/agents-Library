import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

// The server routes (api/*.ts, Vercel-style `export default { fetch }`) run inside the dev server too, so the app
// works locally with a key in .env.local. Nothing of the key reaches the browser: the routes read process.env.
function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server: ViteDevServer) {
      // Routines (docs/routines.md): the dev server is the clock on this Mac. Every minute it runs the routines that are
      // due; ROUTINES_LOCAL_TICK=off stops it. One timer per process, also when the config reloads.
      const clock = globalThis as { __agentsRoutineClock?: ReturnType<typeof setInterval> };
      if (clock.__agentsRoutineClock) clearInterval(clock.__agentsRoutineClock);
      if (process.env.ROUTINES_LOCAL_TICK !== 'off') {
        clock.__agentsRoutineClock = setInterval(() => {
          void server.ssrLoadModule(path.resolve(__dirname, 'server/routines/routes.ts')).then(module => module.localTick()).catch(error => console.error('[routines]', error instanceof Error ? error.message : error));
        }, 60_000);
        server.httpServer?.once('close', () => { if (clock.__agentsRoutineClock) clearInterval(clock.__agentsRoutineClock); });
      }
      // Telegram chat (13 Nov 2026, server/inbound/telegram.ts): the dev server listens for the owner's bot, allowed chats
      // only; TELEGRAM_POLLING=off stops it, and it never starts while a webhook is set.
      void server.ssrLoadModule(path.resolve(__dirname, 'server/inbound/telegram.ts')).then(module => module.startTelegramPolling())
        .then(state => console.log(`[telegram] ${state}`)).catch(error => console.error('[telegram]', error instanceof Error ? error.message : error));
      server.httpServer?.once('close', () => { const listening = (globalThis as { __agentsTelegram?: { stop?: boolean } }).__agentsTelegram; if (listening) listening.stop = true; });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        // The landing page has its own entry: «/welcome» serves welcome.html, as the deployed rewrite does.
        if (url.pathname === '/welcome') { req.url = `/welcome.html${url.search}`; return next(); }
        if (!url.pathname.startsWith('/api/')) return next();
        // Accounts: every `/api/auth/*` path goes to the one catch-all route, as on the host.
        const name = url.pathname.startsWith('/api/auth/') ? 'auth/[...all]' : url.pathname.startsWith('/api/web-asset/') ? 'web-asset/[...all]' : url.pathname.slice(5).replace(/[^a-z0-9-]/g, '');
        const file = path.resolve(__dirname, `api/${name}.ts`);
        if (!name || !fs.existsSync(file)) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"not_found"}'); return; }
        try {
          const module = await server.ssrLoadModule(file);
          const handler: (request: Request) => Promise<Response> = module.default?.fetch ?? module.default;
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) { if (typeof value === 'string') headers.set(key, value); else if (Array.isArray(value)) headers.set(key, value.join(', ')); }
          const controller = new AbortController();
          // The response's 'close' is the browser leaving; the request's fires as soon as its body is read (Node ≥ 16),
          // which aborted every POST before the provider was called.
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          const origin = `http://${req.headers.host || 'localhost'}`;
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : (Readable.toWeb(req) as ReadableStream<Uint8Array>);
          const request = new Request(origin + req.url, { method: req.method, headers, body, signal: controller.signal, ...(body ? { duplex: 'half' } : {}) } as RequestInit);
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          if (!response.body) { res.end(); return; }
          const reader = response.body.getReader();
          for (;;) { const { value, done } = await reader.read(); if (done) break; res.write(value); }
          res.end();
        } catch (error) {
          console.error('[api]', name, error);
          if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); }
          res.end('{"error":"server_error"}');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env.local holds the server-side key; it is loaded into process.env for the routes, never exposed to the client.
  const env = loadEnv(mode, __dirname, '');
  for (const key of Object.keys(env).filter(name => ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AGENT_MODEL', 'AGENT_MODEL_BALANCED', 'AGENT_REASONING_EFFORT', 'OFFICIAL_WEB_SEARCH'].includes(name) || name === 'CRON_SECRET' || /^(?:INBOUND|POSTMARK|WHATSAPP|TELEGRAM|COMPOSIO|CONNECTIONS|ROUTINES|AUTH|BETTER_AUTH)_/.test(name))) if (env[key] && !process.env[key]) process.env[key] = env[key];
  return {
    plugins: [react(), localApi()],
    server: { port: 5181, strictPort: false },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200, rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), welcome: path.resolve(__dirname, 'welcome.html') } } },
  };
});
