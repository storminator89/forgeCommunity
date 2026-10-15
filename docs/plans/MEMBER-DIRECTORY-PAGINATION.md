# Member directory: bounded-read feasibility and implementation gate

Status: **plan only; do not replace the current API yet**.

Investigated against `8ab8eb05a695d995baf65887a15511b64583b3f6` on an isolated
`feat/bounded-member-directory` worktree, 2026-10-15. No application code,
database schema, dependencies, or integration checkout changed.

## Decision

A server-backed directory is feasible, but a small pagination patch cannot
honestly preserve the current Unicode search and name-sort contract on both
supported databases. Do not ship `take: 25` followed by client-side filters,
counts, or facet extraction. Do not substitute the existing
`containsInsensitive` helper without resolving its Unicode limitation.

The implementation needs a deliberate text-comparison contract and its database
representation first. Exact equivalence to every existing browser's default
`localeCompare` is not a single portable contract: the current code specifies
neither locale nor collation options. A server-selected German collation would
be reasonable for this interface, but would be a product behavior decision,
not an invisible optimization. Preserve the existing directory until that is
settled and tested on both providers.

No member data, credentials, external database, browser, publication, or
production environment was used for this investigation.

## Existing contract, verified from code

Sources: `app/api/members/route.ts`, `app/members/page.tsx`,
`lib/server/database-query.ts`, `prisma/schema.prisma`,
`__tests__/members-directory-ui.test.tsx`, and the member projection case in
`__tests__/api/security-regressions.test.ts`.

- The route is public and includes every stored User. It has no discoverability
  setting. Do not copy leaderboard opt-in, test-account, or administrative-role
  exclusions into it, and do not add an authentication requirement as a side
  effect of pagination.
- Only id, name, image, title, role, createdAt, follower count, and skill names
  are selected/returned. Email is neither a search field nor public output.
  Follower identities and other user settings are not returned.
- The UI replaces null **and empty** names with `Unbekannt` before searching
  and sorting. Search is a literal substring after JavaScript `toLowerCase`.
  Name, role, and each skill name participate. The optional location field is
  tested by the UI, but the API supplies none; the schema has no such field.
  Title is displayed but is not a search field. Do not silently broaden search
  to email, bio, title, contact, or private fields.
- Selected skills are exact-name **AND** conditions; selected roles are exact
  **OR** conditions. Search, skill filters, and role filters combine with AND.
- Names use browser-default `localeCompare`; join dates and follower counts use
  numeric order. Defaults are name ascending; choosing a new date/follower sort
  selects descending, and choosing the same sort toggles direction. Equal sort
  values currently inherit the route's createdAt-descending order, whose ties
  have no explicit ID ordering. A future cursor must make ties deterministic.
- Both filter menus are derived from the entire directory, independently of
  search/filter selection. Unassigned taxonomy skills are not included.
- The four statistics describe the whole initially fetched directory, not
  filtered results: total users; users with at least one follower; rounded
  average skill count; createdAt later than the client clock minus 30 days.
  The existing labels `Aktive Mitglieder` and `Neue diesen Monat` overstate
  those latter definitions. Preserve the values; propose accurate labels
  `Mit Followern` and `Neu in den letzten 30 Tagen` with the implementation.
- The result count describes the full matched set. Fetching everything once
  incidentally gives the client a frozen view until a refresh.

## Reproduced blockers

Run `node --test scripts/characterize-member-directory.mjs` with Node 24.
The script uses only an in-memory SQLite database and synthetic names; it does
not import or exercise the application route. Seven passing characterization
checks prove **gaps in naive alternatives**, not a finished implementation.

1. `MÜLLER` matches `müller` in the existing JavaScript search. SQLite `LIKE`
   returns no match, and `lower('MÜLLER')` returns `mÜller`. The project's
   SQLite `containsInsensitive` deliberately relies on ASCII-only LIKE.
2. Null and empty names match `unbekannt` today. A raw name-column contains
   predicate does not match either. The display fallback must be represented
   consistently in filtering, sorting, and cursor keys.
3. `%` and `_` are literal characters today. Unescaped SQL LIKE patterns turn
   them into wildcards. Bind parameters do not by themselves escape LIKE.
