// Accounts in the browser (11 Nov 2026): the status, and Better Auth's e-mail routes called directly (no client library).
// The session is an http-only cookie; nothing about it is kept in this browser's storage.
export type AccountUser = { id: string; email: string; name: string };
export type AccountStatus = { available: boolean; reason?: string; user: AccountUser | null; signup: 'open' | 'list' | 'closed' };

export class AccountError extends Error { constructor(public code: string, message: string) { super(message); } }

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That e-mail and password do not match.',
  USER_ALREADY_EXISTS: 'An account with this e-mail already exists. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this e-mail already exists. Sign in instead.',
  PASSWORD_TOO_SHORT: 'The password needs at least 10 characters.',
  PASSWORD_TOO_LONG: 'The password is too long.',
  INVALID_EMAIL: 'That e-mail address does not look right.',
  signup_not_allowed: 'This address may not create an account here. Ask the owner to add it.',
  EMAIL_PASSWORD_SIGN_UP_DISABLED: 'New accounts are closed here.',
  accounts_off: 'Accounts are not switched on on this server.',
};

async function post(route: string, body: unknown): Promise<any> {
  let response: Response;
  try { response = await fetch(`/api/auth${route}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new AccountError('network', 'The server did not answer. Check the connection and try again.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = String(data?.code ?? data?.error ?? (response.status === 429 ? 'too_many' : `http_${response.status}`));
    throw new AccountError(code, MESSAGES[code] ?? (response.status === 429 ? 'Too many tries. Wait a minute and try again.' : typeof data?.message === 'string' ? data.message : 'That did not work. Try again.'));
  }
  return data;
}

export async function accountStatus(signal?: AbortSignal): Promise<AccountStatus> {
  const response = await fetch('/api/auth/status', { credentials: 'same-origin', signal, cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) return { available: false, reason: response.status === 404 ? 'no_server' : `http_${response.status}`, user: null, signup: 'closed' };
  return { available: data.available === true, reason: data.reason, user: data.user ?? null, signup: data.signup ?? 'closed' };
}
export const signUp = (name: string, email: string, password: string) => post('/sign-up/email', { name, email, password });
export const signIn = (email: string, password: string) => post('/sign-in/email', { email, password, rememberMe: true });
export const signOut = () => post('/sign-out', {});
