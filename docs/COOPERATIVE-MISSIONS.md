# Private Space cooperative missions

The teach-back relay is optional, named collaboration inside an existing
PRIVATE Space. A current administrator creates an immutable topic/prompt and
can close the mission. At most one mission is open per Space. Current USER
members join themselves, up to five active consents. No account is enrolled by
an administrator or by visiting a page.

Two different eligible participants each share an insight. A participant adds
a build-on targeting another participant's current insight. The server derives
`progress.complete` from two distinct insight authors and at least one valid
cross-person build-on. This records cooperation, not comprehension or mastery.
There are no points, grades, course-progress changes, credentials, rewards,
profile badges, leaderboard entries, notifications, deadlines or streaks.

## Consent, privacy and reversal

All mission reads require current PRIVATE-Space access. Current administrators
may read without membership; other accounts need current Space membership.
Only live USER members with active mission consent can post or be credited.
Mission text, participant names and contributions never enter Post/Comment,
feed, search, profile, reward or notification models. All explicit responses
including errors use `Cache-Control: private, no-store`.

Joining uses an expected participation epoch. A fresh self-join advances it by
one. Duplicate requests can return the same still-active epoch; replay after
leave cannot rejoin. A stale leave cannot revoke a newer epoch. Leaving hides
all that epoch's contributions from members and reverses their credit. Rejoin
never revives historical contributions. Private-Space member removal opts out
in the same transaction. The official administrator account PUT also opts out
on transition out of USER; returning to USER requires a new explicit join.

Reads independently require current membership and role. Capacity counts all
unopted consent rows defensively, even if an out-of-band edit made one
ineligible; a raw database role/membership edit cannot release a slot and later
silently exceed the five-person cap.

An author can withdraw their own contribution. Withdrawal is permanent through
these APIs. An administrator may hide/unhide, but cannot clear withdrawal,
change the recorded epoch or restore an invalid target. A hidden, withdrawn,
inactive or removed target invalidates dependent build-ons for display and
credit. Progress can reverse after completion, including on account erasure.
Closing blocks new joins/posts; leaving, withdrawing and moderation still work.

Withdrawn/hidden text is retained for current administrators in the separate
bounded audit endpoint and existing scoped report previews. Ordinary mission
detail never includes it, including when read by an administrator. Account
erasure cascades authored contributions; retained ContentReport audit records
remain FK-free, with unavailable targets shown without a preview.

## API contract

All paths below start with `/api/spaces/{spaceId}/missions`.

- `GET /`: newest-first keyset list, `{items,nextCursor}`, 20 missions/page.
- `POST /`: administrator body `{title,prompt,requestId}`. Title 3–100,
  prompt 10–2000 sanitized plain-text characters. Raw limits 400/8000.
- `GET /{missionId}`: current detail snapshot.
- `PATCH /{missionId}`: administrator body `{closed:true}`; close is idempotent
  and cannot reopen.
- `POST /{missionId}/participation`: self body `{expectedEpoch:0}` for a first
  join; use the last observed epoch for later explicit joins.
- `DELETE /{missionId}/participation`: self body `{epoch}`; duplicate leave is
  idempotent for that same epoch.
- `POST /{missionId}/contributions`: self body
  `{kind,content,epoch,requestId,targetContributionId}`. Kind is INSIGHT or
  BUILD_ON. An INSIGHT requires a null target; BUILD_ON requires another active
  participant's current insight in the same mission. Content is 10–2000
  sanitized plain-text characters, raw maximum 8000. One live contribution per
  kind/author/epoch; at most five stored attempts per kind/author/mission across
  all epochs. Hidden or withdrawn attempts still consume the lifetime limit.
- `DELETE /{missionId}/contributions/{contributionId}`: author-only body
  `{epoch}`. May withdraw a known caller-owned historical contribution after
  leaving, if the caller still has private-Space access. Never withdraws a
  different contribution or newer epoch based on a stale action.
- `PATCH /{missionId}/contributions/{contributionId}/moderation`:
  administrator body `{hidden:boolean}`. Restoring over a replacement live
  same-kind contribution returns 409.
