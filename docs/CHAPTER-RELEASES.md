# Shared UTC chapter releases

Course owners and current administrators can stage a calendar release date on
any top-level chapter. The date is optional: no `releaseOn` means immediate
access. A date must be a real `YYYY-MM-DD` calendar date (years 0001–9999), and
releases the chapter and all descendants at **00:00 UTC** for every enrolled
learner. There is no enrollment-relative drip, cohort schedule, notification,
payment integration, or external scheduler.

This bounded calendar-date flow is informed by the official
[Thinkific chapter drip documentation](https://support.thinkific.com/hc/en-us/articles/42120346615575-Drip-Schedules-for-the-New-Course-Builder-Control-When-Your-Learners-Access-Content)
and [Teachable section drip documentation](https://support.teachable.com/en/articles/11682465-drip-content).
Teachable documents midnight UTC releases. ForgeCommunity uses an explicit UTC
label rather than a configurable timezone or per-learner overrides.

## Author workflow

1. Open a top-level chapter in the private course workspace.
2. Enter its date under **Kapitelfreigabe** and choose **Freigabe speichern**.
   Clear the date and save to restore immediate access.
3. Review **Änderungen veröffentlichen**. Effective date changes, including
   inherited changes after moves, show both the old and new date. New scheduled
   content is included too.
4. Publish explicitly. Saving, previewing, restoring history, or reviewing alone
   never changes learner access.

Child entries link to their root chapter's setting. Moving content follows the
destination root's date; moving a scheduled root below another chapter removes
its old date. Promoting a child back to the top level starts with immediate
access. These effects remain private until publication. Unsaved dates trigger
the existing navigation warning and block publication.

`Course.startDate` and `Course.endDate` remain display metadata and never gate
content. Dates live only in the existing version-1 draft/publication payload;
no database migration or materialized content-column change is needed. Old
payloads remain immediately available. Historical publications are immutable,
and version restore copies their original date state into a new private draft.

## Learner and evidence behavior

- A future chapter keeps its title and date visible. Bodies, quiz material and
  content-version tokens are withheld. The player shows the UTC release time
  and offers **Zugriff neu prüfen**; reloading also reads the current server time.
- Server time gates direct progress creation and removal, new certificate eligibility,
  graded quiz attempts and item evidence, assignment reads/new submissions,
  H5P metadata/embed/tokenized private files, and private text-image GET/HEAD.
  The gate runs even when a leaf has no prerequisites. Client clocks, known
  IDs, previously learned URLs, and fresh forged submissions cannot unlock it.
- Prerequisites still apply. Already earned, current-revision completion can
  satisfy a prerequisite even when its chapter is date-locked again. A released
  dependent chapter can therefore remain unlocked; the date-locked target's own
  bodies and new actions remain blocked. Progress, rewards, analytics, directory
  completion and profile projections share this evidence-based evaluator.
- Existing progress and grades are retained unchanged. A date-only reschedule
  preserves valid same-revision earned completion, reward points, and derived
  badges/pathway credit before and after midnight. It creates no revoke/reinstate
  ledger churn and needs no scheduler. Changed content revisions, changed
  prerequisites, grade withdrawal, role changes, or withdrawn reward approval
  still use their normal revalidation and revocation rules.
- An assignment submitted while access was open can be graded by authorized
  staff after rescheduling. A valid passing grade credits that prior learner
  work, including completion/rewards when otherwise eligible. The lock still
  denies new learner submissions and assignment-history reads.
- New certificates require both earned completion and all chapters released.
  The progress API exposes earned `complete` separately from
  `canIssueCertificate`, and the player explains a locked-but-completed lesson.
  Already issued certificates remain downloadable/verifiable historical
  credentials. A date-only change never changes body-revision hashes.
- Repeating an already committed quiz or assignment request can still return
  its original receipt after rescheduling. It creates no new evidence or credit.

Current author/admin previews and independently owned H5P packages retain their
existing permissions. Public course covers stay public. A private image or H5P
package referenced by multiple lessons is readable when at least one authorized
published reference is released and prerequisite-unlocked. Already public or
external media URLs cannot be made private by a chapter date. Formative practice
is a separate course-publication-bound pool, without chapter-linked items; a
new course publication still needs a matching practice publication.

## Verification

The new tests cover just before/at midnight UTC, legacy payloads, valid and
invalid dates, root-only validation, moves, private draft/publish/restore,
review impact, unsaved input preservation, stable earned reward/pathway credit,
changed-revision revocation, pending-assignment grading, current/stale roles, direct endpoint
bypasses, stable receipts, historical certificates, shared references, and real
private H5P/image bytes including GET/HEAD/range where supported.

Focused suites:

```sh
npm test -- --runInBand \
  __tests__/chapter-release.test.ts \
  __tests__/chapter-release-authoring-sqlite.test.ts \
  __tests__/chapter-release-editor.test.tsx \
  __tests__/chapter-release-earned-credit-sqlite.test.ts \
  __tests__/chapter-release-endpoints-sqlite.test.ts \
  __tests__/course-draft-workspace.test.tsx
```

These are unit, component and migrated-SQLite endpoint checks. They do not by
themselves claim PostgreSQL runtime or rendered-browser visual verification.
The existing CI provider/build/browser checks remain separate release gates.

The existing disposable `e2e/course-editor.pw.ts` journey now stages, publishes,
locks and clears a date, preserves an earlier completion, and records author and
learner captures on desktop/320px projects. Learner contexts explicitly inherit
that project's viewport and touch mode. This journey is CI-only until an actual
browser run provides execution evidence; discovery and typechecking are not a
browser pass.
