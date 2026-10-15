-- Additive private pathway storage. Published, free, reward-approved courses are
-- checked by the server when an administrator seals a 2–4 course definition.
-- Course IDs are snapshots, not FKs: deleting a course must not erase the audit.
CREATE TABLE "LearningPathway" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "badgeLabel" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sealedAt" DATETIME
);
CREATE TABLE "LearningPathwayCourse" (
  "pathwayId" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" BETWEEN 0 AND 3),
  "courseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  PRIMARY KEY ("pathwayId", "position"),
  FOREIGN KEY ("pathwayId") REFERENCES "LearningPathway"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LearningPathwayCourse_pathwayId_courseId_key" ON "LearningPathwayCourse"("pathwayId", "courseId");
CREATE INDEX "LearningPathwayCourse_courseId_idx" ON "LearningPathwayCourse"("courseId");
CREATE TRIGGER "LearningPathway_seal" BEFORE UPDATE ON "LearningPathway"
WHEN NOT (OLD."sealedAt" IS NULL AND NEW."sealedAt" IS NOT NULL
  AND NEW."id" IS OLD."id" AND NEW."title" IS OLD."title"
  AND NEW."description" IS OLD."description" AND NEW."badgeLabel" IS OLD."badgeLabel"
  AND NEW."createdById" IS OLD."createdById" AND NEW."createdAt" IS OLD."createdAt"
  AND (SELECT COUNT(*) FROM "LearningPathwayCourse" WHERE "pathwayId" = OLD."id") BETWEEN 2 AND 4
  AND (SELECT MIN("position") FROM "LearningPathwayCourse" WHERE "pathwayId" = OLD."id") = 0
  AND (SELECT MAX("position") + 1 FROM "LearningPathwayCourse" WHERE "pathwayId" = OLD."id") =
      (SELECT COUNT(*) FROM "LearningPathwayCourse" WHERE "pathwayId" = OLD."id"))
BEGIN SELECT RAISE(ABORT, 'Pathway definitions are immutable and require 2–4 ordered courses'); END;
CREATE TRIGGER "LearningPathway_no_delete" BEFORE DELETE ON "LearningPathway"
BEGIN SELECT RAISE(ABORT, 'Pathway definitions are immutable'); END;
CREATE TRIGGER "LearningPathway_no_replace" BEFORE INSERT ON "LearningPathway"
WHEN EXISTS (SELECT 1 FROM "LearningPathway" WHERE "id" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'Pathway definitions are immutable'); END;
CREATE TRIGGER "LearningPathwayCourse_unsealed_insert" BEFORE INSERT ON "LearningPathwayCourse"
WHEN NOT EXISTS (SELECT 1 FROM "LearningPathway" WHERE "id" = NEW."pathwayId" AND "sealedAt" IS NULL)
  OR EXISTS (SELECT 1 FROM "LearningPathwayCourse" WHERE "pathwayId" = NEW."pathwayId"
    AND ("position" = NEW."position" OR "courseId" = NEW."courseId"))
BEGIN SELECT RAISE(ABORT, 'Cannot change a sealed pathway or replace a course'); END;
CREATE TRIGGER "LearningPathwayCourse_no_update" BEFORE UPDATE ON "LearningPathwayCourse"
BEGIN SELECT RAISE(ABORT, 'Pathway courses are immutable'); END;
CREATE TRIGGER "LearningPathwayCourse_no_delete" BEFORE DELETE ON "LearningPathwayCourse"
BEGIN SELECT RAISE(ABORT, 'Pathway courses are immutable'); END;

CREATE TABLE "LearningPathwayParticipation" (
  "userId" TEXT NOT NULL,
  "pathwayId" TEXT NOT NULL,
  "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "optedOutAt" DATETIME,
  "badgeActive" BOOLEAN NOT NULL DEFAULT false,
  "badgeFirstAwardedAt" DATETIME,
  "stateVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("stateVersion" >= 0),
  PRIMARY KEY ("userId", "pathwayId"),
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("pathwayId") REFERENCES "LearningPathway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (NOT "badgeActive" OR ("badgeFirstAwardedAt" IS NOT NULL AND "optedOutAt" IS NULL))
);
CREATE INDEX "LearningPathwayParticipation_pathwayId_idx" ON "LearningPathwayParticipation"("pathwayId");
CREATE TRIGGER "LearningPathwayParticipation_no_replace" BEFORE INSERT ON "LearningPathwayParticipation"
WHEN EXISTS (SELECT 1 FROM "LearningPathwayParticipation" WHERE "userId" = NEW."userId" AND "pathwayId" = NEW."pathwayId")
BEGIN SELECT RAISE(ABORT, 'Pathway participation history cannot be replaced'); END;
-- Retain the audit while an account exists. During the user's FK cascade the
-- user row is already gone, so private history may be removed with that user.
CREATE TRIGGER "LearningPathwayParticipation_no_direct_delete" BEFORE DELETE ON "LearningPathwayParticipation"
WHEN EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."userId")
BEGIN SELECT RAISE(ABORT, 'Pathway participation history cannot be deleted'); END;
CREATE TRIGGER "LearningPathwayParticipation_no_direct_rekey" BEFORE UPDATE OF "userId", "pathwayId" ON "LearningPathwayParticipation"
WHEN EXISTS (SELECT 1 FROM "User" WHERE "id" = OLD."userId")
BEGIN SELECT RAISE(ABORT, 'Pathway participation history cannot be rekeyed'); END;
CREATE TABLE "LearningPathwayChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "pathwayId" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "type" TEXT NOT NULL CHECK ("type" IN ('AWARDED', 'REVOKED', 'REINSTATED')),
  "reason" TEXT CHECK ("reason" IN ('REWARD_INVALIDATED', 'OPTED_OUT', 'ACCOUNT_INELIGIBLE')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId", "pathwayId") REFERENCES "LearningPathwayParticipation"("userId", "pathwayId") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (("type" = 'REVOKED' AND "reason" IS NOT NULL) OR ("type" <> 'REVOKED' AND "reason" IS NULL))
);
CREATE UNIQUE INDEX "LearningPathwayChange_userId_pathwayId_version_key" ON "LearningPathwayChange"("userId", "pathwayId", "version");
CREATE INDEX "LearningPathwayChange_createdAt_idx" ON "LearningPathwayChange"("createdAt");
CREATE TRIGGER "LearningPathwayChange_no_replace" BEFORE INSERT ON "LearningPathwayChange"
WHEN EXISTS (SELECT 1 FROM "LearningPathwayChange" WHERE "id" = NEW."id" OR
  ("userId" = NEW."userId" AND "pathwayId" = NEW."pathwayId" AND "version" = NEW."version"))
