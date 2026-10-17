-- Additive private-mission invitations; preserve all predecessor rows/values.
-- Apply only after serialized integration with the refreshed PR80 predecessor.
-- Domain transactions enforce quotas/fences and scrub pending rows before erasure.

CREATE TYPE "SpaceMissionInvitationState" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

ALTER TABLE "SpaceMission" ADD COLUMN "invitationAttemptCount" INTEGER NOT NULL DEFAULT 0
  CONSTRAINT "SpaceMission_invitationAttemptCount_check" CHECK ("invitationAttemptCount" >= 0 AND "invitationAttemptCount" <= 20);

CREATE TABLE "SpaceMissionInvitationSetting" (
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "accountEpoch" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SpaceMissionInvitationSetting_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "SpaceMissionInvitationSetting_revision_check" CHECK ("revision" >= 0 AND "revision" <= 2147483647),
  CONSTRAINT "SpaceMissionInvitationSetting_accountEpoch_check" CHECK ("accountEpoch" >= 0 AND "accountEpoch" <= 2147483647),
  CONSTRAINT "SpaceMissionInvitationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SpaceMissionInvitationAccess" (
  "missionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "epoch" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SpaceMissionInvitationAccess_pkey" PRIMARY KEY ("missionId", "userId"),
  CONSTRAINT "SpaceMissionInvitationAccess_epoch_check" CHECK ("epoch" >= 0 AND "epoch" <= 2147483647),
  CONSTRAINT "SpaceMissionInvitationAccess_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceMissionInvitationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SpaceMissionInvitationAccess_userId_idx" ON "SpaceMissionInvitationAccess" ("userId");

CREATE TABLE "SpaceMissionInvitationRequest" (
  "missionId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  CONSTRAINT "SpaceMissionInvitationRequest_pkey" PRIMARY KEY ("missionId", "senderId", "requestId"),
  CONSTRAINT "SpaceMissionInvitationRequest_payloadDigest_check" CHECK ("payloadDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SpaceMissionInvitationRequest_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceMissionInvitationRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SpaceMissionInvitationRequest_senderId_missionId_idx" ON "SpaceMissionInvitationRequest" ("senderId", "missionId");

CREATE TABLE "SpaceMissionInvitation" (
  "id" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "senderId" TEXT,
  "state" "SpaceMissionInvitationState" NOT NULL DEFAULT 'PENDING',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "senderEpoch" INTEGER,
  "senderAccessEpoch" INTEGER,
  "senderAccountEpoch" INTEGER,
  "recipientAccessEpoch" INTEGER,
  "recipientAccountEpoch" INTEGER,
  "recipientSettingRevision" INTEGER,
  "recipientEpoch" INTEGER,
  CONSTRAINT "SpaceMissionInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpaceMissionInvitation_revision_check" CHECK ("revision" >= 1 AND "revision" <= 2147483647),
  CONSTRAINT "SpaceMissionInvitation_senderEpoch_check" CHECK ("senderEpoch" IS NULL OR ("senderEpoch" >= 1 AND "senderEpoch" <= 2147483647)),
  CONSTRAINT "SpaceMissionInvitation_senderAccessEpoch_check" CHECK ("senderAccessEpoch" IS NULL OR ("senderAccessEpoch" >= 0 AND "senderAccessEpoch" <= 2147483647)),
  CONSTRAINT "SpaceMissionInvitation_senderAccountEpoch_check" CHECK ("senderAccountEpoch" IS NULL OR ("senderAccountEpoch" >= 0 AND "senderAccountEpoch" <= 2147483647)),
  CONSTRAINT "SpaceMissionInvitation_recipientAccessEpoch_check" CHECK ("recipientAccessEpoch" IS NULL OR ("recipientAccessEpoch" >= 0 AND "recipientAccessEpoch" <= 2147483647)),
  CONSTRAINT "SpaceMissionInvitation_recipientAccountEpoch_check" CHECK ("recipientAccountEpoch" IS NULL OR ("recipientAccountEpoch" >= 0 AND "recipientAccountEpoch" <= 2147483647)),
  CONSTRAINT "SpaceMissionInvitation_recipientSettingRevision_check" CHECK ("recipientSettingRevision" IS NULL OR ("recipientSettingRevision" >= 0 AND "recipientSettingRevision" <= 2147483647)),
  CONSTRAINT "SpaceMissionInvitation_recipientEpoch_check" CHECK ("recipientEpoch" IS NULL OR ("recipientEpoch" >= 0 AND "recipientEpoch" <= 2147483647)),
  CONSTRAINT "SpaceMissionInvitation_distinct_users_check" CHECK ("senderId" IS NULL OR "senderId" <> "recipientId"),
  CONSTRAINT "SpaceMissionInvitation_pending_shape_check" CHECK (
    ("state" = 'PENDING'
      AND "senderId" IS NOT NULL AND "createdAt" IS NOT NULL AND "expiresAt" IS NOT NULL
      AND "senderEpoch" IS NOT NULL
      AND "senderAccessEpoch" IS NOT NULL
      AND "senderAccountEpoch" IS NOT NULL
      AND "recipientAccessEpoch" IS NOT NULL
      AND "recipientAccountEpoch" IS NOT NULL
      AND "recipientSettingRevision" IS NOT NULL
      AND "recipientEpoch" IS NOT NULL
    ) OR ("state" IN ('ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED')
      AND "senderId" IS NULL AND "createdAt" IS NULL AND "expiresAt" IS NULL
      AND "senderEpoch" IS NULL
      AND "senderAccessEpoch" IS NULL
      AND "senderAccountEpoch" IS NULL
      AND "recipientAccessEpoch" IS NULL
      AND "recipientAccountEpoch" IS NULL
      AND "recipientSettingRevision" IS NULL
      AND "recipientEpoch" IS NULL
    )
  ),
  CONSTRAINT "SpaceMissionInvitation_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceMissionInvitation_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceMissionInvitation_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SpaceMissionInvitation_missionId_recipientId_key" ON "SpaceMissionInvitation" ("missionId", "recipientId");
CREATE INDEX "SpaceMissionInvitation_recipient_pending_idx" ON "SpaceMissionInvitation" ("recipientId", "state", "expiresAt", "createdAt", "id");
CREATE INDEX "SpaceMissionInvitation_senderId_state_idx" ON "SpaceMissionInvitation" ("senderId", "state");
