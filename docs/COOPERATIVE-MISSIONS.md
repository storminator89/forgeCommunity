# Private Space cooperative missions

> Integrated evidence, 16 October 2026: [PR #65 CI run 38871008041](https://github.com/storminator89/forgeCommunity/actions/runs/38871008041)
> passed all seven jobs for `0a8cead91c7f24609236bd516a61722d22472001`, whose
> source tree matches merged main `38a0826458387056ea079d46797b3be4b7a36b96`.
> Its separate [post-merge main run 38872143016](https://github.com/storminator89/forgeCommunity/actions/runs/38872143016)
> also passed all seven jobs.
> This includes the PostgreSQL contract gate and disposable production-build
> browser journeys. Local/configured checks described below retain their
> original scope. See the [current README evidence](../README.md#testing-and-evidence)
> and [screenshot fixture limits](ui/README.md#current-space-captures).

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
profile badges, leaderboard entries, notifications, hard deadlines or streaks.
An administrator may optionally add a soft learning week to a new mission;
self-paced missions keep their existing behavior.

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

## Optional soft learning week

A creator explicitly supplies the current ISO Monday date and a valid IANA
zone, including UTC. The form may suggest the browser zone; the server never
falls back to its own or a viewer's zone. Midweek creation is allowed with no
backfilled activity. Future scheduling, arbitrary historical windows, editing,
rescheduling, reopening and automatic rollover are not supported.

The local Monday midnight and following Monday midnight are resolved
independently. Nonexistent or ambiguous boundaries are rejected. Persisted UTC
instants preserve the chosen window; later viewer travel or timezone-database
changes do not recalculate it. Berlin's 2026-03-23 week lasts 167 hours and its
2026-10-19 week lasts 169 hours, rather than a fixed 168-hour duration.

The window is [startsAt, endsAt). At the exact exclusive end, the server-derived
`windowState` becomes `past`. It is descriptive only: the mission stays open,
late joins and posts remain possible, consent and contributions are not reset,
and progress is still derived from all currently eligible relay contributions.
Late posts do not assert on-time activity. Only an explicit administrator close
blocks new joins/posts. Screens refresh through their existing refresh, focus
and visibility lifecycle; there is no midnight push, countdown, scheduler,
reminder, next mission or carried-over participation.

Named rosters and even small-group progress changes can reveal who acted or
left. These aggregates are not anonymous or suitable for individual assessment.
Leaving removes subsequent member visibility and credit, but cannot erase what
members already saw or retained. The ordinary retained administrator moderation
audit continues under the existing consent disclosure.

## API contract

All paths below start with `/api/spaces/{spaceId}/missions`.

- `GET /`: newest-first keyset list, `{items,nextCursor}`, 20 missions/page.
- `POST /`: administrator body `{title,prompt,requestId}` or exactly
  `{title,prompt,requestId,week:{startDate,timezone}}`. Both nested week keys
  are required; null, partial/extra fields and client-supplied UTC boundaries
  are rejected. Title 3–100, prompt 10–2000 sanitized plain-text characters.
  Raw limits 400/8000 and the existing 12 KiB create body ceiling still apply.
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
active-current-epoch ownContributions metadata, and unchanged derived progress.
Every mission also contains `week:null` or exactly
`{startDate,timezone,startsAt,endsAt}` (UTC instants as ISO strings), plus
`windowState:"self-paced"|"current"|"past"`. The week, close state and current
cooperation milestone are independent. Public
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

Self-paced creation keeps the exact existing SHA-256 digest of JSON
`{title,prompt}` after sanitization. Weekly creation hashes JSON
`{title,prompt,week:{startDate,timezone}}` in that fixed property order, using
validated inputs rather than resolved instants. Each transaction attempt first
obtains current private-Space ADMIN access and checks the scoped request key.
An identical authorized replay after rollover returns the original stored week
and current authorized projection. A changed date, zone or mode under the same
key returns 409. Only a new insert must pass current-local-week eligibility;
a fresh stale/future week returns 400. Serializable retries reread both live
authority and the clock, rather than silently switching the requested week.

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

After the merged waitlist/poll tails, SQLite 0026 and PostgreSQL 0025 add only
four nullable `SpaceMission` columns: `weekStartsOn`, `weekTimezone`,
`weekStartsAt`, `weekEndsAt`. Both engines require all-null or all-four fields,
a zone string of 1–100 characters and strictly increasing boundaries. The
application additionally validates the IANA zone, local Monday/date, exact
unambiguous boundaries and current-week eligibility. Existing missions stay
all-null. The SQLite tail uses four additive column additions, placing its
row-wide CHECK on the final addition; no table rebuild or previous migration
change is needed. Existing indexes, FKs, consent epochs and history are kept.
Strict ordered/checksummed readiness, release-gate and fixture manifests include
the exact week tails. Deploy schema first, server second and UI last. A
forward-compatible application rollback can hide weekly creation and ignore
the nullable columns, but must retain the new migration files and exact
readiness manifests. An unchanged older image refuses startup after this tail
because its history check rejects the extra migration. Do not remove columns
or down-migrate stored mission history.

Weekly backend validation uses disposable schema-generated SQLite/PostgreSQL
clients outside shared dependencies. The local SQLite API suite passes 51 tests,
and the pure clock suite passes 25, including 167/169-hour DST windows and real
historical skipped/ambiguous Monday start/end boundaries. Four new SQLite
migration tests exercise fresh installs, all 14 partial week-field sets,
equal/reversed boundaries, populated predecessor preservation, injected DDL
rollback and fail-closed checksum/order history. Two corresponding guarded
PostgreSQL migration tests are wired into the disposable CI service. The full
local SQLite migration/readiness batch passes 43 tests with four PostgreSQL
tests skipped; mission/clock and adjacent authorization/report regressions pass
161 tests. Both Prisma schemas, SQLite synchronization, changed-source ESLint,
whitespace and a full-project typecheck pass. The typecheck uses external path
overrides to the disposable client and an already-installed Playwright package;
no dependency, cache or installation is changed. There is no local PostgreSQL
service or binary, and no local runtime/build/browser check was run for this
backend slice. Those results must come from the integrated release checks; configuring a gate is not evidence that it ran. Existing API
regressions continue to cover adapter COMMIT conflicts, bounded retries,
member/role revocation, consent epochs, permanent withdrawal and moderation.

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