BEGIN SELECT RAISE(ABORT, 'Pathway changes are append-only'); END;
CREATE TRIGGER "LearningPathwayChange_no_direct_delete" BEFORE DELETE ON "LearningPathwayChange"
WHEN EXISTS (SELECT 1 FROM "LearningPathwayParticipation" WHERE "userId" = OLD."userId" AND "pathwayId" = OLD."pathwayId")
BEGIN SELECT RAISE(ABORT, 'Pathway changes are append-only'); END;
CREATE TRIGGER "LearningPathwayChange_no_direct_update" BEFORE UPDATE ON "LearningPathwayChange"
WHEN NOT (
  NOT EXISTS (SELECT 1 FROM "LearningPathwayParticipation" WHERE "userId" = OLD."userId" AND "pathwayId" = OLD."pathwayId")
  AND EXISTS (SELECT 1 FROM "LearningPathwayParticipation" WHERE "userId" = NEW."userId" AND "pathwayId" = NEW."pathwayId")
  AND NEW."id" IS OLD."id" AND NEW."version" IS OLD."version" AND NEW."type" IS OLD."type"
  AND NEW."reason" IS OLD."reason" AND NEW."createdAt" IS OLD."createdAt")
BEGIN SELECT RAISE(ABORT, 'Pathway changes are append-only'); END;
