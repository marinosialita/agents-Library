// Accounts (11 Nov 2026, his request): Better Auth (MIT, github.com/better-auth/better-auth, pinned 1.7.14), e-mail and
// password, kept in SQLite through Node's own `node:sqlite`. On this Mac the database and a generated secret live in
// .data/ (ignored by git). On a host whose files do not last (Vercel) accounts stay off until a lasting database and
// BETTER_AUTH_SECRET exist. Sign-up is open on this Mac only; elsewhere only AUTH_ALLOWED_EMAILS may join.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';

export type AccountUser = { id: string; email: string; name: string };
export type AuthConfig = { dbPath: string; secret: string; baseURL?: string; signup: 'open' | 'list' | 'closed'; allowed: string[] };

const onServerlessHost = () => Boolean(process.env.VERCEL);
const dataDir = () => path.resolve(process.cwd(), process.env.ROUTINES_DIR || '.data');

/** Who may create an account: an address on the list, or anyone at a listed «@domain». */
export function readAllowed(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(item => /^[^@\s]+@[^@\s]+\.[^@\s]+$|^@[^@\s]+\.[^@\s]+$/.test(item));
}
export function mayJoin(email: unknown, config: Pick<AuthConfig, 'signup' | 'allowed'>): boolean {
  if (typeof email !== 'string') return false;
  const address = email.trim().toLowerCase();
  if (config.signup === 'closed') return false;
  if (config.signup === 'open' && !config.allowed.length) return true;
  return config.allowed.some(item => item.startsWith('@') ? address.endsWith(item) : address === item);
}

/** The settings, or the reason accounts are off. Never invents a secret on a shared host. */
export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | { off: string } {
  const allowed = readAllowed(env.AUTH_ALLOWED_EMAILS);
  const serverless = Boolean(env.VERCEL);
  const dbPath = env.AUTH_DB_PATH?.trim() || (serverless ? '' : path.join(dataDir(), 'auth.sqlite'));
  if (!dbPath) return { off: 'no_database' };
  let secret = env.BETTER_AUTH_SECRET?.trim() ?? '';
  if (!secret) {
    if (serverless) return { off: 'no_secret' };
    secret = localSecret();
  }
  if (secret.length < 32) return { off: 'weak_secret' };
  const signup = env.AUTH_SIGNUP === 'closed' ? 'closed' : allowed.length ? 'list' : serverless ? 'closed' : 'open';
  return { dbPath, secret, baseURL: env.BETTER_AUTH_URL?.trim() || undefined, signup, allowed };
}

/** On this Mac only: a random secret made once and kept in .data/auth-secret (owner-only file). */
function localSecret(): string {
  const file = path.join(dataDir(), 'auth-secret');
  try { const kept = fs.readFileSync(file, 'utf8').trim(); if (kept.length >= 32) return kept; } catch { /* first run */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const made = randomBytes(32).toString('hex');
  fs.writeFileSync(file, made, { mode: 0o600 });
  return made;
}

export function authOptions(config: AuthConfig, database: unknown, origin?: string): BetterAuthOptions {
  return {
    appName: 'Agents',
    database: database as BetterAuthOptions['database'],
    secret: config.secret,
    baseURL: config.baseURL ?? origin,
    basePath: '/api/auth',
    trustedOrigins: [config.baseURL ?? origin].filter((item): item is string => Boolean(item)),
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128, autoSignIn: true, disableSignUp: config.signup === 'closed' },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 8 }, '/sign-up/email': { window: 60, max: 5 } } },
    // The client address for the attempt limits: only a host header that the visitor cannot forge (Vercel sets it).
    advanced: { cookiePrefix: 'agents', ipAddress: { ipAddressHeaders: process.env.VERCEL ? ['x-vercel-forwarded-for'] : [] } },
    telemetry: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path === '/sign-up/email' && !mayJoin(ctx.body?.email, config)) throw new APIError('FORBIDDEN', { message: 'This address may not create an account here.', code: 'signup_not_allowed' });
      }),
    },
  };
}

type Auth = ReturnType<typeof betterAuth>;
const cache = globalThis as { __agentsAuth?: Map<string, Promise<Auth>>; __agentsAuthDb?: Map<string, unknown> };

/** One database per file and one auth per origin (the dev server's port can change); tables made on first use. */
export async function accountsFor(origin: string, config: AuthConfig): Promise<Auth> {
  cache.__agentsAuth ??= new Map(); cache.__agentsAuthDb ??= new Map();
  const key = `${config.dbPath}\u0001${config.baseURL ?? origin}`;
  let made = cache.__agentsAuth.get(key);
  if (!made) {
    made = (async () => {
      let database = cache.__agentsAuthDb!.get(config.dbPath);
      if (!database) {
        const { DatabaseSync } = await import('node:sqlite');
        if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
        database = new DatabaseSync(config.dbPath);
        cache.__agentsAuthDb!.set(config.dbPath, database);
        const options = authOptions(config, database, origin);
        const { runMigrations } = await getMigrations(options);
        await runMigrations();
      }
      return betterAuth(authOptions(config, database, origin));
    })();
    made.catch(() => cache.__agentsAuth!.delete(key));
    cache.__agentsAuth.set(key, made);
  }
  return made;
}

/** The signed-in user of a request, or null (accounts off, no cookie, expired session). */
export async function signedInUser(request: Request, config: AuthConfig | { off: string } = readAuthConfig()): Promise<AccountUser | null> {
  if ('off' in config) return null;
  if (!/(?:^|;\s*)(?:__Secure-)?agents\.session_token=/.test(request.headers.get('cookie') ?? '')) return null;
  try {
    const auth = await accountsFor(new URL(request.url).origin, config);
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user ? { id: session.user.id, email: session.user.email, name: session.user.name } : null;
  } catch (error) {
    console.error('[auth] session', error instanceof Error ? error.message : 'failed');
    return null;
  }
}

/** `/api/auth/*`: Better Auth's own routes, plus `/api/auth/status` (are accounts on, may this address join). */
export async function handleAuth(request: Request): Promise<Response> {
  const config = readAuthConfig();
  const url = new URL(request.url);
  if (url.pathname === '/api/auth/status') {
    const user = await signedInUser(request, config);
    return Response.json('off' in config ? { available: false, reason: config.off, user: null, signup: 'closed' } : { available: true, user, signup: config.signup }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if ('off' in config) return Response.json({ error: 'accounts_off', reason: config.off }, { status: 503 });
  try {
    const auth = await accountsFor(url.origin, config);
    return await auth.handler(request);
  } catch (error) {
    console.error('[auth]', error instanceof Error ? error.message : 'failed');
    return Response.json({ error: 'auth_failed' }, { status: 500 });
  }
}

export { onServerlessHost };
