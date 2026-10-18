-- PREPARATION ONLY. No live migration was applied by this task.
-- Review and apply separately to the intended Sites D1 database, then verify.
-- Kept outside drizzle so merely publishing this inactive preparation cannot
-- implicitly apply it. OAuth remains off until OAUTH_TRANSACTION_MIGRATION_READY
-- is true AND the runtime read-only schema check succeeds.
-- This transient Sites-only table is managed directly through the D1 API and
-- is intentionally outside Prisma's cross-deployment business-domain schema.
CREATE TABLE "OAuthLoginTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bindingHash" TEXT NOT NULL,
  "browserBindingHash" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google', 'oidc', 'browser')),
  "createdAt" INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "consumedAt" INTEGER,
  "finalizedAt" INTEGER,
  "issuedSessionId" TEXT,
  CHECK ("expiresAt" > "createdAt"),
  CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt"),
  CHECK ("finalizedAt" IS NULL OR ("consumedAt" IS NOT NULL AND "finalizedAt" >= "consumedAt")),
  CHECK (("finalizedAt" IS NULL AND "issuedSessionId" IS NULL) OR ("finalizedAt" IS NOT NULL AND "issuedSessionId" IS NOT NULL)),
  CHECK ("provider" <> 'browser' OR ("id" = 'browser:' || "browserBindingHash" AND "bindingHash" = "browserBindingHash" AND "finalizedAt" IS NULL))
);
CREATE INDEX "OAuthLoginTransaction_expiresAt_idx" ON "OAuthLoginTransaction" ("expiresAt");
CREATE INDEX "OAuthLoginTransaction_browserBindingHash_idx" ON "OAuthLoginTransaction" ("browserBindingHash");
