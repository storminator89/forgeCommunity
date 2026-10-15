# Staged course publication storage

This release supports a **fresh, empty database**. Deploy the reviewed SQLite
migrations with `npm run db:deploy`, or initialize a verified empty PostgreSQL
schema with `npm run db:deploy -- --initialize-empty-schema`, before starting
the application. Then run `npm run db:publication:ready` with the same
`DATABASE_PROVIDER` and `DATABASE_URL`. Container and standalone startup run
the read-only guard and refuse to serve if it fails; the health endpoint also
rejects a database containing a course without a draft. The guard verifies
the exact recorded migration names and SHA-256 checksums, that every course
has a saved draft, and that each active publication belongs to its course. It performs no
data repair.

An existing database with pre-publication courses is unsupported. The additive
migration may preserve those rows, but they have no publication or draft; the
readiness check fails with an explicit fresh-install error rather than silently
hiding them. Back up an existing database and provision a new empty one before
switching to this release. Do not reset, truncate, or delete a database as part
of application startup.

The canonical schema is `prisma/schema.prisma`; the generated SQLite variant is
`prisma/schema.sqlite.prisma`. Migration `0010_staged_course_publication.sql`
for SQLite and upgrade `0009_staged_course_publication.sql` for PostgreSQL add:

- `Course.activePublicationId`: null means unpublished. A new course and its
  `CourseDraft` are created in one transaction.
- `CourseDraft`: one saved version per course, with revision, payload, digest,
  base publication, editor and update time. Author saves compare revision.
- `CoursePublication`: immutable numbered snapshot, with source `AUTHOR` or
  `RESTORE`, actor, digest and previous-publication link.
- `PublicationRequest`: course-scoped publish request receipts for idempotency.
- `CourseAsset`: private course-scoped asset metadata. Its stable URL is
  `/api/courses/:courseId/assets/:assetId`.
- `CourseContent.archivedAt` and nullable publication provenance on quiz
  attempts and certificates.

The version-1 snapshot payload is
`{schemaVersion:1,title,description,startDate,endDate,imageUrl,contents:[{id,parentId,title,type,content,order}]}`.
SQL foreign keys and triggers prevent cross-course publication references;
the migration runners also reject changed or gapped history. Drafts and history
are private. Current public course reads use only the active publication.
Already-issued certificates stay valid; a changed lesson body requires fresh
completion against the current publication for all learners.

Storage changes here do not alter paid-access semantics.
