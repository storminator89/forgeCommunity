import 'server-only';

import { CompactEncrypt, compactDecrypt } from 'jose';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { createOAuthProviders, configurationUrl, publicHttpsUrl } from './oauth-providers';

export const OAUTH_CONFIGURATION_ID = 'main-oauth';
const FORMAT = 1;
const PURPOSE = 'forge-community/oauth-configuration';
const STACK = 'main-nextauth';
const JWE_TYPE = 'forge-oauth-configuration+jwe';
const MAX_CIPHERTEXT_LENGTH = 32768;
const controls = /[\u0000-\u001f\u007f]/;
const bounded = (maximum: number) => z.string().max(maximum).refine(value => !controls.test(value));
const secret = bounded(4096);
const provider = z.object({ enabled: z.boolean(), clientId: bounded(1024), clientSecret: secret }).strict();
export const storedOAuthConfigurationSchema = z.object({
  google: provider,
  oidc: provider.extend({
    name: bounded(60), issuer: bounded(2048),
    tokenAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']),
    allowedEndpointOrigins: z.array(bounded(2048)).max(5),
  }).strict(),
}).strict();
export const oauthConfigurationInputSchema = z.object({
  expectedRevision: z.number().int().min(1).max(2147483646).nullable(),
  google: provider.omit({ clientSecret: true }).extend({ clientSecret: secret.optional() }).strict(),
  oidc: storedOAuthConfigurationSchema.shape.oidc.omit({ clientSecret: true }).extend({ clientSecret: secret.optional() }).strict(),
}).strict();
export type StoredOAuthConfiguration = z.infer<typeof storedOAuthConfigurationSchema>;
export type OAuthConfigurationInput = z.infer<typeof oauthConfigurationInputSchema>;
export type OAuthRuntime = ReturnType<typeof createOAuthProviders>;
export type ConfigurationBlocker = 'encryption_key_missing' | 'encryption_key_invalid' | 'schema_missing' | 'base_url_missing' | 'configuration_unavailable';
type Reader = Pick<Prisma.TransactionClient, 'oAuthConfiguration'>;
type ConfigurationRow = { id: string; revision: number; encryptedPayload: string };
export type ConfigurationState = {
  revision: number | null;
  source: 'environment' | 'database' | 'unconfigured';
  config: StoredOAuthConfiguration;
  blockers: ConfigurationBlocker[];
  schemaMissing: boolean;
  binding?: string;
};

export class OAuthConfigurationError extends Error {
  constructor(readonly code: 'configuration_unavailable' | 'invalid_configuration' | 'revision_conflict' | 'oidc_identity_migration_required' | 'administrator_required') {
    super(code);
    this.name = 'OAuthConfigurationError';
  }
}

export function emptyOAuthConfiguration(): StoredOAuthConfiguration {
  return {
    google: { enabled: false, clientId: '', clientSecret: '' },
    oidc: { enabled: false, name: 'OpenID Connect', issuer: '', clientId: '', clientSecret: '', tokenAuthMethod: 'client_secret_basic', allowedEndpointOrigins: [] },
  };
}

export function oauthBaseUrl(env: NodeJS.ProcessEnv): URL | null {
  return configurationUrl(env.NEXTAUTH_URL, env.NODE_ENV === 'production', true);
}

function encryptionKey(env: NodeJS.ProcessEnv): Uint8Array | null {
  const value = env.OAUTH_CONFIG_ENCRYPTION_KEY;
  if (!value || value !== value.trim() ||
      !(/^[A-Za-z0-9+/]{43}=$/.test(value) || /^[A-Za-z0-9_-]{43}=?$/.test(value))) return null;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')) return null;
  // This must be an independently provisioned key, never the session secret.
  if (value === env.NEXTAUTH_SECRET || Buffer.from(env.NEXTAUTH_SECRET ?? '', 'utf8').equals(bytes) ||
      (env.NEXTAUTH_SECRET && Buffer.from(env.NEXTAUTH_SECRET, 'base64url').equals(bytes))) return null;
  return new Uint8Array(bytes);
}

export function configurationHostBlockers(env: NodeJS.ProcessEnv): ConfigurationBlocker[] {
  const blockers: ConfigurationBlocker[] = [];
  if (!env.OAUTH_CONFIG_ENCRYPTION_KEY) blockers.push('encryption_key_missing');
  else if (!encryptionKey(env)) blockers.push('encryption_key_invalid');
  if (!oauthBaseUrl(env)) blockers.push('base_url_missing');
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.trim().length < 32 || env.NEXTAUTH_SECRET.length > 8192 || controls.test(env.NEXTAUTH_SECRET)) blockers.push('configuration_unavailable');
  return blockers;
}

export function missingOAuthSchema(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021' && error.meta?.modelName === 'OAuthConfiguration';
}

function transactionBinding(env: NodeJS.ProcessEnv, value: unknown): string {
  // Keyed and domain-separated: never publish a bare secret hash or fragment.
  // This authenticates a revision marker; JWE encryption uses the separate key.
  return createHmac('sha256', env.NEXTAUTH_SECRET ?? '')
    .update('forge-community/main/oauth-request-binding/v1\0').update(JSON.stringify(value)).digest('hex');
}

