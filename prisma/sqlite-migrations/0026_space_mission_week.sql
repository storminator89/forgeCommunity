-- Additive soft-week metadata. Existing missions stay self-paced (all NULL).
-- Resolve calendar boundaries in the application; a week need not be 168 hours.
-- The final column CHECK applies to the entire row on INSERT and UPDATE.
ALTER TABLE "SpaceMission" ADD COLUMN "weekStartsOn" TEXT;
ALTER TABLE "SpaceMission" ADD COLUMN "weekTimezone" TEXT;
ALTER TABLE "SpaceMission" ADD COLUMN "weekStartsAt" DATETIME;
ALTER TABLE "SpaceMission" ADD COLUMN "weekEndsAt" DATETIME
  CONSTRAINT "SpaceMission_week_complete_range" CHECK (
    ("weekStartsOn" IS NULL AND "weekTimezone" IS NULL AND "weekStartsAt" IS NULL AND "weekEndsAt" IS NULL)
    OR
    ("weekStartsOn" IS NOT NULL AND "weekTimezone" IS NOT NULL AND "weekStartsAt" IS NOT NULL AND "weekEndsAt" IS NOT NULL
      AND length("weekTimezone") BETWEEN 1 AND 100 AND "weekEndsAt" > "weekStartsAt")
  );
