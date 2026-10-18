# Google and OpenID Connect login: Sites

Status: implementation preparation. No OAuth client was registered, no secret was
set, no provider was enabled, and no live database migration or provider grant was
performed. A narrow SQL migration is prepared separately. Login remains hidden
until that migration is verified and a complete private configuration is present.

## Two independent deployment stacks

- `main`: Next.js, NextAuth v4 and Prisma; settings are server environment variables
  such as `NEXTAUTH_URL` and `NEXTAUTH_SECRET`.
- `cloudflare-sites`: vinext/Workers, D1 and ForgeCommunity's existing app-owned
  session cookie; settings below are private Worker environment bindings.

Do not copy the Sites D1 implementation into Main. Both use the fixed callback
paths `/api/auth/callback/google` and `/api/auth/callback/oidc`; each deployment has
its own user database. A Google login in one does not migrate or link accounts in
the other. The Main preparation has its own version of this guide.

## Register Google manually

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create
   the intended project. Open Google Auth Platform, configure Branding and
   Audience, and add your own account as a test user while the app is in testing.
   Supply the real homepage, support contact, privacy policy and terms as Google
   requires. Do not claim production verification until Google confirms it.
2. In Clients, create an OAuth client with application type **Web application**.
3. Add this exact authorized redirect URI for the published Site:

   `https://forge-community.dsgvision.chatgpt.site/api/auth/callback/google`

   For Main, separately register `<NEXTAUTH_URL>/api/auth/callback/google`.
   A Main localhost example is `http://localhost:3013/api/auth/callback/google`.
   URI scheme, host, path and trailing slash must match exactly. The server-side
   redirect flow does not require a browser JavaScript Google SDK or JavaScript
   origin configuration.
4. Limit identity scopes to `openid email profile`. This code requests no Drive,
   Gmail or Calendar access, no offline access and no refresh token.
5. Copy the client ID and secret directly into the intended deployment's private
   configuration. Never paste secrets in chat, GitHub, a screenshot, or public
   variables. Google registration and entering secrets remain owner actions.

## Private Sites configuration

Use the existing deployment's private environment configuration. This change does
not create or alter hosting, security settings or credentials. `.dev.vars.example`
documents the Worker binding names; it contains no real secret.

Before activation, an authorized deployment operator must separately review,
apply and verify `docs/migrations/SITES_OAUTH_TRANSACTIONS.sql` against the intended
existing Sites D1 database. This file deliberately sits outside automatic drizzle
migrations. Merely publishing the inactive code does not apply it. It creates only
the transient Sites-owned transaction table and its indexes; it does not alter
User, Account, Session, roles or Main's Prisma schema. Do not apply it to Main.

Only after that verified step set `OAUTH_TRANSACTION_MIGRATION_READY=true`. The
runtime additionally performs a read-only table-shape check. A missing table,
missing columns or an absent/false flag keeps all OAuth routes and buttons off.
Registering a Google client alone is therefore insufficient on an unmigrated Site.

Also required for Google:

- `OAUTH_BASE_URL=https://forge-community.dsgvision.chatgpt.site`
- `OAUTH_STATE_SECRET`: a fresh independent random secret of at least 32 bytes of
  entropy, generated privately, for example with `openssl rand -base64 32`
- `GOOGLE_CLIENT_ID`: Web application client ID
- `GOOGLE_CLIENT_SECRET`: Web application client secret

The base URL must be an exact HTTPS origin. Provider discovery must also work
before a login can start. Partial/invalid configuration exposes no provider.
Secrets are read only on the server; the provider-list endpoint returns IDs and
display names only. No `NEXT_PUBLIC_*` variable is used for OAuth credentials.

Rotating `OAUTH_STATE_SECRET` invalidates in-progress OAuth attempts. It does not
invalidate existing app sessions. Never reuse a client secret as the state secret.

## Add a general OIDC provider

The generic connector authenticates using **OpenID Connect**, the identity layer
over OAuth 2.0. An arbitrary OAuth API authorization endpoint is insufficient for
login and is intentionally unsupported.

Register another confidential Web client at your trusted identity provider. It
must support OIDC discovery, Authorization Code, RS256-signed ID tokens and
`openid email profile`. PKCE S256 is sent on every attempt. It must emit a valid
email and the boolean claim `email_verified=true` in the ID token. Providers that
omit verification, use only UserInfo for email or require other algorithms need
an explicit reviewed integration rather than weakening identity checks.

Set the same `OAUTH_BASE_URL` and `OAUTH_STATE_SECRET`, plus:

- `OIDC_ISSUER`: the provider's exact HTTPS issuer, without query or fragment
- `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`
- `OIDC_NAME`: optional button label, default `Single Sign-on`
- `OIDC_TOKEN_AUTH_METHOD`: `client_secret_basic` (default) or `client_secret_post`
- `OIDC_ALLOWED_ENDPOINT_ORIGINS`: optional comma-separated additional exact HTTPS
  origins for legitimate cross-origin authorization/token/JWKS endpoints. The
  issuer origin is implicitly allowed. Maximum five additional origins.

The issuer and endpoint origins are private operator configuration, never values
from a login request, callback or public registration. Google uses fixed official
Google endpoint origins. All outbound discovery/token/JWKS fetches reject
redirects; endpoint origins are checked before use. Literal IPs, localhost and
common private DNS namespaces are rejected. DNS resolution/rebinding and
split-horizon DNS cannot be safely pinned by this Workers implementation: only
trusted public identity-provider domains may be configured. This is an explicit
operator trust boundary, not an arbitrary identity-provider marketplace.

