-- Additive soft-week metadata. Existing missions stay self-paced (all NULL).
-- Resolve calendar boundaries in the application; a week need not be 168 hours.
ALTER TABLE "SpaceMission"
  ADD COLUMN "weekStartsOn" TEXT,
  ADD COLUMN "weekTimezone" TEXT,
  ADD COLUMN "weekStartsAt" TIMESTAMP(3),
  ADD COLUMN "weekEndsAt" TIMESTAMP(3),
  ADD CONSTRAINT "SpaceMission_week_complete_range" CHECK (
    ("weekStartsOn" IS NULL AND "weekTimezone" IS NULL AND "weekStartsAt" IS NULL AND "weekEndsAt" IS NULL)
    OR
    ("weekStartsOn" IS NOT NULL AND "weekTimezone" IS NOT NULL AND "weekStartsAt" IS NOT NULL AND "weekEndsAt" IS NOT NULL
      AND length("weekTimezone") BETWEEN 1 AND 100 AND "weekEndsAt" > "weekStartsAt")
  );
