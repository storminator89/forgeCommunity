import { NextResponse } from 'next/server';
import { getServerSession, readSessionToken } from '@/lib/sites-auth/server';
import { readAsAdmin } from '@/lib/server/admin-read';
import { readRequestBody } from '@/lib/server/auth-security';
import { consumeRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit';
import { oauthOrigin, parseProviderInput } from '@/lib/sites-auth/oauth-settings';
import { configurationProjection, liveAdminSession, loadOAuthConfiguration, OAuthConfigurationConflict, OAuthIdentityChange,
  saveOAuthConfiguration } from '@/lib/sites-auth/oauth-configuration-store';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function failure(status: number, code: string) {
  return NextResponse.json({ code }, { status, headers: HEADERS });
}
function requestToken(request: Request) {
  // Reject duplicate session cookies instead of accepting an ambiguous first.
  const cookies = (request.headers.get('cookie') || '').split(';').map(item => item.trim());
  if (cookies.filter(item => item.split('=', 1)[0] === 'forgecommunity.session').length !== 1) return null;
  const token = readSessionToken(request.headers.get('cookie'));
  return token && token.length <= 1024 && !/[\u0000-\u0020\u007f]/.test(token) ? token : null;
}
async function actor(request: Request): Promise<{ status: 401 | 403 } | { token: string; userId: string }> {
  const token = requestToken(request);
  if (!token) return { status: 401 as const };
  const session = await getServerSession();
  if (!session?.user?.id) return { status: 401 as const };
  if (session.user.role !== 'ADMIN' || !await liveAdminSession(token, session.user.id)) return { status: 403 as const };
  return { token, userId: session.user.id };
}

export async function GET(request: Request) {
  try {
    if (request.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site') return failure(403, 'invalid_origin');
    const identity = await actor(request);
    if ('status' in identity) return failure(identity.status, 'unauthorized');
    // Existing helper verifies the current stored ADMIN role both before and
    // after reading. Also recheck the actual session before protected output.
    const result = await readAsAdmin(identity.userId, async () => configurationProjection(await loadOAuthConfiguration()));
    if (!result.authorized || !await liveAdminSession(identity.token, identity.userId)) return failure(403, 'unauthorized');
    return NextResponse.json(result.data, { headers: HEADERS });
  } catch { return failure(503, 'configuration_unavailable'); }
}

export async function PUT(request: Request) {
  try {
    // Unlike the general-purpose helper, a missing Origin is never accepted.
    // Neither request Host nor a Referer substitutes for the operator origin.
    const origin = oauthOrigin();
    if (!origin) return failure(503, 'base_url_missing');
    if (request.headers.get('origin') !== origin || new URL(request.url).origin !== origin ||
      request.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site') return failure(403, 'invalid_origin');
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers.get('content-type') || '')) return failure(415, 'invalid_content_type');
    const identity = await actor(request);
    if ('status' in identity) return failure(identity.status, 'unauthorized');
    const userLimit = consumeRateLimit(`oauth:configuration:write:${identity.userId}`, { limit: 10, windowMs: 60_000 });
    const aggregateLimit = userLimit.allowed ? consumeRateLimit('oauth:configuration:write:aggregate', { limit: 30, windowMs: 60_000 }) : userLimit;
    if (!aggregateLimit.allowed) return NextResponse.json({ code: 'rate_limited' },
      { status: 429, headers: { ...rateLimitHeaders(aggregateLimit), ...HEADERS } });
    const raw = await readRequestBody(request, 24576);
    if (raw === null) return failure(413, 'request_too_large');
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return failure(400, 'invalid_configuration'); }
    const loaded = await loadOAuthConfiguration();
    if (loaded.unavailable || loaded.blockers.length) return failure(503, 'configuration_unavailable');
    const parsed = parseProviderInput(body, loaded.source === 'database' ? loaded.settings : null);
    if (!parsed) return failure(400, 'invalid_configuration');
    if (parsed.input.expectedRevision !== loaded.snapshot.revision) return failure(409, 'configuration_conflict');
    // The native D1 batch rechecks exact revision/ciphertext, current ADMIN role
    // and an unexpired non-revoked session at the point of mutation and commit.
    const saved = await saveOAuthConfiguration(identity, loaded, parsed.settings);
    return NextResponse.json(configurationProjection(saved), { headers: HEADERS });
  } catch (error) {
    if (error instanceof OAuthIdentityChange) return failure(409, 'oidc_identity_migration_required');
    return failure(error instanceof OAuthConfigurationConflict ? 409 : 503,
      error instanceof OAuthConfigurationConflict ? 'configuration_conflict' : 'configuration_unavailable');
  }
}
