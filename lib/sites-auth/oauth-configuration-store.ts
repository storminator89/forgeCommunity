import 'server-only';

import { EncryptJWT, jwtDecrypt } from 'jose';
import { env } from 'cloudflare:workers';
import { d1DateMs } from '@/lib/server/d1-space-reads';
import { emptyProviderSettings, environmentProviderSettings, oauthOrigin, oauthStateSecret, validSettings } from './oauth-settings';
import type { ProviderSettings } from './oauth-settings';

export const CONFIGURATION_ID = 'singleton';
const PURPOSE = 'forgecommunity.oauth-provider-configuration';
const FORMAT = 1;
const STACK = 'sites';
const JWE_TYPE = 'forgecommunity-oauth-configuration+jwt';
const MAX_CIPHERTEXT = 32768;
const MAX_VERSION = Number.MAX_SAFE_INTEGER - 1;
export type ConfigurationBlocker = 'encryption_key_missing' | 'encryption_key_invalid' | 'schema_missing' |
  'base_url_missing' | 'oauth_state_secret_missing' | 'oauth_transaction_not_ready' | 'configuration_unavailable';
export type ConfigurationSnapshot = Readonly<{
  kind: 'schema_missing' | 'absent' | 'database'; revision: number | null;
  ciphertext: string | null; binding: string;
}>;
type StoredRow = { id: string; version: number; ciphertext: string; createdAt: number; updatedAt: number; updatedById: string };
export type LoadedConfiguration = {
  snapshot: ConfigurationSnapshot; settings: ProviderSettings; source: 'environment' | 'database' | 'unconfigured';
  blockers: ConfigurationBlocker[]; unavailable: boolean; origin: string | null;
};
export function oauthDatabase() {
  if (!env.DB) throw new Error('OAuth configuration unavailable');
  return env.DB.withSession('first-primary');
}
type Database = ReturnType<typeof oauthDatabase>;

/** Dedicated host-only key. No derivation from session/state/NextAuth secrets,
 * no key reads/updates through HTTP, and strict canonical 32-byte encoding. */
function configurationKey(): { key: Uint8Array | null; blocker: ConfigurationBlocker | null } {
  const input = env.OAUTH_CONFIG_ENCRYPTION_KEY;
  if (!input) return { key: null, blocker: 'encryption_key_missing' };
  if (input === env.OAUTH_STATE_SECRET) return { key: null, blocker: 'encryption_key_invalid' };
  if (typeof input !== 'string' || !/^(?:[A-Za-z0-9+/]{43}=?|[A-Za-z0-9_-]{43}=?)$/.test(input)) return { key: null, blocker: 'encryption_key_invalid' };
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const binary = atob(`${normalized}=`);
    const key = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (key.length !== 32 || btoa(binary).replace(/=+$/, '') !== normalized) throw new Error('Invalid key');
    return { key, blocker: null };
  } catch { return { key: null, blocker: 'encryption_key_invalid' }; }
}
async function fingerprint(ciphertext: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ciphertext));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function snapshot(kind: ConfigurationSnapshot['kind'], row?: StoredRow, binding: string = kind): ConfigurationSnapshot {
  return Object.freeze({ kind, revision: row?.version ?? null, ciphertext: row?.ciphertext ?? null, binding });
}
function safeRow(row: StoredRow) {
  return row.id === CONFIGURATION_ID && Number.isSafeInteger(row.version) && row.version >= 1 && row.version <= MAX_VERSION &&
    typeof row.ciphertext === 'string' && row.ciphertext.length > 0 && row.ciphertext.length <= MAX_CIPHERTEXT &&
    Number.isSafeInteger(row.createdAt) && row.createdAt > 0 && Number.isSafeInteger(row.updatedAt) && row.updatedAt >= row.createdAt &&
    typeof row.updatedById === 'string' && /^[^\u0000-\u001f\u007f]{1,256}$/.test(row.updatedById);
}
function schemaError(error: unknown) {
  // Classify internally only. No raw D1 exception, request or secret is logged.
  let current = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : '';
    if (/no such (?:table|column)/i.test(message)) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}
