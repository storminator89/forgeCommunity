import { NextResponse } from 'next/server';
import { EncryptJWT, jwtDecrypt } from 'jose';
import * as oauth from 'oauth4webapi';
import { env } from 'cloudflare:workers';
import prisma from '@/lib/prisma';
import { normalizeEmail, readRequestBody } from '@/lib/server/auth-security';
import { consumeRateLimit, LOGIN_AGGREGATE_RATE_LIMIT, rateLimitHeaders } from '@/lib/server/rate-limit';
import { createSessionToken } from './credentials';
import { getServerSession, sessionCookie } from './server';
import { isPublicIdentityUrl, oauthConfiguration, safeOAuthReturnPath } from './oauth-config';
import type { OAuthConfiguration, OAuthProvider } from './oauth-config';
import { configurationGuard, oauthDatabase } from './oauth-configuration-store';

const TRANSACTION_SECONDS = 600;
const RESPONSE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const COOKIE_PREFIX = '__Host-forge.oauth.';
const BROWSER_COOKIE = `${COOKIE_PREFIX}browser`;
type Transaction = { state: string; nonce: string; verifier: string; provider: string; issuer: string; clientId: string; returnTo: string; browserBindingHash: string; configRevision: number | null; configBinding: string };
type BoundTransaction = Transaction & { id: string; bindingHash: string; consumedAt?: number };

function cookieName(provider: string) { return `${COOKIE_PREFIX}${provider}`; }
function transactionCookie(provider: string, token: string, maxAge = TRANSACTION_SECONDS) {
  return `${cookieName(provider)}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function readTransactionCookie(request: Request, provider: string): string | null {
  return readCookie(request, cookieName(provider));
}
function readCookie(request: Request, name: string): string | null {
  const values = (request.headers.get('cookie') || '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  // Duplicate cookie names can be ambiguous. Host-only Secure cookies prevent
  // subdomain cookie injection; rejecting duplicates also fails closed.
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return token.length <= 4096 ? token : null;
}
function browserCookie(token: string, maxAge = TRANSACTION_SECONDS) {
  return `${BROWSER_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function browserToken(request: Request) {
  const token = readCookie(request, BROWSER_COOKIE);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
async function transactionKey(configuration: OAuthConfiguration) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(configuration.stateSecret)));
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function callbackUrl(configuration: OAuthConfiguration, provider: OAuthProvider) {
  return `${configuration.origin}/api/auth/callback/${provider.id}`;
}
function errorResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: RESPONSE_HEADERS });
}
function callbackFailure(providerId: string, reason: string, origin: string) {
  const destination = new URL('/login', origin);
  destination.searchParams.set('error', reason);
  const response = NextResponse.redirect(destination, 303);
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) response.headers.set(name, value);
  if (providerId === 'google' || providerId === 'oidc') response.headers.append('Set-Cookie', transactionCookie(providerId, '', 0));
  return response;
}
function allowedEndpoint(provider: OAuthProvider, endpoint: string) {
  const url = new URL(endpoint);
  return isPublicIdentityUrl(url) && !url.username && !url.password && !url.hash && provider.endpointOrigins.includes(url.origin);
}
function requestOptions(provider: OAuthProvider) {
  return {
    signal: AbortSignal.timeout(10_000),
    [oauth.customFetch]: async (url: string, options: RequestInit) => {
      if (!allowedEndpoint(provider, url)) throw new Error('Untrusted OIDC endpoint');
      // Never follow discovery, token or JWKS redirects onto another target.
      return fetch(url, { ...options, redirect: 'manual' });
    },
  };
}

function generationId(bindingHash: string) { return `browser:${bindingHash}`; }

/** Create a generation before the UI enables any sign-in button. Begin itself
 * never recreates a revoked generation from an older, in-flight request. */
