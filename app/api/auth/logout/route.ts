import { endSession } from '@/lib/sites-auth/credentials';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { jsonError } from '@/lib/sites-auth/credentials';
import { invalidateOAuthTransactions } from '@/lib/sites-auth/oauth';

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return jsonError('Ungültige Anfragequelle.', 403);
  // Clear pending OAuth before ending the existing app session. If an active
  // OAuth generation cannot be invalidated, do not report a successful logout.
  let oauthCookies: string[];
  try { oauthCookies = await invalidateOAuthTransactions(req); }
  catch { return jsonError('Die Abmeldung konnte gerade nicht abgeschlossen werden.', 503); }
  const response = await endSession(req.headers.get('cookie'), req.url);
  for (const cookie of oauthCookies) response.headers.append('Set-Cookie', cookie);
  return response;
}