function environmentConfiguration(env: NodeJS.ProcessEnv): StoredOAuthConfiguration {
  // This private in-memory snapshot may contain environment secrets. The public
  // projection below never includes them, and save never imports them.
  const safe = (value: string | undefined, maximum: number, fallback = '') =>
    value && value.length <= maximum && !controls.test(value) ? value : fallback;
  const configured = createOAuthProviders(env);
  return {
    google: { enabled: configured.enabledIds.includes('google'), clientId: safe(env.GOOGLE_CLIENT_ID, 1024), clientSecret: safe(env.GOOGLE_CLIENT_SECRET, 4096) },
    oidc: {
      enabled: configured.enabledIds.includes('oidc'), name: safe(env.OIDC_NAME?.trim(), 60, 'OpenID Connect'),
      issuer: safe(env.OIDC_ISSUER, 2048), clientId: safe(env.OIDC_CLIENT_ID, 1024), clientSecret: safe(env.OIDC_CLIENT_SECRET, 4096),
      tokenAuthMethod: env.OIDC_TOKEN_AUTH_METHOD?.trim() === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic',
      // Read the pre-existing Main environment allowance without widening new
      // database writes (five) or changing the runtime's sixteen-origin cap.
      allowedEndpointOrigins: env.OIDC_ALLOWED_ENDPOINT_ORIGINS && env.OIDC_ALLOWED_ENDPOINT_ORIGINS.length <= 4096
        ? env.OIDC_ALLOWED_ENDPOINT_ORIGINS.split(',').slice(0, 16).map(value => value.trim()).filter(value => Boolean(publicHttpsUrl(value, true))) : [],
    },
  };
}

function configurationEnvironment(config: StoredOAuthConfiguration, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // A complete replacement, including explicit disable. Never mutate process.env
  // and never leave environment OAuth values behind when a database row exists.
  return {
    NODE_ENV: env.NODE_ENV, NEXTAUTH_URL: env.NEXTAUTH_URL, NEXTAUTH_SECRET: env.NEXTAUTH_SECRET,
    GOOGLE_CLIENT_ID: config.google.enabled ? config.google.clientId : undefined,
    GOOGLE_CLIENT_SECRET: config.google.enabled ? config.google.clientSecret : undefined,
    OIDC_ISSUER: config.oidc.enabled ? config.oidc.issuer : undefined,
    OIDC_CLIENT_ID: config.oidc.enabled ? config.oidc.clientId : undefined,
    OIDC_CLIENT_SECRET: config.oidc.enabled ? config.oidc.clientSecret : undefined,
    OIDC_NAME: config.oidc.name, OIDC_TOKEN_AUTH_METHOD: config.oidc.tokenAuthMethod,
    OIDC_ALLOWED_ENDPOINT_ORIGINS: config.oidc.allowedEndpointOrigins.join(','),
  };
}

function validateConfiguration(config: StoredOAuthConfiguration, env: NodeJS.ProcessEnv): void {
  if ((config.google.clientId && !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(config.google.clientId)) ||
      (config.oidc.issuer && !publicHttpsUrl(config.oidc.issuer)) ||
      config.oidc.allowedEndpointOrigins.some(value => !publicHttpsUrl(value, true))) throw new OAuthConfigurationError('invalid_configuration');
  const runtime = createOAuthProviders(configurationEnvironment(config, env));
  if ((config.google.enabled && !runtime.enabledIds.includes('google')) ||
      (config.oidc.enabled && !runtime.enabledIds.includes('oidc'))) throw new OAuthConfigurationError('invalid_configuration');
}

export function mergeOAuthConfiguration(input: OAuthConfigurationInput, previous: StoredOAuthConfiguration | null, env: NodeJS.ProcessEnv): StoredOAuthConfiguration {
  const config = storedOAuthConfigurationSchema.parse({
    google: { ...input.google, clientSecret: input.google.clientSecret?.trim() ? input.google.clientSecret : previous?.google.clientSecret ?? '' },
    oidc: { ...input.oidc, clientSecret: input.oidc.clientSecret?.trim() ? input.oidc.clientSecret : previous?.oidc.clientSecret ?? '' },
  });
  validateConfiguration(config, env);
  return config;
}

export async function encryptOAuthConfiguration(config: StoredOAuthConfiguration, revision: number, env: NodeJS.ProcessEnv): Promise<string> {
  const key = encryptionKey(env);
  const origin = oauthBaseUrl(env)?.origin;
  if (!key || !origin) throw new OAuthConfigurationError('configuration_unavailable');
  const encrypted = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify({ purpose: PURPOSE, format: FORMAT, stack: STACK, origin, singletonId: OAUTH_CONFIGURATION_ID, revision, config })))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: JWE_TYPE }).encrypt(key);
  if (encrypted.length > MAX_CIPHERTEXT_LENGTH) throw new OAuthConfigurationError('invalid_configuration');
  return encrypted;
}

