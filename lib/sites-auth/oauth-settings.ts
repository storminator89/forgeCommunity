import 'server-only';

import { env } from 'cloudflare:workers';

export type OAuthProviderId = 'google' | 'oidc';
export type TokenAuthMethod = 'client_secret_basic' | 'client_secret_post';
export type OAuthProvider = Readonly<{
  id: OAuthProviderId; name: string; issuer: string; clientId: string; clientSecret: string;
  tokenAuthMethod: TokenAuthMethod; endpointOrigins: readonly string[];
}>;
export type ProviderSettings = {
  google: { enabled: boolean; clientId: string; clientSecret: string };
  oidc: { enabled: boolean; name: string; issuer: string; clientId: string; clientSecret: string;
    tokenAuthMethod: TokenAuthMethod; allowedEndpointOrigins: string[] };
};
export type ProviderInput = {
  expectedRevision: number | null;
  google: Omit<ProviderSettings['google'], 'clientSecret'> & { clientSecret?: string };
  oidc: Omit<ProviderSettings['oidc'], 'clientSecret'> & { clientSecret?: string };
};

export function value(input: unknown): string { return typeof input === 'string' ? input.trim() : ''; }
export function bounded(input: string, maximum: number) {
  return Boolean(input.trim() && input.length <= maximum && !/[\u0000-\u001f\u007f]/.test(input));
}
export function isPublicIdentityUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  // Keep the existing protocol/SSRF boundary. Public-domain DNS rebinding is
  // still an operator trust obligation; Workers offers no safe DNS pinning.
  return url.protocol === 'https:' && host.length <= 253 && !host.endsWith('.') &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) &&
    !/(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example)$/.test(host) && host !== 'home.arpa' && !host.endsWith('.home.arpa');
}
export function httpsIdentityUrl(input: string, originOnly = false): string | null {
  if (!input || input !== input.trim() || input.length > 2048 || input.includes('\\') || /[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    if (!isPublicIdentityUrl(url) || url.username || url.password || url.search || url.hash) return null;
    if (originOnly && url.pathname !== '/') return null;
    return originOnly ? url.origin : input;
  } catch { return null; }
}
export function oauthOrigin() { return httpsIdentityUrl(value(env.OAUTH_BASE_URL), true); }
export function oauthStateSecret() {
  const secret = value(env.OAUTH_STATE_SECRET);
  return bounded(secret, 8192) && new TextEncoder().encode(secret).length >= 32 ? secret : null;
}
export function emptyProviderSettings(): ProviderSettings {
  return { google: { enabled: false, clientId: '', clientSecret: '' },
    oidc: { enabled: false, name: 'Single Sign-on', issuer: '', clientId: '', clientSecret: '',
      tokenAuthMethod: 'client_secret_basic', allowedEndpointOrigins: [] } };
}
export function environmentProviderSettings(): ProviderSettings {
  const settings = emptyProviderSettings();
  settings.google.clientId = value(env.GOOGLE_CLIENT_ID);
  settings.google.clientSecret = value(env.GOOGLE_CLIENT_SECRET);
  settings.oidc = { enabled: false, name: value(env.OIDC_NAME) || 'Single Sign-on', issuer: value(env.OIDC_ISSUER),
    clientId: value(env.OIDC_CLIENT_ID), clientSecret: value(env.OIDC_CLIENT_SECRET),
    tokenAuthMethod: (value(env.OIDC_TOKEN_AUTH_METHOD) || 'client_secret_basic') as TokenAuthMethod,
    allowedEndpointOrigins: value(env.OIDC_ALLOWED_ENDPOINT_ORIGINS).split(',').map(item => item.trim()).filter(Boolean) };
  // Invalid/partial environment providers remain disabled, exactly as before.
  settings.google.enabled = validGoogle(settings.google);
  settings.oidc.enabled = validOidc(settings.oidc);
  // Project only bounded, valid non-secret fields even if host input is bad.
  if (!validSettings(settings as unknown)) {
    if (!validGoogle(settings.google)) settings.google = emptyProviderSettings().google;
    if (!validOidc(settings.oidc)) settings.oidc = emptyProviderSettings().oidc;
  }
  return settings;
}
function validGoogle(provider: ProviderSettings['google']) {
  return bounded(provider.clientId, 1024) && /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(provider.clientId) && bounded(provider.clientSecret, 4096);
}
function validOidc(provider: ProviderSettings['oidc']) {
  return Boolean(httpsIdentityUrl(provider.issuer) && bounded(provider.clientId, 1024) && bounded(provider.clientSecret, 4096) &&
    bounded(provider.name, 60) && provider.allowedEndpointOrigins.length <= 5 &&
    provider.allowedEndpointOrigins.every(item => httpsIdentityUrl(item, true) === item) &&
    (provider.tokenAuthMethod === 'client_secret_basic' || provider.tokenAuthMethod === 'client_secret_post'));
}
function record(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
}
function exact(input: Record<string, unknown>, required: string[], optional: string[] = []) {
  return required.every(key => Object.hasOwn(input, key)) && Object.keys(input).every(key => required.includes(key) || optional.includes(key));
}
function text(input: unknown, max: number) { return typeof input === 'string' && input.length <= max && !/[\u0000-\u001f\u007f]/.test(input); }
/** Strict schema is shared by HTTP input and decrypted storage. Disabled
 * providers may be incomplete, but never contain arbitrary oversized data. */
export function validSettings(input: unknown): input is ProviderSettings {
  const root = record(input); const google = record(root?.google); const oidc = record(root?.oidc);
  if (!root || !google || !oidc || !exact(root, ['google', 'oidc']) ||
    !exact(google, ['enabled', 'clientId', 'clientSecret']) ||
    !exact(oidc, ['enabled', 'name', 'issuer', 'clientId', 'clientSecret', 'tokenAuthMethod', 'allowedEndpointOrigins']) ||
    typeof google.enabled !== 'boolean' || typeof oidc.enabled !== 'boolean' ||
    !text(google.clientId, 1024) || !text(google.clientSecret, 4096) ||
    !text(oidc.name, 60) || !text(oidc.issuer, 2048) || !text(oidc.clientId, 1024) || !text(oidc.clientSecret, 4096) ||
    (oidc.issuer !== '' && !httpsIdentityUrl(oidc.issuer as string)) ||
    (oidc.tokenAuthMethod !== 'client_secret_basic' && oidc.tokenAuthMethod !== 'client_secret_post') ||
    !Array.isArray(oidc.allowedEndpointOrigins) || oidc.allowedEndpointOrigins.length > 5 ||
    !oidc.allowedEndpointOrigins.every(item => typeof item === 'string' && httpsIdentityUrl(item, true) === item) ||
    new Set(oidc.allowedEndpointOrigins).size !== oidc.allowedEndpointOrigins.length) return false;
  return (!google.enabled || validGoogle(google as ProviderSettings['google'])) && (!oidc.enabled || validOidc(oidc as ProviderSettings['oidc']));
}
/** Blank/omitted secrets retain DB secrets only. Environment secrets are never
 * copied into a new encrypted record, even during the first save. */
export function parseProviderInput(input: unknown, stored: ProviderSettings | null): { input: ProviderInput; settings: ProviderSettings } | null {
  const root = record(input); const google = record(root?.google); const oidc = record(root?.oidc);
  if (!root || !google || !oidc || !exact(root, ['expectedRevision', 'google', 'oidc']) ||
    !exact(google, ['enabled', 'clientId'], ['clientSecret']) ||
    !exact(oidc, ['enabled', 'name', 'issuer', 'clientId', 'tokenAuthMethod', 'allowedEndpointOrigins'], ['clientSecret']) ||
    (root.expectedRevision !== null && (!Number.isSafeInteger(root.expectedRevision) || (root.expectedRevision as number) < 1 || (root.expectedRevision as number) >= Number.MAX_SAFE_INTEGER - 1)) ||
    (Object.hasOwn(google, 'clientSecret') && !text(google.clientSecret, 4096)) ||
    (Object.hasOwn(oidc, 'clientSecret') && !text(oidc.clientSecret, 4096))) return null;
  const settings = { google: { ...google, clientSecret: typeof google.clientSecret === 'string' && google.clientSecret.trim() ? google.clientSecret : stored?.google.clientSecret || '' },
    oidc: { ...oidc, clientSecret: typeof oidc.clientSecret === 'string' && oidc.clientSecret.trim() ? oidc.clientSecret : stored?.oidc.clientSecret || '' } };
  return validSettings(settings) ? { input: input as ProviderInput, settings } : null;
}
export function enabledProviders(settings: ProviderSettings): readonly OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (settings.google.enabled) providers.push(Object.freeze({ id: 'google', name: 'Google', issuer: 'https://accounts.google.com',
    clientId: settings.google.clientId, clientSecret: settings.google.clientSecret, tokenAuthMethod: 'client_secret_post',
    endpointOrigins: Object.freeze(['https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://www.googleapis.com']) }));
  if (settings.oidc.enabled) providers.push(Object.freeze({ id: 'oidc', name: settings.oidc.name, issuer: settings.oidc.issuer,
    clientId: settings.oidc.clientId, clientSecret: settings.oidc.clientSecret, tokenAuthMethod: settings.oidc.tokenAuthMethod,
    endpointOrigins: Object.freeze([...new Set([new URL(settings.oidc.issuer).origin, ...settings.oidc.allowedEndpointOrigins])]) }));
  return Object.freeze(providers);
}
