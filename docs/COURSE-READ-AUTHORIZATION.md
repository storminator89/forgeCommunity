# Current authority for private course and H5P reads

Session validation refreshes the stored user role, but an administrator can be
demoted or deleted after that lookup and before the route reads private data.
The read routes now verify the stored administrator role again instead of
using the captured session claim as sufficient authority.

## Covered reads

- Course contents: the current administrator check, course ownership,
  enrollment and content read share one serializable transaction. Every
  serialization retry repeats that decision. An enrolled former administrator
  receives the normal learner payload, with quiz answers and explanations
  removed. Unenrolled former administrators receive 403. Successful content
  responses are `private, no-store`.
- Course detail and progress: both recheck the stored administrator role before
  allowing its enrollment bypass. Detail also derives `canEdit` from that check.
- H5P metadata and preview: their shared authorization helper reads package
  ownership, current administrator authority and qualifying course references
  in one serializable transaction. Rejection occurs before reading package
  files or issuing an asset token.
- H5P package list: the stored-role decision and metadata query share one
  serializable transaction. A former administrator sees only their own packages,
  just like another non-administrator.

Course ownership remains sufficient to edit/read that course, including after
an instructor is demoted. Package owners retain access to their own H5P content.
Enrolled learners retain access to referenced packages, but not unrelated
private packages. Quiz submission already requires an enrollment without an
administrator bypass; its behavior is unchanged.

The snapshot checks do not promise that revocation always wins genuinely
overlapping transactions. The subsequent prerequisite-path package replaced
H5P asset capabilities with encrypted-subject v2 tokens and rechecks current
authority on every asset request. V1 tokens stop working at deployment. The
remaining bearer-token boundary is documented in
[Course learning prerequisites](COURSE-PREREQUISITES.md).

## Evidence

`__tests__/api/course-content-read-authorization-db.test.ts` uses the full SQLite
migration history and synthetic paid-course, quiz and H5P records. Before the
fix, 13 cases failed: five demotion reads, five deleted-account reads, answer-key
redaction for an enrolled former administrator, and two H5P-list cases.

The suite covers current administrators, demoted owners, enrolled learners,
anonymous/unrelated readers, stored-role lookup failures, content-read retry
after demotion, and denial before package-file reads or token disclosure.
Package-file reads are mocked; authentication identity is supplied as a captured
session. Authority, courses, enrollment and package metadata use real SQLite.
The forced serialization-conflict test exercises retry behavior, not real
PostgreSQL concurrency. No browser or PostgreSQL runtime result is claimed.
