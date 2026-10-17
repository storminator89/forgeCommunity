import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sqlitePath } from './sqlite-init.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const reviewedSqlite = [
  '0001_initial.sql', '0002_skill_endorsements.sql', '0003_course_progress.sql',
  '0004_reports.sql', '0005_reward_ledger.sql', '0006_community_feed_indexes.sql',
  '0007_accepted_solutions.sql', '0008_notification_targets.sql',
  '0009_private_learning_goals.sql', '0010_staged_course_publication.sql',
  '0011_question_bank.sql', '0012_manual_assignments.sql',
  '0013_verified_learning_pathways.sql', '0014_quiz_confidence_evidence.sql',
  '0015_formative_practice_authoring.sql', '0016_formative_practice_learner.sql',
  '0017_chat_message_cursor_index.sql', '0018_chat_read_cursor.sql',
  '0019_course_qa.sql', '0020_spaces.sql', '0021_space_report_targets.sql',
  '0022_space_mission_foundation.sql', '0023_space_mission_contributions.sql',
  '0024_event_waitlist.sql', '0025_space_polls.sql', '0026_space_mission_week.sql', '0027_space_mission_bookmarks.sql', '0028_course_qa_lesson_context.sql', '0029_space_mission_invitations.sql',
];
const reviewedPostgresql = [
  '0001_skill_endorsements.sql', '0002_course_progress.sql', '0003_reports.sql',
  '0004_reward_ledger.sql', '0005_community_feed_indexes.sql',
  '0006_accepted_solutions.sql', '0007_notification_targets.sql',
  '0008_private_learning_goals.sql', '0009_staged_course_publication.sql',
  '0010_question_bank.sql', '0011_manual_assignments.sql',
  '0012_verified_learning_pathways.sql', '0013_quiz_confidence_evidence.sql',
  '0014_formative_practice_authoring.sql', '0015_formative_practice_learner.sql',
  '0016_chat_message_cursor_index.sql', '0017_chat_read_cursor.sql',
  '0018_course_qa.sql', '0019_spaces.sql', '0020_space_report_targets.sql',
  '0021_space_mission_foundation.sql', '0022_space_mission_contributions.sql',
  '0023_event_waitlist.sql', '0024_space_polls.sql', '0025_space_mission_week.sql', '0026_space_mission_bookmarks.sql', '0027_course_qa_lesson_context.sql', '0028_space_mission_invitations.sql',
];

function expectedHistory(provider) {
  const directory = resolve(root, provider === 'sqlite' ? 'prisma/sqlite-migrations' : 'prisma/postgresql-upgrades');
  const names = readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  const reviewed = provider === 'sqlite' ? reviewedSqlite : reviewedPostgresql;
  if (JSON.stringify(names) !== JSON.stringify(reviewed)) {
    throw new Error('Publication migration history is not the reviewed fresh-install sequence.');
  }
  return names.map(name => ({
    name,
    checksum: createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex'),
  }));
}

// Compare live invitation storage with the reviewed additive DDL. This remains
// read-only: a valid migration receipt cannot hide missing constraints/indexes.
const invitationTables = ['SpaceMissionInvitationSetting', 'SpaceMissionInvitationAccess',
  'SpaceMissionInvitationRequest', 'SpaceMissionInvitation'];
