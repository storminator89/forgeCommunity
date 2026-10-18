-- Additive OAuth admin configuration table, separately approved on 2026-10-18.
-- No data is seeded or changed; encryption key remains outside this database.
CREATE TABLE "OAuthProviderConfigurationSingleton" (
  "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'singleton'),
  "version" INTEGER NOT NULL CHECK (typeof("version") = 'integer' AND "version" BETWEEN 1 AND 9007199254740990),
  "ciphertext" TEXT NOT NULL CHECK (typeof("ciphertext") = 'text' AND length(CAST("ciphertext" AS BLOB)) BETWEEN 1 AND 32768),
  "createdAt" INTEGER NOT NULL CHECK (typeof("createdAt") = 'integer' AND "createdAt" > 0),
  "updatedAt" INTEGER NOT NULL CHECK (typeof("updatedAt") = 'integer' AND "updatedAt" >= "createdAt"),
  "updatedById" TEXT NOT NULL CHECK (typeof("updatedById") = 'text' AND length("updatedById") BETWEEN 1 AND 256)
);
