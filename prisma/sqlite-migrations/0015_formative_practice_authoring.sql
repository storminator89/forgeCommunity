-- Private formative authoring. No credential quiz or learner-attempt tables change.
CREATE UNIQUE INDEX "CoursePublication_id_courseId_key" ON "CoursePublication"("id", "courseId");

CREATE TABLE "PracticeObjective" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticeObjective_ownerId_updatedAt_idx" ON "PracticeObjective"("ownerId", "updatedAt");
CREATE UNIQUE INDEX "PracticeObjective_id_ownerId_key" ON "PracticeObjective"("id", "ownerId");

CREATE TABLE "PracticeItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "latestRevision" INTEGER NOT NULL DEFAULT 1 CHECK ("latestRevision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("objectiveId", "ownerId") REFERENCES "PracticeObjective"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticeItem_ownerId_updatedAt_idx" ON "PracticeItem"("ownerId", "updatedAt");
CREATE INDEX "PracticeItem_objectiveId_idx" ON "PracticeItem"("objectiveId");

CREATE TABLE "PracticeItemRevision" (
  "itemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "payload" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("itemId", "revision"),
  FOREIGN KEY ("itemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TRIGGER "PracticeItemRevision_no_update" BEFORE UPDATE ON "PracticeItemRevision"
BEGIN SELECT RAISE(ABORT, 'Practice item revisions are immutable'); END;
CREATE TRIGGER "PracticeItemRevision_no_direct_delete" BEFORE DELETE ON "PracticeItemRevision"
WHEN EXISTS (SELECT 1 FROM "PracticeItem" WHERE "id" = OLD."itemId")
BEGIN SELECT RAISE(ABORT, 'Practice item revisions are immutable'); END;
CREATE TRIGGER "PracticeItemRevision_no_replace" BEFORE INSERT ON "PracticeItemRevision"
WHEN EXISTS (SELECT 1 FROM "PracticeItemRevision" WHERE "itemId" = NEW."itemId" AND "revision" = NEW."revision")
BEGIN SELECT RAISE(ABORT, 'Practice item revisions are immutable'); END;

CREATE TABLE "CoursePracticeDraft" (
  "courseId" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "payload" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "lastEditorId" TEXT,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PracticeSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "courseId" TEXT NOT NULL,
  "coursePublicationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "draftRevision" INTEGER NOT NULL CHECK ("draftRevision" >= 0),
  "payload" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL CHECK ("itemCount" > 0),
  "actorId" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("coursePublicationId", "courseId") REFERENCES "CoursePublication"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PracticeSnapshot_courseId_sequence_key" ON "PracticeSnapshot"("courseId", "sequence");
CREATE UNIQUE INDEX "PracticeSnapshot_id_courseId_key" ON "PracticeSnapshot"("id", "courseId");
CREATE INDEX "PracticeSnapshot_courseId_coursePublicationId_sequence_idx" ON "PracticeSnapshot"("courseId", "coursePublicationId", "sequence");
CREATE TRIGGER "PracticeSnapshot_no_update" BEFORE UPDATE ON "PracticeSnapshot"
BEGIN SELECT RAISE(ABORT, 'Practice snapshots are immutable'); END;
CREATE TRIGGER "PracticeSnapshot_no_direct_delete" BEFORE DELETE ON "PracticeSnapshot"
WHEN EXISTS (SELECT 1 FROM "Course" WHERE "id" = OLD."courseId")
BEGIN SELECT RAISE(ABORT, 'Practice snapshots are immutable'); END;
CREATE TRIGGER "PracticeSnapshot_no_replace" BEFORE INSERT ON "PracticeSnapshot"
WHEN EXISTS (SELECT 1 FROM "PracticeSnapshot" WHERE "id" = NEW."id" OR
  ("courseId" = NEW."courseId" AND "sequence" = NEW."sequence"))
BEGIN SELECT RAISE(ABORT, 'Practice snapshots are immutable'); END;

CREATE TABLE "PracticePublicationRequest" (
  "courseId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("courseId", "requestId"),
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("snapshotId", "courseId") REFERENCES "PracticeSnapshot"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticePublicationRequest_snapshotId_idx" ON "PracticePublicationRequest"("snapshotId");
CREATE TRIGGER "PracticePublicationRequest_no_update" BEFORE UPDATE ON "PracticePublicationRequest"
BEGIN SELECT RAISE(ABORT, 'Practice publication receipts are immutable'); END;
CREATE TRIGGER "PracticePublicationRequest_no_direct_delete" BEFORE DELETE ON "PracticePublicationRequest"
WHEN EXISTS (SELECT 1 FROM "Course" WHERE "id" = OLD."courseId")
BEGIN SELECT RAISE(ABORT, 'Practice publication receipts are immutable'); END;
CREATE TRIGGER "PracticePublicationRequest_no_replace" BEFORE INSERT ON "PracticePublicationRequest"
WHEN EXISTS (SELECT 1 FROM "PracticePublicationRequest" WHERE "courseId" = NEW."courseId" AND "requestId" = NEW."requestId")
BEGIN SELECT RAISE(ABORT, 'Practice publication receipts are immutable'); END;

-- REPLACE deletes a conflicting parent before inserting, and with SQLite's
-- default recursive_triggers=OFF the child DELETE triggers do not protect
-- history from that implicit FK cascade. Reject parent conflicts up front.
-- Ordinary UPDATE and intentional DELETE cascades retain their normal behavior.
CREATE TRIGGER "PracticeObjective_no_replace" BEFORE INSERT ON "PracticeObjective"
WHEN EXISTS (SELECT 1 FROM "PracticeObjective" WHERE "id" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'Practice objectives cannot be replaced'); END;
CREATE TRIGGER "PracticeItem_no_replace" BEFORE INSERT ON "PracticeItem"
WHEN EXISTS (SELECT 1 FROM "PracticeItem" WHERE "id" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'Practice items cannot be replaced'); END;
-- During an account FK cascade the User row has already gone. A direct delete
-- while the account/objective still exist would silently erase all revisions.
CREATE TRIGGER "PracticeObjective_no_direct_delete" BEFORE DELETE ON "PracticeObjective"
WHEN EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."ownerId")
BEGIN SELECT RAISE(ABORT, 'Practice objectives cannot be directly deleted'); END;
CREATE TRIGGER "PracticeItem_no_direct_delete" BEFORE DELETE ON "PracticeItem"
WHEN EXISTS (SELECT 1 FROM "PracticeObjective" o JOIN "User" u ON u."id" = o."ownerId"
  WHERE o."id" = OLD."objectiveId" AND o."ownerId" = OLD."ownerId")
BEGIN SELECT RAISE(ABORT, 'Practice items cannot be directly deleted'); END;

-- A credential-course publication has no supported UPSERT path. Block
-- conflicts that would erase a published formative snapshot and its receipts.
CREATE TRIGGER "CoursePublication_no_replace_with_practice" BEFORE INSERT ON "CoursePublication"
WHEN EXISTS (SELECT 1 FROM "PracticeSnapshot" s JOIN "CoursePublication" p
  ON p."id" = s."coursePublicationId" AND p."courseId" = s."courseId"
  WHERE p."id" = NEW."id" OR (p."courseId" = NEW."courseId" AND p."sequence" = NEW."sequence"))
BEGIN SELECT RAISE(ABORT, 'Course publication with practice cannot be replaced'); END;