Register this exact callback:

`https://forge-community.dsgvision.chatgpt.site/api/auth/callback/oidc`

Do not change an issuer merely to point an existing configuration at a different
tenant. Generic account identity is `provider=oidc` plus the lowercase hexadecimal
SHA-256 of JSON `[exactIssuer, sub]`; this prevents a new issuer with the same
subject from taking over an older identity. Google keeps `provider=google` and
its stable `sub`. Do not manually rewrite these account IDs.

## Identity and session guarantees

- Uses pinned `oauth4webapi` for discovery, authorization response/state checking,
  PKCE code exchange and OIDC claims validation. Performs its additional JWKS
  application-level signature verification before accepting any identity.
- Validates issuer, audience/authorized party, signature/algorithm, expiry and
  nonce; email verification is mandatory even for a previously linked identity.
- State, nonce, PKCE verifier, provider, issuer, client and safe local return path
  are sealed by `jose` in a ten-minute JWE transaction cookie. It is host-only,
  HttpOnly, Secure, SameSite=Lax and bound to a separate browser-generation
  HttpOnly cookie. It is cleared after callback success or failure.
  A D1 compare-and-set consumes each transaction exactly once before exchange;
  missing, expired, consumed, altered or wrong-browser transactions fail closed.
  Authorization codes are also one-use at the identity provider.
  Starting the same provider in another tab replaces the earlier transaction.
- The configured provider-list response establishes a short-lived browser
  generation before enabling its buttons. Begin requires that existing generation
  and records the transaction before external discovery. A revoked generation is
  never recreated by Begin. Logout marks its generation revoked, so even an
  earlier Begin paused in discovery cannot later create a valid login. Provider
  discovery in this preparation is server-only and rate-limited.
- Initiation is POST-only and requires an exact configured Origin. Login cannot
  silently become an account-linking flow while already signed in.
- Existing identities are found only by provider and subject identity. An email
  collision never attaches a provider to an existing password or OAuth account.
  The user sees a safe explanation and must use the prior login method. Account
  linking is not implemented and needs a separately authenticated reviewed flow.
- A new identity creates a USER, its identity-only Account, lastLogin and Session
  together in an atomic D1 batch. An existing identity rechecks its current
  subject-to-user mapping and updates only lastLogin and its new Session in that
  batch. Transaction TTL/claim/browser binding are reasserted inside the batch;
  SQL-side assertions roll back all writes on any mismatch. Session cookies are
  emitted only after confirmed completion; no post-commit row decoder or retry
  can create a second result. No password, provider access/refresh/ID token, remote
  role or first-admin bootstrap is written. Existing roles/profile data remain.
- OAuth uses the existing random session-token and app session-cookie helpers,
  with the same 30-day Session lifetime. Credentials helpers remain unchanged.
  Logout also deletes the current browser's pending OAuth transactions and any
  just-issued sessions recorded with them, covering both orderings of a racing
  callback while its unexpired generation/transaction record is retained, then
  clears browser/transaction cookies and ends the app session. This does not
  promise revocation of arbitrarily delayed already-committed HTTP responses
  after the ten-minute generation/transaction cleanup window.
  CSRF/origin and role-read fences remain. Only local return paths can be used.
  If the optional table is conclusively absent, a
  stale/forged optional cookie is only cleared; it cannot make ordinary password
  authentication fail because the optional table is absent, including a
  mistakenly enabled ready flag. No OAuth callback can finalize without the
  complete table. Known missing columns are also harmless to ordinary auth while
  the optional ready flag is off. An existing active table with missing columns
  and other database failures
  while an existing OAuth generation must be revoked remain fail-closed.
- Successful password login or registration invalidates the same pending OAuth
  generation before returning its session cookie, so a slower OAuth callback
  cannot override the newly selected account. Failed password attempts preserve
  the existing session. If invalidation fails after account creation, registration
  reports that the account exists and asks for a fresh login; it does not silently
  report a completed login.
- The transient table stores random transaction IDs, cookie/browser hashes,
  provider (including `browser` generation/tombstone rows), timestamps and a newly
  issued Session's non-secret row ID. It stores
  no verifier, nonce, OAuth code, provider token or client secret. Expired rows are
  removed in bounded batches when a new attempt starts; there is no background
  grant, new persistent credential or recurring task.

## Review and verification before activation

Preparation checks are type checks, production build and source review only.
No local functional tests or new GitHub CI runs are allowed for this task.
Real OAuth success cannot be claimed before the owner registers a client and
enters credentials. After reviewed publication, functional acceptance belongs on
the published Sites URL with an owner-approved legitimate test account.

Cover configured/partial/missing provider visibility, password regression,
Google/OIDC success, denial, expired or modified state/nonce, repeated callback,
back/cancel/retry, email collision, issuer mismatch, unverified email, concurrent
new-account creation, and unchanged account roles/session behavior. No provider
grant or real-account test was performed as part of preparation.

## Official references

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [oauth4webapi reference](https://github.com/panva/oauth4webapi/blob/main/docs/README.md)
- [oauth4webapi signature verification](https://github.com/panva/oauth4webapi/blob/main/docs/functions/validateApplicationLevelSignature.md)
- [jose](https://github.com/panva/jose)
- [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

Documentation checked on 2026-10-18. Nothing here authorizes provider registration,
entering credentials, persistent provider grants, deployment or live activation.
