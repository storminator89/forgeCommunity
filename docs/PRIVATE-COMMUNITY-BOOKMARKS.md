# Private community bookmarks

A member can save currently published global posts and individual comments. Their own private Merkliste lives at `/community/saved`, with all/post/comment filters. Space, mission, course, chat and event records are separate. This feature produces no notifications, read receipts, rewards, public counts or administrative reports.

## Data and authorization

`CommunityBookmark` references exactly one existing Post or Comment and its owning account through real cascade foreign keys, with unique account/target constraints. `savedAt` is server-owned. No target text, notes or identities are copied into the table. An unsaved row retains only current CAS state, not an action history. Deleting the account or target removes the entire row, including its tombstone and latest request UUID.

Session identity is the only account input. Each operation checks that the account still exists. Drafts are unavailable even to their author or an administrator through this feature. A comment's current parent must be published. Hidden and missing targets are indistinguishable. List filtering happens in the database before the 30-row keyset limit; no totals are exposed. The 200-target status batch is bounded and does not create data. Personal success, error and redirect responses use private/no-store and Vary: Cookie. Mutations and batched POST reads use the existing same-origin guard and bounded body reader; the existing in-process quota is a single-instance guard, not a cluster-wide control.

The native Saved link points to GET `/api/community/bookmarks/{kind}/{targetId}`. It freshly checks the account, saved row and published parent before issuing a private 303 to `/community#post-ID` or `/community#comment-ID`. The existing linked-comment resolver retrieves an older comment outside the three-comment preview. Opening a stale or removed bookmark returns the same unavailable result as an unknown target.

## CAS and replay

PUT accepts exactly `{saved, expectedRevision, requestId}`. The request UUID identifies only the latest write to that target. A new state begins at revision 0; each committed write advances the revision. Even a first unsave creates a fence against an in-flight first save. An exact replay of the latest committed request returns the same state. After a later mutation, the old request conflicts and cannot resurrect the former save. A UUID reused with a changed payload conflicts. There is no request-history table and no automatic mutation retry, including after an uncertain network result. The client reads current state before another deliberate write. Serializable/uniqueness conflicts are returned as 409; unrelated failures remain generic errors.

Cursor payloads carry a savedAt/id boundary signed with the configured NEXTAUTH_SECRET, account and filter. They cannot be moved between accounts/filters or altered. Boundaries remain usable if their row is deleted or unsaved. Secret rotation invalidates older cursors; reload the list. Equal saved times are ordered by id.

The UI has a synchronous account-keyed boundary, aborts obsolete requests and fences late read/write completions with a target epoch plus monotone server revision. It never optimistically claims success. An uncertain write offers “Stand prüfen”; that performs a read, not a retry. Keyboard focus uses the existing action-focus helper and does not override newer navigation. Controls retain visible labels on touch.

## Design and artwork

The open divided list uses Forge's existing Inter, petrol, coral and light/dark semantic tokens. No per-item illustration or new animation is introduced. The optional empty-state illustration is decorative beside a real heading and Community link. It was generated with OpenAI's image tool for this feature, preserving the established community characters. The unchanged source PNG SHA-256 is `ce706a1293d1df65f25e285833f3d803878d0eb9ced59adb1e48085c1db5e92f`. The transparent 480×360 WebP (36 KB), displayed at 240×180, has SHA-256 `d19c2699082037262d4ea75e8263ded1c1f717b338199cc6635a63aed8d882f2`.

## Verification boundary

Focused real SQLite tests cover CAS/replays/races, account/target cascades, database shape/FK constraints, visibility, bounded queries, filtered equal-time keysets, deleted boundaries, signed-cursor tampering and route guards. UI tests cover account-switch/in-flight races, late reads, pending duplicate clicks, network uncertainty and bounded batches. The disposable PostgreSQL harness is opt-in, requires the existing validated loopback `forge_test` URL and creates/drops only a random test schema. A PostgreSQL pass must come from that real provider, not SQLite or mocks.

This provisional local composition applies SQLite 0030 and PostgreSQL 0029 after the still-unmerged PR83 predecessor tails. The database suites require the actual numbered feature table and never create a fallback table from an unnumbered fixture. Migration/readiness tests validate receipts and live table, CHECK, FK, null/default and index ownership shape, including populated predecessor data and drift rejection. These numbers do not establish an accepted upstream or publication approval. Final migration/readiness, whole-project type/lint/test/build and real responsive/browser acceptance must run on the exact composed commit. Source tests do not certify 320px/200%, light/dark artwork edges, native focus, older-comment navigation, or runtime regressions in feed pagination, solution selection and moderation.
