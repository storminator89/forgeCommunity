import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { getDatabaseProvider, getPostgresqlSchema } from '@/lib/database-provider';
import { readAsAdmin } from '@/lib/server/admin-read';
import { passwordFingerprint, samePasswordFingerprint } from '@/lib/server/account-security';
import { getClientAddress, readRequestBody } from '@/lib/server/auth-security';
import { consumeRateLimit, ADMIN_CONFIGURATION_WRITE_RATE_LIMIT, rateLimitHeaders } from '@/lib/server/rate-limit';
import {
  absentConfigurationState, encryptOAuthConfiguration, mergeOAuthConfiguration,
  missingOAuthSchema, oauthBaseUrl, oauthConfigurationInputSchema,
  OAuthConfigurationError, OAUTH_CONFIGURATION_ID, publicOAuthConfiguration,
  readOAuthConfiguration,
} from '@/lib/server/oauth-configuration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' };
const MAX_BODY_BYTES = 24 * 1024;
function failure(status: number, code: string) {
  return NextResponse.json({ error: 'OAuth-Konfiguration konnte nicht verarbeitet werden.', code }, { status, headers });
}

export async function GET() {
  const host = { ...process.env };
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return failure(401, 'authentication_required');
    if (session.user.role !== 'ADMIN') return failure(403, 'administrator_required');
    let result;
    try {
      result = await readAsAdmin(session.user.id, tx => readOAuthConfiguration(tx, host));
    } catch (error) {
      if (!missingOAuthSchema(error)) throw error;
      // A PostgreSQL missing-table error aborts that read transaction. Recheck
      // current authority in a fresh snapshot before reporting schema status.
      result = await readAsAdmin(session.user.id, async () => absentConfigurationState(host, true));
    }
    if (!result.authorized) return failure(403, 'administrator_required');
    return NextResponse.json(publicOAuthConfiguration(result.data, host), { headers });
  } catch {
    return failure(503, 'configuration_unavailable');
  }
}

