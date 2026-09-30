-- Keep every historical enrollment and certificate unchanged. Existing contents
-- are required by default; empty chapter shells are excluded by the server.
ALTER TABLE "CourseContent" ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ContentProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enrollmentId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentProgress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentProgress_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "CourseContent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContentProgress_enrollmentId_contentId_key" ON "ContentProgress"("enrollmentId", "contentId");
CREATE INDEX "ContentProgress_contentId_idx" ON "ContentProgress"("contentId");
