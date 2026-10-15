-- Additive private pathway definitions and badge history. Course IDs are
-- snapshots so course deletion revokes current credit without losing context.
CREATE TABLE "LearningPathway" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "badgeLabel" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sealedAt" TIMESTAMP(3)
);
CREATE TABLE "LearningPathwayCourse" (
  "pathwayId" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" BETWEEN 0 AND 3),
  "courseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  CONSTRAINT "LearningPathwayCourse_pkey" PRIMARY KEY ("pathwayId", "position"),
  CONSTRAINT "LearningPathwayCourse_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "LearningPathway"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LearningPathwayCourse_pathwayId_courseId_key" ON "LearningPathwayCourse"("pathwayId", "courseId");
CREATE INDEX "LearningPathwayCourse_courseId_idx" ON "LearningPathwayCourse"("courseId");
CREATE FUNCTION "assertPathwayImmutable"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE course_count INTEGER; min_position INTEGER; max_position INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Pathway definitions are immutable' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT COUNT(*), MIN("position"), MAX("position") FROM %I."LearningPathwayCourse" WHERE "pathwayId" = $1', TG_TABLE_SCHEMA)
      INTO course_count, min_position, max_position USING OLD."id";
    IF OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL OR
      (NEW."id", NEW."title", NEW."description", NEW."badgeLabel", NEW."createdById", NEW."createdAt")
        IS DISTINCT FROM (OLD."id", OLD."title", OLD."description", OLD."badgeLabel", OLD."createdById", OLD."createdAt") OR
      course_count NOT BETWEEN 2 AND 4 OR min_position <> 0 OR max_position + 1 <> course_count THEN
      RAISE EXCEPTION 'Pathway definitions are immutable and require 2–4 ordered courses' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "LearningPathway_immutable" BEFORE UPDATE OR DELETE ON "LearningPathway"
  FOR EACH ROW EXECUTE FUNCTION "assertPathwayImmutable"();
CREATE FUNCTION "assertPathwayCourseMutable"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE open_definition BOOLEAN;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Pathway courses are immutable' USING ERRCODE = '23514'; END IF;
  -- Serialize child insertion with sealing the parent. A plain read can see
  -- an unsealed parent while another transaction seals it and counts children.
  EXECUTE format('SELECT "sealedAt" IS NULL FROM %I."LearningPathway" WHERE "id" = $1 FOR UPDATE', TG_TABLE_SCHEMA)
    INTO open_definition USING NEW."pathwayId";
  IF NOT open_definition THEN RAISE EXCEPTION 'Cannot change a sealed pathway' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "LearningPathwayCourse_mutable_before_seal" BEFORE INSERT OR UPDATE OR DELETE ON "LearningPathwayCourse"
  FOR EACH ROW EXECUTE FUNCTION "assertPathwayCourseMutable"();
CREATE FUNCTION "assertPathwayNoTruncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Pathway definitions are immutable' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "LearningPathway_no_truncate" BEFORE TRUNCATE ON "LearningPathway"
  FOR EACH STATEMENT EXECUTE FUNCTION "assertPathwayNoTruncate"();
CREATE TRIGGER "LearningPathwayCourse_no_truncate" BEFORE TRUNCATE ON "LearningPathwayCourse"
  FOR EACH STATEMENT EXECUTE FUNCTION "assertPathwayNoTruncate"();

