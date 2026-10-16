CREATE TABLE "SpaceMissionContribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL CHECK ("epoch" > 0),
    "kind" TEXT NOT NULL CHECK ("kind" IN ('INSIGHT', 'BUILD_ON')),
    "content" TEXT NOT NULL,
    "targetContributionId" TEXT,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenAt" DATETIME,
    "withdrawnAt" DATETIME,
    CONSTRAINT "SpaceMissionContribution_kind_target_check" CHECK (("kind" = 'INSIGHT' AND "targetContributionId" IS NULL) OR ("kind" = 'BUILD_ON' AND "targetContributionId" IS NOT NULL)),
    CONSTRAINT "SpaceMissionContribution_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionContribution_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionContribution_missionId_targetContributionId_fkey" FOREIGN KEY ("missionId", "targetContributionId") REFERENCES "SpaceMissionContribution" ("missionId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SpaceMissionContribution_missionId_id_key" ON "SpaceMissionContribution"("missionId", "id");
CREATE UNIQUE INDEX "SpaceMissionContribution_missionId_authorId_requestId_key" ON "SpaceMissionContribution"("missionId", "authorId", "requestId");
CREATE INDEX "SpaceMissionContribution_missionId_createdAt_id_idx" ON "SpaceMissionContribution"("missionId", "createdAt", "id");
CREATE INDEX "SpaceMissionContribution_missionId_authorId_epoch_kind_idx" ON "SpaceMissionContribution"("missionId", "authorId", "epoch", "kind");
CREATE INDEX "SpaceMissionContribution_authorId_idx" ON "SpaceMissionContribution"("authorId");
CREATE UNIQUE INDEX "SpaceMissionContribution_one_live_kind" ON "SpaceMissionContribution"("missionId", "authorId", "epoch", "kind") WHERE "hiddenAt" IS NULL AND "withdrawnAt" IS NULL;

-- Preserve the FK-free moderation audit history while widening only the target
-- and scope checks. Existing resolution invariants and indexes remain intact.
CREATE TABLE "ContentReport_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL CHECK ("targetType" IN ('POST', 'COMMENT', 'SPACE_DISCUSSION', 'SPACE_REPLY', 'SPACE_MISSION_CONTRIBUTION')),
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL CHECK ("reason" IN ('SPAM', 'HARASSMENT', 'HATE', 'UNSAFE', 'OTHER')),
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'DISMISSED', 'RESOLVED')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    "resolutionNote" TEXT,
    "scopeSpaceId" TEXT,
    CONSTRAINT "ContentReport_resolution_check" CHECK (
        ("status" = 'OPEN' AND "reviewedAt" IS NULL AND "reviewedById" IS NULL AND "resolutionNote" IS NULL)
        OR ("status" <> 'OPEN' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "resolutionNote" IS NOT NULL)
    ),
    CONSTRAINT "ContentReport_scope_check" CHECK (
        ("targetType" IN ('POST', 'COMMENT') AND "scopeSpaceId" IS NULL)
        OR ("targetType" IN ('SPACE_DISCUSSION', 'SPACE_REPLY', 'SPACE_MISSION_CONTRIBUTION') AND "scopeSpaceId" IS NOT NULL)
    )
);
INSERT INTO "ContentReport_new" ("id", "reporterId", "targetType", "targetId", "reason", "details", "status", "createdAt", "reviewedAt", "reviewedById", "resolutionNote", "scopeSpaceId")
SELECT "id", "reporterId", "targetType", "targetId", "reason", "details", "status", "createdAt", "reviewedAt", "reviewedById", "resolutionNote", "scopeSpaceId" FROM "ContentReport";
DROP TABLE "ContentReport";
ALTER TABLE "ContentReport_new" RENAME TO "ContentReport";
CREATE UNIQUE INDEX "ContentReport_reporterId_targetType_targetId_key" ON "ContentReport"("reporterId", "targetType", "targetId");
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport"("targetType", "targetId");
CREATE INDEX "ContentReport_scopeSpaceId_status_createdAt_idx" ON "ContentReport"("scopeSpaceId", "status", "createdAt");
