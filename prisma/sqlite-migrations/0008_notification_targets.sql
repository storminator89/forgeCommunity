-- Typed server-owned targets; old notifications remain text-only.
ALTER TABLE "Notification" ADD COLUMN "targetType" TEXT;
ALTER TABLE "Notification" ADD COLUMN "targetId" TEXT;
CREATE INDEX "Notification_userId_targetType_targetId_idx" ON "Notification"("userId", "targetType", "targetId");
