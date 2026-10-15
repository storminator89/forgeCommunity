-- Additive fresh-install assignment history. Existing publication rows are untouched.
CREATE TABLE "AssignmentSubmission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "passingScore" INTEGER NOT NULL CHECK ("passingScore" BETWEEN 1 AND 100),
  "requestId" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "responseDigest" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL CHECK ("attemptNumber" > 0),
  "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("publicationId") REFERENCES "CoursePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssignmentSubmission_userId_contentId_requestId_key" ON "AssignmentSubmission"("userId", "contentId", "requestId");
CREATE UNIQUE INDEX "AssignmentSubmission_userId_contentId_attemptNumber_key" ON "AssignmentSubmission"("userId", "contentId", "attemptNumber");
CREATE INDEX "AssignmentSubmission_courseId_contentId_idx" ON "AssignmentSubmission"("courseId", "contentId");
CREATE INDEX "AssignmentSubmission_courseId_contentId_revision_userId_attemptNumber_idx" ON "AssignmentSubmission"("courseId", "contentId", "revision", "userId", "attemptNumber");
CREATE INDEX "AssignmentSubmission_publicationId_idx" ON "AssignmentSubmission"("publicationId");
CREATE TRIGGER "AssignmentSubmission_same_course_insert" BEFORE INSERT ON "AssignmentSubmission"
WHEN NOT EXISTS (SELECT 1 FROM "CoursePublication" p WHERE p."id" = NEW."publicationId" AND p."courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course assignment publication'); END;
CREATE TRIGGER "AssignmentSubmission_same_course_update" BEFORE UPDATE OF "publicationId", "courseId" ON "AssignmentSubmission"
WHEN NOT EXISTS (SELECT 1 FROM "CoursePublication" p WHERE p."id" = NEW."publicationId" AND p."courseId" = NEW."courseId")
BEGIN SELECT RAISE(ABORT, 'Cross-course assignment publication'); END;

CREATE TABLE "AssignmentGradeDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "graderId" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('GRADED', 'WITHDRAWN')),
  "score" INTEGER CHECK ("score" BETWEEN 0 AND 100),
  "feedback" TEXT,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (("action" = 'GRADED' AND "score" IS NOT NULL) OR ("action" = 'WITHDRAWN' AND "score" IS NULL))
);
CREATE UNIQUE INDEX "AssignmentGradeDecision_submissionId_requestId_key" ON "AssignmentGradeDecision"("submissionId", "requestId");
CREATE UNIQUE INDEX "AssignmentGradeDecision_submissionId_sequence_key" ON "AssignmentGradeDecision"("submissionId", "sequence");
CREATE INDEX "AssignmentGradeDecision_createdAt_idx" ON "AssignmentGradeDecision"("createdAt");
-- SQLite REPLACE may erase a conflicting row without firing DELETE triggers.
-- Reject all conflicts before conflict handling can replace history.
CREATE TRIGGER "AssignmentGradeDecision_no_replace" BEFORE INSERT ON "AssignmentGradeDecision"
WHEN EXISTS (
  SELECT 1 FROM "AssignmentGradeDecision" d
  WHERE d."id" = NEW."id"
    OR (d."submissionId" = NEW."submissionId"
      AND (d."requestId" = NEW."requestId" OR d."sequence" = NEW."sequence"))
)
BEGIN SELECT RAISE(ABORT, 'Assignment grade decisions are append-only'); END;
-- A decision is append-only while its submission exists. During an FK cascade
-- the parent row has already been removed; allow that cleanup to proceed.
CREATE TRIGGER "AssignmentGradeDecision_no_direct_delete" BEFORE DELETE ON "AssignmentGradeDecision"
WHEN EXISTS (SELECT 1 FROM "AssignmentSubmission" WHERE "id" = OLD."submissionId")
BEGIN SELECT RAISE(ABORT, 'Assignment grade decisions are append-only'); END;
-- Preserve the declared ON UPDATE CASCADE if a submission primary key changes,
-- but do not permit an ordinary writer to change any decision data.
CREATE TRIGGER "AssignmentGradeDecision_no_direct_update" BEFORE UPDATE ON "AssignmentGradeDecision"
WHEN NOT (
  NEW."submissionId" IS NOT OLD."submissionId"
  AND NOT EXISTS (SELECT 1 FROM "AssignmentSubmission" WHERE "id" = OLD."submissionId")
  AND EXISTS (SELECT 1 FROM "AssignmentSubmission" WHERE "id" = NEW."submissionId")
  AND NEW."id" IS OLD."id"
  AND NEW."requestId" IS OLD."requestId"
  AND NEW."graderId" IS OLD."graderId"
  AND NEW."action" IS OLD."action"
  AND NEW."score" IS OLD."score"
  AND NEW."feedback" IS OLD."feedback"
  AND NEW."sequence" IS OLD."sequence"
  AND NEW."createdAt" IS OLD."createdAt"
)
BEGIN SELECT RAISE(ABORT, 'Assignment grade decisions are append-only'); END;
