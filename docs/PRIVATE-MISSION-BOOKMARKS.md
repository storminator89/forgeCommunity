# Private mission bookmarks

A bookmark is a self-only intention before (or independently of) voluntary mission participation. It does not reserve a participant slot, create consent or contributions, alter progress, award XP, or schedule/deliver a notification. A full mission or expired soft learning week can still be bookmarked while open.

## Access and wire contract

Every read/write requires a live account, a PRIVATE Space, and actual current membership, including administrators. The existing administrative mission read/moderation bypass remains; those full DTOs contain `ownBookmark: null` without membership, and closed missions also return null. No bookmark count, other user's state, copied title/content, roster, timestamp, or reminder is exposed.

- Full mission DTO: `ownBookmark: {saved, revision, accessEpoch} | null`.
- Personal overview item: the same non-null own state, retaining existing fields.
- `GET /api/space-missions?view=all|saved`, default `all`: saved filtering is a database predicate before `(createdAt,id)` descending 20+1 keyset pagination. Strict version-2 cursors bind viewer, live role, filter, and bookmark access epoch. GET is write-free, including missing state/fence rows.
- `PUT /api/spaces/{spaceId}/missions/{missionId}/bookmark`: exact JSON `{saved:boolean, expectedRevision:number, accessEpoch:number}`. Identity comes only from the session. The response is the own state directly. Same-origin checking, a 1024-byte body limit and `private, no-store` apply, including errors. Stale state/fence is 409, unavailable/closed/private-inaccessible mission 404, absent live account 401. Integers are within 0..2147483647; persisted setting revisions are positive.

Missing setting means false/revision 0. Unsave persists a null savedAt tombstone and advances revision, including first unsave. A stale save cannot replace it. Writes are compare-and-swap; a 409 requires a fresh authorized read and another deliberate user action. There is no automatic intent resubmission.

## Lifecycle and concurrency

Two additive tables hold the state: `SpaceMissionBookmarkSetting(missionId,userId,savedAt,revision)` and `SpaceMissionBookmarkAccess(userId,epoch)`. The former has cascading mission/account FKs and a user-leading index; the latter has an account cascade. SQL CHECKs enforce integer domains and bounds. No existing business table is rebuilt or backfilled.

Every mutation writes the per-user access fence inside the same serializable transaction as live access and state CAS. The official private-member-removal route atomically advances that fence even without a previous row, clears settings only in the affected Space, revokes mission participation, and removes membership. Existing bookmarks elsewhere remain, but old-epoch in-flight writes require refresh. This fences delayed first saves across official removal/rejoin. Epochs never reset or wrap; exhaustion rolls back removal. Normal participation exit and role changes with unchanged membership preserve bookmarks.

Mission close atomically clears its settings and prevents new saves. User/mission erasure cascades. Direct SQL/raw removal plus restoration bypassing official hooks cannot be historically detected; live authorization still fails during absence. Other write paths must use the same official hook if private-member removal is added later.

Retries re-run live account, membership, open mission, fence, and revision checks. Known unique first-creation races and serializable conflicts are retried. The installed SQLite adapter's genuine BUSY lock is retried only when its actual DriverAdapterError class and SQLite BUSY code are present, directly or within P1008; unrelated timeouts and similarly shaped objects are not accepted.

## Deployment and validation

Deploy SQLite `0027_space_mission_bookmarks.sql` or PostgreSQL `0026_space_mission_bookmarks.sql` before serving the new application. Both exact history/readiness lists include the additive tail. Legacy images with shorter reviewed histories fail closed. A compatible application rollback must retain the longer histories and official revocation/fence hooks; there is no destructive downmigration.

`node --test scripts/space-mission-bookmarks.node-tests.mjs` covers actual SQLite fresh/populated upgrades, prior rows/schema/checksum preservation, PK/FK/integer checks/cascades, transactional DDL rollback and strict history failures. With `POSTGRESQL_RELEASE_GATE_DISPOSABLE=1` and the existing local-only `forge_test` URL validation it also runs PostgreSQL equivalents in random isolated schemas.

`__tests__/api/space-mission-bookmarks-db.test.ts` covers self-only privacy, pre-participation saves, full/expired missions, tombstone CAS, official revoke/rejoin without prior state, other-Space preservation, closure/rollback, account deletion, bounded filtered pagination/cursor bindings, and real independent-adapter first-save/fence contention. It runs locally on SQLite and in the existing PostgreSQL release-gate job with `SPACE_MISSIONS_POSTGRESQL_DISPOSABLE=1`. PostgreSQL runtime results require that CI job; local SQLite results do not imply a PostgreSQL pass.

No reminder time, scheduler, shared saved-items page, XP, notification target, delivery channel, private note, or administrative bookmark statistics are part of this slice.