async function readStored(db: Database): Promise<{ snapshot: ConfigurationSnapshot; row: StoredRow | null }> {
  const exists = await db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND lower(name) = lower(?)")
    .bind('OAuthProviderConfigurationSingleton').first<{ name: string; type: string }>();
  if (!exists) return { snapshot: snapshot('schema_missing'), row: null };
  if (exists.type !== 'table') throw new Error('Invalid configuration storage type');
  // Bound the projected encrypted cell before reading it into Worker memory.
  // More than one row or any malformed row fails closed, including wrong IDs.
  const result = await db.prepare(`SELECT id, version,
    CASE WHEN typeof(ciphertext) = 'text' AND length(CAST(ciphertext AS BLOB)) BETWEEN 1 AND ${MAX_CIPHERTEXT}
      THEN ciphertext ELSE NULL END AS ciphertext, createdAt, updatedAt, updatedById
    FROM OAuthProviderConfigurationSingleton LIMIT 2`).all<StoredRow>();
  if (!result.success || result.results.length > 1) throw new Error('Invalid configuration storage');
  const row = result.results[0] ?? null;
  if (row && !safeRow(row)) throw new Error('Invalid configuration row');
  return row ? { snapshot: snapshot('database', row, await fingerprint(row.ciphertext)), row }
    : { snapshot: snapshot('absent'), row: null };
}
async function decryptStored(row: StoredRow, origin: string, key: Uint8Array): Promise<ProviderSettings> {
  const { payload } = await jwtDecrypt(row.ciphertext, key, {
    issuer: origin, audience: PURPOSE, typ: JWE_TYPE,
    keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
    requiredClaims: ['iss', 'aud', 'iat', 'jti'],
  });
  if (payload.purpose !== PURPOSE || payload.formatVersion !== FORMAT || payload.stack !== STACK || payload.origin !== origin ||
    payload.configurationId !== CONFIGURATION_ID || payload.revision !== row.version || payload.jti !== `${STACK}:${CONFIGURATION_ID}:${row.version}` ||
    payload.createdAt !== row.createdAt || payload.updatedAt !== row.updatedAt || payload.updatedById !== row.updatedById ||
    !Number.isSafeInteger(payload.iat) || payload.iat! > Math.floor(Date.now() / 1000) + 60 || !validSettings(payload.providers)) {
    throw new Error('Invalid configuration envelope');
  }
  return payload.providers;
}
async function transactionsReady(db: Database) {
  if (env.OAUTH_TRANSACTION_MIGRATION_READY !== 'true') return false;
  try {
    await db.prepare('SELECT id, bindingHash, browserBindingHash, provider, createdAt, expiresAt, consumedAt, finalizedAt, issuedSessionId FROM OAuthLoginTransaction WHERE 1 = 0').all();
    return true;
  } catch { return false; }
}
/** Fresh per request, primary reads, and no fallback once a DB row exists or
 * the optional storage is unreadable/malformed. A genuinely absent table alone
 * preserves existing environment-only login until the additive migration. */
export async function loadOAuthConfiguration(): Promise<LoadedConfiguration> {
  const origin = oauthOrigin();
  const blockers: ConfigurationBlocker[] = [];
  const { key, blocker } = configurationKey();
  if (blocker) blockers.push(blocker);
  if (!origin) blockers.push('base_url_missing');
  if (!oauthStateSecret()) blockers.push('oauth_state_secret_missing');
  let stored: Awaited<ReturnType<typeof readStored>>;
  try {
    const db = oauthDatabase();
    stored = await readStored(db);
    if (!await transactionsReady(db)) blockers.push('oauth_transaction_not_ready');
  } catch (error) {
    blockers.push(schemaError(error) ? 'schema_missing' : 'configuration_unavailable');
    if (!blockers.includes('configuration_unavailable')) blockers.push('configuration_unavailable');
    return { snapshot: snapshot('absent'), settings: emptyProviderSettings(), source: 'unconfigured', blockers, unavailable: true, origin };
  }
  if (stored.snapshot.kind === 'schema_missing') blockers.push('schema_missing');
  if (stored.row) {
    try {
      if (!key || !origin) throw new Error('Configuration key or origin unavailable');
      const settings = await decryptStored(stored.row, origin, key);
      return { snapshot: stored.snapshot, settings, source: 'database', blockers, unavailable: false, origin };
    } catch {
      blockers.push('configuration_unavailable');
      return { snapshot: stored.snapshot, settings: emptyProviderSettings(), source: 'database', blockers, unavailable: true, origin };
    }
  }
  const settings = environmentProviderSettings();
  const configured = settings.google.enabled || settings.oidc.enabled || Boolean(settings.google.clientId || settings.oidc.clientId || settings.oidc.issuer);
  // No-row SQL state alone cannot detect a host-side credential/endpoint
  // change between begin and callback. Bind the complete effective settings
  // inside the encrypted transaction without exposing a hash in any API.
  const environmentSnapshot = Object.freeze({ ...stored.snapshot,
    binding: await fingerprint(JSON.stringify({ kind: stored.snapshot.kind, providers: settings })) });
  return { snapshot: environmentSnapshot, settings, source: configured ? 'environment' : 'unconfigured', blockers, unavailable: false, origin };
}
/** Native D1 batch guard. A schema-missing environment flow additionally
 * rejects if the configuration table was created during external code I/O. */