async function decryptOAuthConfiguration(row: ConfigurationRow, env: NodeJS.ProcessEnv): Promise<StoredOAuthConfiguration> {
  try {
    const key = encryptionKey(env);
    const origin = oauthBaseUrl(env)?.origin;
    if (!key || !origin || row.id !== OAUTH_CONFIGURATION_ID || !Number.isInteger(row.revision) || row.revision < 1 ||
        row.encryptedPayload.length > MAX_CIPHERTEXT_LENGTH) throw new Error();
    const { plaintext, protectedHeader } = await compactDecrypt(row.encryptedPayload, key, {
      keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
    });
    if (protectedHeader.typ !== JWE_TYPE || protectedHeader.alg !== 'dir' || protectedHeader.enc !== 'A256GCM') throw new Error();
    const envelope = z.object({ purpose: z.literal(PURPOSE), format: z.literal(FORMAT), stack: z.literal(STACK), origin: z.literal(origin), singletonId: z.literal(OAUTH_CONFIGURATION_ID), revision: z.literal(row.revision), config: storedOAuthConfigurationSchema }).strict().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
    validateConfiguration(envelope.config, env);
    return envelope.config;
  } catch {
    throw new OAuthConfigurationError('configuration_unavailable');
  }
}

export function absentConfigurationState(env: NodeJS.ProcessEnv, schemaMissing = false): ConfigurationState {
  const config = environmentConfiguration(env);
  const source = env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET || env.OIDC_ISSUER || env.OIDC_CLIENT_ID || env.OIDC_CLIENT_SECRET ? 'environment' : 'unconfigured';
  return { revision: null, source, config, blockers: [...configurationHostBlockers(env), ...(schemaMissing ? ['schema_missing' as const] : [])], schemaMissing, binding: transactionBinding(env, { source, origin: oauthBaseUrl(env)?.origin, config }) };
}

export async function readOAuthConfiguration(reader: Reader, env: NodeJS.ProcessEnv): Promise<ConfigurationState> {
  const row = await reader.oAuthConfiguration.findUnique({ where: { id: OAUTH_CONFIGURATION_ID }, select: { id: true, revision: true, encryptedPayload: true } });
  if (!row) return absentConfigurationState(env);
  const blockers = configurationHostBlockers(env);
  const binding = transactionBinding(env, { source: 'database', revision: row.revision, ciphertext: row.encryptedPayload });
  try {
    const config = await decryptOAuthConfiguration(row, env);
    return { revision: row.revision, source: 'database', config, blockers, schemaMissing: false, binding };
  } catch {
    // A present but unreadable row is authoritative: no environment fallback.
    return { revision: row.revision, source: 'database', config: emptyOAuthConfiguration(), blockers: [...new Set([...blockers, 'configuration_unavailable' as const])], schemaMissing: false, binding };
  }
}

export function publicOAuthConfiguration(state: ConfigurationState, env: NodeJS.ProcessEnv) {
  const base = oauthBaseUrl(env)?.origin;
  const { config } = state;
  return {
    revision: state.revision, canSave: state.blockers.length === 0, blockers: state.blockers, source: state.source,
    callbackUrls: { google: base ? `${base}/api/auth/callback/google` : null, oidc: base ? `${base}/api/auth/callback/oidc` : null },
    providers: {
      google: { enabled: config.google.enabled, clientId: config.google.clientId, clientSecretSet: Boolean(config.google.clientSecret) },
      oidc: { enabled: config.oidc.enabled, name: config.oidc.name, issuer: config.oidc.issuer, clientId: config.oidc.clientId, clientSecretSet: Boolean(config.oidc.clientSecret), tokenAuthMethod: config.oidc.tokenAuthMethod, allowedEndpointOrigins: [...config.oidc.allowedEndpointOrigins] },
    },
  };
}

export async function requestOAuthConfiguration(env: NodeJS.ProcessEnv = process.env) {
  // Capture host values before the first await; no shared mutable OAuth config.
  const host = { ...env };
  let state: ConfigurationState;
  try {
    state = await readOAuthConfiguration(prisma, host);
  } catch (error) {
    if (missingOAuthSchema(error)) state = absentConfigurationState(host, true);
    else return { revision: null, source: 'unavailable' as const, binding: 'unavailable', runtime: createOAuthProviders({ NODE_ENV: host.NODE_ENV }) };
  }
  const unavailable = state.source === 'database' && state.blockers.length > 0;
  return {
    revision: state.revision, source: state.source, binding: state.binding ?? 'unavailable',
    runtime: unavailable ? createOAuthProviders({ NODE_ENV: host.NODE_ENV }) : state.source === 'database'
      ? createOAuthProviders(configurationEnvironment(state.config, host)) : createOAuthProviders(host),
  };
}

export type RequestOAuthConfiguration = Awaited<ReturnType<typeof requestOAuthConfiguration>>;

export async function oauthRevisionIsCurrent(snapshot: RequestOAuthConfiguration): Promise<boolean> {
  const current = await requestOAuthConfiguration();
  return current.source !== 'unavailable' && current.source === snapshot.source && current.revision === snapshot.revision && current.binding === snapshot.binding &&
    current.runtime.enabledIds.join(',') === snapshot.runtime.enabledIds.join(',');
}
