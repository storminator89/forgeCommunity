# Main OAuth configuration: unapplied migration source

## Status and scope

Prepared on 2026-10-18 for the Main application. **No migration has been applied**
as part of this preparation. No database connection, SQL execution, schema push,
backfill, secret generation, provider grant, runtime flag change, application
startup, CI run or publication was performed for this migration work. Review is
static source review only; it is not evidence of successful execution on either
database provider. This document does not authorize deployment.

These two new source files extend Main's existing histories:

- PostgreSQL: `prisma/postgresql-upgrades/0029_oauth_configuration.sql`, after
  `0028_space_mission_invitations.sql`.
- SQLite: `prisma/sqlite-migrations/0030_oauth_configuration.sql`, after
  `0029_space_mission_invitations.sql`.

All historical migration SQL remains unchanged. These are **active migration
directories**, not an inert review archive. Copying these files into the active
directories of a deployment artifact means a future `npm run db:deploy` will
discover and include the new migration together with every other pending
migration for the selected provider. Do not run that command, start a new SQLite
container, or deploy an artifact merely to inspect this preparation. The existing
SQLite Docker entrypoint applies tracked migrations automatically on startup.

This Main table is separate from the published Sites application's storage.
Main's PostgreSQL and SQLite numbering must not be copied into Sites as if the
two applications shared a schema or migration history.

## Model and storage contract

The application schemas must contain this model in the canonical
`prisma/schema.prisma` and its generated SQLite counterpart:

```prisma
model OAuthConfiguration {
  id               String   @id
  revision         Int
  encryptedPayload String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

The DDL only creates `OAuthConfiguration`; it does not alter existing tables,
insert configuration, import environment values, add foreign keys, install
extensions, or create a new database user or service.

- The primary key and `CHECK (id = 'main-oauth')` permit at most one row.
- `revision` is required and at least 1. PostgreSQL `INTEGER` has Prisma `Int`'s
  signed 32-bit range; SQLite explicitly checks integer storage and the same
  maximum, 2147483647. Revision changes remain the application's responsibility.
- `encryptedPayload` must be nonempty text, at most 32768 characters and at most
  32768 stored bytes. The additional byte bound keeps the limit meaningful for
  multibyte input and SQLite text containing embedded NUL characters. SQLite
  explicitly rejects non-text storage. These limits are not proof of encryption
  or payload validity; authenticated encryption and envelope validation must be
  enforced by the server. Plaintext provider secrets must never be written here.
- Following current Main conventions, timestamps are PostgreSQL `TIMESTAMP(3)`
  without a time zone and SQLite `DATETIME`. Only `createdAt` has a SQL
  `CURRENT_TIMESTAMP` default. `updatedAt` is required without a database default
  or trigger because Prisma's `@updatedAt` supplies it; direct SQL writers would
  need to supply and maintain it explicitly.
- No id or revision default is supplied. No row is seeded, so creating this table
  does not itself enable Google or any other identity provider.

The SQL intentionally uses `CREATE TABLE`, without `IF NOT EXISTS`, so an
unexpected pre-existing table fails instead of silently accepting unknown
storage. Transaction handling and migration receipts remain owned by the
existing provider-specific runners.

## Required review before any later deployment

1. Obtain explicit later approval for migration deployment to the named target.
   Confirm the actual application, provider, database and, for PostgreSQL,
   schema. Confirm `DATABASE_PROVIDER`, `DATABASE_URL`, the generated Prisma
   client provider and runtime artifact agree, without exposing the URL or
   credentials in logs, chat or this document.
2. Create a consistent backup and verify the restore procedure for that exact
   target. For SQLite, use a consistent database backup or stop writes and
   preserve its journal/WAL state. Confirm persistent storage and the deployment
   maintenance plan. Do not reset or delete an existing database.
3. Inspect the actual current schema and migration history. PostgreSQL uses
   `_app_schema_upgrades`; SQLite uses `_app_migrations`. Confirm the complete,
   ordered, checksummed predecessor history matches this Main artifact, that
   `OAuthConfiguration` is absent, and that any other pending migrations have
   separate review and authorization. A source checkout alone cannot establish
   live schema compatibility. The existing fresh-empty-database compatibility
   policy remains in force; this additive table does not make legacy course
   databases supported. See [the storage guide](COURSE-PUBLICATION-STORAGE.md).
4. Review the final Prisma schemas and the prepared exact-history file
   allowlists in `scripts/assert-course-publication-ready.mjs`, including
   PostgreSQL `0029` and SQLite `0030` above. Only the matching new OAuth receipt
   may be absent from actual applied history. If present, its checksum must
   match; every required predecessor receipt and checksum remains mandatory.
   The ordinary Main readiness/startup path does not query or require the
   optional OAuth table. A missing table blocks ADMIN configuration writes,
   not the existing credentials/application startup. These source edits do
   not apply or authorize either migration.
5. Only after approval and those checks, use the existing `npm run db:deploy`
   entrypoint with the confirmed target configuration. Do not substitute
   `prisma db push`, `prisma migrate dev`, direct SQL, an automatic schema repair,
   or a new baseline. No baseline or initialization flag is authorized by this
   preparation. The existing runners discover ordered SQL files, reject changed
   or gapped recorded history, and record successful migrations transactionally.
6. After an approved deployment, inspect the actual resulting schema and new
   receipt/checksum, then use the existing read-only readiness check with the
   same confirmed configuration. Schema/provider confirmation and a backup are
   prerequisites, not conclusions supplied by this document. Functional tests
   remain restricted to the published Sites version under the user's current
   instructions; no local functional tests or new GitHub CI runs are authorized.

The read-only `npm run db:publication:ready` guard checks Main's existing
publication and migration-history requirements. It does not by itself prove
that the optional OAuth table exists or matches this SQL, validate encrypted
payloads, or establish that real OAuth sign-in works. It deliberately performs
no OAuth table query: the optional feature must not create a new global Main
startup dependency. Only its one known receipt may be absent; all other
mandatory migration names/order/checksums remain strict. No Google login success,
deployment readiness or production migration success is claimed here.

## Operational caveats

The database stores encrypted configuration only; the encryption key must remain
in the existing approved runtime secret mechanism, outside the table and source
control. Provisioning a key, rotating one, writing provider credentials,
expanding access or enabling provider flags requires its own applicable approval
and is not performed by this migration.

Do not edit a migration file after it has been applied. The runners compare
recorded SHA-256 checksums and fail closed on a mismatch or missing history.
An application rollback must preserve the newly applied migration files and
their receipts. An older artifact that omits a recorded migration can be refused
by the runner/readiness guard. V3 readiness accepts the one prepared OAuth
receipt as absent or present with the exact checksum; this does not relax the
normal migration runner or permit any other history divergence. Dropping the new table would delete saved
configuration and is not an authorized rollback. Plan any recovery separately
from these additive source files.
