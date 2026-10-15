# Bounded community feed

Community records are loaded in bounded pages. Post and comment order is always
`createdAt DESC, id DESC`; `id` breaks timestamp ties deterministically.

## API contracts

- `GET /api/posts?feed=1[&cursor=...]` returns `{ posts, nextCursor }`.
  A response contains at most 50 posts. The database fetches at most 51 posts to
  establish whether another page exists. A terminal response has `nextCursor: null`.
- Each normalized post has `votes`, `isLiked`, `comments`, `commentCount`, and
  `commentsNextCursor` in addition to its ordinary scalar fields and public author
  identity. `comments` is the newest 3 replies; `commentCount` is the total count.
  `commentsNextCursor` begins immediately after the oldest previewed reply. A
  50-post response therefore eagerly includes at most 150 comments.
- `GET /api/posts/:postId/comments?feed=1[&cursor=...]` returns
  `{ comments, nextCursor }`, with at most 50 comments and one database lookahead.
  It can continue a post's `commentsNextCursor`. Comments have aggregate `votes`
  and viewer-specific `isLiked`.
- `GET /api/posts/:postId` and successful post updates return the same complete,
  bounded normalized post shape. Creating a post returns a published normalized
  post with empty comments, zero counts/votes, `isLiked: false`, and a null comment
  cursor, so it can immediately enter the feed.
- `GET /api/posts/linked-comment/:commentId` resolves an existing comment anchor
  directly, without scanning feed pages. It returns one normalized parent post
  with the ordinary 3-comment preview and, when necessary, the requested older
  comment once. There are at most 4 comments. The ordinary preview cursor is
  preserved, so loading older replies cannot skip the interval before the linked
  comment. The response uses the same newest-first timestamp/ID order.
- Authenticated `GET /api/posts/me/stats` returns
  `{ posts, receivedLikes, comments }` using database counts in a transaction.
  Posts count all records authored by the current user, including their drafts;
  received likes count likes on those posts, including likes they give their own
  posts. Comments count the current user's
  replies only where the parent is published or owned by them. Staff privilege
  does not widen personal totals. The route accepts no user target and ignores
  arbitrary target query parameters.

Like totals use `_count`. A like relation query fetches only the current viewer's
unique like, with `take: 1`, or no like records for anonymous readers. Raw liker
arrays and `_count` internals are not returned to clients.

### Legacy compatibility decision

`GET /api/posts?page=N` preserves its outer array response and 50-post page size.
Its post payloads intentionally use the same 3-comment preview and truthful
`commentCount`/`commentsNextCursor` metadata as the cursor feed. Unbounded nested
comments and liker arrays would retain the original scalability failure even
when the outer post list is paginated. Clients needing older replies should use
the bounded comment cursor endpoint.

`GET /api/posts/:postId/comments?page=N` likewise preserves an array response,
bounded to 50 comments. Legacy page routes use the same timestamp/ID tie order.
Existing consumers should use aggregate `votes`/`isLiked`, not raw like arrays.

### Cursor semantics and privacy

A versioned base64url cursor contains the boundary timestamp and ID, its resource
kind, and the parent post ID for comment cursors. The next query uses:

```text
createdAt < boundaryTime
OR (createdAt = boundaryTime AND id < boundaryId)
```

This does not depend on the boundary database row still existing. Deleting that
row or inserting a newer top-of-feed record does not skip the remaining older
records. Cursors are scoped to posts or a specific post's comments; malformed,
overlong, wrong-scope, or invalid-date cursors return HTTP 400. They are opaque
pagination values rather than snapshot tokens: new older/backdated records can
appear, and deleted records no longer appear.

Every request reapplies visibility. Anonymous readers see published posts;
ordinary signed-in readers additionally see their own drafts. Another author's
draft requires a currently stored ADMIN role, checked through a narrow database
lookup before granting that access. Personal statistics have no staff override.
Inaccessible post/comment links return HTTP 404. Personalized GET responses use
`Cache-Control: private, no-store`.

## Indexes and query justification

The migrations add ordinary indexes only. No existing migration or PostgreSQL
baseline is rewritten, and there are no table, column, ownership, or data changes.

- `Post(createdAt, id)` supports global staff feeds and descending timestamp/ID
  keysets. A same-direction B-tree supports the descending order by scanning
  backwards.
- `Post(published, createdAt, id)` supports the published branch of visibility
  filtering and its timestamp/ID order.
