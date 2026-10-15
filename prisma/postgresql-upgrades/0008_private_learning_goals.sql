-- One private opt-in challenge per account. The database stores the goal,
-- never a mutable progress count or public score.
CREATE TABLE "LearningGoal" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "targetLeaves" INTEGER NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "timezone" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "pausedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningGoal_targetLeaves_check" CHECK ("targetLeaves" IN (1, 3, 5)),
  CONSTRAINT "LearningGoal_durationDays_check" CHECK ("durationDays" IN (7, 14, 28)),
  CONSTRAINT "LearningGoal_window_check" CHECK ("endsAt" > "startedAt"),
  CONSTRAINT "LearningGoal_timezone_check" CHECK (length("timezone") BETWEEN 1 AND 100)
);
