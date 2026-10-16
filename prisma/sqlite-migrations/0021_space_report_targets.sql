-- SQLite cannot widen a CHECK in place. Preserve report history and the
-- original resolution invariant while rebuilding this FK-free audit table.
CREATE TABLE "ContentReport_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL CHECK ("targetType" IN ('POST', 'COMMENT', 'SPACE_DISCUSSION', 'SPACE_REPLY')),
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
        OR ("targetType" IN ('SPACE_DISCUSSION', 'SPACE_REPLY') AND "scopeSpaceId" IS NOT NULL)
    )
);

INSERT INTO "ContentReport_new" ("id", "reporterId", "targetType", "targetId", "reason", "details",
    "status", "createdAt", "reviewedAt", "reviewedById", "resolutionNote", "scopeSpaceId")
SELECT "id", "reporterId", "targetType", "targetId", "reason", "details",
    "status", "createdAt", "reviewedAt", "reviewedById", "resolutionNote", "scopeSpaceId"
FROM "ContentReport";
DROP TABLE "ContentReport";
ALTER TABLE "ContentReport_new" RENAME TO "ContentReport";

CREATE UNIQUE INDEX "ContentReport_reporterId_targetType_targetId_key" ON "ContentReport"("reporterId", "targetType", "targetId");
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport"("targetType", "targetId");
CREATE INDEX "ContentReport_scopeSpaceId_status_createdAt_idx" ON "ContentReport"("scopeSpaceId", "status", "createdAt");
