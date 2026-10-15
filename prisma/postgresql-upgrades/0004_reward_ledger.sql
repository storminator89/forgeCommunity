CREATE TYPE "RewardEventType" AS ENUM ('COURSE_COMPLETED');
CREATE TYPE "RewardChangeType" AS ENUM ('AWARDED', 'REVOKED', 'REINSTATED');
CREATE TYPE "RewardChangeReason" AS ENUM ('QUIZ_REVISED', 'APPROVAL_WITHDRAWN', 'LEARNING_CHANGED', 'ACCOUNT_INELIGIBLE', 'COURSE_REMOVED');

ALTER TABLE "User" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ADD COLUMN "publicRankingOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Course" ADD COLUMN "rewardEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Course" ADD COLUMN "rewardApprovalRevision" TEXT;

CREATE TABLE "RewardLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "RewardEventType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "RewardLedger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RewardLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RewardLedger_points_check" CHECK ("points" > 0),
    CONSTRAINT "RewardLedger_stateVersion_check" CHECK ("stateVersion" > 0)
);

CREATE UNIQUE INDEX "RewardLedger_userId_eventType_sourceId_key" ON "RewardLedger"("userId", "eventType", "sourceId");
CREATE INDEX "RewardLedger_userId_revokedAt_idx" ON "RewardLedger"("userId", "revokedAt");
CREATE INDEX "RewardLedger_eventType_sourceId_idx" ON "RewardLedger"("eventType", "sourceId");

CREATE TABLE "RewardLedgerChange" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "RewardChangeType" NOT NULL,
    "reason" "RewardChangeReason",
    "pointsDelta" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardLedgerChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RewardLedgerChange_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "RewardLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RewardLedgerChange_version_check" CHECK ("version" > 0),
    CONSTRAINT "RewardLedgerChange_reason_check" CHECK (("type" = 'REVOKED' AND "reason" IS NOT NULL AND "pointsDelta" < 0) OR ("type" <> 'REVOKED' AND "reason" IS NULL AND "pointsDelta" > 0))
);

CREATE UNIQUE INDEX "RewardLedgerChange_ledgerId_version_key" ON "RewardLedgerChange"("ledgerId", "version");
CREATE INDEX "RewardLedgerChange_createdAt_idx" ON "RewardLedgerChange"("createdAt");

-- A private first-completion snapshot has no course FK, so ordinary course
-- deletion cannot erase previously earned learning history. User deletion
-- still cascades the snapshot.
CREATE TABLE "CourseCompletionRecord" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseCompletionRecord_pkey" PRIMARY KEY ("userId", "courseId"),
    CONSTRAINT "CourseCompletionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CourseCompletionRecord_userId_completedAt_idx" ON "CourseCompletionRecord"("userId", "completedAt");
INSERT INTO "CourseCompletionRecord" ("userId", "courseId", "courseTitle", "completedAt")
SELECT e."userId", e."courseId", c."title", e."completedAt"
FROM "Enrollment" e JOIN "Course" c ON c."id" = e."courseId"
WHERE e."completedAt" IS NOT NULL
ON CONFLICT ("userId", "courseId") DO NOTHING;
