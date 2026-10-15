-- Keep reports after a target or account is deleted for a durable review trail.
-- Polymorphic target IDs are validated by the reporting route, not foreign keys.
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "resolutionNote" TEXT,
    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentReport_targetType_check" CHECK ("targetType" IN ('POST', 'COMMENT')),
    CONSTRAINT "ContentReport_reason_check" CHECK ("reason" IN ('SPAM', 'HARASSMENT', 'HATE', 'UNSAFE', 'OTHER')),
    CONSTRAINT "ContentReport_status_check" CHECK ("status" IN ('OPEN', 'DISMISSED', 'RESOLVED')),
    CONSTRAINT "ContentReport_resolution_check" CHECK (
        ("status" = 'OPEN' AND "reviewedAt" IS NULL AND "reviewedById" IS NULL AND "resolutionNote" IS NULL)
        OR ("status" <> 'OPEN' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "resolutionNote" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "ContentReport_reporterId_targetType_targetId_key" ON "ContentReport"("reporterId", "targetType", "targetId");
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport"("targetType", "targetId");