- `Post(authorId, createdAt, id)` supports the viewer-owned branch and authored
  post totals. The ordinary-viewer OR query can use both visibility indexes;
  exact execution plans depend on row distribution and provider.
- `Comment(postId, createdAt, id)` supports per-post newest previews and older
  reply keysets.
- `Comment(authorId, postId)` supports own-comment totals and parent visibility
  joins.
- `LikePost(postId)` and `LikeComment(commentId)` support aggregate counts by
  parent. Existing unique user/parent keys support the viewer-only like lookup.

PostgreSQL upgrade: `0005_community_feed_indexes.sql`.
SQLite migration: `0006_community_feed_indexes.sql`.
The generated SQLite Prisma schema mirrors the canonical PostgreSQL schema.

## Verification

The real SQLite API tests cover more than 50 posts, timestamp ties, newer inserts,
deleted post/comment boundaries, malformed/scoped cursors, draft visibility and
stale ADMIN claims, previews from 95 replies and follow-on pages, large like totals,
legacy bounded arrays, complete create/edit shapes, linked older comments, and
personal stats without arbitrary-user or staff-draft leaks.

The dedicated migration tests verify fresh install, populated post/comment/like
preservation, ordered migration history, repeat deployment, checksum rejection,
foreign-key integrity and cascades, index column definitions, and use of the
per-post comment index in a SQLite keyset query plan. Existing migration-safety,
input-boundary and security-regression tests remain applicable.

Both Prisma schemas validate, SQLite schema generation passes its consistency
check, and the PostgreSQL safety/release-gate scripts pass syntax checks. The
PostgreSQL test scripts include the new upgrade, check the complete index catalog
for fresh and upgraded schemas, retain replay/checksum/FK checks, and seed
community records to assert data preservation. CI's PostgreSQL 16 service runs
those runtime scripts. The validate job generates a SQLite client for its real
DB Jest suites and restores the PostgreSQL client before building. PostgreSQL runtime checks were not executed locally because
this execution environment had no PostgreSQL binaries or running service.

For local SQLite API tests, generate the SQLite Prisma client before running Jest:

```sh
SQLITE_TEST_DIRECTORY="$(mktemp -d)"
DATABASE_PROVIDER=sqlite DATABASE_URL="file:${SQLITE_TEST_DIRECTORY}/forge-jest.db" npm run db:generate
DATABASE_PROVIDER=sqlite DATABASE_URL="file:${SQLITE_TEST_DIRECTORY}/forge-jest.db" npm test -- --runInBand __tests__/api/community-feed-db.test.ts __tests__/community-feed-migration-db.test.ts __tests__/reward-upgrade-deploy-db.test.ts
node --test scripts/check-sqlite-migrations.mjs
node scripts/generate-sqlite-schema.mjs --check
rm -r "$SQLITE_TEST_DIRECTORY"
```

Use a disposable PostgreSQL database for the runtime gates, with the explicit
safety variables required by `scripts/check-postgresql-release-gate.mjs`.

## Client behavior and regression checks

The initial view makes one feed-page request. Further pages load only through a
native button. The visible count says how many posts are loaded, rather than
claiming to be the entire community's post total. A failed later page preserves
loaded rows and retries the same cursor. Initial failure remains distinct from
an empty feed; the personal activity card has its own loading, failure and retry
state and never substitutes page-limited counts or invented zero totals.

The complete view remounts when either account ID or session role changes.
Pending feed, comment, linked-target, stats and mutation requests are aborted;
late responses cannot repopulate the new account's view. Rows are de-duplicated
and deterministically sorted by timestamp/ID. An overlapping page keeps newer
local edits, likes and comments, and deleted IDs cannot reappear. A mutation
aborts a pending post page without advancing its cursor. The requested page can
then be fetched again safely. Older comments remain reachable through explicit
load-more/retry; post/comment anchor links use bounded target reads.

Pagination and comment controls use native buttons, accessible names, live
loading/error/count feedback, wrapping mobile layouts, and keyboard focus at
the terminal result after the final load-more button disappears. They do not
hide rows on a later request failure.

Final local validation: 103 Jest suites and 623 tests passed, including 11 new
UI tests and real SQLite feed/migration coverage. Full typecheck and full ESLint
with zero allowed warnings passed. All six standalone SQLite migration-safety
tests, schema consistency and diff whitespace checks passed. No throughput or
latency target is claimed; the bounds establish request size independent of the
community's total records. Repository call-site audit found the community view
is the only application consumer of the legacy post-list endpoint, and it now
uses the explicit cursor contract.
