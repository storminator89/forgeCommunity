# Google and OpenID Connect login: Sites

Status (2026-10-18): Google/OIDC sign-in remains configuration-gated and inactive.
No OAuth client, secret, ready flag or provider grant was configured. A separately
authorized migration-only Sites publication succeeded as version 76 using the
unchanged v75 application code; see the record below. Google is visible as a
disabled button labelled "Noch nicht eingerichtet" until configuration is complete. OAuth still requires full migration verification and
private settings before sign-in can start. The ADMIN interface described below
belongs to the separately reviewed configuration candidate; this guide does not
claim that candidate or its host prerequisites have already been published or set.

## Two independent deployment stacks

- `main`: Next.js, NextAuth v4 and Prisma; host prerequisites include server
  environment variables such as `NEXTAUTH_URL` and `NEXTAUTH_SECRET`. Its provider
  setup belongs to Main's separate deployment and guide.
- `cloudflare-sites`: vinext/Workers, D1 and ForgeCommunity's existing app-owned
  session cookie. Host prerequisites use private Worker environment bindings;
  the prepared ADMIN interface manages provider credentials in an encrypted D1
  configuration after its separate provisioning and publication.

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

After the separately reviewed ADMIN configuration candidate is published,
currently authenticated administrators can open `/admin/authentication` to manage
Google and OIDC provider settings. See the
[ADMIN configuration setup and security runbook](OAUTH_ADMIN_CONFIGURATION_SITES.md)
for the separate additive migration, the new independent host-only
`OAUTH_CONFIG_ENCRYPTION_KEY`, existing host prerequisites and verification limits.
The form remains blocked until those prerequisites are ready. It never changes
host keys, applies migrations or toggles the OAuth operator-ready flag. Provider
secrets are write-only; the page never displays existing secrets. The first
transfer from environment settings requires explicit secret re-entry.

The host controls and credential variables below describe host prerequisites and
optional legacy environment bootstrap/fallback. For those host changes, open the
Site in ChatGPT's Sites management, select its Settings, then the private secrets
and environment-variable configuration. The exact control label can vary by
client; use Sites runtime configuration, not a public app setting or a repository
secret. `.dev.vars.example` documents the existing Worker binding names without
secrets; the new encryption-key prerequisite is documented in the linked runbook.
[Official Sites settings guidance](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites).
After explicitly authorized host configuration, publish the saved application
version to apply its environment revision. ADMIN provider saves use their encrypted
database record and do not require a new application-source publication.
Registering an app or displaying a button does not itself configure credentials
or authorize a provider grant.

A valid encrypted database record takes precedence over environment provider
credentials, including an explicit disabled-provider record. Environment provider
settings remain a fallback only when the optional configuration table or its row
is genuinely absent. An unreadable, malformed or undecryptable existing record
fails closed; it never silently reactivates environment credentials. Deactivating
providers means saving a disabled record, not deleting it. The runbook explains
key loss/rotation, backup and complete-database-rollback boundaries.

The canonical DDL is `docs/migrations/SITES_OAUTH_TRANSACTIONS.sql`. Its three
statements were added to `drizzle/0001_oauth_login_transactions.sql` with Drizzle
statement separators and an appended journal entry for the authorized v76 publish.
Preserve this applied migration history; do not manually replay the preparation
file or rewrite existing entries. It only adds the transient Sites-owned table
and indexes, without changing User, Account, Session, roles or Main's Prisma schema.
Do not apply it to Main. Before activation, separately verify the live CHECK/PK
constraints, both index definitions and applied-migration bookkeeping.

Only after that verified step set `OAUTH_TRANSACTION_MIGRATION_READY=true`. The
runtime additionally performs a read-only table-shape check. A missing table,
missing columns or an absent/false flag keeps OAuth initiation disabled. The
Google button remains visible and disabled with "Noch nicht eingerichtet"; an
initial provider check shows "Verfügbarkeit wird geprüft …". A failed check shows
"Momentan nicht verfügbar" and leaves it disabled. The optional generic OIDC button appears only when configured.
Registering a Google client alone is therefore insufficient on an unmigrated Site.

Host prerequisites for both ADMIN-backed and environment-backed Google/OIDC:

- `OAUTH_BASE_URL=https://forge-community.dsgvision.chatgpt.site`
- `OAUTH_STATE_SECRET`: a fresh independent random secret of at least 32 bytes of
  entropy, generated privately, for example with `openssl rand -base64 32`

For Google environment bootstrap/fallback only, also set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` to the Web application's client ID and secret. With an
ADMIN-managed encrypted record, enter these provider values in
`/admin/authentication` instead; environment credentials are not automatically
copied into that record.

The base URL must be an exact HTTPS origin. Provider discovery must also work
before a login can start. Partial/invalid provider credentials do not enable
that provider.
Stored provider secrets are read only on the server; the provider-list endpoint returns IDs and
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

Keep the same host `OAUTH_BASE_URL` and `OAUTH_STATE_SECRET`. With the prepared
ADMIN interface, enter the provider's issuer, client ID, secret, display name,
token-authentication method and any allowed endpoint origins at
`/admin/authentication`. The following variable names apply only to optional
legacy environment bootstrap/fallback when no encrypted configuration row exists:

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
its stable `sub`. Do not manually rewrite these account IDs. The ADMIN API also
refuses OIDC issuer/client-ID changes once OIDC accounts exist; such a change
requires a separately reviewed identity migration.

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

## Migration-only publication record

- Published Sites version 76 on 2026-10-18 at 15:28 UTC, source
  `ba1996495677302ec2abc81c0d06bb6b2e043f86`, directly based on v75 source
  `4789bd7ff74a29b7e1e097b95e4c4bac4a469c2c`.
- Only the new migration and journal append changed. Application code, dependency
  lockfile, public audience, DB/BUCKET bindings and environment revision 2 remained
  unchanged. No OAuth application code was included in that publication.
- Live database inspection confirmed `OAuthLoginTransaction` with exactly nine
  columns (`id`, `bindingHash`, `browserBindingHash`, `provider`, `createdAt`,
  `expiresAt`, `consumedAt`, `finalizedAt`, `issuedSessionId`) and zero rows.
- CHECK/PK constraints, index definitions and the ledger were not separately read
  back. Table/column presence is not full activation verification. Google/OIDC
  login remains disabled; no provider credentials, ready flag or grant was set.
- If a future migration fails or has an uncertain outcome, stop and reconcile;
  do not blindly retry, suppress collisions with IF NOT EXISTS, reset the ledger
  or rewrite history. A failed publication can leave database additions applied.

## Review and verification before activation

Preparation checks are type checks, production build and source review only.
No local functional tests or new GitHub CI runs are allowed for this task.
Real OAuth success cannot be claimed before the owner registers a client and
enters credentials. After reviewed publication, functional acceptance belongs on
the published Sites URL with an owner-approved legitimate test account.

Cover configured/partial/missing provider enabled states, password regression,
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
