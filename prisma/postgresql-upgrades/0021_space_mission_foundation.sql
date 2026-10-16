-- Additive private-Space mission foundation. Application transactions enforce
-- private visibility, current membership, explicit consent and capacity.
CREATE TABLE "SpaceMission" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "creatorId" TEXT,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "SpaceMission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SpaceMission_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpaceMission_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SpaceMission_spaceId_createdAt_id_idx" ON "SpaceMission"("spaceId", "createdAt", "id");
CREATE UNIQUE INDEX "SpaceMission_spaceId_requestId_key" ON "SpaceMission"("spaceId", "requestId");
CREATE UNIQUE INDEX "SpaceMission_one_open_per_space" ON "SpaceMission"("spaceId") WHERE "closedAt" IS NULL;

CREATE TABLE "SpaceMissionParticipation" (
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL CHECK ("epoch" > 0),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optedOutAt" TIMESTAMP(3),
    CONSTRAINT "SpaceMissionParticipation_pkey" PRIMARY KEY ("missionId", "userId"),
    CONSTRAINT "SpaceMissionParticipation_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SpaceMissionParticipation_userId_optedOutAt_idx" ON "SpaceMissionParticipation"("userId", "optedOutAt");
CREATE INDEX "SpaceMissionParticipation_missionId_optedOutAt_idx" ON "SpaceMissionParticipation"("missionId", "optedOutAt");
