-- Report rows intentionally survive target and account deletion for audit.
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL CHECK ("targetType" IN ('POST', 'COMMENT')),
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL CHECK ("reason" IN ('SPAM', 'HARASSMENT', 'HATE', 'UNSAFE', 'OTHER')),
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'DISMISSED', 'RESOLVED')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    "resolutionNote" TEXT,
    CONSTRAINT "ContentReport_resolution_check" CHECK (
        ("status" = 'OPEN' AND "reviewedAt" IS NULL AND "reviewedById" IS NULL AND "resolutionNote" IS NULL)
        OR ("status" <> 'OPEN' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "resolutionNote" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "ContentReport_reporterId_targetType_targetId_key" ON "ContentReport"("reporterId", "targetType", "targetId");
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport"("targetType", "targetId");