4. Even SQLite `ORDER BY lower(name), id` sorts `Zara` before `Änne`/`Özlem`;
   German localeCompare places those names before `Zara`.
5. German and Swedish `localeCompare` order `Änne` versus `Zara` differently.
   There is no exact server replacement for all unconfigured browser locales.
6. A member just after page 1 can be the only skill/role match, the only
   follower-bearing user, and the source of all available skill facets.
7. Offset pagination repeats an existing boundary row after a concurrent
   registration sorts ahead of it. Value-based keysets also survive deletion
   of the boundary row; looking up that row by cursor ID is insufficient.

The installed Prisma SQLite adapter has no documented connection hook for
registering Unicode functions/collations. Reaching through its internal client
property is not a safe production solution. SQLite's default LIKE/collations
and the deployment-dependent PostgreSQL collation cannot be assumed equivalent.
PostgreSQL execution was not tested in this investigation.

## Required decisions before code changes

1. Define one versioned name-order contract, including locale, normalization,
   case/accent treatment, punctuation, null/empty fallback, and tie-breaks.
   The recommended discussion starting point is explicit German alphabetical
   order, with case-sensitive distinctions specified by fixtures. Preserve the
   existing createdAt-descending secondary order for equal names/follower
   counts, adding ID only as the final previously unspecified tie-break. Do not describe this as bit-for-bit legacy behavior.
2. Preserve literal substring search using the current JavaScript lowercase
   semantics (including Unicode and no trimming or accent folding unless
   explicitly agreed). Choose an implementation that works on both providers.
3. Define freshness across page requests: snapshot-like browsing versus a live
   directory. A createdAt cutoff excludes ordinary later registrations but is
   **not** a complete database snapshot: an earlier uncommitted registration
   can commit later, and updates/deletes/follows can change matches or order.
   Do not call a timestamp watermark transactionally exact.

### Viable text implementation options

- **Materialized comparison keys:** versioned search keys computed with the
  agreed JavaScript normalization and persisted for user display names and
  skill names. Query them with a literal substring operation (or correctly
  escaped LIKE). Choose a portable, explicitly specified name sort key, with
  bytewise comparison identical on both databases. A simplistic accent-stripped
  lowercase key is not equivalent to German ICU and must not be substituted.
  If ICU sort keys are selected, use a supported, version-pinned implementation
  and test its deployment/runtime support before choosing it.
- **Matched database collation support:** a supported SQLite ICU-enabled driver
  plus PostgreSQL ICU configured to the agreed locale/version. Verify that the
  providers' comparison and cursor predicates agree with the reference corpus;
  do not assume matching locale names imply matching behavior. This adds a
  deployment dependency and cannot be introduced as an incidental route edit.

The first option allows portable explicit keys but requires schema/backfill and
write-path coverage; the second requires a supported infrastructure contract.
Neither is a small, already verified change. Loading all users into Node to
apply localeCompare, fetching in batches but scanning everyone per request,
or caching the old unbounded result are not accepted substitutes.

## Implementation sequence after the contract is agreed

### 1. Data invariants and migrations

- Add only the comparison/version fields required by the chosen strategy.
  Backfill from existing public name/skill fields without selecting emails.
  Preserve the `Unbekannt` fallback exactly. Migrate PostgreSQL and SQLite,
  including upgrade paths and old installations; do not require reseeding.
- Update registration, admin account creation, self/public/admin profile edits,
  the NextAuth adapter's create/update paths, skill creation/renaming, and seed
  fixtures. Verify every write path, not just the directory reader. Avoid
  indexing arbitrary concatenations whose separators could create false
  cross-field substring matches.
- Add/measure indexes for name-key plus ID, createdAt plus ID, reverse follower
  lookup by followingId, and reverse skill membership by skillId/userId.
  `Follow` currently only has the followerId/followingId unique index;
  `UserSkill` only the userId/skillId unique index. Query plans must verify
  whether proposed indexes actually help; exact global aggregates may still
  scan the database and must not materialize all user records in application
  memory.

### 2. One bounded, typed query contract

