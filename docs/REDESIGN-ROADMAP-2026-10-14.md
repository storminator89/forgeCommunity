# ForgeCommunity redesign and product delivery plan

Status: implementation in progress. This plan records observed repository behavior and measurable release gates; it does not imply the redesigned pages or features have shipped.

## Product direction

ForgeCommunity should feel like a useful workshop for learning, asking good questions and making things together. The differentiator is a trustworthy loop from discovering a course or discussion, through meaningful participation, to verifiable progress and helpful recognition. The UI should use one accessible design system, with distinct page structures suited to each job instead of one repeated dashboard/card template. The [competitive benchmark](COMPETITIVE-BENCHMARK-2026-10-14.md) records vendor-documented comparisons and source-backed gaps.

The existing Next.js App Router, Prisma, NextAuth, German-language content, data models and route boundaries are retained. Hallmark v1.1.0's multi-page flow informs a shared `design.md`, responsive checks and page-by-page structure. Do not delete route trees or replace production data to achieve the redesign. Paid courses must not be enrolled through a free-join path. Work remains in draft pull requests until reviewed; this plan does not authorize a merge or deployment.

## Release gates used for every affected page

Each route is assessed individually. A page is marked done only when:

1. Its primary job, visible next action, empty/loading/error state and responsive layout have been checked with realistic, clearly identified fixture data.
2. Keyboard-only use reaches every action in logical order, focus stays visible, headings and landmarks make sense, labels and dynamic status are announced, reduced motion is respected, and text/control contrast is checked against WCAG 2.2 AA criteria. Test at 320, 375, 414 and 768 CSS pixels and a wide desktop viewport with no horizontal page scroll.
3. Authenticated, anonymous, member, instructor, moderator and administrator states relevant to that route are checked. Server authorization is tested independently of hidden UI controls.
4. The changed flow has focused regression tests. On the integrated branch, lint, TypeScript, Jest and production build run against the final code; passing a focused test is not a full-suite pass. Critical journeys get a real-browser keyboard and screenshot pass.
5. No fabricated testimonials, metrics or fake “live” states are introduced. A screenshot of the actual app is required before claiming visual QA.

Target operational metrics after instrumenting a representative deployment: p75 LCP at most 2.5 seconds, INP at most 200 ms and CLS at most 0.1, separately for mobile and desktop. These are targets, not measurements of the current app.

## Route-by-route design inventory

| Route | Page job and redesign emphasis |
| --- | --- |
| `/` | Introduce the product and give new/returning people one clear next action. |
| `/about` | Explain purpose, governance and the community's actual capabilities without invented proof. |
| `/login`, `/register`, `/logout` | Accessible auth, form errors, safe return path and interruption/retry handling. |
| `/community` | Scan, filter, ask and reply; readable density and a useful empty feed. |
| `/members`, `/profile/[id]` | Discover people through consent-aware public fields; connect and distinguish own profile. |
| `/chat`, `/notifications` | Clear conversation/inbox states, exact destinations and accessible unread/status feedback. |
| `/search` | Keyboard-operable results, query/filter persistence and cross-type discovery. |
| `/courses`, `/courses/new` | Understand course availability, price and join state; create with clear field semantics. |
| `/courses/[courseId]`, `/courses/[courseId]/contents` | Explain course and move through server-verifiable learning without dead-end certificate actions. |
| `/events` | Browse by time zone, RSVP/cancel where allowed, understand capacity, then export to calendar. |
| `/knowledgebase`, `/knowledgebase/[id]` | Find and read answers with strong reading hierarchy and accessible search. |
| `/knowledgebase/new-article`, `/knowledgebase/drafts` | Draft, resume and publish with clear save/error feedback. |
| `/knowledgebase/[id]/edit`, `/knowledgebase/edit/[id]` | Bring both existing edit URLs to an accessible, consistent editor while preserving routing. |
| `/projects/new`, `/projects/[projectId]` | Create and review projects. The experimental `[id]test` source was removed after the generated Next routes manifest showed it was shadowed by `[projectId]`. |
| `/showcases` | Browse work with useful metadata and readable project previews. |
| `/resources`, `/resources/[id]` | Find and inspect resources with meaningful source/action labels. |
| `/skills` | Explain skills and endorsement meaning; give the page one visible primary heading. |
| `/settings` | Make saved preferences, privacy and notification effects understandable. |
| `/verify-certificate/[certificateId]` | Verify credential status truthfully, without exposing unnecessary learner data. |
| `/admin/dashboard`, `/admin/users` | Efficient, permissioned operations with keyboard-reachable tables and no nested main landmark. |

