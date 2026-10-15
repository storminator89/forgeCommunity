-- Fresh-install staged publication storage. Legacy Course rows are not
-- converted; startup rejects any row without a draft.
CREATE TYPE "PublicationSource" AS ENUM ('AUTHOR', 'RESTORE');

ALTER TABLE "Course" ADD COLUMN "activePublicationId" TEXT;
ALTER TABLE "CourseContent" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "QuizAttempt" ADD COLUMN "publicationId" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "publicationId" TEXT;

CREATE TABLE "CoursePublication" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "source" "PublicationSource" NOT NULL,
  "payload" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "contentCount" INTEGER NOT NULL,
  "previousPublicationId" TEXT,
  "actorId" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoursePublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoursePublication_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "CoursePublication_contentCount_check" CHECK ("contentCount" >= 0),
  CONSTRAINT "CoursePublication_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CoursePublication_previousPublicationId_fkey" FOREIGN KEY ("previousPublicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CoursePublication_courseId_sequence_key" ON "CoursePublication"("courseId", "sequence");
CREATE INDEX "CoursePublication_courseId_recordedAt_idx" ON "CoursePublication"("courseId", "recordedAt");

ALTER TABLE "Course" ADD CONSTRAINT "Course_activePublicationId_fkey"
  FOREIGN KEY ("activePublicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_publicationId_fkey"
  FOREIGN KEY ("publicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_publicationId_fkey"
  FOREIGN KEY ("publicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CourseDraft" (
  "courseId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "basePublicationId" TEXT,
  "payload" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "lastEditorId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseDraft_pkey" PRIMARY KEY ("courseId"),
  CONSTRAINT "CourseDraft_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "CourseDraft_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseDraft_basePublicationId_fkey" FOREIGN KEY ("basePublicationId") REFERENCES "CoursePublication"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PublicationRequest" (
  "courseId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationRequest_pkey" PRIMARY KEY ("courseId", "requestId"),
  CONSTRAINT "PublicationRequest_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PublicationRequest_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CoursePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PublicationRequest_publicationId_idx" ON "PublicationRequest"("publicationId");

CREATE TABLE "CourseAsset" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "uploaderId" TEXT,
  "storageKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseAsset_byteSize_check" CHECK ("byteSize" >= 0),
  CONSTRAINT "CourseAsset_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourseAsset_storageKey_key" ON "CourseAsset"("storageKey");
CREATE INDEX "CourseAsset_courseId_idx" ON "CourseAsset"("courseId");

CREATE INDEX "Course_activePublicationId_idx" ON "Course"("activePublicationId");
CREATE INDEX "CourseContent_courseId_archivedAt_idx" ON "CourseContent"("courseId", "archivedAt");
CREATE INDEX "QuizAttempt_publicationId_idx" ON "QuizAttempt"("publicationId");
CREATE INDEX "Certificate_publicationId_idx" ON "Certificate"("publicationId");

-- A single trigger checks nullable references on the legacy and new tables.
-- TG_TABLE_SCHEMA keeps a custom ?schema= deployment isolated even when a
-- connection's search_path is later changed by another application process.
CREATE FUNCTION "assertSameCoursePublication"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reference_id TEXT;
  expected_course_id TEXT;
  owner_course_id TEXT;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'Course' THEN
      reference_id := NEW."activePublicationId";
      expected_course_id := NEW."id";
    WHEN 'CourseDraft' THEN
      reference_id := NEW."basePublicationId";
      expected_course_id := NEW."courseId";
    WHEN 'CoursePublication' THEN
      reference_id := NEW."previousPublicationId";
      expected_course_id := NEW."courseId";
    WHEN 'PublicationRequest' THEN
      reference_id := NEW."publicationId";
      expected_course_id := NEW."courseId";
    WHEN 'QuizAttempt' THEN
      reference_id := NEW."publicationId";
      expected_course_id := NEW."courseId";
    WHEN 'Certificate' THEN
      reference_id := NEW."publicationId";
      expected_course_id := NEW."courseId";
    ELSE
      RAISE EXCEPTION 'Unexpected publication-reference trigger table: %', TG_TABLE_NAME;
  END CASE;
  IF reference_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT "courseId" FROM %I."CoursePublication" WHERE "id" = $1', TG_TABLE_SCHEMA)
    INTO owner_course_id USING reference_id;
  IF owner_course_id IS DISTINCT FROM expected_course_id THEN
    RAISE EXCEPTION 'Cross-course publication reference on %', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Course_activePublication_same_course" BEFORE INSERT OR UPDATE OF "activePublicationId" ON "Course"
  FOR EACH ROW EXECUTE FUNCTION "assertSameCoursePublication"();
CREATE TRIGGER "CourseDraft_basePublication_same_course" BEFORE INSERT OR UPDATE OF "basePublicationId", "courseId" ON "CourseDraft"
  FOR EACH ROW EXECUTE FUNCTION "assertSameCoursePublication"();
CREATE TRIGGER "CoursePublication_previous_same_course" BEFORE INSERT OR UPDATE OF "previousPublicationId", "courseId" ON "CoursePublication"
  FOR EACH ROW EXECUTE FUNCTION "assertSameCoursePublication"();
CREATE TRIGGER "PublicationRequest_publication_same_course" BEFORE INSERT OR UPDATE OF "publicationId", "courseId" ON "PublicationRequest"
  FOR EACH ROW EXECUTE FUNCTION "assertSameCoursePublication"();
CREATE TRIGGER "QuizAttempt_publication_same_course" BEFORE INSERT OR UPDATE OF "publicationId", "courseId" ON "QuizAttempt"
  FOR EACH ROW EXECUTE FUNCTION "assertSameCoursePublication"();
CREATE TRIGGER "Certificate_publication_same_course" BEFORE INSERT OR UPDATE OF "publicationId", "courseId" ON "Certificate"
  FOR EACH ROW EXECUTE FUNCTION "assertSameCoursePublication"();
