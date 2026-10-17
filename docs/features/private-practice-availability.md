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

## Verification scope

Focused pure clock, real SQLite API, and component regressions cover review intervals, one/two/larger pools, inclusive repeat boundaries, session caps/exclusions, read-only GET, stale/future heartbeat, closure replay/races, live publication failures, refresh and abort behavior. The existing PostgreSQL learner HTTP smoke is extended for effective return metadata, no-read writes, close authorization/replay, and retention outages. A companion genuine disposable browser journey exercises opt-in, answer, waiting, keyboard refresh, reload, fixture-window advancement, explicit reopen, outage recovery, and enrollment revocation; it captures desktop/320px in both themes. Browser/PG execution and original-pixel review belong to the central exact-tree CI gate and are not implied by source tests alone.