There are 33 `page.tsx` files as of base commit `7814799`; several delegate most UI to client components. This list groups related routes but the QA gate applies to each file individually.

## Prioritized implementation waves

### P0: Make the existing product trustworthy

- **Design foundation and page audit:** publish shared tokens, typography, navigation and accessible primitives; then implement each route family under the gate above. Prove the critical routes with real screenshots, not static mockups. Stop page work that would destroy an existing function or change storage semantics.
- **Free course enrollment:** an authenticated learner can join/leave an available free course; capacity is enforced transactionally; retries and repeated clicks do not create duplicates. Priced courses cannot enter through this path. Course cards show the learner's state and point to a reachable next step. Listing data does not expose other learners' IDs. Test anonymous/member/instructor/admin and simultaneous last-seat attempts.
- **Learning truth:** replace localStorage-only credential eligibility with per-user, server-stored lesson/quiz progress. Repeated completion is idempotent; required graded steps cannot be skipped; course completion and certificate issuance derive from validated server state. Test cross-device resume, tampered requests, course edits and repeated certificate calls.
- **Event RSVP:** signed-in members can RSVP/cancel once, see capacity and time zone, and cannot overbook the final place during concurrent requests. Only authorized editors see edit controls. ICS remains available.
- **Privacy and safety:** remove ordinary user-email substring search, test that an email-only query cannot reveal account existence, and create a small report/triage workflow with role-limited actions and an auditable resolution state.
- **Critical accessibility defects:** replace click-only search results and admin rows with semantic keyboard targets, fix heading/landmark/label gaps, and validate reflow/focus/status on join, course, RSVP, report and admin paths.

P0 exit evidence: new-member browser journeys from registration to first discussion/course/event; focused authorization/privacy/concurrency tests; integrated lint, typecheck, Jest and build; keyboard and 320px screenshots for the critical routes. Failed or unrun checks remain explicit blockers.

### P1: Coherent engagement

- Expand search to the existing article/project/skill content types with useful filters, stable query state and source-backed relevance rules.
- Give new members a skippable, interest-aware first-action path; preserve existing data and avoid forced profile disclosure.
- Emit relevant server-side notifications for actual events, link to exact items, and verify saved mute/email/push preferences on the delivery path. Use reliable polling before claiming real-time behavior; the current SSE endpoint returns 501.
- Introduce an explicit solved/helpful-answer signal and quality-based contribution recognition.
- Add a server-owned, idempotent reward ledger with reversals and rate/abuse limits. Existing Badge/UserBadge schema alone is not an award system. Learning progress stays private; public ranks are opt-in and staff/test accounts are excluded.

P1 exit evidence: repeat/reversal and privacy tests; notification destination and preference tests; search coverage tests; a keyboard/browser pass of all affected routes.

### P2: Deeper, responsible participation

- Skill paths, cohort challenges and group goals driven by validated participation rather than click counts.
- Optional streaks with pause/resume, no shame or punitive loss; accessible celebration with a reduced-motion path.
- Time-windowed, explainable rankings and admin insight into abuse/reward reversals. No automatic moderator powers based on points.
- Profile, settings, admin and public content refinements after measuring real use and performance.

P2 exit evidence: abuse simulations, fairness/privacy/accessibility review, and measured improvement in completed learning or helpful answers rather than raw posting volume.

## Current verification notes

The initial source audit found a localStorage-only course visit record, a certificate route requiring server-side `Enrollment.completedAt`, no enrollment or RSVP write path, a leaderboard based on raw activity volume, and an ordinary member search that queries email substrings. These are implementation hypotheses until each changed flow passes tests and browser verification. Existing notification preferences appear persisted; whether all delivery paths honor them requires testing.
