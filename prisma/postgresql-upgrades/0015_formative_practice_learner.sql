-- CreateTable
CREATE TABLE "PracticeLearnerSetting" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetTokenHash" TEXT,
    "resetTokenExpiresAt" TIMESTAMP(3),

    CONSTRAINT "PracticeLearnerSetting_pkey" PRIMARY KEY ("userId","courseId")
);

-- CreateTable
CREATE TABLE "PracticeLearnerSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "pendingReservationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeLearnerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeLearnerReservation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemRevision" INTEGER NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeLearnerReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeLearnerAnswer" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "canContinue" BOOLEAN NOT NULL DEFAULT true,
    "confidence" "QuizConfidence",
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeLearnerAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeLearnerSubmissionReceipt" (
    "sessionId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeLearnerSubmissionReceipt_pkey" PRIMARY KEY ("sessionId","submissionId")
);

-- CreateTable
CREATE TABLE "PracticeLearnerSchedule" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemRevision" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastAnsweredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeLearnerSchedule_pkey" PRIMARY KEY ("userId","courseId","snapshotId","itemId")
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

-- AddForeignKey
ALTER TABLE "PracticeLearnerSetting" ADD CONSTRAINT "PracticeLearnerSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLearnerSetting" ADD CONSTRAINT "PracticeLearnerSetting_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLearnerSession" ADD CONSTRAINT "PracticeLearnerSession_userId_courseId_fkey" FOREIGN KEY ("userId", "courseId") REFERENCES "PracticeLearnerSetting"("userId", "courseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLearnerSession" ADD CONSTRAINT "PracticeLearnerSession_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PracticeSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLearnerReservation" ADD CONSTRAINT "PracticeLearnerReservation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeLearnerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLearnerAnswer" ADD CONSTRAINT "PracticeLearnerAnswer_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PracticeLearnerReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLearnerSubmissionReceipt" ADD CONSTRAINT "PracticeLearnerSubmissionReceipt_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "PracticeLearnerAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLearnerSchedule" ADD CONSTRAINT "PracticeLearnerSchedule_userId_courseId_fkey" FOREIGN KEY ("userId", "courseId") REFERENCES "PracticeLearnerSetting"("userId", "courseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLearnerSchedule" ADD CONSTRAINT "PracticeLearnerSchedule_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PracticeSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One live learner session per course, even under concurrent starts.
CREATE TABLE "PracticeRetentionHealth" (
  "id" TEXT NOT NULL,
  "lastSuccessAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PracticeRetentionHealth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PracticeLearnerSession_one_active_key" ON "PracticeLearnerSession"("userId", "courseId") WHERE "status" = 'ACTIVE';
ALTER TABLE "PracticeLearnerSession" ADD CONSTRAINT "PracticeLearnerSession_status_check"
  CHECK ("status" IN ('ACTIVE','COMPLETE','SUPERSEDED') AND "answeredCount" BETWEEN 0 AND 10);
