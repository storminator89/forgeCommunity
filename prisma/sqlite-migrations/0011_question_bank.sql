-- Private, reusable question revisions. Existing quiz payloads are not
-- migrated: a reuse copies one revision into a draft quiz snapshot.
CREATE TABLE "QuestionBankItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "latestRevision" INTEGER NOT NULL DEFAULT 1 CHECK ("latestRevision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionBankItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QuestionBankItem_ownerId_updatedAt_idx" ON "QuestionBankItem"("ownerId", "updatedAt");

CREATE TABLE "QuestionBankRevision" (
  "itemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "questionJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionBankRevision_pkey" PRIMARY KEY ("itemId", "revision"),
  CONSTRAINT "QuestionBankRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "QuestionBankItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Revision rows cannot be edited in place. Account deletion still cascades.
CREATE TRIGGER "QuestionBankRevision_immutable_update"
BEFORE UPDATE ON "QuestionBankRevision"
BEGIN
  SELECT RAISE(ABORT, 'Question bank revisions are immutable');
END;
