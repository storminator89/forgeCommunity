-- Historical lesson anchors remain scalar provenance when publications/content disappear.
ALTER TABLE "CourseQuestion"
  ADD COLUMN "contextPublicationId" TEXT,
  ADD COLUMN "contextContentId" TEXT,
  ADD CONSTRAINT "CourseQuestion_lesson_context_pair_check" CHECK (
    ("contextPublicationId" IS NULL AND "contextContentId" IS NULL) OR
    ("contextPublicationId" IS NOT NULL AND "contextContentId" IS NOT NULL)
  );
CREATE INDEX "CourseQuestion_lesson_scope_page_idx" ON "CourseQuestion"
  ("courseId", "contextPublicationId", "contextContentId", "createdAt", "id");