export async function oauthProviderList(request: Request) {
  const configuration = await oauthConfiguration();
  if (!configuration || !configuration.providers.length || new URL(request.url).origin !== configuration.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ providers: [] }, { headers: RESPONSE_HEADERS });
  }
  const limit = consumeRateLimit('oauth:browser:aggregate', LOGIN_AGGREGATE_RATE_LIMIT);
  if (!limit.allowed) return NextResponse.json({ providers: [] }, { status: 429, headers: { ...RESPONSE_HEADERS, ...rateLimitHeaders(limit) } });
  try {
    if (!env.DB) throw new Error('Missing D1 binding');
    let browser = browserToken(request);
    const now = Date.now();
    const currentHash = browser ? await digest(browser) : null;
    const current = currentHash ? await env.DB.prepare(`SELECT id FROM OAuthLoginTransaction
      WHERE id = ? AND provider = 'browser' AND bindingHash = ? AND browserBindingHash = ? AND consumedAt IS NULL AND expiresAt > ?`)
      .bind(generationId(currentHash), currentHash, currentHash, now).first<{ id: string }>() : null;
    const response = NextResponse.json({ providers: configuration.providers.map(({ id, name }) => ({ id, name })) }, { headers: RESPONSE_HEADERS });
    if (!current) {
      browser = createSessionToken();
      const bindingHash = await digest(browser);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM OAuthLoginTransaction WHERE id IN (SELECT id FROM OAuthLoginTransaction WHERE expiresAt <= ? LIMIT 100)').bind(now),
        env.DB.prepare(`INSERT INTO OAuthLoginTransaction (id, bindingHash, browserBindingHash, provider, createdAt, expiresAt)
          VALUES (?, ?, ?, 'browser', ?, ?)`).bind(generationId(bindingHash), bindingHash, bindingHash, now, now + TRANSACTION_SECONDS * 1000),
      ]);
      response.headers.append('Set-Cookie', browserCookie(browser));
    }
    return response;
  } catch { return NextResponse.json({ providers: [] }, { headers: RESPONSE_HEADERS }); }
}

async function discover(provider: OAuthProvider) {
  const issuer = new URL(provider.issuer);
  const response = await oauth.discoveryRequest(issuer, requestOptions(provider));
  const server = await oauth.processDiscoveryResponse(issuer, response);
  for (const endpoint of [server.authorization_endpoint, server.token_endpoint, server.jwks_uri]) {
    if (typeof endpoint !== 'string') throw new Error('Missing OIDC endpoint');
    if (!allowedEndpoint(provider, endpoint)) throw new Error('Invalid OIDC endpoint');
  }
  if (server.token_endpoint_auth_methods_supported && !server.token_endpoint_auth_methods_supported.includes(provider.tokenAuthMethod)) {
    throw new Error('Unsupported OIDC client authentication');
  }
  if (server.id_token_signing_alg_values_supported && !server.id_token_signing_alg_values_supported.includes('RS256')) {
    throw new Error('Provider must support RS256');
  }
  return server;
}

