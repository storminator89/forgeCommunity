# Private practice availability

The course's existing voluntary practice entry and workspace now share a server-owned, read-only availability projection. This is a return-window display, not a change to review timing, assessment, rewards, or retention policy.

## Additive learner DTO

Existing `status` values remain, with `unavailable` added when an opted-in, unpaused learner cannot practice because the retention heartbeat is missing, stale, invalid, or too far in the future.

- `availability`: `notOptedIn`, `paused`, `ready`, `resume`, `waiting`, `sessionComplete`, or `unavailable`.
- `dueCount`: questions selectable now, limited to remaining session capacity. A pending reservation is represented by `resume`, not counted again as a new question.
- `nextAvailableAt`: effective ISO timestamp or null. Ready/resume and unavailable states use null. An exhausted active session describes availability after explicit closure in a fresh session.

The effective time combines persisted due dates with the existing latest-two-reservations rule. The 24-hour SQL horizon is inclusive, so an item remains excluded at exact equality and becomes eligible one millisecond later. All items shown in an active session remain excluded until that session closes. Mismatched schedule/item revisions have no speculative return date. Missing or unmatched active publication/pool has zero availability and no date.

GET does not opt in, reserve, close sessions, update last activity, or repair rows. The server projector is also used by the existing reservation selector, preventing display/selection drift. Answer interval calculation is unchanged: wrong 5/10 minutes, correct uncertain/guessed 6 hours, otherwise the existing bounded 1–30-day progression.

## Explicit actions and privacy

Refresh only reads. Questions open only through an explicit question action. Feedback and finish re-read the live state, so a completed session ID or old pool cannot be reused accidentally. An outage or failed live read clears usable private question/feedback state. Requests are aborted on account-bound workspace unmount.

`POST /api/courses/:courseId/practice/learner/close` accepts only `{sessionId}` (1,024-byte object limit). Live enrollment, session ownership and the current matching snapshot are required. A pending reservation prevents closure. ACTIVE/no-pending closure uses id/status/version/pending-null CAS; COMPLETE replays successfully. It changes only the session status/version and never selects/reserves or updates activity. Same-origin protection remains in the shared API proxy. Refresh and “Für jetzt beenden” do not call selection.

No learner answers, confidence, question keys, or practice performance enter instructor views, analytics, profiles, rewards, or public feeds. Existing pause, opt-out, reset and retention behavior remains available.

## Interface decisions

Use the installed Inter hierarchy and the app's petrol action/focus tokens, quiet reading surfaces, existing coral/social and sun/earned-reward roles. Do not add reward styling to private practice. Keep the existing left-aligned workspace and one compact return/count sentence with a clearly named refresh button. Display dates in the viewer's local time, with “Voraussichtlich” and a local-time label rather than promising exact memory decay. Controls wrap at 320px, keep visible labels and keyboard focus, and introduce no motion.

Review of the initial plan removed a separate dashboard/card and a raw “next due” label: both would obscure the existing voluntary course-local flow and the unchanged anti-repeat rule.

## Bounded objective-aware ordering

After the immediately preceding committed answer in the current session is wrong with confidence `SURE`, the selector prefers the first already-eligible different item with the same `objectiveId` and `objectiveRevision` in that exact immutable snapshot. Eligibility and its existing dueAt/itemId order are unchanged. The preferred subset keeps that order; no matching candidate means the ordinary first candidate. Other confidence values, null and correct answers do not trigger priority. No cross-session queue or objective mastery model is stored.

Legacy missing/invalid objective metadata is unknown, never inferred from titles or coerced from string revisions. It receives ordinary selection. All item/grading checks remain fail-closed. Current authors still validate immutable objective references strictly. Recent-two inclusive 24-hour exclusions, all current-session item exclusions, revision checks and the ten-answer cap are unchanged. A due date of five minutes is not a promise of availability after five minutes. The effective estimate may change with later reservations, the published pool or access/service state; refresh remains server-owned.

The private GET adds only an optional `questionContext: sameObjectiveAfterConfidentError` on the pending question. One bounded predecessor proof within the existing read snapshot checks the exact preceding ordinal, committed false/SURE answer and both pinned item/objective revisions. Ambiguous or invalid optional proof omits context. This is a factual relationship, not a claim about the algorithm that originally selected an old pending question. Reload does not reserve or write anything. Objective identifiers, previous answer choices and keys are not added to the browser DTO; no trainer or analytics endpoint changes.

Different item IDs are not evidence of independent scenarios or delayed transfer. The copy says only “andere Frage zum selben Lernziel”. Answer feedback/replay DTOs remain unchanged in this slice; no stale receipt is used to promise currently available alternatives. The next available question can address a different objective. No person diagnosis, Area9 parity, validated calibration or mastery claim is made. Session completion explicitly is not proof of all-objective mastery.

### Required content and release gates

Before release, authorized authors must inventory DISTINCT item IDs per `(snapshotId, objectiveId, objectiveRevision)` in the intended published pool, and review at least two curated variants for each intended remediation objective. Two IDs are only a structural minimum: independently review reasoning/scenario, answer key and explanation. One item or unknown metadata is a coverage gap, not successful remediation. No live coverage count is claimed by this draft. No automatic generated questions, schema migration, historical snapshot rewrite, learner identity or enrollment creation is authorized.

## Verification scope

Earlier local pure-clock/SQLite/component/PG/CI plans are historical documentation, not current permission or current evidence. All new functional acceptance is exclusively on the exact published Sites version with Cloudflare D1. Builds and typechecks establish compilation only. No local functional tests, new GitHub CI runs, timestamp advancement or fabricated learner roles are permitted.

Published acceptance must record version, deployment, source commit and a genuinely authorized enrolled USER. If access/content prerequisites are absent, mark BLOCKED, not PASS. Independent exact-patch review and authorized publication are required before these cases can run:

1. Wrong+SURE A, eligible same-objective B and earlier-due unrelated C: explicit next selects B; A never repeats. Verify stable dueAt/itemId ordering inside the matching subset.
2. Wrong with each other confidence/null and correct+SURE retain ordinary ordering. Missing metadata, same title/different ID, different objective revision or snapshot never establish a match.
3. Pools of one/two/three, future-due/recent-two/already-shown alternatives: retain exclusions and ordinary fallback or clean completion. Do not invent a return time or a coverage claim.
4. Pending reload returns exactly the same reservation and truthful optional context. Old pending reservations may receive context only if the relationship is proved. GET/refresh is read-only.
5. Ten-answer bound, explicit close, two-tab next/next and answer/next, exact-body replay, mismatched replay, lost-response recovery: preserve one active session, exact-once answer/reservation, counts and CAS. Never retry an unknown write blindly.
6. Authorized pause/opt-out/revocation/republish, retention failure, foreign IDs and post-completion replay: preserve existing fail-closed access and immutable feedback, no stale session revival. Mark scenarios lacking permission untested.
7. Actual effective return windows, including inclusive 24h where feasible, observed without manipulating D1 dates. Source reasoning alone is not runtime verification.
8. Desktop/320px, keyboard and both themes; no forced confidence, false diagnosis/mastery, score/XP/certificate change or private practice data in trainer/analytics outputs.

Keep static review, compiler results, observed published results and blocked/unexecuted cases separate. This bounded immediate-predecessor priority can postpone other due items within a ten-answer session; it is not a claim of optimal fairness or pedagogy. Rollback removes code only; no data repair is necessary.