- `GET /{missionId}/contributions/moderation`: administrator-only newest-first
  audit list, `{items,nextCursor}`, 20/page. Cursor is Space-and-mission scoped.
- Existing `POST /api/reports` accepts target type
  SPACE_MISSION_CONTRIBUTION. Private visibility is checked before duplicate
  receipt lookup. Ordinary moderators cannot list, count, preview or review
  private mission reports. Administrator previews match the stored Space scope
  and include targetMissionId and targetWithdrawn.

Detail and successful mutation projections contain the mission's immutable
fields, minimal creator identity, current named participants, participantLimit,
the caller's epoch/active state, canManage/canJoin, visible contributions,
active-current-epoch ownContributions metadata, and derived progress. Public
projections omit replay digests/keys and historical epochs. Own metadata has no
text and lets authors withdraw a hidden or invalid-target current contribution.
Hidden metadata does not block a replacement; an unhidden invalid-target
build-on occupies its slot until withdrawn.

Bodies use strict allowlists and bounded reads. Every mutation checks same
origin, then resolves stored role, Space, membership, consent and protected
writes together in serializable retry snapshots. Nonexistent and inaccessible
missions have indistinguishable 404s. Replay keys are scoped; identical
sanitized payload replays return current authorized state, changed payloads
under the same key return 409. Withdrawn/hidden/inactive contribution replays
cannot return retained text.

The four-attempt retry boundary recognizes Prisma P2034 and actual PostgreSQL
DriverAdapterError instances with mapped TransactionWriteConflict plus original
SQLSTATE 40001 or 40P01. Prisma 7.10 can propagate that adapter error unwrapped
when serialization fails at COMMIT. Every retry takes a fresh authorization
snapshot; exhaustion returns 409. Lookalikes, other mapped kinds and unrelated
SQLSTATEs are not retried. The adapter error class is an explicitly declared,
locked direct dependency, aligned with the installed Prisma 7.10 adapters.

## Storage and checks

PostgreSQL upgrades 0021/0022 and SQLite migrations 0022/0023 follow the merged
Spaces tails. Both enforce one-open-mission and one-live-kind partial unique
indexes, replay uniqueness, positive epochs, kind/target shape and a composite
same-mission target FK. New tables are separate from all private course,
practice, confidence, grading and reward data. The contribution upgrade widens
the existing report type/scope checks while retaining all report history,
resolution invariants and indexes. Publication readiness and PostgreSQL release
gate allowlists include the exact new tails.

Local validation used a private schema-generated SQLite client without changing
shared dependencies: 43 mission API tests plus 46 adjacent account, Space and
report regressions passed; eight Space/mission migration/readiness/fixture-boundary tests passed. Both Prisma
schemas, generated SQLite synchronization, changed-source zero-warning ESLint
and whitespace checks passed. Full-project typecheck was resource-killed and
is not a pass. No local PostgreSQL server/runtime, build or browser validation
was performed for this backend-only change. The actual PostgreSQL adapter's
COMMIT-error mapping was reproduced with a fake in-memory pg pool and no socket.
Regressions cover successful retry, four-attempt rollback/409, membership
revocation between retries and rejection of lookalikes/unrelated adapter errors.

CI runs the identical mission API suite through the PostgreSQL adapter in the
existing disposable PostgreSQL service. The opt-in fixture requires
SPACE_MISSIONS_POSTGRESQL_DISPOSABLE=1, DATABASE_PROVIDER=postgresql and a local
`forge_test` database URL without any query parameters or fragments. This rejects
pg-connection-string host/socket, database, SSL and options overrides before any
connection; every client and deploy subprocess uses the validated canonical URL.
Pure parser regressions exercise those rejection paths without connecting. It creates only a random
`forge_mission_...` schema, deploys through the reviewed runner, and tears down
only that schema. This configured gate is not evidence of a completed CI run.

The existing PostgreSQL release, course-publication-readiness and course-Q&A
integration gates share the same parameter-free loopback URL boundary. An
explicit disposable flag with an unsafe URL fails before registering database
work. Production Prisma and migration-runner remote connections remain supported.
