-- Additive Main-only encrypted OAuth configuration. No row or secret is seeded.
-- The existing checksummed SQLite runner owns transaction and migration history.
CREATE TABLE "OAuthConfiguration" (
  "id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OAuthConfiguration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthConfiguration_id_check" CHECK (typeof("id") = 'text' AND "id" = 'main-oauth'),
  CONSTRAINT "OAuthConfiguration_revision_check" CHECK (
    typeof("revision") = 'integer' AND "revision" >= 1 AND "revision" <= 2147483647
  ),
  CONSTRAINT "OAuthConfiguration_encryptedPayload_check" CHECK (
    typeof("encryptedPayload") = 'text'
    AND length("encryptedPayload") BETWEEN 1 AND 32768
    AND length(CAST("encryptedPayload" AS BLOB)) <= 32768
  )
);
