// Every `/api/auth/*` request: Better Auth's routes (sign up, sign in, sign out, session) and `/api/auth/status`.
import { handleAuth } from '../../server/auth/auth.ts';

export default { fetch: handleAuth };