const compactSql = value => value.replace(/\s+/g, ' ').trim().replace(/;$/, '');
const compactCheck = value => {
  // Preserve literal bytes, quoted identifiers, grouping and casts. Only
  // whitespace outside SQL's quoted tokens is a benign deparser variation.
  if (value.includes('\0')) throw new Error('Unexpected CHECK marker.');
  const quoted = [];
  const unquoted = value.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, token => {
    quoted.push(token); return `\0${quoted.length - 1}\0`;
  });
  if (/['"]/.test(unquoted)) throw new Error('Unterminated CHECK quoted token.');
  return unquoted.replace(/\s+/g, '').replace(/\0(\d+)\0/g, (_, index) => quoted[Number(index)]);
};
// Strict PostgreSQL pg_get_constraintdef normal forms for the unchanged reviewed
// invitation DDL. No removal of grouping, identifiers, casts or literal content.
const invitationChecks = new Map([
  [
    "SpaceMissionInvitationAccess_epoch_check",
    "CHECK (((epoch >= 0) AND (epoch <= 2147483647)))"
  ],
  [
    "SpaceMissionInvitationRequest_payloadDigest_check",
    "CHECK ((\"payloadDigest\" ~ '^[0-9a-f]{64}$'::text))"
  ],
  [
    "SpaceMissionInvitationSetting_accountEpoch_check",
    "CHECK (((\"accountEpoch\" >= 0) AND (\"accountEpoch\" <= 2147483647)))"
  ],
  [
    "SpaceMissionInvitationSetting_revision_check",
    "CHECK (((revision >= 0) AND (revision <= 2147483647)))"
  ],
  [
    "SpaceMissionInvitation_distinct_users_check",
    "CHECK (((\"senderId\" IS NULL) OR (\"senderId\" <> \"recipientId\")))"
  ],
  [
    "SpaceMissionInvitation_pending_shape_check",
    "CHECK ((((state = 'PENDING'::\"SpaceMissionInvitationState\") AND (\"senderId\" IS NOT NULL) AND (\"createdAt\" IS NOT NULL) AND (\"expiresAt\" IS NOT NULL) AND (\"senderEpoch\" IS NOT NULL) AND (\"senderAccessEpoch\" IS NOT NULL) AND (\"senderAccountEpoch\" IS NOT NULL) AND (\"recipientAccessEpoch\" IS NOT NULL) AND (\"recipientAccountEpoch\" IS NOT NULL) AND (\"recipientSettingRevision\" IS NOT NULL) AND (\"recipientEpoch\" IS NOT NULL)) OR ((state = ANY (ARRAY['ACCEPTED'::\"SpaceMissionInvitationState\", 'DECLINED'::\"SpaceMissionInvitationState\", 'REVOKED'::\"SpaceMissionInvitationState\", 'EXPIRED'::\"SpaceMissionInvitationState\"])) AND (\"senderId\" IS NULL) AND (\"createdAt\" IS NULL) AND (\"expiresAt\" IS NULL) AND (\"senderEpoch\" IS NULL) AND (\"senderAccessEpoch\" IS NULL) AND (\"senderAccountEpoch\" IS NULL) AND (\"recipientAccessEpoch\" IS NULL) AND (\"recipientAccountEpoch\" IS NULL) AND (\"recipientSettingRevision\" IS NULL) AND (\"recipientEpoch\" IS NULL))))"
  ],
  [
    "SpaceMissionInvitation_recipientAccessEpoch_check",
    "CHECK (((\"recipientAccessEpoch\" IS NULL) OR ((\"recipientAccessEpoch\" >= 0) AND (\"recipientAccessEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_recipientAccountEpoch_check",
    "CHECK (((\"recipientAccountEpoch\" IS NULL) OR ((\"recipientAccountEpoch\" >= 0) AND (\"recipientAccountEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_recipientEpoch_check",
    "CHECK (((\"recipientEpoch\" IS NULL) OR ((\"recipientEpoch\" >= 0) AND (\"recipientEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_recipientSettingRevision_check",
    "CHECK (((\"recipientSettingRevision\" IS NULL) OR ((\"recipientSettingRevision\" >= 0) AND (\"recipientSettingRevision\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_revision_check",
    "CHECK (((revision >= 1) AND (revision <= 2147483647)))"
  ],
  [
    "SpaceMissionInvitation_senderAccessEpoch_check",
    "CHECK (((\"senderAccessEpoch\" IS NULL) OR ((\"senderAccessEpoch\" >= 0) AND (\"senderAccessEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_senderAccountEpoch_check",
    "CHECK (((\"senderAccountEpoch\" IS NULL) OR ((\"senderAccountEpoch\" >= 0) AND (\"senderAccountEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_senderEpoch_check",
    "CHECK (((\"senderEpoch\" IS NULL) OR ((\"senderEpoch\" >= 1) AND (\"senderEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMission_invitationAttemptCount_check",
    "CHECK (((\"invitationAttemptCount\" >= 0) AND (\"invitationAttemptCount\" <= 20)))"
  ]
]);
async function inspectInvitationStorage(query, provider) {
  const file = provider === 'sqlite'
    ? 'prisma/sqlite-migrations/0029_space_mission_invitations.sql'
    : 'prisma/postgresql-upgrades/0028_space_mission_invitations.sql';
  const ddl = readFileSync(resolve(root, file), 'utf8');
  if (provider === 'sqlite') {
    const objects = await query(`SELECT name, sql FROM sqlite_master
      WHERE type IN ('table','index') AND (tbl_name LIKE 'SpaceMissionInvitation%' OR name='SpaceMission')`);
    const actual = new Map(objects.map(row => [row.name, compactSql(row.sql ?? '')]));
    for (const match of ddl.matchAll(/CREATE (?:TABLE|(?:UNIQUE )?INDEX) "([^"]+)"[\s\S]*?;/g)) {
      if (actual.get(match[1]) !== compactSql(match[0])) throw new Error(`Invitation object ${match[1]} differs.`);
    }
    const column = (await query(`SELECT type, "notnull", dflt_value FROM pragma_table_info('SpaceMission') WHERE name='invitationAttemptCount'`))[0];
    if (!column || column.type !== 'INTEGER' || column.notnull !== 1 || column.dflt_value !== '0') throw new Error('Invitation counter differs.');
    const counter = ddl.match(/ADD COLUMN ([\s\S]*?);/)[1];
    if (!actual.get('SpaceMission')?.includes(compactSql(counter))) throw new Error('Invitation counter constraint differs.');
    return;
  }
  const tables = invitationTables.map(name => `'${name}'`).join(',');
  // These four private tables must contain exactly the reviewed plain columns.
  // A valid receipt/check name cannot establish nullability, type or defaults.
  const reviewedTables = [...ddl.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)];
  const reviewedColumns = reviewedTables.flatMap(([, table, body]) =>
    [...body.matchAll(/^  "([^"]+)" (TEXT|BOOLEAN|INTEGER|TIMESTAMP\(3\)|"SpaceMissionInvitationState")([^\n]*)$/gm)]
      .map(([, name, type, suffix]) => ({ table, name, type, required: /\bNOT NULL\b/.test(suffix),
        default: suffix.match(/\bDEFAULT ([^,\n]+)/)?.[1] ?? null })));
  const columns = await query(`SELECT c.relname AS table_name, a.attname AS column_name,
      pg_catalog.format_type(a.atttypid,a.atttypmod) AS formatted_type,
      t.typname AS type_name, tn.nspname AS type_schema, t.typtype AS type_kind,
      t.typnamespace = c.relnamespace AS same_schema_type,
      a.atttypid = to_regtype('"SpaceMissionInvitationState"')::oid AS is_invitation_state,
      a.attnotnull AS required, a.attidentity AS identity_kind, a.attgenerated AS generated_kind,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid
    JOIN pg_namespace tn ON tn.oid=t.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname IN (${tables})
      AND a.attnum>0 AND NOT a.attisdropped`);
  if (columns.length !== reviewedColumns.length) throw new Error('Invitation column inventory differs.');
  const scalarTypes = { TEXT: ['text','text'], BOOLEAN: ['bool','boolean'],
    INTEGER: ['int4','integer'], 'TIMESTAMP(3)': ['timestamp','timestamp(3) without time zone'] };
  for (const expected of reviewedColumns) {
    const column = columns.find(row => row.table_name === expected.table && row.column_name === expected.name);
    const state = expected.type === '"SpaceMissionInvitationState"';
    const defaultExpression = state ? `${expected.default}::"SpaceMissionInvitationState"` : expected.default;
    if (!column || column.required !== expected.required || column.identity_kind !== '' || column.generated_kind !== '' ||
        column.default_expression !== defaultExpression) throw new Error('Invitation column shape differs.');
    if (state) {
      if (!column.is_invitation_state || !column.same_schema_type || column.type_kind !== 'e' ||
          column.type_name !== 'SpaceMissionInvitationState') throw new Error('Invitation state column type differs.');
    } else {
      const [name, formatted] = scalarTypes[expected.type];
      if (column.type_kind !== 'b' || column.type_schema !== 'pg_catalog' || column.type_name !== name ||
          column.formatted_type !== formatted) throw new Error('Invitation scalar column type differs.');
    }
  }
  const expectedOwners = new Map([['SpaceMission_invitationAttemptCount_check','SpaceMission']]);
  for (const [, table, body] of reviewedTables) for (const [, name] of body.matchAll(/CONSTRAINT "([^"]+)"/g)) {
    expectedOwners.set(name, table);
  }
  const constraints = await query(`SELECT c.conname AS name, c.contype AS type, c.convalidated AS validated,
      c.condeferrable AS deferrable, c.confdeltype AS on_delete, c.confupdtype AS on_update,
      t.relname AS table_name, rt.relname AS referenced_table,
      rt.relnamespace = t.relnamespace AS same_schema, pg_get_constraintdef(c.oid) AS definition,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,n)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.n) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,n)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.n) AS referenced_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_class rt ON rt.oid=c.confrelid
    WHERE n.nspname=current_schema() AND (t.relname IN (${tables}) OR c.conname='SpaceMission_invitationAttemptCount_check')`);
  const byName = new Map(constraints.map(row => [row.name, row]));
  const expectedNames = [...ddl.matchAll(/CONSTRAINT "([^"]+)"/g)].map(match => match[1]);
  if (constraints.length !== expectedNames.length || byName.size !== constraints.length || expectedNames.some(name => !byName.has(name)) ||
      constraints.some(row => !row.validated || row.deferrable || row.table_name !== expectedOwners.get(row.name))) throw new Error('Invitation constraints differ.');
  const checkNames = [...ddl.matchAll(/CONSTRAINT "([^"]+)" CHECK \(/g)].map(match => match[1]).sort();
  if (JSON.stringify(checkNames) !== JSON.stringify([...invitationChecks.keys()].sort())) throw new Error('Invitation CHECK inventory differs.');
  for (const [name, expression] of invitationChecks) {
    const row = byName.get(name);
    if (row.type !== 'c' || compactCheck(row.definition) !== compactCheck(expression)) throw new Error(`Invitation CHECK ${name} differs.`);
  }
  for (const match of ddl.matchAll(/CONSTRAINT "([^"]+)" PRIMARY KEY \(([^)]+)\)/g)) {
    const row = byName.get(match[1]); const fields = [...match[2].matchAll(/"([^"]+)"/g)].map(item => item[1]);
    if (row.type !== 'p' || JSON.stringify(row.columns) !== JSON.stringify(fields)) throw new Error('Invitation primary key differs.');
  }
  for (const match of ddl.matchAll(/CONSTRAINT "([^"]+)" FOREIGN KEY \("([^"]+)"\) REFERENCES "([^"]+)" \("id"\) ON DELETE (CASCADE|SET NULL) ON UPDATE CASCADE/g)) {
    const row = byName.get(match[1]);
    if (row.type !== 'f' || row.referenced_table !== match[3] || !row.same_schema || row.on_update !== 'c' ||
        row.on_delete !== (match[4] === 'CASCADE' ? 'c' : 'n') ||
        JSON.stringify(row.columns) !== JSON.stringify([match[2]]) || JSON.stringify(row.referenced_columns) !== '["id"]') {
      throw new Error('Invitation foreign key differs.');
    }
  }
  const indexes = await query(`SELECT idx.relname AS name, t.relname AS table_name, i.indisunique AS is_unique,
      i.indisvalid AS valid, i.indisready AS ready, i.indpred IS NULL AS no_predicate,
      i.indexprs IS NULL AS no_expression, i.indnkeyatts AS key_columns,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,n)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.n) AS columns
    FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname IN (${tables})`);
  for (const match of ddl.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)" \(([^)]+)\)/g)) {
    const row = indexes.find(item => item.name === match[2]);
    const fields = [...match[4].matchAll(/"([^"]+)"/g)].map(item => item[1]);
    if (!row || row.table_name !== match[3] || row.is_unique !== !!match[1] || !row.valid || !row.ready || !row.no_predicate || !row.no_expression ||
        row.key_columns !== fields.length || JSON.stringify(row.columns) !== JSON.stringify(fields)) throw new Error('Invitation index differs.');
  }
  const counter = (await query(`SELECT pg_catalog.format_type(a.atttypid,a.atttypmod) AS formatted_type,
      t.typname AS type_name, tn.nspname AS type_schema, t.typtype AS type_kind,
      a.attnotnull AS required, a.attidentity AS identity_kind, a.attgenerated AS generated_kind,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid
    JOIN pg_namespace tn ON tn.oid=t.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname='SpaceMission'
      AND a.attname='invitationAttemptCount' AND a.attnum>0 AND NOT a.attisdropped`))[0];
  if (!counter || counter.type_kind !== 'b' || counter.type_schema !== 'pg_catalog' || counter.type_name !== 'int4' ||
      counter.formatted_type !== 'integer' || !counter.required || counter.identity_kind !== '' || counter.generated_kind !== '' ||
      counter.default_expression !== '0') throw new Error('Invitation counter differs.');
  const states = await query(`SELECT e.enumlabel AS state FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname=current_schema() AND t.typname='SpaceMissionInvitationState' ORDER BY e.enumsortorder`);
  if (JSON.stringify(states.map(row => row.state)) !== '["PENDING","ACCEPTED","DECLINED","REVOKED","EXPIRED"]') throw new Error('Invitation state enum differs.');
}

