import 'server-only';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { CommunityBookmarkError } from './community-bookmarks';
import { isSameOriginRequest } from './auth-security';
import { requestErrorResponse } from './api-input';
import { consumeRateLimit } from './rate-limit';

export const BOOKMARK_NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export async function bookmarkActor(request: Request, write = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new CommunityBookmarkError('Nicht authentifiziert', 401);
  if (write && !isSameOriginRequest(request)) throw new CommunityBookmarkError('Ungültige Anfragequelle', 403);
  const quota = consumeRateLimit(`community-bookmarks:${write ? 'write' : 'read'}:${session.user.id}`, { limit: write ? 60 : 120, windowMs: 60_000 });
  if (!quota.allowed) throw new CommunityBookmarkError('Zu viele Anfragen. Bitte kurz warten.', 429);
  return session.user.id;
}
export function bookmarkErrorResponse(error: unknown) {
  if (error instanceof CommunityBookmarkError) return NextResponse.json({ error: error.message, ...(error.state ? { state: error.state } : {}) }, { status: error.status, headers: BOOKMARK_NO_STORE });
  const input = requestErrorResponse(error);
  if (input) { for (const [key, value] of Object.entries(BOOKMARK_NO_STORE)) input.headers.set(key, value); return input; }
  // No target, account, request body or raw adapter error in diagnostics.
  console.error('Community bookmark request failed');
  return NextResponse.json({ error: 'Merker konnten nicht geladen oder geändert werden. Bitte erneut prüfen.' }, { status: 500, headers: BOOKMARK_NO_STORE });
}
