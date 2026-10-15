# Author-selected discussion solutions

This is a small discussion-quality signal. An accepted solution means the discussion's author chose one existing reply. It is not staff verification, a credential, a points event, or a statement that the answer is objectively correct. Likes remain separate. There is no leaderboard, badge, public profile counter, reward-ledger entry or notification for selecting a solution.

## Rules and permissions

- Only the authenticated, currently stored post author can select, replace or remove a solution. Current ADMIN, MODERATOR and INSTRUCTOR accounts have no override on another author's post.
- Selecting requires a published post and an existing reply belonging to that post. The reply author must differ from the post author and must not be a test account. Raw test classification is never returned; the derived eligibility capability is sent only to the actual author of a published post. The server derives actor identity from the session and rereads the user and target inside the transaction.
- Hidden/draft posts cannot acquire a selection. An author can remove a retained selection after a post becomes private. Public reads already exclude drafts; authorized draft reads expose no solution, no selected count, and no selection revision to anyone except the actual post author. The author's revision is only an edit-state token.
- If the selected reply author later becomes a test account, subsequent reads suppress the signal. The original author can remove the selection. Self-replies never qualify.
- Reporting remains unchanged. Reports are not proof of wrongdoing, and merely filing one does not remove a solution. Existing moderation decisions and content removal retain their own permissions.

## API and state

PUT /api/posts/{postId}/solution accepts a bounded JSON object with commentId (reply ID or null to clear) and expectedRevision (last-seen revision or null when there is no selection). Cross-origin browser requests are rejected with the existing same-origin guard.

The response contains changed and an authoritative post. A repeated desired state is a no-op, including replaying the same successful request with its original revision. Replacing/removing a different current state requires the exact last-seen revision. A stale edit returns 409 with the requesting author's current post so the UI can refresh and request an explicit retry; it never silently overwrites another choice. Client code uses server state, preserves loaded replies and pagination cursors, disables controls while saving, shows accessible pending/error feedback, and ignores aborted or old-account responses.

Eligibility, ownership, current-state CAS and decision insertion share one serializable transaction. Known serialization/unique-key races are retried at most four times, rereading permission and state on every attempt. CAS validates updates/deletes; the primary key protects competing first selections. A target removed during the transaction returns an unavailable-target error. No caller-supplied actor, timestamp, audit action or reward value is accepted.

Post responses carry acceptedSolution, acceptedSolutionCount (0 or 1), and solutionRevision. The accepted reply is a separate one-row relation include. The ordinary initial feed remains capped at 50 posts, comments remain a three-row preview, and subsequent comment pages remain capped at 50. An old accepted answer is visible without scanning pages, shifting a cursor, adding it to the preview, or changing commentCount. Its body renders once: in the solution panel while collapsed/not loaded, or in its ordinary comment card when expanded and loaded.

## Storage, reversal and erasure

PostgreSQL upgrade 0006_accepted_solutions.sql and SQLite migration 0007_accepted_solutions.sql add:

- Comment(postId,id) unique index, enabling a composite same-post foreign key
- AcceptedSolution, keyed by postId, with unique commentId and revision
- AcceptedSolutionChange, containing a unique transition ID, SELECTED/CHANGED/CLEARED action, server timestamp, and nullable actor/post/previous-comment/current-comment references

Both providers use the same SQL-only action CHECK constraint; Prisma schema files remain compatible without pretending that Prisma generates this CHECK. Deploy through the reviewed migration runner. No existing rows, likes, rewards or content are changed or backfilled.

A successful choice or reversal creates one server-owned decision record in the same transaction. No API edits/deletes historical decisions. New UUID revision tokens prevent deletion/reselection from reusing earlier audit versions. The audit describes user decisions, not automatic deletion as if the user made a new choice.

Deleting the selected reply, its author, or the post cascades away the current signal. Deleting an actor or any referenced target SET NULLs that audit reference. No deleted actor/recipient identity snapshot or comment text survives in these tables. Account-erasure paths therefore do not gain new retained user IDs. Remaining anonymized timestamps/actions describe transition history without restoring the deleted target or creating public reputation. Re-selecting after reply deletion requires no old revision and creates a new transition.

## Private, current discussion milestones

