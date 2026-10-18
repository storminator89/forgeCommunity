# Sites OAuth administration candidate

Status: prepared source only. No live database command, provider discovery, real
login, secret provisioning, source push, or publication is part of this package.
The current published Button release and its environment are not changed.

## Components and API

- `lib/sites-auth/oauth-settings.ts`: the existing public-HTTPS identity URL and
  Google/RS256/OIDC endpoint boundaries, strict bounded settings validation, and
  immutable effective provider projections.
- `lib/sites-auth/oauth-configuration-store.ts`: fresh primary D1 reads, dedicated
  JWE encryption, storage state, ADMIN/session/CAS mutation and login guards.
- `app/api/admin/oauth-configuration/route.ts`: protected GET and PUT. GET uses
  `readAsAdmin` (fresh stored role before and after reading) plus a current
  unexpired DB session recheck. PUT requires exact non-missing Origin equal to
  trusted OAUTH_BASE_URL, request URL origin equality, no cross-site Fetch
  Metadata, application/json, a 24,576-byte request-body limit and strict schema.
- `lib/sites-auth/oauth.ts`: each transaction JWE binds `configRevision` and a
  ciphertext SHA-256 binding (or a full effective environment-settings SHA-256
  binding plus exact storage absence state); callbacks compare both.
  The final identity/User/Account/Session native D1 batch asserts the current
  version and exact ciphertext both before writes and at its end.
- Migration: `docs/migrations/SITES_OAUTH_PROVIDER_CONFIGURATION.sql` is separate
  and additive. It is intentionally NOT present in drizzle migration history.

GET returns the agreed revision/canSave/blockers/source/callbackUrls/providers
projection. No ciphertext, fingerprint, key, secret, token, audit ID, or exception
is in HTTP output. There are no raw exception logs. Callback URLs derive only
from the configured trusted origin.

PUT takes expectedRevision (null for the first row), google and oidc settings.
Success advances null to 1, then exactly +1. The safe version ceiling is
9,007,199,254,740,990. Unknown fields, unsafe integers and oversized/control
character input are rejected. Blank/omitted secrets retain only an existing
DB secret. An environment bootstrap NEVER silently copies environment secrets:
active providers require explicit secret entry for the first encrypted save.
Saving both providers disabled is an explicit database override of environment
providers; it does not delete any account or session.

Known failures are fixed code values. Invalid input is 400, wrong/missing Origin
403, wrong content type 415, body too large 413, unavailable prerequisites 503,
CAS/authority race 409 configuration_conflict. Writes use the existing per-isolate
rate limiter at 10/minute per ADMIN and 30/minute aggregate, after authentication
and before reading the body; 429 has fixed code and Retry-After. This is not a
claim of distributed/cluster-wide rate enforcement. A stored OIDC account prevents an
issuer or client-ID change with 409 oidc_identity_migration_required. This last
check is repeated inside the same native mutation batch, closing the race with
an in-flight first OIDC account creation. Plan any identity migration separately;
changing email is never used to link accounts.

## One-time host setup, requiring separate approval

1. Review and authorize only the additive singleton-table migration above for
   the intended Sites database. Do not run it automatically or add it to an
   already-published migration history. It creates only one new table, with
   CHECK constraints for singleton ID, integer safe version, ciphertext size,
   integer timestamps and audit actor ID. It has no seeded data and changes no
   User, Account, Session, role or OAuth transaction rows.
2. Provision a NEW cryptographically random 32-byte host secret named
   OAUTH_CONFIG_ENCRYPTION_KEY using the supported host-secret mechanism.
   Canonical standard Base64 or Base64url, with optional single '=' padding,
   is accepted. It must be independent of OAUTH_STATE_SECRET, NEXTAUTH_SECRET,
   session credentials and provider client secrets. It is never entered into
   this admin UI, checked into source, or stored in this database. The runtime
   additionally rejects an exact OAUTH_STATE_SECRET reuse.
3. Preserve/provision OAUTH_BASE_URL and independent OAUTH_STATE_SECRET via the
   host, then verify the existing OAuthLoginTransaction migration separately.
   The existing OAUTH_TRANSACTION_MIGRATION_READY=true operator gate remains
   host-only and unchanged. The UI never toggles it or any host setting.
4. Publish the separately reviewed candidate only after explicit authorization.
   Then use the ADMIN form to enter Google/OIDC application credentials and
   register the shown exact callback URL with the identity provider.
