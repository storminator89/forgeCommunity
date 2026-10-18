-- PREPARED ONLY. Do not add to drizzle or run against any database until the
-- owner explicitly authorizes this separate live-database migration.
-- Purely additive: no ALTER/DROP, existing identity/account/role/session data
-- and OAuthLoginTransaction are untouched. The host encryption key must be
-- provisioned separately; SQL contains no provider or encryption secret.
CREATE TABLE "OAuthProviderConfigurationSingleton" (
  "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'singleton'),
  "version" INTEGER NOT NULL CHECK (typeof("version") = 'integer' AND "version" BETWEEN 1 AND 9007199254740990),
  "ciphertext" TEXT NOT NULL CHECK (typeof("ciphertext") = 'text' AND length(CAST("ciphertext" AS BLOB)) BETWEEN 1 AND 32768),
  "createdAt" INTEGER NOT NULL CHECK (typeof("createdAt") = 'integer' AND "createdAt" > 0),
  "updatedAt" INTEGER NOT NULL CHECK (typeof("updatedAt") = 'integer' AND "updatedAt" >= "createdAt"),
  "updatedById" TEXT NOT NULL CHECK (typeof("updatedById") = 'text' AND length("updatedById") BETWEEN 1 AND 256)
);
