-- Fresh-install staged publication storage. Existing legacy Course rows are
-- intentionally not converted; startup rejects any row without a draft.
ALTER TABLE "Course" ADD COLUMN "activePublicationId" TEXT
  REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseContent" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "QuizAttempt" ADD COLUMN "publicationId" TEXT
  REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD COLUMN "publicationId" TEXT
  REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CoursePublication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "courseId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "source" TEXT NOT NULL CHECK ("source" IN ('AUTHOR', 'RESTORE')),
  "payload" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "contentCount" INTEGER NOT NULL CHECK ("contentCount" >= 0),
  "previousPublicationId" TEXT,
  "actorId" TEXT,
  "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoursePublication_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CoursePublication_previousPublicationId_fkey" FOREIGN KEY ("previousPublicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CoursePublication_courseId_sequence_key" ON "CoursePublication"("courseId", "sequence");
CREATE INDEX "CoursePublication_courseId_recordedAt_idx" ON "CoursePublication"("courseId", "recordedAt");

CREATE TABLE "CourseDraft" (
  "courseId" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "basePublicationId" TEXT,
  "payload" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "lastEditorId" TEXT,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CourseDraft_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseDraft_basePublicationId_fkey" FOREIGN KEY ("basePublicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PublicationRequest" (
  "courseId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationRequest_pkey" PRIMARY KEY ("courseId", "requestId"),
  CONSTRAINT "PublicationRequest_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PublicationRequest_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CoursePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PublicationRequest_publicationId_idx" ON "PublicationRequest"("publicationId");

CREATE TABLE "CourseAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "courseId" TEXT NOT NULL,
  "uploaderId" TEXT,
  "storageKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL CHECK ("byteSize" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseAsset_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourseAsset_storageKey_key" ON "CourseAsset"("storageKey");
CREATE INDEX "CourseAsset_courseId_idx" ON "CourseAsset"("courseId");

CREATE INDEX "Course_activePublicationId_idx" ON "Course"("activePublicationId");
CREATE INDEX "CourseContent_courseId_archivedAt_idx" ON "CourseContent"("courseId", "archivedAt");
CREATE INDEX "QuizAttempt_publicationId_idx" ON "QuizAttempt"("publicationId");
CREATE INDEX "Certificate_publicationId_idx" ON "Certificate"("publicationId");

-- SQLite cannot add a composite FK to an existing Course without rebuilding
-- its populated table. These guards enforce the same-course rule uniformly for
-- every nullable publication reference, including legacy tables.
CREATE TRIGGER "Course_activePublication_same_course_insert" BEFORE INSERT ON "Course"
WHEN NEW."activePublicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."activePublicationId" AND "courseId" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'Cross-course active publication'); END;
CREATE TRIGGER "Course_activePublication_same_course_update" BEFORE UPDATE OF "activePublicationId" ON "Course"
WHEN NEW."activePublicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."activePublicationId" AND "courseId" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'Cross-course active publication'); END;
CREATE TRIGGER "CourseDraft_basePublication_same_course_insert" BEFORE INSERT ON "CourseDraft"
WHEN NEW."basePublicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."basePublicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course draft base'); END;
CREATE TRIGGER "CourseDraft_basePublication_same_course_update" BEFORE UPDATE OF "basePublicationId", "courseId" ON "CourseDraft"
WHEN NEW."basePublicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."basePublicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course draft base'); END;
CREATE TRIGGER "CoursePublication_previous_same_course_insert" BEFORE INSERT ON "CoursePublication"
WHEN NEW."previousPublicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."previousPublicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course previous publication'); END;
CREATE TRIGGER "CoursePublication_previous_same_course_update" BEFORE UPDATE OF "previousPublicationId", "courseId" ON "CoursePublication"
WHEN NEW."previousPublicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."previousPublicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course previous publication'); END;
CREATE TRIGGER "PublicationRequest_publication_same_course_insert" BEFORE INSERT ON "PublicationRequest"
WHEN NOT EXISTS (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."publicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course publication request'); END;
CREATE TRIGGER "PublicationRequest_publication_same_course_update" BEFORE UPDATE OF "publicationId", "courseId" ON "PublicationRequest"
WHEN NOT EXISTS (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."publicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course publication request'); END;
CREATE TRIGGER "QuizAttempt_publication_same_course_insert" BEFORE INSERT ON "QuizAttempt"
WHEN NEW."publicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."publicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course quiz attempt'); END;
CREATE TRIGGER "QuizAttempt_publication_same_course_update" BEFORE UPDATE OF "publicationId", "courseId" ON "QuizAttempt"
WHEN NEW."publicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."publicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course quiz attempt'); END;
CREATE TRIGGER "Certificate_publication_same_course_insert" BEFORE INSERT ON "Certificate"
WHEN NEW."publicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."publicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course certificate'); END;
CREATE TRIGGER "Certificate_publication_same_course_update" BEFORE UPDATE OF "publicationId", "courseId" ON "Certificate"
WHEN NEW."publicationId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "CoursePublication" WHERE "id" = NEW."publicationId" AND "courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course certificate'); END;
