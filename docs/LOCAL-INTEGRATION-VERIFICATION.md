# Local integration verification (2026-10-14)

This is an isolated integration branch, not a deployment or a claim that CI has passed. The individual source branches remain intact. The checked integration code head before this note was `19d63d2b2bbdda3deb84b40805b6e0d4cf57d0c0`.

## Included source

- `d15cdc4869a2ba5e2c98bdcadd6dcf267082491b`: verified learning progress.
- Enrollment commit `788df17dc5451da63d5cc8a26dfdbc5472807f56`, included as the patch-equivalent local commit `2b2a407`.
- Moderation commit `3a303fb7c9f868eb7cbcbea4cb12c0c1e8c94021`, included as the patch-equivalent local commit `5e28e82`.
- `5a41987fb3ab432941639df2a51b574ee55f2f9d`: responsible rewards, including the SQLite `0005` and PostgreSQL `0004` migrations.
- `f259f56c5b9e7714374ab84c30add4b3a0bf6150`: UI stack.
- `da3f9ebb6741f375b22e82eecf1ff9bf04ee9765`: private search.
- `8dd75fc63ae9432d9dd2c8f2d9c6d0a9570d2bc0`: dependency updates.
- `5e1026aac22987c9a7abee7e63b70345f628c814`: certificate ordering fix and regression.
- Browser QA patches from `19d49021841e1e9145983170fe74ec851b90ae8f` and `4480ff2c92b78b30b725f5bafb7128e0b069f489` were cherry-picked without their older UI ancestry. Stable patch IDs match their source commits. They add the dedicated browser job and integrated journey checks.

The UI merge had three actual content conflicts: `app/community/page.tsx`, `components/community/LeaderboardCard.tsx`, and `components/community/StatsCard.tsx`. The resolution keeps the UI's editorial layout while retaining server-backed private rewards, the opt-in explanation, reward history, and a public leaderboard without persistent account IDs. The moderation navigation was auto-merged and inspected for its role gate and link. Search, dependency, and certificate merges had no textual conflicts.

## Checks completed locally

- Full Jest: **88 suites, 491 tests passed**.
- Full ESLint and `tsc --noEmit`: passed.
- SQLite-provider production `npm run build`: passed with an isolated dependency overlay that matched the lockfile versions of Sharp 0.35.5, source-map-js 1.2.2, and Playwright 1.64.1, plus a locally generated Prisma client for the combined schema.
- Both PostgreSQL and SQLite Prisma schemas: `prisma validate` passed. This validates schema shape, not execution against PostgreSQL.
- Fresh disposable SQLite: `db:deploy` applied `0001_initial` through `0005_reward_ledger` in order. Repeated deploy made no new changes; each recorded checksum matched the committed SQL, foreign-key check was empty, and no completion snapshot was invented in an empty database.
- Populated clean-main SQLite upgrade and repeat-deploy behavior: exercised by the passing real-database `reward-upgrade-deploy-db` regression. Historical completed enrollment was backfilled; incomplete enrollment was not; ranking consent and reward approval defaulted false; course deletion retained the private completion snapshot; account deletion cascaded it.
- Authenticated production HTTP smoke on disposable local SQLite using synthetic accounts and `next start` in the same shell: anonymous/private boundaries, search privacy, course join and repeat, event RSVP/capacity/cancel/rejoin, quiz pass and a single server-owned reward, public ranking opt-in/out without account IDs, report/review permissions and replay, certificate issuance/listing. Database postconditions confirmed one enrollment, one passing attempt, one active 50-point reward/change, one report, one certificate, and opt-out after the test.

## Open verification

- PostgreSQL runtime migrations and the full PostgreSQL CI upgrade script were **not run locally**: this executor has no local PostgreSQL service or Docker. A PostgreSQL-backed CI/deployment environment must test fresh install, populated upgrade from main, replay/checksum continuity, foreign keys, and concurrent reward reconciliation before merge.
- Browser QA and visual screenshots were **not run locally**. The existing executor's browser sandbox cannot launch Chromium normally; no sandbox bypass was attempted. The dedicated browser CI job remains the intended supported test, using its explicitly disposable database. Its result must be observed on the exact published commit, if publication is later authorized.
- Standalone-server smoke was **not accepted locally**. The symlinked dependency layout caused Next's trace to omit a relative `./cpu-profile` module. An attempt to rebuild with physically hardlinked dependencies compiled, then the executor killed its TypeScript phase with exit 137 under low workspace resources. This does not establish a product failure or a passing standalone release. A regular clean `npm ci` with non-symlinked dependencies, production build, and `node scripts/smoke-standalone.mjs` are required in CI before merge.
- No external push, PR update, merge to `main`, deployment, or audit-data transfer was performed by this integration work.

## Exact-head rerun after final UI changes (2026-10-14)

The checks above remain the record for code head `19d63d2b2bbdda3deb84b40805b6e0d4cf57d0c0`. This section records a separate rerun at full integration head `7190b9c493eb3ebd9a98582b992d9005c4991ae2`. Final UI head `15c3b8d4998194e3d8bb651bfed6e1979084375e` is an ancestor of that commit; the only file changed after it is this verification note.

- Full ESLint and `tsc --noEmit` passed. Full Jest passed: **90 suites, 507 tests**.
- PostgreSQL and SQLite Prisma schemas both passed `prisma validate`. This is schema validation, not a PostgreSQL runtime migration.
- A new disposable SQLite database applied `0001_initial.sql` through `0005_reward_ledger.sql` in order. A second deploy was a no-op. Separately, a populated database deployed at clean `main` (`7814799e6f60639ed90de08b285c8bed8a414ee1`) applied its first two migrations, then applied `0003`–`0005` at the current integration head; a second integration deploy was a no-op. All five recorded checksums matched the committed SQL. Fresh and upgraded schemas had the same SHA-256 (`13a1f12ea77352d46cd00cc46cfd5bb41b0577c2810352962e1a4035e02fcce1`), foreign-key checks were empty, and the seeded historical completed enrollment produced exactly one completion snapshot. The disposable migration-check databases were removed.
- An additional isolated worktree at the exact integration head used a physical `npm ci --no-audit --no-fund` install of 1,184 packages with a local SQLite Prisma client. Its Next and Prisma dependencies resolved within that worktree. The sandbox's default npm cache was unavailable, so the successful clean install used a writable temporary cache, removed before the build. With a disposable SQLite database and no production credentials, a normal `npm run build` passed and produced `.next/standalone/server.js`; `node scripts/smoke-standalone.mjs` then passed **11 HTTP checks**. This resolves the older local standalone failure for this exact head, but does not replace a clean CI run.

PostgreSQL runtime upgrade and concurrency checks, browser journey/visual QA in a supported CI browser, and CI verification of the exact published commit remain open before merge. No browser sandbox bypass, GitHub publication, merge, or deployment was performed for this rerun.
