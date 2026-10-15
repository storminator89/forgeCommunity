# Skill search discovery

The authenticated global search now includes the existing Skill taxonomy. This
closes the skill-discovery gap recorded in the P1 redesign plan; it does not add
a new skill model, migration, external provider, or member-disclosure contract.

## Search contract

- `/api/search?query=TypeScript&type=skill` matches skill names and categories
  using the existing provider-aware substring helper. Exact names also match;
  SQLite's existing ASCII case-insensitive behavior is retained. PostgreSQL uses
  Prisma's explicit insensitive mode. This change does not introduce Unicode
  normalization, fuzzy matching, or a relevance score.
- As with other typed searches, queries are sanitized and limited to 120
  characters, queries shorter than two characters return no results, page is
  clamped to 1–1000, and limit is clamped to 1–20. The typed total and pages count
  use the identical name/category predicate. Skill pages use stable name/id
  ordering because the taxonomy has no creation timestamp.
- All returns at most five skills, alongside at most five of each existing
  content type. Its existing `pagination.total = 0` convention remains: the UI
  counts the displayed preview and tells users to choose a category for more.
  Skills have `createdAt: null` and appear after dated results, with no invented
  recency. Results select only taxonomy id, name and category, with a sanitized,
  bounded directory/category snippet. They do not join users, expose member
  identities/counts/endorsements, or search account email fields.
- The API requires an authenticated account id before any lookup. Success and
  short-query responses remain `private, no-store`.

## Navigation and privacy

The new “Fähigkeiten” tab accepts `/search?q=…&type=skill&page=…`, uses the existing
accessible scrolling tab list, and retains the typed paging/history behavior.
Each skill result is a real keyboard-operable link to `/skills?query=<name>`.
Category matches still link to the actual matched skill name, so a broad global
category query leads to people with that specific skill.

The directory initializes its name/skill filter from `query`, updates that
parameter while typing, preserves unrelated URL parameters and hashes, and
responds to later same-route navigation and Back/Forward. Native history updates
use the installed Next router's documented integration. Delayed router renders
cannot overwrite a newer keystroke. Typing uses replaceState to avoid one history
entry per character. Existing category selection and sorting keep their behavior;
they are not new URL parameters. Filter reset removes the query, clears category
selection, and returns focus to the search input. An unused taxonomy skill leads
to the honest “Keine passenden Mitglieder” state and a reset path.

The directory still remounts all viewer-specific data, details and endorsement
state when the account changes, and aborts former-account directory reads. Only
the ordinary, shareable URL filter persists across that boundary. No extra
member data is fetched for global taxonomy results. Global search now also
remounts its result state at an account transition, aborts old searches and hides
results on logout. A new viewer starts from the current URL rather than stale
navigation props; no search read is started before authentication is established.

## Verification scope

- Jest covers actual disposable SQLite/Prisma exact/substring/category matches,
  stable ordering, totals, pagination and caps; real sanitization and minimal
  fields; anonymous/partial sessions and email-only non-enumeration.
- UI tests cover the ninth tab, encoded skill link and keyboard activation,
  typed paging/history, directory deep links, category interaction, later URL
  navigation, delayed router values, reset focus, account changes and aborted
  former-account responses in both search and directory. Touch/reflow classes are asserted structurally;
  these assertions do not measure real browser geometry.
- `e2e/skill-search-discovery.pw.ts` is a CI-only journey guarded by a loopback
  origin, explicit disposable SQLite flag and the dedicated fixture filename.
  It creates only synthetic fixtures in that database, exercises keyboard
  navigation/reset/Back/Forward, and checks light/dark reflow at 320, 375, 414,
  768 and 1280 pixels plus 200% text sizing. Screenshots are produced only when
  the actual journey runs. Local test discovery is not browser or visual QA.

Full source Jest, lint and typecheck must pass on the final integrated source.
Production build and HTTP smoke belong to the coordinated integration checks.
PostgreSQL runtime and actual browser results remain unverified until those
checks run in a supported environment; this document does not claim green CI,
WCAG conformance, publication, merge readiness or deployment.

Local source checks on 2026-10-15 passed: full Jest **120 suites / 833 tests**,
TypeScript typecheck, ESLint with zero warnings, and `git diff --check`.
Playwright discovered the new journey in all three configured projects. No
browser process, screenshot journey, PostgreSQL runtime or production build was
run by this isolated lane; integration owns the coordinated build/HTTP checks.
