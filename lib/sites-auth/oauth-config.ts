import 'server-only';

import { loadOAuthConfiguration } from './oauth-configuration-store';
import type { ConfigurationSnapshot } from './oauth-configuration-store';
import { enabledProviders, oauthStateSecret } from './oauth-settings';
import type { OAuthProvider } from './oauth-settings';
export { isPublicIdentityUrl } from './oauth-settings';
export type { OAuthProvider, OAuthProviderId } from './oauth-settings';
export type OAuthConfiguration = Readonly<{
  origin: string; stateSecret: string; providers: readonly OAuthProvider[];
  configRevision: number | null; configBinding: string; storage: ConfigurationSnapshot;
}>;

/** Immutable fresh request snapshot. Invalid encrypted storage never silently
 * reactivates environment credentials. An explicit DB disable wins over env. */
export async function oauthConfiguration(): Promise<OAuthConfiguration | null> {
  const loaded = await loadOAuthConfiguration();
  const stateSecret = oauthStateSecret();
  if (loaded.unavailable || !loaded.origin || !stateSecret || loaded.blockers.includes('oauth_transaction_not_ready')) return null;
  return Object.freeze({ origin: loaded.origin, stateSecret, providers: enabledProviders(loaded.settings),
    configRevision: loaded.snapshot.revision, configBinding: loaded.snapshot.binding, storage: loaded.snapshot });
}
export function safeOAuthReturnPath(input: unknown): string {
  return typeof input === 'string' && input.length <= 1024 && /^\/(?![\\/])[^\\\u0000-\u001f\u007f]*$/.test(input)
    ? input : '/community';
}
