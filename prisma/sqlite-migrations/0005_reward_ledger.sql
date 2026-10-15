ALTER TABLE "User" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ADD COLUMN "publicRankingOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Course" ADD COLUMN "rewardEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Course" ADD COLUMN "rewardApprovalRevision" TEXT;

CREATE TABLE "RewardLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL CHECK ("eventType" IN ('COURSE_COMPLETED')),
    "sourceId" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "points" INTEGER NOT NULL CHECK ("points" > 0),
    "stateVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("stateVersion" > 0),
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "RewardLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RewardLedger_userId_eventType_sourceId_key" ON "RewardLedger"("userId", "eventType", "sourceId");
CREATE INDEX "RewardLedger_userId_revokedAt_idx" ON "RewardLedger"("userId", "revokedAt");
CREATE INDEX "RewardLedger_eventType_sourceId_idx" ON "RewardLedger"("eventType", "sourceId");

CREATE TABLE "RewardLedgerChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ledgerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL CHECK ("version" > 0),
    "type" TEXT NOT NULL CHECK ("type" IN ('AWARDED', 'REVOKED', 'REINSTATED')),
    "reason" TEXT CHECK ("reason" IN ('QUIZ_REVISED', 'APPROVAL_WITHDRAWN', 'LEARNING_CHANGED', 'ACCOUNT_INELIGIBLE', 'COURSE_REMOVED')),
    "pointsDelta" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardLedgerChange_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "RewardLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RewardLedgerChange_reason_check" CHECK (("type" = 'REVOKED' AND "reason" IS NOT NULL AND "pointsDelta" < 0) OR ("type" <> 'REVOKED' AND "reason" IS NULL AND "pointsDelta" > 0))
);

CREATE UNIQUE INDEX "RewardLedgerChange_ledgerId_version_key" ON "RewardLedgerChange"("ledgerId", "version");
CREATE INDEX "RewardLedgerChange_createdAt_idx" ON "RewardLedgerChange"("createdAt");

-- No course FK: preserve earned private milestones after course deletion.
CREATE TABLE "CourseCompletionRecord" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL,
    CONSTRAINT "CourseCompletionRecord_pkey" PRIMARY KEY ("userId", "courseId"),
    CONSTRAINT "CourseCompletionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CourseCompletionRecord_userId_completedAt_idx" ON "CourseCompletionRecord"("userId", "completedAt");
INSERT OR IGNORE INTO "CourseCompletionRecord" ("userId", "courseId", "courseTitle", "completedAt")
SELECT e."userId", e."courseId", c."title", e."completedAt"
FROM "Enrollment" e JOIN "Course" c ON c."id" = e."courseId"
WHERE e."completedAt" IS NOT NULL;
