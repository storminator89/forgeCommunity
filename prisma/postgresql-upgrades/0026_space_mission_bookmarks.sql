-- Additive self-only bookmarks. Existing mission, membership and consent rows
-- are unchanged. Deploy this tail before serving bookmark-capable application code.
CREATE TABLE "SpaceMissionBookmarkSetting" (
  "missionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "savedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL,
  CONSTRAINT "SpaceMissionBookmarkSetting_pkey" PRIMARY KEY ("missionId", "userId"),
  CONSTRAINT "SpaceMissionBookmarkSetting_revision_check" CHECK ("revision" > 0 AND "revision" <= 2147483647),
  CONSTRAINT "SpaceMissionBookmarkSetting_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceMissionBookmarkSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SpaceMissionBookmarkSetting_userId_savedAt_idx" ON "SpaceMissionBookmarkSetting" ("userId", "savedAt");

CREATE TABLE "SpaceMissionBookmarkAccess" (
  "userId" TEXT NOT NULL,
  "epoch" INTEGER NOT NULL,
  CONSTRAINT "SpaceMissionBookmarkAccess_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "SpaceMissionBookmarkAccess_epoch_check" CHECK ("epoch" >= 0 AND "epoch" <= 2147483647),
  CONSTRAINT "SpaceMissionBookmarkAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
