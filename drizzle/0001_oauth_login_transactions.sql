-- Additive Sites-only OAuth transaction storage; no provider activation.
-- Exact DDL from docs/migrations/SITES_OAUTH_TRANSACTIONS.sql at
-- 5bb1807557c6cb0cdcd7d6dca35c08d50aab9306 (source SHA256
-- 9ca82765080cdd3eef0b396b5b24cc80dbc0e814537f0aba5ecac46e277afc27).
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
--> statement-breakpoint
CREATE INDEX "OAuthLoginTransaction_expiresAt_idx" ON "OAuthLoginTransaction" ("expiresAt");
--> statement-breakpoint
CREATE INDEX "OAuthLoginTransaction_browserBindingHash_idx" ON "OAuthLoginTransaction" ("browserBindingHash");
