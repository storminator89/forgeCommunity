-- Additive Main-only encrypted OAuth configuration. No row or secret is seeded.
-- The existing checksummed PostgreSQL runner owns transaction and schema scope.
CREATE TABLE "OAuthConfiguration" (
  "id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OAuthConfiguration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthConfiguration_id_check" CHECK ("id" = 'main-oauth'),
  CONSTRAINT "OAuthConfiguration_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "OAuthConfiguration_encryptedPayload_check" CHECK (
    length("encryptedPayload") BETWEEN 1 AND 32768
    AND octet_length("encryptedPayload") <= 32768
  )
);