CREATE TABLE "LearningPathwayParticipation" (
  "userId" TEXT NOT NULL,
  "pathwayId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "optedOutAt" TIMESTAMP(3),
  "badgeActive" BOOLEAN NOT NULL DEFAULT false,
  "badgeFirstAwardedAt" TIMESTAMP(3),
  "stateVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("stateVersion" >= 0),
  CONSTRAINT "LearningPathwayParticipation_pkey" PRIMARY KEY ("userId", "pathwayId"),
  CONSTRAINT "LearningPathwayParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningPathwayParticipation_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "LearningPathway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LearningPathwayParticipation_badge_check" CHECK (NOT "badgeActive" OR ("badgeFirstAwardedAt" IS NOT NULL AND "optedOutAt" IS NULL))
);
CREATE INDEX "LearningPathwayParticipation_pathwayId_idx" ON "LearningPathwayParticipation"("pathwayId");
CREATE FUNCTION "assertPathwayParticipationRetained"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_user_exists BOOLEAN;
BEGIN
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."User" WHERE "id" = $1)', TG_TABLE_SCHEMA)
    INTO old_user_exists USING OLD."userId";
  IF old_user_exists THEN RAISE EXCEPTION 'Pathway participation history cannot be deleted or rekeyed' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "LearningPathwayParticipation_retained_delete" BEFORE DELETE ON "LearningPathwayParticipation"
  FOR EACH ROW EXECUTE FUNCTION "assertPathwayParticipationRetained"();
CREATE TRIGGER "LearningPathwayParticipation_retained_rekey" BEFORE UPDATE OF "userId", "pathwayId" ON "LearningPathwayParticipation"
  FOR EACH ROW EXECUTE FUNCTION "assertPathwayParticipationRetained"();
CREATE TRIGGER "LearningPathwayParticipation_no_truncate" BEFORE TRUNCATE ON "LearningPathwayParticipation"
  FOR EACH STATEMENT EXECUTE FUNCTION "assertPathwayNoTruncate"();
CREATE TABLE "LearningPathwayChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "pathwayId" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "type" TEXT NOT NULL CHECK ("type" IN ('AWARDED', 'REVOKED', 'REINSTATED')),
  "reason" TEXT CHECK ("reason" IN ('REWARD_INVALIDATED', 'OPTED_OUT', 'ACCOUNT_INELIGIBLE')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningPathwayChange_participation_fkey" FOREIGN KEY ("userId", "pathwayId") REFERENCES "LearningPathwayParticipation"("userId", "pathwayId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningPathwayChange_reason_check" CHECK (("type" = 'REVOKED' AND "reason" IS NOT NULL) OR ("type" <> 'REVOKED' AND "reason" IS NULL))
);
CREATE UNIQUE INDEX "LearningPathwayChange_userId_pathwayId_version_key" ON "LearningPathwayChange"("userId", "pathwayId", "version");
CREATE INDEX "LearningPathwayChange_createdAt_idx" ON "LearningPathwayChange"("createdAt");
CREATE FUNCTION "assertPathwayChangeAppendOnly"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_parent_exists BOOLEAN; new_parent_exists BOOLEAN;
BEGIN
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."LearningPathwayParticipation" WHERE "userId" = $1 AND "pathwayId" = $2)', TG_TABLE_SCHEMA)
    INTO old_parent_exists USING OLD."userId", OLD."pathwayId";
  IF TG_OP = 'DELETE' THEN
    IF NOT old_parent_exists THEN RETURN OLD; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."LearningPathwayParticipation" WHERE "userId" = $1 AND "pathwayId" = $2)', TG_TABLE_SCHEMA)
      INTO new_parent_exists USING NEW."userId", NEW."pathwayId";
    IF (NEW."userId", NEW."pathwayId") IS DISTINCT FROM (OLD."userId", OLD."pathwayId")
      AND NOT old_parent_exists AND new_parent_exists
      AND (NEW."id", NEW."version", NEW."type", NEW."reason", NEW."createdAt") IS NOT DISTINCT FROM
          (OLD."id", OLD."version", OLD."type", OLD."reason", OLD."createdAt") THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Pathway changes are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "LearningPathwayChange_append_only" BEFORE UPDATE OR DELETE ON "LearningPathwayChange"
  FOR EACH ROW EXECUTE FUNCTION "assertPathwayChangeAppendOnly"();
CREATE FUNCTION "assertPathwayChangeNoTruncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Pathway changes are append-only' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "LearningPathwayChange_no_truncate" BEFORE TRUNCATE ON "LearningPathwayChange"
  FOR EACH STATEMENT EXECUTE FUNCTION "assertPathwayChangeNoTruncate"();
