-- The deployment runner validates and fixes current_schema() from the URL's
-- explicit ?schema= parameter. Do not resolve through the public schema.
DO $migration$
DECLARE
  target_schema text := current_schema();
  target_table regclass;
BEGIN
  IF target_schema IS NULL THEN
    RAISE EXCEPTION 'No selected schema for ContentReport upgrade';
  END IF;
  target_table := to_regclass(format('%I.%I', target_schema, 'ContentReport'));
  IF target_table IS NULL THEN
    RAISE EXCEPTION 'ContentReport missing in selected schema %', target_schema;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = target_table AND conname = 'ContentReport_targetType_check' AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Expected ContentReport target type check is missing';
  END IF;
  EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', target_schema, 'ContentReport', 'ContentReport_targetType_check');
  EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK ("targetType" IN (''POST'', ''COMMENT'', ''SPACE_DISCUSSION'', ''SPACE_REPLY''))',
    target_schema, 'ContentReport', 'ContentReport_targetType_check');
  EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (("targetType" IN (''POST'', ''COMMENT'') AND "scopeSpaceId" IS NULL) OR ("targetType" IN (''SPACE_DISCUSSION'', ''SPACE_REPLY'') AND "scopeSpaceId" IS NOT NULL))',
    target_schema, 'ContentReport', 'ContentReport_scope_check');
END
$migration$;