export async function PUT(request: NextRequest) {
  const host = { ...process.env };
  try {
    const base = oauthBaseUrl(host);
    if (!base) return failure(503, 'base_url_missing');
    // Unlike general API mutations this private cookie-authenticated endpoint
    // requires an exact, present Origin from the configured public host.
    if (request.headers.get('origin') !== base.origin || request.headers.get('sec-fetch-site') === 'cross-site') return failure(403, 'invalid_origin');
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return failure(415, 'json_required');
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return failure(401, 'authentication_required');
    if (session.user.role !== 'ADMIN') return failure(403, 'administrator_required');
    const secureCookie = authOptions.useSecureCookies ?? base.protocol === 'https:';
    const token = await getToken({ req: request, secret: authOptions.secret, secureCookie,
      cookieName: authOptions.cookies?.sessionToken?.name, decode: authOptions.jwt?.decode });
    if (!token || token.sub !== session.user.id || token.id !== session.user.id ||
        (token.authProvider !== 'credentials' && token.authProvider !== 'oauth')) return failure(401, 'authentication_required');
    const address = getClientAddress(request.headers);
    const limits = [
      consumeRateLimit(`oauth-config:actor:${session.user.id}`, ADMIN_CONFIGURATION_WRITE_RATE_LIMIT),
      consumeRateLimit(`oauth-config:ip:${address}`, ADMIN_CONFIGURATION_WRITE_RATE_LIMIT),
    ];
    const limited = limits.find(result => !result.allowed);
    if (limited) return NextResponse.json({ error: 'Zu viele Änderungen. Bitte später erneut versuchen.', code: 'rate_limited' }, { status: 429, headers: rateLimitHeaders(limited) });
    const body = await readRequestBody(request, MAX_BODY_BYTES);
    if (body === null) return failure(413, 'body_too_large');
    let json: unknown;
    try { json = JSON.parse(body); } catch { return failure(400, 'invalid_configuration'); }
    const parsed = oauthConfigurationInputSchema.safeParse(json);
    if (!parsed.success) return failure(400, 'invalid_configuration');
    const input = parsed.data;
    const saved = await prisma.$transaction(async tx => {
      // Acquire before the first MVCC read, so the subsequent serializable
      // snapshot sees every Account committed before this lock was granted.
      // Quote the same optional namespace as PrismaPg; never use a UI value.
      let actor: { role: string; password: string | null } | null;
      if (getDatabaseProvider() === 'postgresql') {
        const schema = getPostgresqlSchema();
        const qualified = (table: 'Account' | 'User') => schema === null ? `"${table}"` : `"${schema.replaceAll('"', '""')}"."${table}"`;
        await tx.$executeRaw(Prisma.sql`LOCK TABLE ${Prisma.raw(qualified('Account'))} IN SHARE ROW EXCLUSIVE MODE`);
        // SERIALIZABLE alone does not lock a read-only authority dependency.
        // Hold the actor row through commit so demotion/password changes cannot
        // commit between the fresh role/fingerprint check and settings write.
        const actors = await tx.$queryRaw<Array<{ role: string; password: string | null }>>(
          Prisma.sql`SELECT "role"::text AS "role", "password" FROM ${Prisma.raw(qualified('User'))} WHERE "id" = ${session.user.id} FOR UPDATE`,
        );
        actor = actors[0] ?? null;
      } else {
        // SQLite rejects promotion of an obsolete Serializable read snapshot
        // to a writer; no PostgreSQL-specific statement is sent to SQLite.
        actor = await tx.user.findUnique({ where: { id: session.user.id }, select: { role: true, password: true } });
      }
      if (actor?.role !== 'ADMIN') throw new OAuthConfigurationError('administrator_required');
      if (token.authProvider === 'credentials' && (!actor.password ||
          !samePasswordFingerprint(token.passwordFingerprint, passwordFingerprint(session.user.id, actor.password)))) {
        throw new OAuthConfigurationError('administrator_required');
      }
      const previous = await readOAuthConfiguration(tx, host);
      if (previous.blockers.length) throw new OAuthConfigurationError('configuration_unavailable');
      if (previous.revision !== input.expectedRevision) throw new OAuthConfigurationError('revision_conflict');
      const config = mergeOAuthConfiguration(input, previous.source === 'database' ? previous.config : null, host);
      if (previous.config.oidc.issuer !== config.oidc.issuer || previous.config.oidc.clientId !== config.oidc.clientId) {
        // Serialize against committed Account inserts while deciding whether an
        // identity migration is required. SQLite's serializable write commit
        // rejects a stale read snapshot. This is not a framework-wide OAuth
        // finalization lock: already in-flight framework work remains a limit.
        if (await tx.account.count({ where: { provider: 'oidc' } }) > 0) throw new OAuthConfigurationError('oidc_identity_migration_required');
      }
      const revision = previous.revision === null ? 1 : previous.revision + 1;
      if (revision > 2147483647) throw new OAuthConfigurationError('revision_conflict');
      const encryptedPayload = await encryptOAuthConfiguration(config, revision, host);
      if (previous.revision === null) {
        await tx.oAuthConfiguration.create({ data: { id: OAUTH_CONFIGURATION_ID, revision, encryptedPayload } });
      } else {
        const updated = await tx.oAuthConfiguration.updateMany({
          where: { id: OAUTH_CONFIGURATION_ID, revision: previous.revision }, data: { revision, encryptedPayload },
        });
        if (updated.count !== 1) throw new OAuthConfigurationError('revision_conflict');
      }
      return { revision, source: 'database' as const, config, blockers: [], schemaMissing: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(publicOAuthConfiguration(saved, host), { headers });
  } catch (error) {
    if (error instanceof OAuthConfigurationError) {
      if (error.code === 'administrator_required') return failure(403, error.code);
      if (error.code === 'revision_conflict' || error.code === 'oidc_identity_migration_required') return failure(409, error.code);
      return failure(error.code === 'invalid_configuration' ? 400 : 503, error.code);
    }
    if (missingOAuthSchema(error)) return failure(503, 'schema_missing');
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) return failure(409, 'revision_conflict');
    return failure(503, 'configuration_unavailable');
  }
}
