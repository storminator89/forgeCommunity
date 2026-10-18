import { env } from 'cloudflare:workers';

export type OAuthProviderId = 'google' | 'oidc';
export type OAuthProvider = {
  id: OAuthProviderId;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  tokenAuthMethod: 'client_secret_basic' | 'client_secret_post';
  endpointOrigins: string[];
};
export type OAuthConfiguration = { origin: string; stateSecret: string; providers: OAuthProvider[] };

function value(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}
function bounded(input: string, maximum: number) {
  return Boolean(input && input.length <= maximum && !/[\u0000-\u001f\u007f]/.test(input));
}

export function isPublicIdentityUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  // Literal IPv4/IPv6 (including URL-normalized alternative IPv4 notation),
  // loopback and common private DNS namespaces are never identity targets.
  // DNS resolution/rebinding remains a trust obligation of operator-selected
  // public identity-provider domains; Workers does not expose a safe DNS pin.
  return url.protocol === 'https:' && host.length <= 253 && !host.endsWith('.') &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) &&
    !/(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example)$/.test(host) && host !== 'home.arpa' && !host.endsWith('.home.arpa');
}

function httpsUrl(input: string, originOnly = false): string | null {
  if (input.length > 2048 || input.includes('\\') || /[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    if (!isPublicIdentityUrl(url) || url.username || url.password || url.search || url.hash) return null;
    if (originOnly && url.pathname !== '/') return null;
    return originOnly ? url.origin : input;
  } catch { return null; }
}

/** Server-only allowlist. Partial or invalid configuration enables no provider. */
export async function oauthConfiguration(): Promise<OAuthConfiguration | null> {
  // Setting credentials alone must never activate code against an unmigrated
  // live database. The owner first verifies the prepared migration separately.
  if (env.OAUTH_TRANSACTION_MIGRATION_READY !== 'true' || !env.DB) return null;
  const origin = httpsUrl(value(env.OAUTH_BASE_URL), true);
  const stateSecret = value(env.OAUTH_STATE_SECRET);
  if (!origin || !bounded(stateSecret, 8192) || new TextEncoder().encode(stateSecret).length < 32) return null;
  const providers: OAuthProvider[] = [];
  const googleId = value(env.GOOGLE_CLIENT_ID);
  const googleSecret = value(env.GOOGLE_CLIENT_SECRET);
  if (bounded(googleId, 1024) && /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(googleId) && bounded(googleSecret, 4096)) providers.push({
    id: 'google', name: 'Google', issuer: 'https://accounts.google.com',
    clientId: googleId, clientSecret: googleSecret, tokenAuthMethod: 'client_secret_post',
    endpointOrigins: ['https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://www.googleapis.com'],
  });
  const issuer = httpsUrl(value(env.OIDC_ISSUER));
  const clientId = value(env.OIDC_CLIENT_ID);
  const clientSecret = value(env.OIDC_CLIENT_SECRET);
  const method = value(env.OIDC_TOKEN_AUTH_METHOD) || 'client_secret_basic';
  const name = value(env.OIDC_NAME) || 'Single Sign-on';
  const additionalOrigins = value(env.OIDC_ALLOWED_ENDPOINT_ORIGINS).split(',').map(item => item.trim()).filter(Boolean);
  const validOrigins = additionalOrigins.length <= 5 && additionalOrigins.every(item => httpsUrl(item, true) === item);
  if (issuer && bounded(clientId, 1024) && bounded(clientSecret, 4096) && bounded(name, 60) && validOrigins && (method === 'client_secret_basic' || method === 'client_secret_post')) providers.push({
    id: 'oidc', name, issuer,
    clientId, clientSecret, tokenAuthMethod: method,
    endpointOrigins: [...new Set([new URL(issuer).origin, ...additionalOrigins])],
  });
  if (providers.length) {
    try {
      // Read-only shape verification. This code never creates/migrates a table.
      await env.DB.prepare('SELECT id, bindingHash, browserBindingHash, provider, createdAt, expiresAt, consumedAt, finalizedAt, issuedSessionId FROM OAuthLoginTransaction WHERE 1 = 0').all();
    } catch { return null; }
  }
  return { origin, stateSecret, providers };
}

export function safeOAuthReturnPath(input: unknown): string {
  return typeof input === 'string' && input.length <= 1024 && /^\/(?![\\/])[^\\\u0000-\u001f\u007f]*$/.test(input)
    ? input : '/community';
}