Proposed `/api/members?q=...&skill=...&role=...&sort=name&order=asc&cursor=...`
returns `{ members, nextCursor, matchedTotal, stats, facets, asOf }`.

- Return 25 cards plus a one-row lookahead internally. Keep a fixed server cap
  regardless of user parameters. Select only safe public fields. Count skills
  separately and return a three-skill preview per card, because the UI displays
  at most three. Preserve its exact full skill-count badge and all filtering;
  a preview must never become the search/filter source.
- Build a single full-population visibility/filter predicate shared by row and
  matched-count queries. Use EXISTS for skill-name matches and selected skills
  to avoid join fan-out inflating counts. All selected skills must match.
- Compute the four global statistics with aggregates independent of selected
  filters. Never infer any from page length. Use one server as-of time for the
  rolling 30-day threshold. Run related reads in an appropriate transaction
  for consistent per-response rows, counts, and facets.
- Fetch roles and distinct **assigned** skill facets from the entire visible
  population. Do not use Prisma `distinct` without proving it is pushed into
  SQL; client-side distinct can still materialize all membership rows. If
  taxonomy itself can become large, use a separate bounded facet-search API
  with exact counts and accessible load-more, retaining selected values when
  they are outside the loaded facet page. Do not silently cap the menu.
- Name/follower sorts need lexicographic primary-value, createdAt-descending,
  then ID keysets; date sorting needs date-plus-ID keysets. Preserve the current
  createdAt-descending tie order when changing the primary sort direction. A follower count is derived; `take` alone or a simple UserWhere
  predicate cannot provide a matching aggregate keyset. Use parameterized SQL
  or an invariant-preserving counter, with no interpolated user identifiers or
  sort SQL. Store actual boundary values, not merely a cursor row ID.
- Cursor schema: version, query/sort scope digest, boundary key and ID, and the
  agreed snapshot/freshness token. Validate lengths/types/canonical encoding,
  dates, allowed enums, repeated filter limits, and query scope before queries.
  Reject malformed/mismatched cursors with 400 and expired snapshots with a
  defined refresh response. A digest is scope binding, not authentication.
- Response and request caching must not reuse stale account/session results;
  use `Cache-Control: private, no-store` and client `cache: 'no-store'`.
  Public access remains public; account scoping prevents stale UI requests,
  not a new private-data authorization contract.

### 3. Registration and mutation stability

- Value keysets with the full ordering tuple and a unique final tie-break
  prevent existing rows moving between offsets when a new registration sorts before the boundary. Date/follower
  ties require ID tie-breaks too. Test insertions before, at, and after every
  boundary and deletion of the boundary itself.
- For timestamp-bounded browsing, describe the temporal cutoff precisely and
  test equal timestamps and delayed commits. If strict frozen membership is a
  requirement, use a durable bounded-lifetime database snapshot/result identity
  or a carefully serialized registration watermark with proved commit-order
  invariants. Do not hold a database transaction open across HTTP requests or
  put every matching ID into a cursor. Measure storage/cleanup costs before
  choosing persisted result sets.
- Profile/skill edits and follows may change old rows' filter membership/sort.
  Define version invalidation and an accessible refresh path rather than
  claiming keysets freeze mutable keys. Client deduplication prevents duplicate
  display but cannot repair skipped rows. Counts must be clearly live or
  snapshot-wide, consistently with the agreed contract.

### 4. Accessible UI and request ownership

- Source search, selected roles/skills, sort direction/key, and view mode from
  canonical URL state. Repeated skill/role parameters preserve multi-selection.
  Use Next 16 `useSearchParams` under Suspense or a server page wrapper. Keep
  Back/Forward functional. Use replaceState for debounced typing and pushState
  for deliberate filter/sort changes; do not write a history entry per keypress.
- On query/sort or viewer identity change, abort outstanding initial and
  continuation requests and invalidate their generation before displaying new
  results. Logout and loading-to-authenticated transitions count as identity
  changes. Late success/error/finally handlers must not overwrite newer state.
- Separate initial load/error from continuation load/error. Retain already
  loaded cards after a load-more failure and retry the same cursor. Disable
  repeated clicks while pending. A failed continuation is not an empty result.