async function inspect(query, provider) {
  const historyTable = provider === 'sqlite' ? '_app_migrations' : '_app_schema_upgrades';
  let actual;
  try { actual = await query(`SELECT name, checksum FROM "${historyTable}" ORDER BY name`); }
  catch { throw new Error('Publication schema is missing or incomplete; run the reviewed database deployment on an empty database.'); }
  if (JSON.stringify(actual) !== JSON.stringify(expectedHistory(provider))) {
    throw new Error('Publication migration history is missing, divergent or has changed checksums; startup refused.');
  }
  // Exact history alone cannot establish that both additive sidecars are
  // still queryable (for example after an accidental manual table removal).
  try {
    await query('SELECT b."missionId", b."userId", b."savedAt", b."revision" FROM "SpaceMissionBookmarkSetting" b LIMIT 0');
    await query('SELECT a."userId", a."epoch" FROM "SpaceMissionBookmarkAccess" a LIMIT 0');
  } catch { throw new Error('Bookmark schema is missing or incomplete; startup refused.'); }
  // Recorded history does not prove both additive anchor scalars still exist.
  // Qualify the columns so SQLite cannot interpret a missing quoted name as text.
  try {
    await query('SELECT q."contextPublicationId", q."contextContentId" FROM "CourseQuestion" q LIMIT 0');
  } catch { throw new Error('Course Q&A lesson context schema is missing or incomplete; startup refused.'); }
  try {
    await query('SELECT "userId", "enabled", "revision", "accountEpoch" FROM "SpaceMissionInvitationSetting" LIMIT 0');
    await query('SELECT "missionId", "userId", "epoch" FROM "SpaceMissionInvitationAccess" LIMIT 0');
    await query('SELECT "missionId", "senderId", "requestId", "payloadDigest" FROM "SpaceMissionInvitationRequest" LIMIT 0');
    await query('SELECT "id", "missionId", "recipientId", "senderId", "state", "revision", "createdAt", "expiresAt", "senderEpoch", "senderAccessEpoch", "senderAccountEpoch", "recipientAccessEpoch", "recipientAccountEpoch", "recipientSettingRevision", "recipientEpoch" FROM "SpaceMissionInvitation" LIMIT 0');
    await query('SELECT "invitationAttemptCount" FROM "SpaceMission" LIMIT 0');
    await inspectInvitationStorage(query, provider);
  } catch { throw new Error('Mission invitation schema or constraints are missing or incomplete; startup refused.'); }
  const missingDraft = await query(`SELECT c."id" FROM "Course" c
    LEFT JOIN "CourseDraft" d ON d."courseId" = c."id"
    WHERE d."courseId" IS NULL LIMIT 1`);
  if (missingDraft.length) {
    throw new Error(`Legacy course ${missingDraft[0].id} has no saved draft. This release requires a fresh empty database; back up the existing database and do not serve it with phase 2.`);
  }
  const invalidPointer = await query(`SELECT c."id" FROM "Course" c
    LEFT JOIN "CoursePublication" p ON p."id" = c."activePublicationId" AND p."courseId" = c."id"
    WHERE c."activePublicationId" IS NOT NULL AND p."id" IS NULL LIMIT 1`);
  if (invalidPointer.length) throw new Error(`Course ${invalidPointer[0].id} has an invalid active publication; startup refused.`);
  return true;
}

export async function assertCoursePublicationReady(url, provider) {
  if (provider === 'sqlite') {
    const path = sqlitePath(url);
    if (!existsSync(path)) throw new Error('SQLite database does not exist; run npm run db:deploy on a fresh database first.');
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec('BEGIN');
      try {
        const result = await inspect(sql => db.prepare(sql).all(), provider);
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
  }
  if (provider !== 'postgresql' || !/^postgres(?:ql)?:\/\//.test(url ?? '')) {
    throw new Error('Set DATABASE_PROVIDER and DATABASE_URL for SQLite or PostgreSQL.');
  }
  const schema = new URL(url).searchParams.get('schema') ?? 'public';
  if (!schema) throw new Error('PostgreSQL schema must not be empty.');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await client.query(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
      const selected = (await client.query('SELECT current_schema() AS name')).rows[0].name;
      if (selected !== schema) throw new Error(`PostgreSQL schema ${schema} is unavailable.`);
      const result = await inspect(async sql => (await client.query(sql)).rows, provider);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  await assertCoursePublicationReady(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER ?? 'postgresql');
  console.log('Fresh-install course publication storage is ready.');
}