The community sidebar additionally offers the signed-in member a private view of current author selections, with milestones at 1, 3 and 5 different discussion authors. These are reversible progress indicators, not permanent achievements or proof of answer quality. They create no points, ledger entries, badges, public ranking, profile/directory/search exposure, notifications or new database schema. No author/reply identities are returned by this private summary.

GET /api/contributions/me accepts no query parameters or other-account identifier. It derives the account solely from the current authenticated session, rereads the stored account, and returns exactly eligible, selectedByAuthors and saturated. All success and error responses use Cache-Control: private, no-store and Vary: Cookie; the route is dynamically executed. Anonymous sessions return 401, removed accounts 404, query parameters 400, and failed session/database reads 500. Errors never become a zero count. Stored ADMIN, MODERATOR, INSTRUCTOR or test accounts receive eligible: false with zero and no progress indicators, regardless of a stale session role claim.

The read transaction uses only live Post → AcceptedSolution → Comment relations. The post must currently be published; the contributor and post author must currently be different, non-test USER accounts. It groups qualifying posts by their authorId in the database, orders those groups deterministically, and limits the returned groups to five. Multiple selected replies in discussions by the same author count once. This deliberately avoids Prisma findMany distinct's potentially client-side deduplication and growing transfer size. Five qualifying authors is displayed as 5+, because the query never tries to establish a total above the cap. The grouping operation can still scan qualifying database rows; the transferred/result cardinality, not database execution time, is bounded.

Every new read reflects replacing or clearing a selection, reply/post/account deletion, unpublishing and changed account eligibility. Decision-history records are never consulted. A report alone, including its review status, cannot subtract progress. Existing independent moderation/content-removal rules continue to apply.

The client requests no-store reads, clears old-account and superseded-read displays immediately, aborts interrupted requests, and ignores late responses. A successful local post creation/edit/deletion, comment creation or solution selection/clearing refreshes the summary. Likes do not. Window focus and a return to a visible page refresh it; the user can also update manually. Cross-account changes do not push live notifications, so an already open page updates on the next refresh/read. Loading, retryable errors, ineligible accounts and genuine zero progress have separate copy. The 1/3/5 list, native progress element and ordinary keyboard-operable buttons use no animations or reduced-motion-sensitive effects.

Private contribution regression suites exercise live eligibility, session boundaries, repeated selection/reversal, repeated-author grouping, all thresholds, 5+ saturation, query rejection, generated SQLite GROUP BY/LIMIT SQL, deletion/publication changes, report independence, no reward/notification writes, loading/error/retry, abort/reset and local-mutation/focus refresh. The guarded e2e/private-contributions.pw.ts journey is discovered by the existing disposable SQLite browser-qa job for desktop and 320/390px viewports. The new journey is CI-only until an allowed browser run supplies actual execution evidence; listing or compiling it is not browser QA. PostgreSQL runtime validation remains a separate release check.

## Verification and release boundary

Regression coverage includes anonymous/deleted actors, owner versus staff/non-owner, self/test/foreign/missing replies, hidden post and stale ADMIN reads, repeated desired states, replacement/reversal, conflict state refresh, concurrent first/identical selections, old selected replies with page-size/cursor guarantees, reply/post/account cascade and audit anonymization, malformed/cross-origin input, keyboard controls, repeated clicks, pending/error/retry state and account-switch interruption.

Migration suites exercise fresh and populated SQLite deploy, no backfill, named FKs/indexes, CHECK/unique/same-post rejection, existing rewards/community preservation, replay, checksums and erasure. PostgreSQL scripts carry corresponding reviewed schema/catalog/upgrade/deletion tests. Run them only against the required disposable local forge_test database; a syntax check is not a PostgreSQL runtime pass.

Typical isolated checks:

    DATABASE_PROVIDER=sqlite DATABASE_URL=file:/absolute/disposable/test.db npm run db:generate
    DATABASE_PROVIDER=sqlite DATABASE_URL=file:/absolute/disposable/test.db npm test -- --runInBand
    npm run typecheck
    npm run lint -- --max-warnings 0
    node scripts/generate-sqlite-schema.mjs --check
    node --test scripts/check-sqlite-migrations.mjs

The production build uses the appropriate generated provider client. Live PostgreSQL concurrency and actual desktop/mobile browser QA remain independent release checks. No publication, deployment or merge is implied by local implementation.
