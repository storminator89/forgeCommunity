-- Additive fresh-install assignment history. Existing publication rows are untouched.
ALTER TYPE "ContentType" ADD VALUE 'ASSIGNMENT';
CREATE TYPE "AssignmentGradeAction" AS ENUM ('GRADED', 'WITHDRAWN');

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
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssignmentSubmission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssignmentSubmission_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CoursePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssignmentSubmission_userId_contentId_requestId_key" ON "AssignmentSubmission"("userId", "contentId", "requestId");
CREATE UNIQUE INDEX "AssignmentSubmission_userId_contentId_attemptNumber_key" ON "AssignmentSubmission"("userId", "contentId", "attemptNumber");
CREATE INDEX "AssignmentSubmission_courseId_contentId_idx" ON "AssignmentSubmission"("courseId", "contentId");
CREATE INDEX "AssignmentSubmission_courseId_contentId_revision_userId_attemptNumber_idx" ON "AssignmentSubmission"("courseId", "contentId", "revision", "userId", "attemptNumber");
CREATE INDEX "AssignmentSubmission_publicationId_idx" ON "AssignmentSubmission"("publicationId");

CREATE TABLE "AssignmentGradeDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "graderId" TEXT NOT NULL,
  "action" "AssignmentGradeAction" NOT NULL,
  "score" INTEGER CHECK ("score" BETWEEN 0 AND 100),
  "feedback" TEXT,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentGradeDecision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssignmentGradeDecision_action_score_check" CHECK (("action" = 'GRADED' AND "score" IS NOT NULL) OR ("action" = 'WITHDRAWN' AND "score" IS NULL))
);
CREATE UNIQUE INDEX "AssignmentGradeDecision_submissionId_requestId_key" ON "AssignmentGradeDecision"("submissionId", "requestId");
CREATE UNIQUE INDEX "AssignmentGradeDecision_submissionId_sequence_key" ON "AssignmentGradeDecision"("submissionId", "sequence");
CREATE INDEX "AssignmentGradeDecision_createdAt_idx" ON "AssignmentGradeDecision"("createdAt");

-- Keep decisions append-only except for referential actions initiated by a
-- submission key update or deletion. FK cascades run after the old parent row
-- has been removed, so its absence distinguishes that cleanup from direct DML.
CREATE FUNCTION "assertAssignmentGradeDecisionAppendOnly"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_parent_exists BOOLEAN;
  new_parent_exists BOOLEAN;
BEGIN
  -- Resolve the table in the decision's own schema, regardless of a caller's
  -- search_path (including a temporary table with the same name).
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."AssignmentSubmission" WHERE "id" = $1)', TG_TABLE_SCHEMA)
    INTO old_parent_exists USING OLD."submissionId";
  IF TG_OP = 'DELETE' THEN
    IF NOT old_parent_exists THEN
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."AssignmentSubmission" WHERE "id" = $1)', TG_TABLE_SCHEMA)
      INTO new_parent_exists USING NEW."submissionId";
    IF NEW."submissionId" IS DISTINCT FROM OLD."submissionId"
      AND NOT old_parent_exists
      AND new_parent_exists
      AND (NEW."id", NEW."requestId", NEW."graderId", NEW."action", NEW."score", NEW."feedback", NEW."sequence", NEW."createdAt")
          IS NOT DISTINCT FROM
          (OLD."id", OLD."requestId", OLD."graderId", OLD."action", OLD."score", OLD."feedback", OLD."sequence", OLD."createdAt") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Assignment grade decisions are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "AssignmentGradeDecision_append_only" BEFORE UPDATE OR DELETE ON "AssignmentGradeDecision"
  FOR EACH ROW EXECUTE FUNCTION "assertAssignmentGradeDecisionAppendOnly"();
-- TRUNCATE skips row DELETE triggers, so forbid it explicitly. Deletion through
-- a submission/account FK cascade uses DELETE and remains available.
CREATE FUNCTION "assertAssignmentGradeDecisionNoTruncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Assignment grade decisions are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "AssignmentGradeDecision_no_truncate" BEFORE TRUNCATE ON "AssignmentGradeDecision"
  FOR EACH STATEMENT EXECUTE FUNCTION "assertAssignmentGradeDecisionNoTruncate"();

CREATE FUNCTION "assertAssignmentPublicationCourse"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CoursePublication" p WHERE p."id" = NEW."publicationId" AND p."courseId" = NEW."courseId") THEN
    RAISE EXCEPTION 'Cross-course assignment publication' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AssignmentSubmission_same_course" BEFORE INSERT OR UPDATE OF "publicationId", "courseId" ON "AssignmentSubmission"
  FOR EACH ROW EXECUTE FUNCTION "assertAssignmentPublicationCourse"();
