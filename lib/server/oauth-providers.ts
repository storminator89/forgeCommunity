import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import { z } from 'zod';
import { normalizeEmail } from '@/lib/server/auth-security';

type Claims = Record<string, unknown>;
export type OAuthProviderId = 'google' | 'oidc';
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const emailSchema = z.string().trim().max(254).email();
const OIDC_DISCOVERY_LIMIT = 64 * 1024;

function publicHttpsUrl(value: unknown, originOnly = false): URL | null {
  if (typeof value !== 'string') return null;
  const url = configurationUrl(value, true, originOnly);
  if (!url || url.protocol !== 'https:') return null;
  const hostname = url.hostname.toLowerCase();
  if (hostname.length > 253 || isIP(hostname.replace(/^\[|\]$/g, '')) || hostname.endsWith('.') ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname) ||
      /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example)$/.test(hostname) ||
      (hostname === 'home.arpa' || hostname.endsWith('.home.arpa'))) return null;
  return url;
}

function allowedEndpointOrigins(issuer: URL, value: string | undefined): Set<string> | null {
  if (value && (value.length > 4096 || CONTROL_CHARACTERS.test(value))) return null;
  const origins = new Set([issuer.origin]);
  const extra = value?.trim() ? value.split(',') : [];
  if (extra.length > 16) return null;
  for (const entry of extra) {
    const url = publicHttpsUrl(entry.trim(), true);
    if (!url) return null;
    origins.add(url.origin);
  }
  return origins;
}

async function boundedDiscoveryJson(response: Response): Promise<Claims> {
  if (response.status !== 200 || !response.body ||
      Number(response.headers.get('content-length') ?? 0) > OIDC_DISCOVERY_LIMIT) {
    throw new Error('InvalidOIDCDiscovery');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > OIDC_DISCOVERY_LIMIT) {
      void reader.cancel().catch(() => undefined);
      throw new Error('InvalidOIDCDiscovery');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const result = claimsObject(JSON.parse(new TextDecoder().decode(bytes)));
  if (!result) throw new Error('InvalidOIDCDiscovery');
  return result;
}

async function resolveOIDCProvider(provider: OAuthConfig<Claims>, origins: Set<string>): Promise<OAuthConfig<Claims>> {
  const issuer = provider.issuer!;
  // Only the private operator configuration supplies a fetch target. Redirects
  // are forbidden, and metadata is validated before any credential is sent.
  const response = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  const metadata = await boundedDiscoveryJson(response);
  const includes = (value: unknown, item: string) => Array.isArray(value) && value.includes(item);
  if (metadata.issuer !== issuer || !includes(metadata.response_types_supported, 'code') ||
      !includes(metadata.code_challenge_methods_supported, 'S256') ||
      !includes(metadata.id_token_signing_alg_values_supported, 'RS256') ||
      (metadata.grant_types_supported !== undefined && !includes(metadata.grant_types_supported, 'authorization_code')) ||
      (metadata.response_modes_supported !== undefined && !includes(metadata.response_modes_supported, 'query')) ||
      !includes(metadata.token_endpoint_auth_methods_supported ?? ['client_secret_basic'], provider.client!.token_endpoint_auth_method!)) {
    throw new Error('InvalidOIDCDiscovery');
  }
  const endpoint = (value: unknown): string => {
    const url = publicHttpsUrl(value);
    if (!url || !origins.has(url.origin)) throw new Error('InvalidOIDCEndpoint');
    return url.href;
  };
  const authorization = endpoint(metadata.authorization_endpoint);
  const token = endpoint(metadata.token_endpoint);
  const jwks = endpoint(metadata.jwks_uri);
  if (metadata.userinfo_endpoint !== undefined) endpoint(metadata.userinfo_endpoint);
  return {
    ...provider,
    // No wellKnown: NextAuth must use only these prevalidated endpoint URLs.
    authorization: { url: authorization, params: {
      scope: 'openid email profile', response_type: 'code', response_mode: 'query',
    } },
    token: { url: token },
    jwks_endpoint: jwks,
  };
}

function boundedValue(value: string | undefined, maximum: number): string | null {
  if (!value || !value.trim() || value.length > maximum || CONTROL_CHARACTERS.test(value)) return null;
  return value;
}

function configurationUrl(value: string | undefined, production: boolean, originOnly = false): URL | null {
  if (!boundedValue(value, 2048) || value !== value?.trim() || value?.includes('\\')) return null;
  try {
    const url = new URL(value!);
    // NextAuth's URL utility and getToken inspect raw prefixes in different
    // ways. Accept only an explicit canonical lowercase scheme in config.
    if (!value!.startsWith(`${url.protocol}//`)) return null;
    const localHttp = !production && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password ||
        url.search || url.hash || (originOnly && url.pathname !== '/')) return null;
    return url;
  } catch {
    return null;
  }
}