export function configurationGuard(db: Database, expected: ConfigurationSnapshot) {
  if (expected.kind === 'schema_missing') return db.prepare(`SELECT CASE WHEN NOT EXISTS
    (SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND lower(name) = lower('OAuthProviderConfigurationSingleton'))
    THEN 1 ELSE json('OAUTH_CONFIGURATION_CHANGED') END AS guarded`);
  if (expected.kind === 'absent') return db.prepare(`SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM OAuthProviderConfigurationSingleton)
    THEN 1 ELSE json('OAUTH_CONFIGURATION_CHANGED') END AS guarded`);
  return db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM OAuthProviderConfigurationSingleton
    WHERE id = ? AND version = ? AND ciphertext = ?) AND (SELECT COUNT(*) FROM OAuthProviderConfigurationSingleton) = 1
    THEN 1 ELSE json('OAUTH_CONFIGURATION_CHANGED') END AS guarded`)
    .bind(CONFIGURATION_ID, expected.revision, expected.ciphertext);
}
const LIVE_ADMIN_SQL = `EXISTS (SELECT 1 FROM "Session" s JOIN "User" u ON u.id = s.userId
  WHERE s.sessionToken = ? AND u.id = ? AND u.role = 'ADMIN'
  AND ${d1DateMs('s.expires')} > CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER))`;
export async function liveAdminSession(token: string, userId: string) {
  return (await oauthDatabase().prepare(`SELECT ${LIVE_ADMIN_SQL} AS authorized`).bind(token, userId)
    .first<{ authorized: number }>())?.authorized === 1;
}
export class OAuthConfigurationConflict extends Error {}
export class OAuthIdentityChange extends Error {}
/** Returns a prevalidated projection only after SQL assertions and the write
 * commit atomically. No retries after uncertain network/commit errors. */
export async function saveOAuthConfiguration(actor: { token: string; userId: string }, loaded: LoadedConfiguration, settings: ProviderSettings) {
  const db = oauthDatabase();
  const { key } = configurationKey();
  if (!key || !loaded.origin || loaded.blockers.length || loaded.unavailable || loaded.snapshot.kind === 'schema_missing' || !validSettings(settings)) {
    throw new Error('Configuration prerequisites unavailable');
  }
  const previous = loaded.snapshot.revision;
  if (previous !== null && previous >= MAX_VERSION) throw new OAuthConfigurationConflict();
  const version = previous === null ? 1 : previous + 1;
  const sameOidcIdentity = loaded.settings.oidc.issuer === settings.oidc.issuer && loaded.settings.oidc.clientId === settings.oidc.clientId;
  if (!sameOidcIdentity && await db.prepare(`SELECT id FROM "Account" WHERE provider = 'oidc' LIMIT 1`).first()) throw new OAuthIdentityChange();
  // Re-read the encrypted row only for its immutable creation timestamp; the
  // entire original ciphertext/version is guarded in the mutation batch.
  const prior = await readStored(db);
  if (prior.snapshot.kind !== loaded.snapshot.kind || prior.snapshot.revision !== previous ||
    (prior.snapshot.kind === 'database' && prior.snapshot.binding !== loaded.snapshot.binding)) throw new OAuthConfigurationConflict();
  const updatedAt = Math.max(Date.now(), prior.row?.updatedAt ?? 0);
  const createdAt = prior.row?.createdAt ?? updatedAt;
  const ciphertext = await new EncryptJWT({ purpose: PURPOSE, formatVersion: FORMAT, stack: STACK, origin: loaded.origin,
    configurationId: CONFIGURATION_ID, revision: version, createdAt, updatedAt, updatedById: actor.userId, providers: settings })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: JWE_TYPE }).setIssuer(loaded.origin).setAudience(PURPOSE)
    .setJti(`${STACK}:${CONFIGURATION_ID}:${version}`).setIssuedAt().encrypt(key);
  if (ciphertext.length > MAX_CIPHERTEXT) throw new Error('Configuration envelope too large');
  const nextSnapshot = snapshot('database', { id: CONFIGURATION_ID, version, ciphertext, createdAt, updatedAt, updatedById: actor.userId }, await fingerprint(ciphertext));
  const next = { ...loaded, snapshot: nextSnapshot, settings, source: 'database' as const };
  // Bound and serialize the exact public response before a write can commit.
  if (new TextEncoder().encode(JSON.stringify(configurationProjection(next))).length > 24576) throw new Error('Configuration projection too large');
  const authority = db.prepare(`SELECT CASE WHEN ${LIVE_ADMIN_SQL} THEN 1 ELSE json('OAUTH_CONFIGURATION_ADMIN_CHANGED') END AS guarded`).bind(actor.token, actor.userId);
  const mutation = previous === null
    ? db.prepare(`INSERT INTO OAuthProviderConfigurationSingleton (id, version, ciphertext, createdAt, updatedAt, updatedById)
        SELECT ?, ?, ?, ?, ?, ? WHERE ${LIVE_ADMIN_SQL}
        AND NOT EXISTS (SELECT 1 FROM OAuthProviderConfigurationSingleton)`)
      .bind(CONFIGURATION_ID, version, ciphertext, createdAt, updatedAt, actor.userId, actor.token, actor.userId)
    : db.prepare(`UPDATE OAuthProviderConfigurationSingleton SET version = ?, ciphertext = ?, updatedAt = ?, updatedById = ?
        WHERE id = ? AND version = ? AND ciphertext = ? AND ${LIVE_ADMIN_SQL}`)
      .bind(version, ciphertext, updatedAt, actor.userId, CONFIGURATION_ID, previous, loaded.snapshot.ciphertext, actor.token, actor.userId);
  try {
    await db.batch([
      authority, configurationGuard(db, loaded.snapshot),
      db.prepare(`SELECT CASE WHEN ? = 1 OR NOT EXISTS (SELECT 1 FROM "Account" WHERE provider = 'oidc')
        THEN 1 ELSE json('OAUTH_CONFIGURATION_IDENTITY_CHANGED') END AS guarded`).bind(sameOidcIdentity ? 1 : 0),
      mutation,
      db.prepare(`SELECT CASE WHEN changes() = 1 AND ${LIVE_ADMIN_SQL} AND EXISTS
        (SELECT 1 FROM OAuthProviderConfigurationSingleton WHERE id = ? AND version = ? AND ciphertext = ?
          AND createdAt = ? AND updatedAt = ? AND updatedById = ?)
        AND (SELECT COUNT(*) FROM OAuthProviderConfigurationSingleton) = 1
        THEN 1 ELSE json('OAUTH_CONFIGURATION_WRITE_INVARIANT') END AS guarded`)
        .bind(actor.token, actor.userId, CONFIGURATION_ID, version, ciphertext, createdAt, updatedAt, actor.userId),
    ]);
  } catch (error) {
    // Only classify a known rolled-back SQL assertion as a conflict; never
    // retry an ambiguous outcome, and never reflect the underlying exception.
    let current = error;
    for (let depth = 0; depth < 6 && current; depth++) {
      const message = current instanceof Error ? current.message : typeof current === 'string' ? current : '';
      if (/OAUTH_CONFIGURATION_IDENTITY_CHANGED/i.test(message)) throw new OAuthIdentityChange();
      if (/OAUTH_CONFIGURATION_(?:CHANGED|ADMIN_CHANGED|WRITE_INVARIANT)|malformed JSON/i.test(message)) throw new OAuthConfigurationConflict();
      current = typeof current === 'object' && 'cause' in current ? current.cause : null;
    }
    throw new Error('Configuration persistence unavailable');
  }
  return next;
}
/** Explicit allowlist: ciphertext, keys, secrets, audit IDs and exceptions can
 * never enter the admin API response or the server-rendered page. */
export function configurationProjection(loaded: LoadedConfiguration) {
  const { google, oidc } = loaded.settings;
  return {
    revision: loaded.snapshot.revision, canSave: !loaded.unavailable && loaded.blockers.length === 0,
    blockers: [...new Set(loaded.blockers)], source: loaded.source,
    callbackUrls: { google: loaded.origin ? `${loaded.origin}/api/auth/callback/google` : null,
      oidc: loaded.origin ? `${loaded.origin}/api/auth/callback/oidc` : null },
    providers: {
      google: { enabled: google.enabled, clientId: google.clientId, clientSecretSet: Boolean(google.clientSecret) },
      oidc: { enabled: oidc.enabled, name: oidc.name, issuer: oidc.issuer, clientId: oidc.clientId,
        clientSecretSet: Boolean(oidc.clientSecret), tokenAuthMethod: oidc.tokenAuthMethod,
        allowedEndpointOrigins: [...oidc.allowedEndpointOrigins] },
    },
  };
}
