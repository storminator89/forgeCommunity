# Report-review authorization and transaction boundary

`PATCH /api/reports/{reportId}` retains its early current-role check, input validation and same-origin guard. Before writing a decision, `reviewContentReport` rereads the stored actor and performs the conditional `OPEN` → `DISMISSED`/`RESOLVED` write in one serializable transaction. The actor, timestamp and decision fields remain server-owned. A demotion or deletion committed before the decision transaction is rejected with 403, without changing any report.

Only an actual Prisma `PrismaClientKnownRequestError` with code `P2034` is retried, for at most four transaction attempts. Every attempt rereads actor authorization. Exhaustion returns 409; unrelated errors are not retried or reported as successful. An existing reviewed report still returns 409, and a missing report still returns 404 to an authorized actor. The first successful review's identity, timestamp, status and note cannot be overwritten by replay or another reviewer.

This is a serializable snapshot guarantee, not a promise that revocation always wins overlapping transactions. PostgreSQL may validly serialize an overlapping review before a concurrent role change or deletion, even if their wall-clock commit order differs. SQLite serializes its writes, with adapter failures handled according to their actual Prisma error code. Neither provider is claimed to provide a stronger revocation ordering than its transaction semantics.

No report retention behavior, table, foreign key, migration, content-removal permission or report-evidence field has changed. Reports still survive target/account deletion under the existing retention contract. A resolved report continues to document an already-completed action; reviewing it does not remove content automatically.

## Regression coverage

`__tests__/api/report-review-db.test.ts` applies the existing ordered migrations to a disposable SQLite database and exercises the route against the real Prisma adapter. It covers:

- Committed ADMIN/MODERATOR demotion or deletion after the early check, before the decision transaction
- Anonymous, non-staff, deleted actors, stale session claims and authorized missing reports
- Both successful decision types, server-owned fields, replay and conflicting reviewers
- Two competing authorized requests preserving one first decision
- Transaction rollback after a successful conditional write
- Injected known serialization failure, fresh authorization on retry, four-attempt exhaustion and no retry for unrelated/lookalike errors
- Unchanged historical reports and retained evidence on failed requests

The injected `P2034` cases test retry and rollback behavior; they are not proof that a real PostgreSQL concurrency conflict occurred. PostgreSQL runtime and concurrency checks require a disposable PostgreSQL environment and a matching provider-generated client. Prisma schema validation alone is not a runtime pass.

Focused checks:

    DATABASE_PROVIDER=sqlite DATABASE_URL=file:/absolute/disposable/test.db npm test -- --runInBand __tests__/api/content-reports.test.ts __tests__/api/report-review-db.test.ts
    npm run typecheck
    npm run lint -- --max-warnings 0

No publication, merge, deployment or broader erasure-policy change is implied by this local fix.

Local verification on 2026-10-15: the two focused report suites passed all 35 tests; the full Jest suite passed 115 suites and 770 tests. Typecheck, zero-warning lint, SQLite and PostgreSQL Prisma schema validation, SQLite schema synchronization and diff whitespace checks passed. The shared SQLite client was not regenerated. No PostgreSQL runtime, build, browser, dependency audit, publication or merge was run for this change.