function claimsObject(value: unknown): Claims | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Claims : null;
}

export function verifiedOAuthEmail(value: unknown): string | null {
  const profile = claimsObject(value);
  // OIDC defines a JSON boolean. The string "true" is deliberately rejected.
  if (!profile || profile.email_verified !== true) return null;
  const parsed = emailSchema.safeParse(profile.email);
  return parsed.success ? normalizeEmail(parsed.data) : null;
}

function safeName(value: unknown): string | null {
  return typeof value === 'string' && !CONTROL_CHARACTERS.test(value)
    ? value.trim().slice(0, 120) || null : null;
}

function safePicture(value: unknown): string | null {
  if (typeof value !== 'string' || !boundedValue(value, 2048)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function accountIdentity(profile: Claims, issuer: string, provider: OAuthProviderId): string {
  const issuers = provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : [issuer];
  if (!issuers.includes(profile.iss as string) || typeof profile.sub !== 'string' ||
      !/^[\x21-\x7e]{1,255}$/.test(profile.sub)) {
    throw new Error('InvalidOAuthIdentity');
  }

  // Keep existing Google identities compatible. Generic OIDC identities bind
  // the subject to the exact issuer, even when OIDC_ISSUER changes later.
  return provider === 'google' ? profile.sub
    : createHash('sha256').update(JSON.stringify([issuer, profile.sub])).digest('hex');
}

function mappedProfile(profile: Claims, issuer: string, provider: OAuthProviderId) {
  const id = accountIdentity(profile, issuer, provider);
  const email = emailSchema.safeParse(profile.email);
  return {
    id,
    name: safeName(profile.name),
    email: email.success ? normalizeEmail(email.data) : null,
    image: safePicture(profile.picture),
  };
}

/** Missing or invalid optional configuration disables only that provider. */
export function createOAuthProviders(env: NodeJS.ProcessEnv = process.env): {
  providers: NextAuthOptions['providers'];
  enabledIds: OAuthProviderId[];
  matchesIdentity: (provider: string, providerAccountId: string, profile: unknown) => boolean;
  issuerFor: (provider: string) => string | undefined;
  resolveProviders: (provider: string) => Promise<NextAuthOptions['providers']>;
} {
  const providers: NextAuthOptions['providers'] = [];
  const enabledIds: OAuthProviderId[] = [];
  const issuers = new Map<OAuthProviderId, string>();
  let oidcRuntime: { provider: OAuthConfig<Claims>; origins: Set<string> } | null = null;
  const issuerFor = (provider: string) => issuers.get(provider as OAuthProviderId);
  const resolveProviders = async (provider: string): Promise<NextAuthOptions['providers']> => {
    if (provider !== 'oidc' || !oidcRuntime) return providers;
    const resolved = await resolveOIDCProvider(oidcRuntime.provider, oidcRuntime.origins);
    return providers.map(configured => configured.id === 'oidc' ? resolved : configured);
  };
  const matchesIdentity = (provider: string, providerAccountId: string, value: unknown): boolean => {
    const issuer = issuers.get(provider as OAuthProviderId);
    const profile = claimsObject(value);
    if (!issuer || !profile) return false;
    try {
      // Token response extension fields must never override the account's
      // provider/subject when NextAuth spreads the token set onto the account.
      return accountIdentity(profile, issuer, provider as OAuthProviderId) === providerAccountId;
    } catch {
      return false;
    }
  };
  const googleRequested = Boolean(env.GOOGLE_CLIENT_ID?.trim() || env.GOOGLE_CLIENT_SECRET?.trim());
  const oidcRequested = Boolean(env.OIDC_ISSUER?.trim() || env.OIDC_CLIENT_ID?.trim() || env.OIDC_CLIENT_SECRET?.trim());
  if (!googleRequested && !oidcRequested) return { providers, enabledIds, matchesIdentity, issuerFor, resolveProviders };

  const production = env.NODE_ENV === 'production';
  if (!configurationUrl(env.NEXTAUTH_URL, production, true) ||
      !boundedValue(env.NEXTAUTH_SECRET, 8192) || env.NEXTAUTH_SECRET!.trim().length < 32) {
    console.warn('[auth] Optional OAuth login disabled: configure a valid NEXTAUTH_URL and NEXTAUTH_SECRET (at least 32 characters).');
    return { providers, enabledIds, matchesIdentity, issuerFor, resolveProviders };
  }

  const googleId = boundedValue(env.GOOGLE_CLIENT_ID, 1024);
  const googleSecret = boundedValue(env.GOOGLE_CLIENT_SECRET, 4096);
  if (googleRequested) {
    if (googleId && /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(googleId) && googleSecret) {
      providers.push(GoogleProvider({
        clientId: googleId,
        clientSecret: googleSecret,
        wellKnown: undefined,
        issuer: 'https://accounts.google.com',
        token: { url: 'https://oauth2.googleapis.com/token' },
        jwks_endpoint: 'https://www.googleapis.com/oauth2/v3/certs',
        checks: ['state', 'pkce', 'nonce'],
        client: { id_token_signed_response_alg: 'RS256' },
        authorization: { url: 'https://accounts.google.com/o/oauth2/v2/auth', params: {
          scope: 'openid email profile', response_type: 'code', response_mode: 'query',
        } },
        profile: profile => mappedProfile(profile, 'https://accounts.google.com', 'google'),
      }));
      enabledIds.push('google');
      issuers.set('google', 'https://accounts.google.com');
    } else {
      console.warn('[auth] Google login disabled: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be valid.');
    }
  }

  if (oidcRequested) {
    const issuer = env.OIDC_ISSUER;
    const clientId = boundedValue(env.OIDC_CLIENT_ID, 1024);
    const clientSecret = boundedValue(env.OIDC_CLIENT_SECRET, 4096);
    const name = env.OIDC_NAME?.trim() || 'OpenID Connect';
    const authMethod = env.OIDC_TOKEN_AUTH_METHOD?.trim() || 'client_secret_basic';
    const issuerUrl = publicHttpsUrl(issuer);
    const origins = issuerUrl ? allowedEndpointOrigins(issuerUrl, env.OIDC_ALLOWED_ENDPOINT_ORIGINS) : null;
    if (issuer && issuerUrl && origins && clientId && clientSecret &&
        name.length <= 60 && !CONTROL_CHARACTERS.test(name) &&
        (authMethod === 'client_secret_basic' || authMethod === 'client_secret_post')) {
      const provider: OAuthConfig<Claims> = {
        id: 'oidc',
        name,
        type: 'oauth',
        issuer,
        clientId,
        clientSecret,
        idToken: true,
        checks: ['state', 'pkce', 'nonce'],
        client: {
          token_endpoint_auth_method: authMethod,
          id_token_signed_response_alg: 'RS256',
        },
        authorization: { params: { scope: 'openid email profile', response_type: 'code', response_mode: 'query' } },
        profile: profile => mappedProfile(profile, issuer, 'oidc'),
      };
      providers.push(provider);
      enabledIds.push('oidc');
      issuers.set('oidc', issuer);
      oidcRuntime = { provider, origins };
    } else {
      console.warn('[auth] OIDC login disabled: complete valid OIDC issuer, client credentials, name and token auth method are required.');
    }
  }
  return { providers, enabledIds, matchesIdentity, issuerFor, resolveProviders };
}
