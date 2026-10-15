-- CreateTable
CREATE TABLE "PracticeLearnerSetting" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetTokenHash" TEXT,
    "resetTokenExpiresAt" DATETIME,

    PRIMARY KEY ("userId", "courseId"),
    CONSTRAINT "PracticeLearnerSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeLearnerSetting_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "pendingReservationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PracticeLearnerSession_userId_courseId_fkey" FOREIGN KEY ("userId", "courseId") REFERENCES "PracticeLearnerSetting" ("userId", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeLearnerSession_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PracticeSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemRevision" INTEGER NOT NULL,
    "shownAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeLearnerReservation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeLearnerSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "canContinue" BOOLEAN NOT NULL DEFAULT true,
    "confidence" TEXT,
    "nextDueAt" DATETIME NOT NULL,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeLearnerAnswer_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PracticeLearnerReservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerSubmissionReceipt" (
    "sessionId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("sessionId", "submissionId"),
    CONSTRAINT "PracticeLearnerSubmissionReceipt_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "PracticeLearnerAnswer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerSchedule" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemRevision" INTEGER NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastAnsweredAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "courseId", "snapshotId", "itemId"),
    CONSTRAINT "PracticeLearnerSchedule_userId_courseId_fkey" FOREIGN KEY ("userId", "courseId") REFERENCES "PracticeLearnerSetting" ("userId", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeLearnerSchedule_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PracticeSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PracticeLearnerSetting_lastActivityAt_idx" ON "PracticeLearnerSetting"("lastActivityAt");

-- CreateIndex
CREATE INDEX "PracticeLearnerSession_userId_courseId_status_idx" ON "PracticeLearnerSession"("userId", "courseId", "status");

-- CreateIndex
CREATE INDEX "PracticeLearnerSession_snapshotId_idx" ON "PracticeLearnerSession"("snapshotId");

-- CreateIndex
CREATE INDEX "PracticeLearnerReservation_itemId_itemRevision_idx" ON "PracticeLearnerReservation"("itemId", "itemRevision");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLearnerReservation_sessionId_ordinal_key" ON "PracticeLearnerReservation"("sessionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLearnerReservation_sessionId_itemId_key" ON "PracticeLearnerReservation"("sessionId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLearnerAnswer_reservationId_key" ON "PracticeLearnerAnswer"("reservationId");

-- CreateIndex
CREATE INDEX "PracticeLearnerAnswer_answeredAt_idx" ON "PracticeLearnerAnswer"("answeredAt");

-- CreateIndex
CREATE INDEX "PracticeLearnerSubmissionReceipt_createdAt_idx" ON "PracticeLearnerSubmissionReceipt"("createdAt");

-- CreateIndex
CREATE INDEX "PracticeLearnerSchedule_userId_courseId_snapshotId_dueAt_idx" ON "PracticeLearnerSchedule"("userId", "courseId", "snapshotId", "dueAt");

-- One live learner session per course, even under concurrent starts.
CREATE TABLE "PracticeRetentionHealth" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lastSuccessAt" DATETIME,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "PracticeLearnerSession_one_active_key" ON "PracticeLearnerSession"("userId", "courseId") WHERE "status" = 'ACTIVE';
CREATE TRIGGER "PracticeLearnerSession_valid_status_insert" BEFORE INSERT ON "PracticeLearnerSession"
WHEN NEW."status" NOT IN ('ACTIVE','COMPLETE','SUPERSEDED') OR NEW."answeredCount" < 0 OR NEW."answeredCount" > 10
BEGIN SELECT RAISE(ABORT, 'Invalid practice session'); END;
CREATE TRIGGER "PracticeLearnerSession_valid_status_update" BEFORE UPDATE ON "PracticeLearnerSession"
WHEN NEW."status" NOT IN ('ACTIVE','COMPLETE','SUPERSEDED') OR NEW."answeredCount" < 0 OR NEW."answeredCount" > 10
BEGIN SELECT RAISE(ABORT, 'Invalid practice session'); END;
