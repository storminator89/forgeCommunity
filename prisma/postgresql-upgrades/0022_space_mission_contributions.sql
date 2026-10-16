CREATE TYPE "SpaceMissionContributionKind" AS ENUM ('INSIGHT', 'BUILD_ON');
CREATE TABLE "SpaceMissionContribution" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL CHECK ("epoch" > 0),
    "kind" "SpaceMissionContributionKind" NOT NULL,
    "content" TEXT NOT NULL,
    "targetContributionId" TEXT,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    CONSTRAINT "SpaceMissionContribution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SpaceMissionContribution_missionId_id_key" UNIQUE ("missionId", "id"),
    CONSTRAINT "SpaceMissionContribution_kind_target_check" CHECK (("kind" = 'INSIGHT' AND "targetContributionId" IS NULL) OR ("kind" = 'BUILD_ON' AND "targetContributionId" IS NOT NULL)),
    CONSTRAINT "SpaceMissionContribution_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionContribution_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionContribution_missionId_targetContributionId_fkey" FOREIGN KEY ("missionId", "targetContributionId") REFERENCES "SpaceMissionContribution" ("missionId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SpaceMissionContribution_missionId_authorId_requestId_key" ON "SpaceMissionContribution"("missionId", "authorId", "requestId");
CREATE INDEX "SpaceMissionContribution_missionId_createdAt_id_idx" ON "SpaceMissionContribution"("missionId", "createdAt", "id");
CREATE INDEX "SpaceMissionContribution_missionId_authorId_epoch_kind_idx" ON "SpaceMissionContribution"("missionId", "authorId", "epoch", "kind");
CREATE INDEX "SpaceMissionContribution_authorId_idx" ON "SpaceMissionContribution"("authorId");
CREATE UNIQUE INDEX "SpaceMissionContribution_one_live_kind" ON "SpaceMissionContribution"("missionId", "authorId", "epoch", "kind") WHERE "hiddenAt" IS NULL AND "withdrawnAt" IS NULL;

-- The runner fixes search_path to the selected schema. Never qualify public.
ALTER TABLE "ContentReport" DROP CONSTRAINT "ContentReport_targetType_check";
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_targetType_check" CHECK ("targetType" IN ('POST', 'COMMENT', 'SPACE_DISCUSSION', 'SPACE_REPLY', 'SPACE_MISSION_CONTRIBUTION'));
ALTER TABLE "ContentReport" DROP CONSTRAINT "ContentReport_scope_check";
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_scope_check" CHECK (
    ("targetType" IN ('POST', 'COMMENT') AND "scopeSpaceId" IS NULL)
    OR ("targetType" IN ('SPACE_DISCUSSION', 'SPACE_REPLY', 'SPACE_MISSION_CONTRIBUTION') AND "scopeSpaceId" IS NOT NULL)
);