5. Perform functional acceptance only on the published Sites version. No local
   functional tests or new GitHub CI test runs are included in this candidate.

Until prerequisites are ready the form stays blocked. Blockers are
`encryption_key_missing`, `encryption_key_invalid`, `schema_missing`,
`base_url_missing`, `oauth_state_secret_missing`,
`oauth_transaction_not_ready`, and `configuration_unavailable`.

## Encryption, concurrency and failure behavior

The pinned jose 6.2.12 EncryptJWT/jwtDecrypt implementation uses only alg=dir,
enc=A256GCM, with strict decryption algorithm allowlists and a fixed JWE typ.
Authenticated claims bind purpose, formatVersion=1, stack=sites, trusted origin,
singleton ID, revision, creation/update timestamps and updating actor ID. Issuer
and audience are explicitly checked. No OAuth code, access/refresh/ID token,
PKCE verifier or provider response is saved by this configuration feature.

A write is one native D1 batch, not an unsupported Prisma interactive
transaction. SQL asserts the current ADMIN role, exact session token and user,
non-revoked/nonexpired session using database time, original row version plus
ciphertext (or absence), exactly one affected row, and complete final metadata.
No uncertain batch result is retried. Concurrent saves or authority loss roll
back. The input and deterministic response projection are bounded before write.

Runtime configuration is a fresh, immutable request snapshot. A genuinely absent
optional configuration table or no row preserves legacy environment providers.
If the schema is malformed/unreadable, a row exists but cannot decrypt, the key
is missing/invalid for that row, the origin changed, or claims do not match,
OAuth fails closed. There is no environment fallback for an invalid stored row.
The pre-migration login batch uses sqlite_master to assert that the table still
does not exist (case-insensitive table/view name matching, consistent with SQLite
identifier resolution); creation while a code exchange is running invalidates that old
flow too. With a present empty table it asserts row absence, and with a stored
row it asserts version plus exact ciphertext. A save during code exchange thus
cannot issue an account or session under the old configuration. A host deployment may still finish already-running requests on an old Worker
configuration; there is no database-level atomic fence for deployment metadata.
Between begin and callback, the entire effective environment settings fingerprint
must match, including provider secrets and allowed endpoints. Existing sessions
are deliberately not revoked merely because provider configuration changes.

The established OIDC issuer+sub identity hash, Google sub identity, RS256,
verified-email requirement, PKCE/state/nonce, host-only cookies, browser generation
revocation, duplicate/replayed callback protection, endpoint allowlist,
no-redirect external fetches and no-email-autolinking semantics are preserved.
No discovery or external credential check runs when saving settings.

## Key loss, rotation, backups and rollback limits

Back up the host encryption key separately and securely from database backups.
Database ciphertext alone cannot recover provider secrets. Losing/replacing the
key without re-encrypting the record makes it unreadable and disables OAuth;
the UI cannot recover, reset or read out that key. Password login is unchanged.
Do not rotate the key by simply overwriting the host secret. A separately
reviewed rotation procedure must retain secure access to the old key, decrypt
and validate outside the UI, re-encrypt under the new key with the next revision,
coordinate the host change, and verify the published result. No such procedure
has been executed or automatically enabled here.

Swapping ciphertext across revisions/origins/stacks/records fails authentication
or envelope validation. Replaying an older ciphertext while retaining a newer
DB version is rejected. A COMPLETE coherent older DB snapshot, including its
older counter and ciphertext, cannot be detected by a counter kept in that same
database. Detecting full database rollback requires a separate external monotonic
trust anchor or an operational backup/restore policy; this candidate does not
claim to provide one. Deleting the singleton row outside this API also restores
the explicitly supported no-row environment fallback; never use row deletion as
a configuration reset. Disable providers with an encrypted stored settings row.
Restoring DB and matching key together must be treated as
a security-sensitive operation, with state-secret rotation to invalidate old
browser flows and provider/client configuration review.

## Remaining trust boundaries

ADMIN can deliberately configure a provider that controls new sign-ins; ADMIN
accounts and the host-secret/operator path are trusted. Operator-selected public
OIDC domains and allowed endpoint domains require trustworthy DNS/TLS. Workers
cannot securely pin DNS against rebinding here. At-rest JWE protects the DB
copy, not compromised running server code or an operator with its host key.
The singleton has last-updater metadata, not a complete independent audit log.
These are explicit boundaries, not silently relaxed checks.
