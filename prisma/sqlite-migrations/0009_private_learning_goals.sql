-- One private opt-in challenge per account. Progress is derived at read time.
CREATE TABLE "LearningGoal" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "targetLeaves" INTEGER NOT NULL CHECK ("targetLeaves" IN (1, 3, 5)),
  "durationDays" INTEGER NOT NULL CHECK ("durationDays" IN (7, 14, 28)),
  "timezone" TEXT NOT NULL CHECK (length("timezone") BETWEEN 1 AND 100),
  "startedAt" DATETIME NOT NULL,
  "endsAt" DATETIME NOT NULL,
  "pausedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LearningGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningGoal_window_check" CHECK ("endsAt" > "startedAt")
);
