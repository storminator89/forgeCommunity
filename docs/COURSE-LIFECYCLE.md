# Course enrollment, progress and automatic certificates

## Product rules

- Signed-in members can enroll themselves in a free course. A course with a price greater than zero requires access granted by that course's owner or an administrator. This is an access approval, not a payment integration or proof of payment.
- The course's maximum number of students applies to enrollment. Repeating an enrollment request does not consume another place.
- Learning progress belongs to the enrolled member and is persisted on the server. Opening a page or playing a video does not automatically confirm learning. The member explicitly marks content completed.
- Non-empty learning content is required by default. The owner can mark content optional. Empty structural chapters are excluded, and a course with no required learning content cannot automatically complete.
- Marking the final required learning content completes the enrollment and issues a certificate automatically, in the same server workflow. No instructor completion approval or examination is implied. This records the learner's self-confirmed completion, not verified competence.
- Repeated or concurrent completion requests reuse the certificate. Previously issued certificate IDs and names remain valid. Later syllabus edits do not revoke a completed enrollment or an existing certificate. Existing course/user deletion behavior is unchanged; this is not a permanent archive or certificate-revocation system.
- Owners and administrators can manage course contents without enrollment, but need an enrollment to track personal learning progress or earn their own certificate.
- Before course completion a member can undo a content mark. Completed enrollments remain historical records and cannot be uncompleted through the progress API.

## Storage and upgrades

The canonical Prisma schema supports PostgreSQL; the generated SQLite schema supports the local single-instance setup. New progress rows relate an enrollment to a course content item and are unique for that pair. Server validation rejects content from a different course. Removing an enrollment/content cleans up associated progress through foreign keys.

Apply the reviewed deployment migrations with `npm run db:deploy`. Do not edit migration files after deployment. Back up any existing production database first. Use the documented explicit baseline operation only for a fresh schema already created with `prisma db push`; ordinary tracked upgrades use `db:deploy` without that option.

## Verification

Run the normal type, lint, unit and production-build checks. The additional `scripts/smoke-course-lifecycle.mjs` exercises the real HTTP workflow against a disposable, empty, initialized SQLite database and a matching local server:

```sh
SMOKE_BASE_URL=http://127.0.0.1:3014 \
SMOKE_SQLITE_FILE=/absolute/path/to/disposable-course-smoke.db \
node scripts/smoke-course-lifecycle.mjs
```

The script registers fresh test users and creates courses through the API. It never sets `Enrollment.completedAt` or inserts certificates directly. It checks free enrollment, paid access approval, progress persistence across login, automatic certificate creation, repeated/concurrent completion, PDF download, access boundaries, empty courses and concurrent capacity limits. It leaves its disposable fixture data for inspection.

## Local validation (30 September 2026)

- TypeScript, ESLint with zero warnings, and all 239 Jest tests across 37 suites passed
- 35 migration/runner checks passed: real SQLite migrations plus catalog-mocked PostgreSQL runner checks
- SQLite production build passed; 64 genuine course-lifecycle HTTP checks, 11 standalone HTTP checks, and existing audit/SQLite application smokes passed
- Both Prisma schemas validate; dependency audit reported zero known vulnerabilities with the unchanged lockfile
- Live PostgreSQL and Docker integration were not run because those runtimes were unavailable; browser visual QA was blocked by the environment's localhost browser policy
- No remote push, pull request or deployment was performed. A requested Cloudflare Quick Tunnel could not be established because its outbound DNS/network connection was unavailable

The local standalone server's certificate links prioritize runtime `NEXTAUTH_URL`, so a future authorized HTTPS deployment does not inherit a build-time localhost link.
