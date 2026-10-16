# Voluntary Space polls

Current administrators can create a plain-text question with 2–8 immutable
options in either a PUBLIC or PRIVATE Space, then close or hide the poll.
Only current Space members may cast or change their single choice. Voting is
voluntary. Viewing a poll never casts a vote, and admins cannot vote on behalf
of another person. A nonmember admin must join before voting.

## Visibility and privacy

PUBLIC means readable by signed-in community accounts, not by anonymous
visitors. PRIVATE polls require current Space membership or a current stored
ADMIN role. Every read, replay, write and aggregate projection uses the same
serializable transaction as its current account/role/membership checks.
Inaccessible, missing, wrong-Space and non-admin hidden polls all return 404.
Explicit route responses, including errors, are `private, no-store`.

The API returns option totals, the caller's own choice/revision, and permission
flags. It has no voter list or creator identity, and never returns other
people's vote rows, replay keys or digests. This does not make votes anonymous:
small-group totals and changing counts can reveal choices. The UI discloses
this next to the tool and asks admins to avoid sensitive questions. Individual
choices and account-linked receipts are stored server-side to enforce one vote
and safe retries; database operators can access them.

A vote already cast stays in aggregate results after the person leaves or is
removed from a Space. This preserves the decision history. Removed members
cannot change it or read PRIVATE polls; PUBLIC former members remain ordinary
signed-in readers. Rejoining restores the ability to change the existing
choice. Account deletion cascades choices/receipts; creator deletion preserves
the question without its creator reference. There is no separate withdrawal or
poll deletion endpoint in this slice. Hiding retains the poll for admins;
closing cannot be reversed. These boundaries are deliberately distinct from
mission participation and its opt-out rules.

The UI rechecks on focus/visibility return and purges displayed poll rows while
revalidating. Shared Space access guards abort in-flight requests on access
loss, and generation guards reject late pages. Changing PUBLIC membership
remounts the poll tool so voting controls reflect the new membership. Reads do
not subscribe to push updates; a continuously visible tab may retain its last
snapshot until its next focus/revalidation/request.

## API

All paths below start at `/api/spaces/{spaceId}/polls`.

- `GET /`: newest-first keyset list `{items,nextCursor}`, 10 polls/page. Opaque
  cursors are versioned, canonical and Space-scoped, and are checked only after
  current access.
- `POST /`: admin `{question,options,requestId}`. Question minimum 5 Unicode
  codepoints, maximum 200 UTF-16 units; options 1–100 UTF-16 units each, 2–8
  distinct labels after sanitization and case folding. Raw string limits are
  800/400; body at most 6 KiB. Text/options are immutable.
- `GET /{pollId}`: current authorized detail with totals, own choice and flags.
- `PUT /{pollId}/vote`: member `{optionId,expectedRevision,requestId}`.
  First vote expects revision 0; a successful write increments the revision.
  The option must belong to that poll. A stale different request returns 409.
- `PATCH /{pollId}`: admin `{closed:true}` for one-way idempotent close, or
  `{hidden:boolean,expectedRevision}` to change visibility using the latest
  `moderationRevision`. Repeating an already-current visibility is a no-op;
  a delayed opposite state cannot overwrite newer moderation with an old
  revision.

All bodies reject unknown keys. Mutations enforce same-origin requests and
bounded reads (1 KiB vote/moderation bodies). Actor identity comes only from
the session, never a body field. Fresh stored role is resolved on every retry.

Create IDs are Space-scoped and bound to creator + normalized payload digest.
Exact retries return the current authorized snapshot, mismatches return 409.
Vote receipts are scoped to poll + authenticated voter + request ID. Their
digest includes option and expected revision. Exact old retries return the
current state without changing a later choice, including after close if the
caller is still a current authorized member. Hidden/private revocation checks
precede receipt lookup. Each mutation/receipt commits atomically.

## Abuse and storage limits

- 10 new polls per Space / rolling 24 hours; 20 per creator / rolling 24 hours
- 12 accepted vote writes per account / rolling minute across all polls
- 100 accepted vote writes per account per poll across its lifetime
- Exact create/vote replays consume no additional quota or revision

These are durable database counts inside serializable transactions, including
predicate conflicts for concurrent quota checks. A bounded retry reruns all
checks on recognized Prisma/adapter serialization failures. Cross-poll option
FKs, one vote per member, unique receipt keys and text/position checks exist
in both provider migrations. Limits do not rely on process-local maps.

No points, rewards, rankings, streaks, mastery evidence, course progress,
notifications, external providers or credentials are added. Poll content is
not copied into the global feed, search or profile. Moderation here is current
admin close/hide; this slice does not extend the generic content-report queue.

## Deployment and verification

SQLite `0025_space_polls.sql` and PostgreSQL `0024_space_polls.sql` follow the
event waitlist tails. Both are additive. Strict startup/readiness migration
inventories include the new tails, and predecessor waitlist safety tests keep
their pre-waitlist fixture boundary while deploying later tails on upgrade.

Focused checks:

- `DATABASE_PROVIDER=sqlite npm test -- --runInBand __tests__/api/space-polls-db.test.ts __tests__/space-polls-ui.test.tsx`
- `DATABASE_PROVIDER=sqlite node --test scripts/space-polls.node-tests.mjs scripts/event-waitlist.node-tests.mjs scripts/check-course-publication-ready.mjs`
- After generating the PostgreSQL client, run against an explicitly disposable
  local `forge_test` database without URL query parameters/fragments:
  `SPACE_POLLS_POSTGRESQL_DISPOSABLE=1 DATABASE_PROVIDER=postgresql npm test -- --runInBand __tests__/api/space-polls-db.test.ts`

The guarded PostgreSQL suite creates a random schema, deploys real migrations,
runs the same route contracts, and drops only that schema. One-shot barriers
force overlapping real transactions for competing revisions, identical replay,
per-Space creation quota, per-account minute quota across distinct polls, and
close versus vote. The PostgreSQL release-gate CI job runs it explicitly.
That job is independent of `validate`, so inspect its exact-commit result.

The real disposable SQLite browser journey is `e2e/space-polls.pw.ts`, included
in `browser-qa`. It covers keyboard composition/vote/change, no voter-list
projection, stale replay, hide/close, revoked access, PUBLIC join/leave,
light/dark 320/375/414/768px, 200% zoom and document/control reflow. It requires
the repository's guarded loopback `forge-browser-qa.db` fixture. Browser and
PostgreSQL runtime remain unverified until their actual CI jobs pass; unit and
SQLite route tests are not substitutes for those gates.
