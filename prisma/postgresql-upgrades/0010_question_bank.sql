-- Private, reusable question revisions. Reuse copies a revision into the
-- course draft; no published quiz depends on a live bank row.
CREATE TABLE "QuestionBankItem" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "latestRevision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionBankItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionBankItem_latestRevision_check" CHECK ("latestRevision" > 0),
  CONSTRAINT "QuestionBankItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QuestionBankItem_ownerId_updatedAt_idx" ON "QuestionBankItem"("ownerId", "updatedAt");

CREATE TABLE "QuestionBankRevision" (
  "itemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "questionJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionBankRevision_pkey" PRIMARY KEY ("itemId", "revision"),
  CONSTRAINT "QuestionBankRevision_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "QuestionBankRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "QuestionBankItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE FUNCTION "blockQuestionBankRevisionUpdate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Question bank revisions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "QuestionBankRevision_immutable_update" BEFORE UPDATE ON "QuestionBankRevision"
  FOR EACH ROW EXECUTE FUNCTION "blockQuestionBankRevisionUpdate"();