/** POST + exact Origin protects initiation; PKCE/state/nonce bind the callback. */
export async function beginOAuth(request: Request, providerId: string) {
  const configuration = await oauthConfiguration();
  const provider = configuration?.providers.find(item => item.id === providerId);
  if (!configuration || !provider) return errorResponse('Dieser Anmeldedienst ist nicht eingerichtet.', 404);
  if (new URL(request.url).origin !== configuration.origin || request.headers.get('origin') !== configuration.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return errorResponse('Ungültige Anfragequelle.', 403);
  }
  // Login never doubles as an implicit account-linking endpoint.
  if (await getServerSession()) return errorResponse('Bitte melde dich zuerst ab, um den Anmeldedienst zu wechseln.', 409);
  const limit = consumeRateLimit('oauth:begin:aggregate', LOGIN_AGGREGATE_RATE_LIMIT);
  if (!limit.allowed) return NextResponse.json({ message: 'Zu viele Anfragen. Bitte versuche es später erneut.' }, { status: 429, headers: { ...RESPONSE_HEADERS, ...rateLimitHeaders(limit) } });
  let body: unknown;
  try {
    const raw = await readRequestBody(request, 2048);
    if (raw === null) return errorResponse('Anfrage ist zu groß.', 413);
    body = JSON.parse(raw);
  } catch { return errorResponse('Ungültige Anfrage.', 400); }
  const returnTo = safeOAuthReturnPath(body && typeof body === 'object' ? (body as { callbackUrl?: unknown }).callbackUrl : undefined);
  try {
    const state = oauth.generateRandomState();
    const nonce = oauth.generateRandomNonce();
    const verifier = oauth.generateRandomCodeVerifier();
    const browser = browserToken(request);
    if (!browser) return errorResponse('Die Anmeldung ist abgelaufen. Bitte lade die Seite neu.', 409);
    const browserBindingHash = await digest(browser);
    const transaction: Transaction = { state, nonce, verifier, provider: provider.id, issuer: provider.issuer, clientId: provider.clientId, returnTo, browserBindingHash,
      configRevision: configuration.configRevision, configBinding: configuration.configBinding };
    const id = crypto.randomUUID();
    const token = await new EncryptJWT(transaction).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuer(configuration.origin).setAudience(configuration.origin).setJti(id).setIssuedAt().setExpirationTime(`${TRANSACTION_SECONDS}s`)
      .encrypt(await transactionKey(configuration));
    if (transactionCookie(provider.id, token).length > 4096) throw new Error('Transaction cookie exceeds browser limit');
    if (!env.DB) throw new Error('Missing D1 binding');
    const now = Date.now();
    const db = oauthDatabase();
    await db.batch([
      configurationGuard(db, configuration.storage),
      db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM OAuthLoginTransaction WHERE id = ?
        AND provider = 'browser' AND bindingHash = ? AND browserBindingHash = ? AND consumedAt IS NULL AND expiresAt > ?)
        THEN 1 ELSE json('OAUTH_BROWSER_REVOKED') END AS guarded`)
        .bind(generationId(browserBindingHash), browserBindingHash, browserBindingHash, now),
      // Bounded housekeeping removes old state without retaining any long-term
      // nonce, PKCE verifier, OAuth code or provider token in the database.
      db.prepare('DELETE FROM OAuthLoginTransaction WHERE id IN (SELECT id FROM OAuthLoginTransaction WHERE expiresAt <= ? LIMIT 100)').bind(now),
      db.prepare('DELETE FROM OAuthLoginTransaction WHERE browserBindingHash = ? AND provider = ? AND finalizedAt IS NULL').bind(browserBindingHash, provider.id),
      db.prepare(`UPDATE OAuthLoginTransaction SET expiresAt = ? WHERE id = ? AND provider = 'browser' AND consumedAt IS NULL`)
        .bind(now + TRANSACTION_SECONDS * 1000, generationId(browserBindingHash)),
      db.prepare('INSERT INTO OAuthLoginTransaction (id, bindingHash, browserBindingHash, provider, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, await digest(token), browserBindingHash, provider.id, now, now + TRANSACTION_SECONDS * 1000),
    ]);
    // The transaction exists before external I/O, so a concurrent logout can
    // revoke it and permanently mark this generation as unusable.
    const server = await discover(provider);
    const active = await env.DB.prepare(`SELECT t.id FROM OAuthLoginTransaction t JOIN OAuthLoginTransaction g
      ON g.id = ? AND g.provider = 'browser' AND g.consumedAt IS NULL AND g.expiresAt > ?
      WHERE t.id = ? AND t.consumedAt IS NULL AND t.expiresAt > ?`)
      .bind(generationId(browserBindingHash), Date.now(), id, Date.now()).first<{ id: string }>();
    if (active?.id !== id) throw new Error('Revoked transaction');
    const destination = new URL(server.authorization_endpoint!);
    destination.searchParams.set('client_id', provider.clientId);
    destination.searchParams.set('redirect_uri', callbackUrl(configuration, provider));
    destination.searchParams.set('response_type', 'code');
    destination.searchParams.set('response_mode', 'query');
    destination.searchParams.set('scope', 'openid email profile');
    destination.searchParams.set('state', state);
    destination.searchParams.set('nonce', nonce);
    destination.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(verifier));
    destination.searchParams.set('code_challenge_method', 'S256');
    const response = NextResponse.json({ url: destination.href }, { headers: RESPONSE_HEADERS });
    response.headers.append('Set-Cookie', transactionCookie(provider.id, token));
    response.headers.append('Set-Cookie', browserCookie(browser));
    return response;
  } catch { return errorResponse('Der Anmeldedienst ist momentan nicht erreichbar.', 503); }
}

async function readTransaction(request: Request, configuration: OAuthConfiguration, provider: OAuthProvider): Promise<BoundTransaction> {
  const token = readTransactionCookie(request, provider.id);
  if (!token) throw new Error('Missing transaction');
  const { payload } = await jwtDecrypt(token, await transactionKey(configuration), {
    issuer: configuration.origin, audience: configuration.origin,
    keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'], maxTokenAge: '10m',
    requiredClaims: ['iat', 'exp', 'jti'],
  });
  if (typeof payload.jti !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.jti)) throw new Error('Invalid transaction id');
  if (payload.configRevision !== configuration.configRevision || payload.configBinding !== configuration.configBinding) throw new Error('Changed OAuth configuration');
  if (payload.provider !== provider.id || payload.issuer !== provider.issuer || payload.clientId !== provider.clientId) throw new Error('Changed provider');
  const browser = browserToken(request);
  if (!browser || payload.browserBindingHash !== await digest(browser)) throw new Error('Changed browser generation');
  for (const field of ['state', 'nonce', 'verifier'] as const) {
    if (typeof payload[field] !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(payload[field] as string)) throw new Error('Invalid transaction');
  }
  if (typeof payload.returnTo !== 'string' || safeOAuthReturnPath(payload.returnTo) !== payload.returnTo) throw new Error('Invalid return path');
  return { ...(payload as unknown as Transaction), id: payload.jti, bindingHash: await digest(token) };
}

async function accountSubject(provider: OAuthProvider, subject: string): Promise<string> {
  if (provider.id === 'google') return subject;
  return digest(JSON.stringify([provider.issuer, subject]));
}

async function consumeTransaction(transaction: BoundTransaction) {
  if (!env.DB) throw new Error('Missing D1 binding');
  const now = Date.now();
  const result = await env.DB.prepare(`UPDATE OAuthLoginTransaction SET consumedAt = ?
    WHERE id = ? AND bindingHash = ? AND browserBindingHash = ? AND provider = ? AND expiresAt > ? AND consumedAt IS NULL AND finalizedAt IS NULL
    AND EXISTS (SELECT 1 FROM OAuthLoginTransaction g WHERE g.id = ? AND g.provider = 'browser' AND g.browserBindingHash = ? AND g.consumedAt IS NULL AND g.expiresAt > ?)
    RETURNING id`).bind(now, transaction.id, transaction.bindingHash, transaction.browserBindingHash, transaction.provider, now,
      generationId(transaction.browserBindingHash), transaction.browserBindingHash, now).first<{ id: string }>();
  if (result?.id !== transaction.id) throw new Error('Expired or consumed transaction');
  transaction.consumedAt = now;
}

async function finalizeOAuthSession(transaction: BoundTransaction, provider: OAuthProvider, providerAccountId: string,
  existingAccount: { id: string; userId: string } | null, email: string, name: string | null, configuration: OAuthConfiguration) {
  if (!env.DB) throw new Error('Missing D1 binding');
  const db = oauthDatabase();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString().replace(/Z$/, '+00:00');
  const userId = existingAccount?.userId || crypto.randomUUID();
  const accountId = existingAccount?.id || crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const token = createSessionToken();
  const expires = new Date(nowMs + 30 * 24 * 60 * 60 * 1000);
  const expiresText = expires.toISOString().replace(/Z$/, '+00:00');
  // Validate/serialize all return values before committing. After batch returns,
  // do not decode result rows or retry a potentially committed operation.
  const cookie = sessionCookie(token, configuration.origin, expires);
  const transactionFence = `id = ? AND bindingHash = ? AND browserBindingHash = ? AND provider = ?
    AND consumedAt = ? AND finalizedAt IS NULL AND expiresAt > ?
    AND EXISTS (SELECT 1 FROM OAuthLoginTransaction g WHERE g.id = ? AND g.provider = 'browser' AND g.browserBindingHash = ? AND g.consumedAt IS NULL AND g.expiresAt > ?)`;
  const fenceValues = [transaction.id, transaction.bindingHash, transaction.browserBindingHash, provider.id, transaction.consumedAt!, nowMs,
    generationId(transaction.browserBindingHash), transaction.browserBindingHash, nowMs];
  const statements = [
    configurationGuard(db, configuration.storage),
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM OAuthLoginTransaction WHERE ${transactionFence})
      THEN 1 ELSE json('OAUTH_TRANSACTION_INVARIANT') END AS guarded`).bind(...fenceValues),
  ];
  if (existingAccount) {
    statements.push(
      db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM "Account" a JOIN "User" u ON u.id = a.userId
        WHERE a.id = ? AND a.provider = ? AND a.providerAccountId = ? AND a.userId = ?)
        THEN 1 ELSE json('OAUTH_IDENTITY_INVARIANT') END AS guarded`).bind(accountId, provider.id, providerAccountId, userId),
      db.prepare('UPDATE "User" SET lastLogin = ? WHERE id = ?').bind(now, userId),
      db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('OAUTH_LAST_LOGIN_INVARIANT') END AS guarded`),
    );
  } else {
    statements.push(
      db.prepare(`SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE lower(email) = lower(?))
        AND NOT EXISTS (SELECT 1 FROM "Account" WHERE provider = ? AND providerAccountId = ?)
        THEN 1 ELSE json('OAUTH_ACCOUNT_NOT_LINKED') END AS guarded`).bind(email, provider.id, providerAccountId),
      db.prepare(`INSERT INTO "User" (id, email, emailVerified, name, role, lastLogin, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 'USER', ?, ?, ?)`).bind(userId, email, now, name, now, now, now),
      db.prepare(`INSERT INTO "Account" (id, userId, type, provider, providerAccountId)
        VALUES (?, ?, 'oidc', ?, ?)`).bind(accountId, userId, provider.id, providerAccountId),
    );
  }
  statements.push(
    db.prepare('INSERT INTO "Session" (id, sessionToken, userId, expires) VALUES (?, ?, ?, ?)').bind(sessionId, token, userId, expiresText),
    db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM "Session" s JOIN "Account" a ON a.userId = s.userId
      JOIN "User" u ON u.id = s.userId WHERE s.id = ? AND s.sessionToken = ? AND s.userId = ? AND s.expires = ?
      AND a.id = ? AND a.provider = ? AND a.providerAccountId = ? AND u.lastLogin = ?
      ${existingAccount ? '' : "AND u.role = 'USER' AND u.email = ? AND u.emailVerified = ? AND u.password IS NULL AND u.name IS ? AND a.access_token IS NULL AND a.refresh_token IS NULL AND a.id_token IS NULL"})
      THEN 1 ELSE json('OAUTH_SESSION_INVARIANT') END AS guarded`)
      .bind(sessionId, token, userId, expiresText, accountId, provider.id, providerAccountId, now,
        ...(existingAccount ? [] : [email, now, name])),
    db.prepare(`UPDATE OAuthLoginTransaction SET finalizedAt = ?, issuedSessionId = ? WHERE ${transactionFence}`).bind(nowMs, sessionId, ...fenceValues),
    db.prepare(`SELECT CASE WHEN changes() = 1 AND EXISTS (SELECT 1 FROM OAuthLoginTransaction
      WHERE id = ? AND bindingHash = ? AND browserBindingHash = ? AND provider = ? AND consumedAt = ?
      AND finalizedAt = ? AND issuedSessionId = ?)
      THEN 1 ELSE json('OAUTH_FINALIZE_INVARIANT') END AS guarded`)
      .bind(transaction.id, transaction.bindingHash, transaction.browserBindingHash, provider.id, transaction.consumedAt!, nowMs, sessionId),
  );
  // End assertion also guards config: saving while discovery/code exchange is
  // in flight cannot issue a session under the previous provider credentials.
  statements.push(configurationGuard(db, configuration.storage));
  // All identity, lastLogin, Session and finalization writes commit together.
  // SQL-side assertions throw and roll back the entire batch on any mismatch.
  await db.batch(statements);
  return cookie;
}

/** Logout invalidates this browser generation, including in-flight callbacks. */
export async function invalidateOAuthTransactions(request: Request): Promise<string[]> {
  const browser = browserToken(request);
  if (browser && env.DB) {
    const bindingHash = await digest(browser);
    try { await env.DB.prepare('SELECT id, bindingHash, browserBindingHash, provider, createdAt, expiresAt, consumedAt, finalizedAt, issuedSessionId FROM OAuthLoginTransaction WHERE 1 = 0').all(); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      // A syntactically valid but forged/stale optional cookie must not break
      // password auth before this feature was ever migrated/activated.
      const missingTable = /no such table:\s*(?:main\.)?["']?OAuthLoginTransaction\b/i.test(message);
      const missingColumn = /no such column:\s*["']?(?:id|bindingHash|browserBindingHash|provider|createdAt|expiresAt|consumedAt|finalizedAt|issuedSessionId)\b/i.test(message);
      // No OAuth transaction can finalize against a conclusively absent or
      // structurally incomplete table, even if its operator-ready flag was
      // mistakenly set. Preserve ordinary auth in that disabled state.
      if (missingTable || (env.OAUTH_TRANSACTION_MIGRATION_READY !== 'true' && missingColumn)) {
        return [browserCookie('', 0), ...['google', 'oidc'].map(provider => transactionCookie(provider, '', 0))];
      }
      throw error;
    }
    // Cover both orderings of logout racing a callback: an earlier logout
    // removes the transaction; an earlier completed callback has its newly
    // issued Session revoked here before its delayed response can log in.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM "Session" WHERE id IN (SELECT issuedSessionId FROM OAuthLoginTransaction WHERE browserBindingHash = ? AND issuedSessionId IS NOT NULL)').bind(bindingHash),
      env.DB.prepare(`UPDATE OAuthLoginTransaction SET consumedAt = COALESCE(consumedAt, ?) WHERE id = ? AND provider = 'browser'`)
        .bind(Date.now(), generationId(bindingHash)),
      env.DB.prepare("DELETE FROM OAuthLoginTransaction WHERE browserBindingHash = ? AND provider <> 'browser'").bind(bindingHash),
    ]);
  }
  return [browserCookie('', 0), ...['google', 'oidc'].map(provider => transactionCookie(provider, '', 0))];
}

export async function completeOAuth(request: Request, providerId: string) {
  const configuration = await oauthConfiguration();
  const provider = configuration?.providers.find(item => item.id === providerId);
  // Without trusted configuration use only the current origin for the fixed
  // local error page. No provider response data is ever reflected or logged.
  const origin = configuration?.origin || new URL(request.url).origin;
  if (!configuration || !provider || new URL(request.url).origin !== configuration.origin) return callbackFailure(providerId, 'OAuthUnavailable', origin);
  try {
    if (await getServerSession()) return callbackFailure(providerId, 'OAuthAlreadySignedIn', origin);
    const transaction = await readTransaction(request, configuration, provider);
    const callbackParameters = new URL(request.url).searchParams;
    if (callbackParameters.getAll('state').length !== 1 || callbackParameters.get('state') !== transaction.state) throw new Error('State mismatch');
    // Only this browser's exact JWE cookie and an unexpired, unused row can
    // consume the transaction. Do so before any network exchange or identity
    // write, including denial/error callbacks. Parallel/replayed callbacks fail.
    await consumeTransaction(transaction);
    const server = await discover(provider);
    const client: oauth.Client = { client_id: provider.clientId, id_token_signed_response_alg: 'RS256' };
    const parameters = oauth.validateAuthResponse(server, client, new URL(request.url), transaction.state);
    if (parameters.getAll('code').length !== 1 || !parameters.get('code') || parameters.get('code')!.length > 4096 ||
        ['id_token', 'access_token', 'token_type'].some(name => parameters.has(name))) throw new Error('Code-only callback required');
    const clientAuthentication = provider.tokenAuthMethod === 'client_secret_post'
      ? oauth.ClientSecretPost(provider.clientSecret) : oauth.ClientSecretBasic(provider.clientSecret);
    const tokenResponse = await oauth.authorizationCodeGrantRequest(server, client, clientAuthentication, parameters, callbackUrl(configuration, provider), transaction.verifier, requestOptions(provider));
    const result = await oauth.processAuthorizationCodeResponse(server, client, tokenResponse, { expectedNonce: transaction.nonce, requireIdToken: true });
    // oauth4webapi validates OIDC claims over the direct TLS response. Require
    // the additional JWKS signature check too, before using any identity.
    await oauth.validateApplicationLevelSignature(server, tokenResponse, requestOptions(provider));
    const claims = oauth.getValidatedIdTokenClaims(result);
    if (!claims || claims.iss !== provider.issuer || typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub) ||
        (claims.azp !== undefined && claims.azp !== provider.clientId) || claims.email_verified !== true ||
        typeof claims.email !== 'string' || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) {
      return callbackFailure(providerId, 'OAuthVerifiedEmailRequired', origin);
    }
    const providerAccountId = await accountSubject(provider, claims.sub);
    const identity = await prisma.account.findUnique({ where: { provider_providerAccountId: { provider: provider.id, providerAccountId } }, select: { id: true, userId: true } });
    let cookie: string;
    try {
      cookie = await finalizeOAuthSession(transaction, provider, providerAccountId, identity,
        normalizeEmail(claims.email), typeof claims.name === 'string' ? claims.name.slice(0, 120) : null, configuration);
    } catch { return callbackFailure(providerId, identity ? 'OAuthCallback' : 'OAuthAccountNotLinked', origin); }
    const response = NextResponse.redirect(new URL(transaction.returnTo, configuration.origin), 303);
    for (const [name, value] of Object.entries(RESPONSE_HEADERS)) response.headers.set(name, value);
    response.headers.append('Set-Cookie', transactionCookie(provider.id, '', 0));
    response.headers.append('Set-Cookie', cookie);
    return response;
  } catch { return callbackFailure(providerId, 'OAuthCallback', origin); }
}
