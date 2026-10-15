# ForgeCommunity release handoff and review order

Status on 2026-10-15: **draft stack through #24 plus a final integration branch in publication, not shipped or merge-ready**. The clean main baseline is `7814799e6f60639ed90de08b285c8bed8a414ee1`. The last application-code commit is `521aa21c0213c5f12564310ce7a0f075b2cc9434`; CI was subsequently corrected at `bfad62a` and guarded at `ea30b57`. The final integration branch must still prove those CI changes on GitHub Actions.

The conceptual packages below describe reviewer dependencies, while the actual published cuts follow the repository's chronological commit order. The latter are **not** seven independent feature packages and must not be presented that way. No merge or deployment is approved. The interrupted #24 upload resumed after a specific user approval and was verified against its local source tree. A separately approved fresh registry audit remains blocked by tooling after renewed user confirmation; do not claim an updated comparable audit result or bypass that restriction.

## Existing published drafts, verified by read-only GitHub metadata

| PR | Current scope/base | Treatment before integration |
| --- | --- | --- |
| [#6](https://github.com/storminator89/forgeCommunity/pull/6) | Earlier course enrollment, progress and automatic certificates; `main`; open draft | Preserve for review; its learning flow overlaps #16–17 and predates the integrated certificate and account guards. |
| [#11](https://github.com/storminator89/forgeCommunity/pull/11) | Product plan and competitive benchmark; `main`; open draft | Keep as a planning review. Refresh the roadmap only after reviewing new local evidence; it is not implementation proof. |
| [#12](https://github.com/storminator89/forgeCommunity/pull/12) | Design foundation/public/auth; `main`; open draft | Review as UI foundation, then restack or supersede against the agreed implementation base. Its current head predates the completed route work and contrast corrections. |
| [#13](https://github.com/storminator89/forgeCommunity/pull/13) | Search privacy/keyboard; `main`; open draft | Preserve its privacy test while integrating the expanded article/project/skill discovery. Avoid merging a stale independent version over the combined search UI. |
| [#14](https://github.com/storminator89/forgeCommunity/pull/14) | Available dependency updates; `main`; open draft | Review separately. It leaves the strict high-severity audit red; it is not a security-gate waiver or release approval. |
| [#15](https://github.com/storminator89/forgeCommunity/pull/15) | Four community workspaces; stacked on #12; open draft | Keep the #12 dependency explicit. Restack/supersede with the later pages, server-backed states and account-boundary fixes; do not merge its old head as the final UI. |

These six earlier PRs overlap the integration and remain drafts and unmerged. Their existing CI/mergeability metadata is not evidence that the new local integration has run in GitHub Actions. Preserve reviewer history and agree whether to refresh or supersede each draft; do not force-update them by assumption.

## Actual draft publication and final integration branch

Each remote cut through #24 was checked for exact tree equality to its matching local cut before the branch and PR were created. The remote commit SHA can differ because GitHub commit metadata differs. Each PR targets the immediately preceding branch; review from #16 upward. Their intermediate states were **not** each independently given the full final-app test suite.

| PR | Review scope | Exact remote head | Local cut |
| --- | --- | --- | --- |
| [#16](https://github.com/storminator89/forgeCommunity/pull/16) | Enrollment, RSVP and server-backed progress foundation | `3f956b1` | `788df17` |
| [#17](https://github.com/storminator89/forgeCommunity/pull/17) | Learning completion, reports and reward groundwork | `c4081ec` | `5a41987` |
| [#18](https://github.com/storminator89/forgeCommunity/pull/18) | Accessible UI foundation and route coverage | `bed0ca3` | `db7434b` |
| [#19](https://github.com/storminator89/forgeCommunity/pull/19) | Search privacy, dependency lock and certificate ordering | `7f898f1` | `29878ab` |
| [#20](https://github.com/storminator89/forgeCommunity/pull/20) | Route UX and browser CI harness | `e1ff1d7` | `7190b9c` |
| [#21](https://github.com/storminator89/forgeCommunity/pull/21) | PostgreSQL baseline and account boundaries | `4653b31` | `162593d` |
| [#22](https://github.com/storminator89/forgeCommunity/pull/22) | Badges, feed and split quality/security CI | `a9fb8b4` | `6b2b103` |
| [#23](https://github.com/storminator89/forgeCommunity/pull/23) | Accepted solutions and private contribution progress | `3244308` | `dff3c5c` |
| [#24](https://github.com/storminator89/forgeCommunity/pull/24) | Read authorization, discovery, onboarding and authenticated smokes | `3e15ea7` | `8ab8eb0` |

The final integration branch `review/forge-109-final-ci-qa` combines `8ab8eb0→521aa21` (account cleanup and contrast), `521aa21→aa5d5e6` (verification/handoff documentation), `aa5d5e6→ea30b57` (CI context correction and source guard), and this updated handoff. Review it against #24; its published tree must match the exact local integration before treating it as the final candidate. A separate local four-file dependency-security candidate is reviewed at `2236b57`, based on `aa5d5e6`; it must be restacked after the final application/CI branch if published.

Known current CI evidence: #19's Docker application smoke failed against an old certificate fixture, which the later local `3a0ef8c` fixes. #22 and #23 failed workflow admission with no jobs because `runner.temp` was used in job-level `env`; `bfad62a` changes that to an allowed `github.workspace` context, and `ea30b57` adds a source regression. No final remote CI, browser run or live PostgreSQL result exists yet.

## Conceptual review packages and ordering

1. **Database deployment foundation.** Review the PostgreSQL main-schema baseline, explicit empty-schema/current-schema options, checksum/locking/replay guards, SQLite canonical-schema generator and migration-safety tests. Baseline a pre-existing PostgreSQL schema only with its explicit reviewed option; the fresh-schema option is only for a verified empty schema. No production database operation is authorized by this plan.
2. **Learning and participation core.** Add the prerequisite skill-endorsement migration, then server-owned course enrollment, lesson/quiz progress, certificate eligibility/issuance/deletion guards and event RSVP. Accept only with tests for concurrent last seats, retries, role/ownership changes, course edits, no partial deletion and historical enrollment data. This establishes the truth source used by the UI and rewards.
3. **Moderation and safety.** Add reports, role-limited triage and auditable resolution, search-email privacy, protected staff reads and account-scoped UI state. Preserve report evidence while the retention decision remains open; do not silently anonymize or erase audit records. The administrator-profile edit source concern is **unverified and tool-blocked**; do not present it as fixed or as a reproduced exploit.
4. **Responsible course rewards.** Add the revision-aware, opt-in reward ledger, reversible course points, private history, verified-course badge and bounded opt-in ranking. Depends on server-verifiable learning and the earlier migration numbers. Check award-once event keys, reversals, editor changes, deleted courses/accounts, staff/test exclusions and no learning-progress disclosure. Author-selected discussion solutions currently provide private derived 1/3/5 milestones **without** public points or automatic moderator powers.
5. **Discovery and discussion scale.** Add community feed/comment indexes and bounded pagination, accepted-solution state/change history, private contribution milestones, article/project/skill search and event discovery. Include API privacy, cursor/retry/focus, reversal and role-boundary regressions. The member directory remains unbounded until its Unicode text and freshness contract is decided; do not ship an incomplete page cap.
6. **Route-by-route UI.** Refresh #12 then #15 or replace them with equivalent reviewed stacked changes, followed by courses/events, knowledge/resources/projects/skills, settings/profile/admin, and utility routes. Include the notification-handle, chat-send cancellation and measured contrast changes from application head `521aa21`. Recheck every original route plus `/moderation` against the route inventory and `design.md`; do not infer visual completion from source changes.
7. **Integrated CI and release verification.** Apply the strict-audit/quality split without lowering the unchanged `npm audit --audit-level=high` floor or the required `validate` aggregate. Keep independent PostgreSQL upgrade, disposable Chromium browser, standalone and Docker HTTP jobs. Run them on the **same published integration SHA**, inspect artifacts, and fix actual failures before any merge request. A final integration PR must describe which earlier drafts it supersedes and contain no duplicated migrations.

Use these packages to guide review of the already published chronological cuts and the remaining drafts. The grouping may be adjusted after diff review, but the database migration order and truth-source dependencies may not be silently changed. Avoid a single opaque “all features” merge and avoid deploying directly from local integration.

### Required migration order

| Purpose | PostgreSQL upgrade | SQLite migration | Must precede |
| --- | --- | --- | --- |
| Existing skill endorsements | `0001_skill_endorsements` | `0002_skill_endorsements` (`0001` is SQLite baseline) | Later numbered upgrades |
| Learning progress | `0002_course_progress` | `0003_course_progress` | Course rewards/certificates |
| Reports | `0003_reports` | `0004_reports` | Later numbered upgrades |
| Reward ledger | `0004_reward_ledger` | `0005_reward_ledger` | Reward API, badge and leaderboard |
| Feed indexes | `0005_community_feed_indexes` | `0006_community_feed_indexes` | Bounded feed/comment queries |
| Accepted solutions | `0006_accepted_solutions` | `0007_accepted_solutions` | Private contribution milestones |

The PostgreSQL baseline is `prisma/postgresql-baselines/0000_main_7814799.sql`; it is **not** an ordinary upgrade to run over a populated main schema. Both providers require fresh install, populated upgrade from actual `main`, repeated no-op deployment, recorded checksum continuity, foreign-key/data checks and failure rollback. SQLite passed these locally earlier; PostgreSQL runtime tests remain pending in the disposable PostgreSQL 16 CI job.

## Evidence already available at the local application SHA

- `docs/LOCAL-INTEGRATION-VERIFICATION.md` records **129 Jest suites / 1,077 tests**, full TypeScript and zero-warning lint, both Prisma validators, SQLite migration-safety 6/6, physical Next 16 production build, 11 standalone HTTP checks and synthetic authenticated SQLite smokes for security/general flows, contributions and H5P before/after restart. Fixture foreign-key checks were empty.
- `docs/qa/design-color-contrast.md` and `node scripts/check-color-contrast.js` record 52 curated source-calculated light/dark pairs with a ≥3.2:1 controlled input-boundary reserve. They are not a visual/WCAG certification.
- `docs/plans/MEMBER-DIRECTORY-PAGINATION.md` and its seven synthetic characterization checks demonstrate why a naive cap breaks Unicode search, locale sort and global counts/facets. The plan makes no runtime directory changes.
- Playwright discovers 21 tests in seven files across desktop/320px/390px. **No actual browser run, screenshots, manual keyboard check, touch/reflow observation or page-by-page visual acceptance occurred at this SHA.**

## Remaining decisions and stop gates

1. **Publication and review:** #16–24 are published drafts and the final integration branch is being published as the next draft. No merge or deployment permission has been given. Reviewers must see the exact final published SHA and required contexts before considering a merge.
2. **High-severity audit:** the upstream `braces` advisory remains under the unchanged strict gate; available dependency updates do not make it green. No audit exception, `continue-on-error`, branch-protection change or unapproved audit-data transmission. Resolve against a genuinely patched supported dependency graph, then observe the CI result.
3. **PostgreSQL 16 runtime:** execute the existing disposable release-gate job with baseline, populated upgrade, replay/checksums, FK/data and concurrent reward/transaction cases on the final published code. Local Prisma validation and SQLite execution cannot substitute for it.
4. **Real browser and visual accessibility:** run the disposable browser job and manually review all 34 current pages with synthetic fixtures on desktop and 320/375/414/768px mobile/tablet sizes, light/dark, zoom, keyboard/focus, Escape/cancel, Back/Forward, interrupted account changes and error/empty states. Save actual-app screenshots tied to the exact SHA. Axe or source contrast alone cannot establish WCAG conformance. The available CUA surface was not verified as the requested assistant-cloud PC and was not used for app QA.
5. **Product contracts:** decide the member directory's explicit Unicode/collation and cross-page freshness semantics before pagination; decide report/account-evidence retention before changing deletion or anonymization. Keep contribution awards private/non-pointed until abuse/fairness criteria and moderation review are accepted. Previously issued H5P asset capabilities retain their current two-hour lifetime and warrant explicit review if revocation timing becomes a requirement.

If any gate fails, keep the relevant PRs draft and the strict aggregate red. This document is a handoff for review, not a green release certificate.
