-- Private formative authoring. No credential quiz or learner-attempt tables change.
CREATE UNIQUE INDEX "CoursePublication_id_courseId_key" ON "CoursePublication"("id", "courseId");

CREATE TABLE "PracticeObjective" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeObjective_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PracticeObjective_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "PracticeObjective_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticeObjective_ownerId_updatedAt_idx" ON "PracticeObjective"("ownerId", "updatedAt");
CREATE UNIQUE INDEX "PracticeObjective_id_ownerId_key" ON "PracticeObjective"("id", "ownerId");

CREATE TABLE "PracticeItem" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "latestRevision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PracticeItem_latestRevision_check" CHECK ("latestRevision" > 0),
  CONSTRAINT "PracticeItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PracticeItem_objectiveId_ownerId_fkey" FOREIGN KEY ("objectiveId", "ownerId") REFERENCES "PracticeObjective"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticeItem_ownerId_updatedAt_idx" ON "PracticeItem"("ownerId", "updatedAt");
CREATE INDEX "PracticeItem_objectiveId_idx" ON "PracticeItem"("objectiveId");

CREATE TABLE "PracticeItemRevision" (
  "itemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payload" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeItemRevision_pkey" PRIMARY KEY ("itemId", "revision"),
  CONSTRAINT "PracticeItemRevision_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "PracticeItemRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CoursePracticeDraft" (
  "courseId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "payload" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "lastEditorId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoursePracticeDraft_pkey" PRIMARY KEY ("courseId"),
  CONSTRAINT "CoursePracticeDraft_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "CoursePracticeDraft_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PracticeSnapshot" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "coursePublicationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "draftRevision" INTEGER NOT NULL,
  "payload" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PracticeSnapshot_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "PracticeSnapshot_draftRevision_check" CHECK ("draftRevision" >= 0),
  CONSTRAINT "PracticeSnapshot_itemCount_check" CHECK ("itemCount" > 0),
  CONSTRAINT "PracticeSnapshot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PracticeSnapshot_coursePublicationId_courseId_fkey" FOREIGN KEY ("coursePublicationId", "courseId") REFERENCES "CoursePublication"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PracticeSnapshot_courseId_sequence_key" ON "PracticeSnapshot"("courseId", "sequence");
CREATE UNIQUE INDEX "PracticeSnapshot_id_courseId_key" ON "PracticeSnapshot"("id", "courseId");
CREATE INDEX "PracticeSnapshot_courseId_coursePublicationId_sequence_idx" ON "PracticeSnapshot"("courseId", "coursePublicationId", "sequence");

CREATE TABLE "PracticePublicationRequest" (
  "courseId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticePublicationRequest_pkey" PRIMARY KEY ("courseId", "requestId"),
  CONSTRAINT "PracticePublicationRequest_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PracticePublicationRequest_snapshotId_courseId_fkey" FOREIGN KEY ("snapshotId", "courseId") REFERENCES "PracticeSnapshot"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticePublicationRequest_snapshotId_idx" ON "PracticePublicationRequest"("snapshotId");

CREATE FUNCTION "blockPracticeImmutableUpdate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Practice revisions and snapshots are immutable' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "PracticeItemRevision_no_update" BEFORE UPDATE ON "PracticeItemRevision"
  FOR EACH ROW EXECUTE FUNCTION "blockPracticeImmutableUpdate"();
CREATE TRIGGER "PracticeSnapshot_no_update" BEFORE UPDATE ON "PracticeSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "blockPracticeImmutableUpdate"();
CREATE TRIGGER "PracticePublicationRequest_no_update" BEFORE UPDATE ON "PracticePublicationRequest"
  FOR EACH ROW EXECUTE FUNCTION "blockPracticeImmutableUpdate"();
CREATE FUNCTION "blockPracticeDirectDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_exists BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'PracticeItemRevision' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."PracticeItem" WHERE "id" = $1)', TG_TABLE_SCHEMA)
      INTO parent_exists USING OLD."itemId";
  ELSE
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."Course" WHERE "id" = $1)', TG_TABLE_SCHEMA)
      INTO parent_exists USING OLD."courseId";
  END IF;
  IF parent_exists THEN RAISE EXCEPTION 'Practice revisions and snapshots are immutable' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "PracticeItemRevision_no_direct_delete" BEFORE DELETE ON "PracticeItemRevision"
  FOR EACH ROW EXECUTE FUNCTION "blockPracticeDirectDelete"();
CREATE TRIGGER "PracticeSnapshot_no_direct_delete" BEFORE DELETE ON "PracticeSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "blockPracticeDirectDelete"();
CREATE TRIGGER "PracticePublicationRequest_no_direct_delete" BEFORE DELETE ON "PracticePublicationRequest"
  FOR EACH ROW EXECUTE FUNCTION "blockPracticeDirectDelete"();
CREATE FUNCTION "blockPracticeTruncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Practice revisions, snapshots and receipts are immutable' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "PracticeItemRevision_no_truncate" BEFORE TRUNCATE ON "PracticeItemRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION "blockPracticeTruncate"();
CREATE TRIGGER "PracticeSnapshot_no_truncate" BEFORE TRUNCATE ON "PracticeSnapshot"
  FOR EACH STATEMENT EXECUTE FUNCTION "blockPracticeTruncate"();
CREATE TRIGGER "PracticePublicationRequest_no_truncate" BEFORE TRUNCATE ON "PracticePublicationRequest"
  FOR EACH STATEMENT EXECUTE FUNCTION "blockPracticeTruncate"();

-- Keep revision history when an author removes an item or objective directly.
-- A real account deletion remains a privacy cascade: the User row is already
-- absent when these child DELETE triggers execute.
CREATE FUNCTION "blockPracticeParentDirectDelete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_exists BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'PracticeObjective' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."User" WHERE "id" = $1)', TG_TABLE_SCHEMA)
      INTO parent_exists USING OLD."ownerId";
  ELSE
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."PracticeObjective" o JOIN %I."User" u ON u."id" = o."ownerId" WHERE o."id" = $1 AND o."ownerId" = $2)',
      TG_TABLE_SCHEMA, TG_TABLE_SCHEMA) INTO parent_exists USING OLD."objectiveId", OLD."ownerId";
  END IF;
  IF parent_exists THEN RAISE EXCEPTION 'Practice objectives and items cannot be directly deleted' USING ERRCODE = '23514'; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "PracticeObjective_no_direct_delete" BEFORE DELETE ON "PracticeObjective"
  FOR EACH ROW EXECUTE FUNCTION "blockPracticeParentDirectDelete"();
CREATE TRIGGER "PracticeItem_no_direct_delete" BEFORE DELETE ON "PracticeItem"
  FOR EACH ROW EXECUTE FUNCTION "blockPracticeParentDirectDelete"();
CREATE TRIGGER "PracticeObjective_no_truncate" BEFORE TRUNCATE ON "PracticeObjective"
  FOR EACH STATEMENT EXECUTE FUNCTION "blockPracticeTruncate"();
CREATE TRIGGER "PracticeItem_no_truncate" BEFORE TRUNCATE ON "PracticeItem"
  FOR EACH STATEMENT EXECUTE FUNCTION "blockPracticeTruncate"();