- Use an actual keyboard-operable button for load more and announce loaded and
  matched counts with a polite status message. After append, make newly loaded
  profile links reachable without sending focus to the very beginning; define
  and test focus placement. Handle the final page without dropping focus into
  the document body. Keep grid/list profile links and active-filter removal.
- Show exact `N Ergebnisse` and separate `X angezeigt` when paginated. Before
  counts arrive show placeholders, never fabricated zero counts. Distinguish
  initial empty, filtered empty, retryable error, and expired snapshot.

## Acceptance matrix before integration

All API cases must run against disposable, migrated SQLite **and PostgreSQL**,
using the real route/query implementation; mocks alone cannot prove collation,
aggregate keysets, isolation, or query cardinality. The characterization script
is evidence for planning only and does not satisfy this gate.

1. 76+ synthetic users traverse all pages once in each of six sort/direction
   combinations; bounded query shape, no unbounded nested user/skill payload.
2. Duplicate names/dates/follower counts, null/empty names, deterministic ties,
   a deleted boundary, new registrations on both sides, same-millisecond
   registrations, and an earlier transaction committing between page requests.
3. Names/skills containing Ä/ä, Ö/ö, Ü/ü, É/é, ß/SS, İ/i plus combining dot,
   Turkish I/ı, Greek sigma variants, combining marks, emoji, punctuation,
   non-Latin scripts, and mixed case. Expected results come from the approved
   reference contract, not whichever database is under test.
4. Literal `%`, `_`, backslash, quotes, leading/trailing spaces, and empty query;
   no wildcard, SQL injection, or cross-field concatenation matches.
5. Name, role, and skill search match beyond page 1. Null/empty names match
   `Unbekannt`. Title, email, password, bio, contact, and follower identity do not
   become searchable/output. Anonymous and signed-in visibility remains equal.
6. Multiple selected skills use AND, roles use OR, combined with search;
   unassigned skills are absent from facets; assigned skills solely on later
   pages remain discoverable; counts/facets stay complete with zero matches.
7. Global stats match explicit fixture aggregates, including zero members,
   fractional average rounding, exact 30-day boundary, and members without
   followers. A filtered response never changes global definitions.
8. Profile/name/skill changes, follows, account deletion and expired/altered
   cursors obey the agreed freshness/invalidation policy without silent skips.
9. All cursor/error cases reject safely: unknown sort, negative/huge limit,
   malformed/cross-filter cursor, invalid dates, excessive filter arrays,
   duplicate values, stale snapshot, empty final page, and DB failure.
10. React tests: initial load, beyond-page search, complete facets, URL deep link,
    Back/Forward, typing debounce, changed filter mid-flight, late stale success
    and rejection, account A to B/logout, unmount abort, double load-more,
    continuation failure/retry, final-page focus, accessible names/keyboard,
    grid/list, initial empty, filtered empty, and initial retry.
11. Real HTTP smoke using synthetic DB data verifies route serialization and
    no-store headers. A production build proves the useSearchParams/Suspense
    boundary. Run focused tests, full typecheck, full lint, and integration
    suites after final code/conflict changes. Actual browser checks, when run,
    must distinguish keyboard/behavior checks from visual validation.

## Investigation validation

- Read the repository AGENTS.md and installed Next 16 route-handler,
  useSearchParams, and native-history navigation documentation before edits.
- `node --test scripts/characterize-member-directory.mjs`: 7/7 pass.
- Focused ESLint on the characterization script with `--max-warnings 0`: pass.
- Full `npm run typecheck`: pass using the existing full-integration dependency
  overlay. The initially selected older integration dependency overlay had a
  stale generated Prisma client; switching only this worktree’s symlink fixed
  that environment mismatch without modifying shared dependencies.
- Existing member UI and API security regression suites: 2 suites / 18 tests
  pass. These verify the unchanged application baseline, not a new API.
- `git diff --check`: pass. No full test-suite, build, PostgreSQL runtime, or
  browser/visual QA claim.
- Only this plan and the synthetic characterization script are proposed for
  commit. No bounded endpoint or UI implementation is claimed.
