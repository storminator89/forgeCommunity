import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import pg from 'pg';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';

// This test creates and drops only random schemas in a local, disposable CI database.
const baseUrl = process.env.DATABASE_URL;
const parsedUrl = baseUrl && /^postgres(?:ql)?:\/\//.test(baseUrl) ? new URL(baseUrl) : null;
if (process.env.POSTGRESQL_RELEASE_GATE_DISPOSABLE !== '1' ||
    !parsedUrl || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname) ||
    parsedUrl.pathname !== '/forge_test' || parsedUrl.searchParams.has('schema')) {
  throw new Error('PostgreSQL release gate requires POSTGRESQL_RELEASE_GATE_DISPOSABLE=1 and a local forge_test database URL without ?schema=.');
}

const baselineSql = readFileSync(fileURLToPath(new URL('../prisma/postgresql-baselines/0000_main_7814799.sql', import.meta.url)), 'utf8');
const upgradesDir = fileURLToPath(new URL('../prisma/postgresql-upgrades/', import.meta.url));
const upgradeNames = readdirSync(upgradesDir).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const reviewedUpgradeNames = [
  '0001_skill_endorsements.sql',
  '0002_course_progress.sql',
  '0003_reports.sql',
  '0004_reward_ledger.sql',
  '0005_community_feed_indexes.sql',
  '0006_accepted_solutions.sql',
  '0007_notification_targets.sql',
  '0008_private_learning_goals.sql',
  '0009_staged_course_publication.sql',
  '0010_question_bank.sql',
  '0011_manual_assignments.sql',
  '0012_verified_learning_pathways.sql',
  '0013_quiz_confidence_evidence.sql',
  '0014_formative_practice_authoring.sql',
];
// A release image must carry the exact reviewed sequence, including the tail.
assert.deepEqual(upgradeNames, reviewedUpgradeNames);
const expectedChecksums = new Map(upgradeNames.map(name => [name, createHash('sha256')
  .update(readFileSync(new URL(`../prisma/postgresql-upgrades/${name}`, import.meta.url)))
  .digest('hex')]));

const communityIndexes = {
  Post_createdAt_id_idx: ['createdAt', 'id'],
  Post_published_createdAt_id_idx: ['published', 'createdAt', 'id'],
  Post_authorId_createdAt_id_idx: ['authorId', 'createdAt', 'id'],
  Comment_postId_createdAt_id_idx: ['postId', 'createdAt', 'id'],
  Comment_authorId_postId_idx: ['authorId', 'postId'],
  LikePost_postId_idx: ['postId'],
  LikeComment_commentId_idx: ['commentId'],
};

const quoteIdent = value => `"${value.replaceAll('"', '""')}"`;
const count = async (db, table) => Number((await db.query(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`)).rows[0].count);
const rejectsCode = (promise, code) => assert.rejects(promise, error => error?.code === code);
const deploy = (url, option) => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./db-deploy.mjs', import.meta.url)), ...(option ? [option] : [])], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, DATABASE_PROVIDER: 'postgresql', DATABASE_URL: url },
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
};

async function publicObjects(db) {
  return (await db.query(`
    SELECT 'relation' AS kind, c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'type' AS kind, t.typname AS name FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
    ORDER BY kind, name`)).rows;
}

async function schemaObjectCounts(db) {
  return (await db.query(`
    SELECT (SELECT COUNT(*)::int FROM pg_class WHERE relnamespace = n.oid) AS relations,
           (SELECT COUNT(*)::int FROM pg_type WHERE typnamespace = n.oid) AS types
    FROM pg_namespace n WHERE n.nspname = current_schema()`)).rows[0];
}

async function withSchema({ mainBaseline = false, populated = false }, run) {
  const schema = `forge_release_${randomUUID().replaceAll('-', '_')}`;
  const db = new pg.Client({ connectionString: baseUrl });
  let connected = false;
  let created = false;
  try {
    await db.connect();
    connected = true;
    const originalPublic = await publicObjects(db);
    await db.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    created = true;
    await db.query(`SET search_path TO ${quoteIdent(schema)}`);
    if (mainBaseline) await db.query(baselineSql);
    if (populated) await seedMainData(db);
    const url = new URL(baseUrl);
    url.searchParams.set('schema', schema);
    const result = await run(db, url.toString());
    assert.deepEqual(await publicObjects(db), originalPublic, 'test-only initialization changed public schema');
    return result;
  } finally {
    try {
      if (created) await db.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    } finally {
      if (connected) await db.end();
    }
  }
}

async function seedMainData(db) {
  await db.query(`
    INSERT INTO "User" ("id", "email", "updatedAt") VALUES
      ('teacher', 'teacher@example.invalid', CURRENT_TIMESTAMP),
      ('completed', 'completed@example.invalid', CURRENT_TIMESTAMP),
      ('incomplete', 'incomplete@example.invalid', CURRENT_TIMESTAMP);
    INSERT INTO "UserSettings" ("id", "userId") VALUES ('settings', 'completed');
    INSERT INTO "Skill" ("id", "name", "category") VALUES ('skill', 'Legacy skill', 'Technical');
    INSERT INTO "UserSkill" ("id", "userId", "skillId", "level", "endorsements")
      VALUES ('user-skill', 'completed', 'skill', 2, 7);
    INSERT INTO "SkillEndorsement" ("id", "endorserId", "userSkillId")
      VALUES ('endorsement', 'teacher', 'user-skill');
    INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt")
      VALUES ('legacy-course', 'Legacy course', 'Main baseline course', 'teacher', CURRENT_TIMESTAMP);
    INSERT INTO "CourseContent" ("id", "title", "type", "content", "order", "courseId", "updatedAt")
      VALUES ('legacy-content', 'Lesson', 'TEXT', 'Existing content', 0, 'legacy-course', CURRENT_TIMESTAMP);
    INSERT INTO "Enrollment" ("id", "userId", "courseId", "completedAt") VALUES
      ('old-completed', 'completed', 'legacy-course', TIMESTAMP '2026-09-01 12:00:00'),
      ('old-incomplete', 'incomplete', 'legacy-course', NULL);
    INSERT INTO "Post" (id, title, content, published, "authorId", "updatedAt") VALUES
      ('legacy-post', 'Preserved community title', 'Existing post', true, 'teacher', CURRENT_TIMESTAMP),
      ('legacy-draft', 'Preserved private title', 'Existing draft', false, 'teacher', CURRENT_TIMESTAMP);
    INSERT INTO "Comment" (id, content, "postId", "authorId", "updatedAt")
      VALUES ('legacy-comment', 'Existing reply', 'legacy-post', 'completed', CURRENT_TIMESTAMP);
    INSERT INTO "LikePost" (id, "userId", "postId") VALUES ('legacy-like', 'completed', 'legacy-post');
    INSERT INTO "LikeComment" (id, "userId", "commentId") VALUES ('legacy-comment-like', 'teacher', 'legacy-comment');
  `);
}

async function history(db) {
  const { rows } = await db.query('SELECT name, checksum, applied_at::text AS applied_at FROM "_app_schema_upgrades" ORDER BY name');
  assert.deepEqual(rows.map(row => row.name), upgradeNames);
  for (const row of rows) assert.equal(row.checksum, expectedChecksums.get(row.name), `checksum for ${row.name}`);
  return rows;
}

async function assertAcceptedSolutionSchema(db) {
  const expectedFks = [
    ['AcceptedSolution_postId_fkey', 'AcceptedSolution', ['postId'], 'Post', ['id'], 'c'],
    ['AcceptedSolution_postId_commentId_fkey', 'AcceptedSolution', ['postId', 'commentId'], 'Comment', ['postId', 'id'], 'c'],
    ['AcceptedSolutionChange_actorId_fkey', 'AcceptedSolutionChange', ['actorId'], 'User', ['id'], 'n'],
    ['AcceptedSolutionChange_postId_fkey', 'AcceptedSolutionChange', ['postId'], 'Post', ['id'], 'n'],
    ['AcceptedSolutionChange_previousCommentId_fkey', 'AcceptedSolutionChange', ['previousCommentId'], 'Comment', ['id'], 'n'],
    ['AcceptedSolutionChange_commentId_fkey', 'AcceptedSolutionChange', ['commentId'], 'Comment', ['id'], 'n'],
  ];
  const { rows: constraints } = await db.query(`
    SELECT c.conname AS name, t.relname AS table_name, c.contype AS type,
      c.convalidated AS validated, c.condeferrable AS deferrable,
      c.confdeltype AS on_delete, c.confupdtype AS on_update, rt.relname AS referenced_table,
      rt.relnamespace = t.relnamespace AS same_schema,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.n) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.n) AS referenced_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_class rt ON rt.oid = c.confrelid
    WHERE n.nspname = current_schema() AND t.relname IN ('AcceptedSolution', 'AcceptedSolutionChange')`);
  const byName = new Map(constraints.map(constraint => [constraint.name, constraint]));
  assert.equal(constraints.length, 9, 'accepted-solution tables must have two primary keys, six foreign keys and one action check');
  const actionCheck = byName.get('AcceptedSolutionChange_action_check');
  assert.ok(actionCheck, 'accepted-solution action check missing');
  assert.equal(actionCheck.table_name, 'AcceptedSolutionChange');
  assert.equal(actionCheck.type, 'c');
  assert.equal(actionCheck.validated, true);
  assert.equal(actionCheck.deferrable, false);
  assert.deepEqual(actionCheck.columns, ['action']);
  for (const [table, columns] of [['AcceptedSolution', ['postId']], ['AcceptedSolutionChange', ['id']]]) {
    const primary = byName.get(`${table}_pkey`);
    assert.ok(primary, `${table} primary key missing`);
    assert.equal(primary.type, 'p');
    assert.equal(primary.validated, true);
    assert.equal(primary.deferrable, false);
    assert.deepEqual(primary.columns, columns);
  }
  for (const [name, table, columns, referencedTable, referencedColumns, onDelete] of expectedFks) {
    assert.deepEqual(byName.get(name), {
      name, table_name: table, type: 'f', validated: true, deferrable: false,
      on_delete: onDelete, on_update: 'c', referenced_table: referencedTable, same_schema: true,
      columns, referenced_columns: referencedColumns,
    }, `accepted-solution foreign key ${name}`);
  }
  const expectedIndexes = [
    ['Comment_postId_id_key', ['postId', 'id'], true, false],
    ['AcceptedSolution_pkey', ['postId'], true, true],
    ['AcceptedSolution_commentId_key', ['commentId'], true, false],
    ['AcceptedSolution_revision_key', ['revision'], true, false],
    ['AcceptedSolutionChange_pkey', ['id'], true, true],
    ['AcceptedSolutionChange_postId_createdAt_idx', ['postId', 'createdAt'], false, false],
  ];
  const { rows: indexes } = await db.query(`
    SELECT idx.relname AS name, i.indisunique AS unique_index, i.indisprimary AS primary_index,
      i.indisvalid AS valid, i.indisready AS ready, i.indpred IS NULL AS no_predicate,
      i.indexprs IS NULL AS no_expression, i.indnkeyatts AS key_columns,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.n) AS columns
    FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND idx.relname = ANY($1::text[])`, [expectedIndexes.map(([name]) => name)]);
  const byIndex = new Map(indexes.map(index => [index.name, index]));
  for (const [name, columns, unique, primary] of expectedIndexes) {
    assert.deepEqual(byIndex.get(name), {
      name, unique_index: unique, primary_index: primary, valid: true, ready: true,
      no_predicate: true, no_expression: true, key_columns: columns.length, columns,
    }, `accepted-solution index ${name}`);
  }
  const { rows: columns } = await db.query(`
    SELECT table_name, column_name, is_nullable, data_type, datetime_precision, column_default
    FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name IN ('AcceptedSolution', 'AcceptedSolutionChange') ORDER BY table_name, ordinal_position`);
  for (const [table, names] of [
    ['AcceptedSolution', ['postId', 'commentId', 'revision', 'createdAt']],
    ['AcceptedSolutionChange', ['id', 'action', 'createdAt', 'actorId', 'postId', 'previousCommentId', 'commentId']],
  ]) {
    const fields = columns.filter(column => column.table_name === table);
    assert.deepEqual(fields.map(column => column.column_name), names, `${table} must not retain content, points or recipient snapshots`);
    for (const column of fields) {
      const nullable = table === 'AcceptedSolutionChange' && ['actorId', 'postId', 'previousCommentId', 'commentId'].includes(column.column_name);
      assert.equal(column.is_nullable, nullable ? 'YES' : 'NO');
      if (column.column_name === 'createdAt') {
        assert.equal(column.data_type, 'timestamp without time zone');
        assert.equal(column.datetime_precision, 3);
        assert.match(column.column_default ?? '', /^(CURRENT_TIMESTAMP|now\(\))$/i);
      } else {
        assert.equal(column.data_type, 'text');
        assert.equal(column.column_default, null);
      }
    }
  }
}

async function assertCoursePublicationSchema(db) {
  const { rows: columns } = await db.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns WHERE table_schema = current_schema() AND table_name IN
      ('Course', 'CourseContent', 'QuizAttempt', 'Certificate', 'CourseDraft', 'CoursePublication',
       'PublicationRequest', 'CourseAsset')`);
  const column = (table, name) => columns.find(row => row.table_name === table && row.column_name === name);
  for (const [table, name, dataType, nullable] of [
    ['Course', 'activePublicationId', 'text', 'YES'],
    ['CourseContent', 'archivedAt', 'timestamp without time zone', 'YES'],
    ['QuizAttempt', 'publicationId', 'text', 'YES'],
    ['Certificate', 'publicationId', 'text', 'YES'],
    ['CourseDraft', 'courseId', 'text', 'NO'],
    ['CourseDraft', 'revision', 'integer', 'NO'],
    ['CourseDraft', 'basePublicationId', 'text', 'YES'],
    ['CourseDraft', 'payload', 'text', 'NO'],
    ['CourseDraft', 'digest', 'text', 'NO'],
    ['CourseDraft', 'lastEditorId', 'text', 'YES'],
    ['CoursePublication', 'id', 'text', 'NO'],
    ['CoursePublication', 'courseId', 'text', 'NO'],
    ['CoursePublication', 'sequence', 'integer', 'NO'],
    ['CoursePublication', 'payload', 'text', 'NO'],
    ['CoursePublication', 'digest', 'text', 'NO'],
    ['CoursePublication', 'contentCount', 'integer', 'NO'],
    ['CoursePublication', 'previousPublicationId', 'text', 'YES'],
    ['CoursePublication', 'actorId', 'text', 'YES'],
    ['PublicationRequest', 'courseId', 'text', 'NO'],
    ['PublicationRequest', 'requestId', 'text', 'NO'],
    ['PublicationRequest', 'actorId', 'text', 'NO'],
    ['PublicationRequest', 'requestDigest', 'text', 'NO'],
    ['PublicationRequest', 'publicationId', 'text', 'NO'],
    ['CourseAsset', 'id', 'text', 'NO'],
    ['CourseAsset', 'courseId', 'text', 'NO'],
    ['CourseAsset', 'uploaderId', 'text', 'YES'],
    ['CourseAsset', 'storageKey', 'text', 'NO'],
    ['CourseAsset', 'contentType', 'text', 'NO'],
    ['CourseAsset', 'byteSize', 'integer', 'NO'],
  ]) {
    const actual = column(table, name);
    assert.ok(actual, `${table}.${name} missing`);
    assert.equal(actual.data_type, dataType, `${table}.${name} type`);
    assert.equal(actual.is_nullable, nullable, `${table}.${name} nullability`);
  }
  assert.deepEqual(column('CoursePublication', 'source') &&
    [column('CoursePublication', 'source').data_type, column('CoursePublication', 'source').udt_name,
      column('CoursePublication', 'source').is_nullable],
  ['USER-DEFINED', 'PublicationSource', 'NO']);
  const { rows: labels } = await db.query(`
    SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'PublicationSource' ORDER BY e.enumsortorder`);
  assert.deepEqual(labels.map(row => row.enumlabel), ['AUTHOR', 'RESTORE']);

  const { rows: foreignKeys } = await db.query(`
    SELECT c.conname AS name, c.convalidated AS valid, c.confdeltype AS on_delete,
      rt.relname AS target, rn.nspname = n.nspname AS same_schema
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE n.nspname = current_schema() AND c.contype = 'f' AND t.relname IN
      ('Course', 'CourseDraft', 'CoursePublication', 'PublicationRequest', 'CourseAsset',
       'QuizAttempt', 'Certificate')`);
  const fks = new Map(foreignKeys.map(row => [row.name, row]));
  for (const [name, target, onDelete] of [
    ['Course_activePublicationId_fkey', 'CoursePublication', 'n'],
    ['CourseDraft_courseId_fkey', 'Course', 'c'],
    ['CourseDraft_basePublicationId_fkey', 'CoursePublication', 'n'],
    ['CoursePublication_courseId_fkey', 'Course', 'c'],
    ['CoursePublication_previousPublicationId_fkey', 'CoursePublication', 'n'],
    ['PublicationRequest_courseId_fkey', 'Course', 'c'],
    ['PublicationRequest_publicationId_fkey', 'CoursePublication', 'c'],
    ['CourseAsset_courseId_fkey', 'Course', 'c'],
    ['QuizAttempt_publicationId_fkey', 'CoursePublication', 'n'],
    ['Certificate_publicationId_fkey', 'CoursePublication', 'n'],
  ]) {
    const fk = fks.get(name);
    assert.ok(fk, `${name} missing`);
    assert.equal(fk.target, target, `${name} target`);
    assert.equal(fk.on_delete, onDelete, `${name} on-delete`);
    assert.equal(fk.valid, true, `${name} unvalidated`);
    assert.equal(fk.same_schema, true, `${name} leaked to another schema`);
  }
  const { rows: checks } = await db.query(`
    SELECT c.conname AS name, c.convalidated AS valid FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.contype = 'c' AND t.relname IN
      ('CourseDraft', 'CoursePublication', 'CourseAsset')`);
  const byCheck = new Map(checks.map(row => [row.name, row]));
  for (const name of [
    'CourseDraft_revision_check', 'CoursePublication_sequence_check', 'CoursePublication_contentCount_check',
    'CourseAsset_byteSize_check',
  ]) assert.equal(byCheck.get(name)?.valid, true, `${name} missing or unvalidated`);
  const { rows: indexes } = await db.query(`
    SELECT idx.relname AS name, i.indisvalid AS valid, i.indisready AS ready,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.n) AS columns
    FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname IN
      ('Course', 'CourseContent', 'QuizAttempt', 'Certificate', 'CoursePublication', 'PublicationRequest', 'CourseAsset')`);
  const byIndex = new Map(indexes.map(row => [row.name, row]));
  for (const [name, expectedColumns] of [
    ['Course_activePublicationId_idx', ['activePublicationId']],
    ['CourseContent_courseId_archivedAt_idx', ['courseId', 'archivedAt']],
    ['QuizAttempt_publicationId_idx', ['publicationId']],
    ['Certificate_publicationId_idx', ['publicationId']],
    ['CoursePublication_courseId_sequence_key', ['courseId', 'sequence']],
    ['CoursePublication_courseId_recordedAt_idx', ['courseId', 'recordedAt']],
    ['PublicationRequest_publicationId_idx', ['publicationId']],
    ['CourseAsset_storageKey_key', ['storageKey']],
    ['CourseAsset_courseId_idx', ['courseId']],
  ]) assert.deepEqual(byIndex.get(name), { name, valid: true, ready: true, columns: expectedColumns }, `${name} index`);
  const { rows: triggers } = await db.query(`
    SELECT tg.tgname AS name, t.relname AS table_name FROM pg_trigger tg
    JOIN pg_class t ON t.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND NOT tg.tgisinternal`);
  for (const [table, name] of [
    ['Course', 'Course_activePublication_same_course'],
    ['CourseDraft', 'CourseDraft_basePublication_same_course'],
    ['CoursePublication', 'CoursePublication_previous_same_course'],
    ['PublicationRequest', 'PublicationRequest_publication_same_course'],
    ['QuizAttempt', 'QuizAttempt_publication_same_course'],
    ['Certificate', 'Certificate_publication_same_course'],
  ]) assert.ok(triggers.some(row => row.table_name === table && row.name === name), `${table} publication-reference trigger missing`);
}

async function assertCurrentSchema(db) {
  for (const table of [
    'SkillEndorsement', 'CourseContentProgress', 'QuizAttempt', 'QuizAttemptItemEvidence', 'ContentReport',
    'RewardLedger', 'RewardLedgerChange', 'CourseCompletionRecord',
    'AcceptedSolution', 'AcceptedSolutionChange', 'CourseDraft',
    'CoursePublication', 'PublicationRequest', 'CourseAsset',
    'LearningPathway', 'LearningPathwayCourse',
    'LearningPathwayParticipation', 'LearningPathwayChange',
  ]) {
    assert.ok((await db.query('SELECT to_regclass($1) AS relation', [`"${table}"`])).rows[0].relation, `${table} missing`);
  }
  await assertAcceptedSolutionSchema(db);
  await assertCoursePublicationSchema(db);
  const requiredFks = [
    'CourseContentProgress_userId_fkey', 'CourseContentProgress_courseId_fkey',
    'CourseContentProgress_contentId_fkey', 'QuizAttempt_userId_fkey',
    'QuizAttemptItemEvidence_attemptId_fkey',
    'QuizAttempt_courseId_fkey', 'RewardLedger_userId_fkey',
    'RewardLedgerChange_ledgerId_fkey', 'CourseCompletionRecord_userId_fkey',
    'Post_authorId_fkey', 'Comment_postId_fkey', 'Comment_authorId_fkey',
    'LikePost_userId_fkey', 'LikePost_postId_fkey', 'LikeComment_userId_fkey', 'LikeComment_commentId_fkey',
  ];
  const { rows: foreignKeys } = await db.query(`
    SELECT c.conname AS name, c.convalidated AS validated, c.confdeltype AS on_delete
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.contype = 'f' AND t.relname IN
      ('CourseContentProgress', 'QuizAttempt', 'QuizAttemptItemEvidence', 'RewardLedger', 'RewardLedgerChange', 'CourseCompletionRecord', 'Post', 'Comment', 'LikePost', 'LikeComment')`);
  const byName = new Map(foreignKeys.map(fk => [fk.name, fk]));
  for (const name of requiredFks) {
    const fk = byName.get(name);
    assert.ok(fk, `missing foreign key ${name}`);
    assert.equal(fk.validated, true, `${name} is unvalidated`);
    assert.equal(fk.on_delete, 'c', `${name} does not cascade on delete`);
  }
  assert.equal((await db.query(`
    SELECT COUNT(*)::int AS count FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'ContentReport' AND c.contype = 'f'`)).rows[0].count, 0,
  'reports should retain their review trail after account or target removal');
  const requiredChecks = [
    'ContentReport_targetType_check', 'ContentReport_reason_check',
    'ContentReport_status_check', 'ContentReport_resolution_check',
    'RewardLedger_points_check', 'RewardLedger_stateVersion_check',
    'RewardLedgerChange_version_check', 'RewardLedgerChange_reason_check',
  ];
  const { rows: checks } = await db.query(`
    SELECT c.conname AS name, c.convalidated AS validated FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.contype = 'c' AND t.relname IN
      ('ContentReport', 'RewardLedger', 'RewardLedgerChange')`);
  const byCheckName = new Map(checks.map(check => [check.name, check]));
  for (const name of requiredChecks) {
    const check = byCheckName.get(name);
    assert.ok(check, `missing SQL-only check constraint ${name}`);
    assert.equal(check.validated, true, `${name} is unvalidated`);
  }
  const { rows: indexes } = await db.query(`
    SELECT idx.relname AS name, i.indisvalid AS valid, i.indisready AS ready,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.n) AS columns
    FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname IN ('Post', 'Comment', 'LikePost', 'LikeComment')`);
  const indexesByName = new Map(indexes.map(index => [index.name, index]));
  for (const [name, columns] of Object.entries(communityIndexes)) {
    assert.deepEqual(indexesByName.get(name), { name, valid: true, ready: true, columns }, `community index ${name}`);
  }
  const schema = (await db.query('SELECT current_schema() AS name')).rows[0].name;
  const { rows: columns } = await db.query(`
    SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = current_schema()
    ORDER BY table_name, ordinal_position`);
  return columns.map(column => ({
    ...column,
    column_default: column.column_default?.replaceAll(schema, '<schema>') ?? null,
  }));
}

test('PostgreSQL empty install and main baseline upgrades: replay, checksums and FKs', async () => {
  for (const existingObject of [
    'CREATE TYPE "ExistingType" AS ENUM (\'VALUE\')',
    'CREATE TABLE "ExistingTable" (id TEXT PRIMARY KEY)',
    'CREATE TABLE "_app_schema_upgrades" (name TEXT PRIMARY KEY)',
  ]) {
    await withSchema({}, async (db, url) => {
      await db.query(existingObject);
      const before = await schemaObjectCounts(db);
      await assert.rejects(applyPostgresqlUpgrades(url, { initializeEmptySchema: true }), /requires a schema with no existing/);
      assert.deepEqual(await schemaObjectCounts(db), before, 'rejected initialization changed existing objects');
    });
  }

  const emptyCatalog = await withSchema({}, async (db, url) => {
    deploy(url, '--initialize-empty-schema');
    const firstHistory = await history(db);
    const catalog = await assertCurrentSchema(db);
    assert.equal(await count(db, 'CourseCompletionRecord'), 0);
    assert.equal(await count(db, 'RewardLedger'), 0);
    assert.equal(await count(db, 'AcceptedSolution'), 0);
    assert.equal(await count(db, 'AcceptedSolutionChange'), 0);
    deploy(url);
    assert.deepEqual(await history(db), firstHistory);
    await assert.rejects(applyPostgresqlUpgrades(url, { initializeEmptySchema: true }), /requires a schema with no existing/);
    assert.deepEqual(await history(db), firstHistory);
    return catalog;
  });

  const freshMainCatalog = await withSchema({ mainBaseline: true }, async (db, url) => {
    await assert.rejects(applyPostgresqlUpgrades(url, { initializeEmptySchema: true }), /requires a schema with no existing/);
    assert.equal((await db.query(`SELECT to_regclass('"_app_schema_upgrades"') AS history`)).rows[0].history, null);
    await applyPostgresqlUpgrades(url, { baselineCurrentSchema: true });
    const firstHistory = await history(db);
    const catalog = await assertCurrentSchema(db);
    assert.equal(await count(db, 'CourseCompletionRecord'), 0);
    assert.equal(await count(db, 'RewardLedger'), 0);
    assert.equal(await count(db, 'AcceptedSolution'), 0);
    assert.equal(await count(db, 'AcceptedSolutionChange'), 0);
    await applyPostgresqlUpgrades(url);
    assert.deepEqual(await history(db), firstHistory);
    await assert.rejects(applyPostgresqlUpgrades(url, { baselineCurrentSchema: true }), /requires an untracked/);
    await db.query(`UPDATE "_app_schema_upgrades" SET checksum = 'tampered' WHERE name = '0004_reward_ledger.sql'`);
    await assert.rejects(applyPostgresqlUpgrades(url), /history mismatch for 0004_reward_ledger.sql/);
    return catalog;
  });

  const populatedCatalog = await withSchema({ mainBaseline: true, populated: true }, async (db, url) => {
    await applyPostgresqlUpgrades(url, { baselineCurrentSchema: true });
    const firstHistory = await history(db);
    const catalog = await assertCurrentSchema(db);
    assert.deepEqual((await db.query(`
      SELECT "userId", "courseId", "courseTitle",
        "completedAt" = TIMESTAMP '2026-09-01 12:00:00' AS preserved_date
      FROM "CourseCompletionRecord"`)).rows, [{
      userId: 'completed', courseId: 'legacy-course', courseTitle: 'Legacy course', preserved_date: true,
    }]);
    assert.equal((await db.query(`SELECT "endorsements" FROM "UserSkill" WHERE id = 'user-skill'`)).rows[0].endorsements, 7);
    assert.equal(await count(db, 'SkillEndorsement'), 1);
    assert.deepEqual((await db.query(`
      SELECT u."isTestAccount", s."publicRankingOptIn", c."rewardEligible", c."rewardApprovalRevision"
      FROM "User" u JOIN "UserSettings" s ON s."userId" = u.id
      CROSS JOIN "Course" c WHERE u.id = 'completed'`)).rows, [{
      isTestAccount: false, publicRankingOptIn: false, rewardEligible: false, rewardApprovalRevision: null,
    }]);
    assert.equal(await count(db, 'RewardLedger'), 0);
    assert.equal(await count(db, 'ContentReport'), 0);
    assert.equal(await count(db, 'AcceptedSolution'), 0, 'historical likes are not solution selections');
    assert.equal(await count(db, 'AcceptedSolutionChange'), 0, 'upgrades must not invent decisions');
    assert.deepEqual((await db.query('SELECT id, title, published FROM "Post" ORDER BY id')).rows, [
      { id: 'legacy-draft', title: 'Preserved private title', published: false },
      { id: 'legacy-post', title: 'Preserved community title', published: true },
    ]);
    assert.deepEqual((await db.query('SELECT id, content FROM "Comment"')).rows, [{ id: 'legacy-comment', content: 'Existing reply' }]);
    assert.equal(await count(db, 'LikePost'), 1);
    assert.equal(await count(db, 'LikeComment'), 1);
    await applyPostgresqlUpgrades(url);
    assert.deepEqual(await history(db), firstHistory);
    assert.equal(await count(db, 'CourseCompletionRecord'), 1);

    await db.query(`INSERT INTO "CourseContentProgress" ("userId", "courseId", "contentId", "revision")
      VALUES ('completed', 'legacy-course', 'legacy-content', 'revision-1')`);
    await db.query(`INSERT INTO "QuizAttempt"
      ("id", "userId", "courseId", "contentId", "submissionId", "answerDigest", "revision", "score", "passed")
      VALUES ('attempt', 'completed', 'legacy-course', 'legacy-content', 'submission', 'digest', 'revision-1', 100, true)`);
    await rejectsCode(db.query(`INSERT INTO "QuizAttempt"
      ("id", "userId", "courseId", "contentId", "submissionId", "answerDigest", "revision", "score", "passed")
      VALUES ('duplicate-attempt', 'completed', 'legacy-course', 'legacy-content', 'submission', 'digest', 'revision-1', 100, true)`), '23505');
    await rejectsCode(db.query(`INSERT INTO "CourseContentProgress" ("userId", "courseId", "contentId", "revision")
      VALUES ('completed', 'legacy-course', 'missing-content', 'revision-1')`), '23503');

    await db.query(`INSERT INTO "ContentReport" ("id", "reporterId", "targetType", "targetId", "reason")
      VALUES ('report', 'completed', 'POST', 'removed-post', 'SPAM')`);
    await rejectsCode(db.query(`INSERT INTO "ContentReport" ("id", "reporterId", "targetType", "targetId", "reason")
      VALUES ('duplicate-report', 'completed', 'POST', 'removed-post', 'SPAM')`), '23505');
    await rejectsCode(db.query(`INSERT INTO "ContentReport" ("id", "reporterId", "targetType", "targetId", "reason")
      VALUES ('invalid-report', 'completed', 'USER', 'someone', 'SPAM')`), '23514');
    await rejectsCode(db.query(`UPDATE "ContentReport" SET "status" = 'RESOLVED' WHERE id = 'report'`), '23514');
    await db.query(`UPDATE "ContentReport" SET "status" = 'RESOLVED', "reviewedAt" = CURRENT_TIMESTAMP,
      "reviewedById" = 'teacher', "resolutionNote" = 'Synthetic CI review' WHERE id = 'report'`);
    await db.query(`INSERT INTO "RewardLedger" ("id", "userId", "eventType", "sourceId", "courseTitle", "points")
      VALUES ('reward', 'completed', 'COURSE_COMPLETED', 'legacy-course', 'Legacy course', 50)`);
    await db.query(`INSERT INTO "RewardLedgerChange" ("id", "ledgerId", "version", "type", "pointsDelta")
      VALUES ('change', 'reward', 1, 'AWARDED', 50)`);
    await rejectsCode(db.query(`INSERT INTO "RewardLedger" ("id", "userId", "eventType", "sourceId", "courseTitle", "points")
      VALUES ('duplicate', 'completed', 'COURSE_COMPLETED', 'legacy-course', 'Legacy course', 50)`), '23505');
    await rejectsCode(db.query(`INSERT INTO "RewardLedger" ("id", "userId", "eventType", "sourceId", "courseTitle", "points")
      VALUES ('invalid-points', 'completed', 'COURSE_COMPLETED', 'another-course', 'Another course', -1)`), '23514');
    await rejectsCode(db.query(`INSERT INTO "RewardLedgerChange" ("id", "ledgerId", "version", "type", "pointsDelta")
      VALUES ('invalid-change', 'reward', 2, 'REVOKED', 50)`), '23514');
    await db.query(`DELETE FROM "Course" WHERE id = 'legacy-course'`);
    assert.equal(await count(db, 'CourseCompletionRecord'), 1, 'course deletion must retain the snapshot');
    assert.equal(await count(db, 'RewardLedger'), 1, 'reward history has no course FK');
    assert.equal(await count(db, 'CourseContentProgress'), 0);
    assert.equal(await count(db, 'QuizAttempt'), 0);
    await db.query(`DELETE FROM "User" WHERE id = 'completed'`);
    assert.equal(await count(db, 'CourseCompletionRecord'), 0, 'account deletion must cascade the snapshot');
    assert.equal(await count(db, 'RewardLedger'), 0);
    assert.equal(await count(db, 'RewardLedgerChange'), 0);
    assert.equal(await count(db, 'ContentReport'), 1, 'report review trail must survive account deletion');
    assert.equal(await count(db, 'Comment'), 0, 'account deletion must cascade community replies');
    assert.equal(await count(db, 'LikePost'), 0);
    assert.equal(await count(db, 'LikeComment'), 0);
    assert.equal(await count(db, 'Post'), 2, 'another author’s posts remain');
    return catalog;
  });

  assert.deepEqual(freshMainCatalog, emptyCatalog, 'empty install and main-baseline upgrade must reach the same table columns');
  assert.deepEqual(populatedCatalog, emptyCatalog, 'populated upgrade must reach the same table columns as empty install');
});

test('accepted-solution release upgrade preserves existing rewards and decisions on redeploy and anonymizes erasures', async () => {
  await withSchema({ mainBaseline: true, populated: true }, async (db, url) => {
    // Model an already deployed 0005 database, not a baseline with a new signal inferred from likes.
    await db.query(`CREATE TABLE "_app_schema_upgrades" (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for (const name of upgradeNames.filter(name => name < '0006_accepted_solutions.sql')) {
      if (name !== '0001_skill_endorsements.sql') await db.query(readFileSync(new URL(`../prisma/postgresql-upgrades/${name}`, import.meta.url), 'utf8'));
      await db.query('INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)', [name, expectedChecksums.get(name)]);
    }
    await db.query(`
      INSERT INTO "RewardLedger" (id, "userId", "eventType", "sourceId", "courseTitle", points)
        VALUES ('preserved-reward', 'completed', 'COURSE_COMPLETED', 'legacy-course', 'Legacy course', 50);
      INSERT INTO "RewardLedgerChange" (id, "ledgerId", version, type, "pointsDelta")
        VALUES ('preserved-reward-change', 'preserved-reward', 1, 'AWARDED', 50);
      INSERT INTO "Post" (id, title, content, published, "authorId", "updatedAt")
        VALUES ('other-post', 'Other title', 'Other post', true, 'teacher', CURRENT_TIMESTAMP);
      INSERT INTO "Comment" (id, content, "postId", "authorId", "updatedAt") VALUES
        ('replacement', 'Replacement reply', 'legacy-post', 'completed', CURRENT_TIMESTAMP),
        ('other-reply', 'Other reply', 'other-post', 'completed', CURRENT_TIMESTAMP);`);
    const read = async table => (await db.query(`SELECT * FROM ${quoteIdent(table)} ORDER BY 1`)).rows;
    const oldTables = ['User', 'Post', 'Comment', 'LikePost', 'LikeComment', 'SkillEndorsement', 'RewardLedger', 'RewardLedgerChange', 'CourseCompletionRecord'];
    const before = new Map();
    for (const table of oldTables) before.set(table, await read(table));
    const oldHistory = (await db.query('SELECT name, checksum, applied_at::text AS applied_at FROM "_app_schema_upgrades" ORDER BY name')).rows;
    deploy(url);
    await assertCurrentSchema(db);
    const upgradedHistory = await history(db);
    assert.deepEqual(upgradedHistory.slice(0, oldHistory.length), oldHistory, 'upgrade altered old history');
    for (const [table, rows] of before) assert.deepEqual(await read(table), rows, `${table} changed during additive upgrade`);
    assert.equal(await count(db, 'AcceptedSolution'), 0);
    assert.equal(await count(db, 'AcceptedSolutionChange'), 0);
    const select = (postId, commentId, revision) => db.query(
      'INSERT INTO "AcceptedSolution" ("postId", "commentId", revision) VALUES ($1, $2, $3)', [postId, commentId, revision]);
    await select('legacy-post', 'legacy-comment', 'selected-revision');
    for (const values of [
      ['legacy-post', 'replacement', 'duplicate-post'],
      ['other-post', 'legacy-comment', 'duplicate-comment'],
      ['other-post', 'other-reply', 'selected-revision'],
    ]) await rejectsCode(select(...values), '23505');
    for (const values of [
      ['other-post', 'replacement', 'cross-discussion'],
      ['missing-post', 'replacement', 'missing-post'],
      ['other-post', 'missing-comment', 'missing-comment'],
    ]) await rejectsCode(select(...values), '23503');
    await rejectsCode(db.query(`INSERT INTO "AcceptedSolution" ("postId", "commentId")
      VALUES ('other-post', 'other-reply')`), '23502');
    await db.query(`INSERT INTO "AcceptedSolutionChange" (id, action, "actorId", "postId", "previousCommentId", "commentId") VALUES
      ('selected-revision', 'SELECTED', 'incomplete', 'legacy-post', NULL, 'legacy-comment'),
      ('changed-revision', 'CHANGED', 'incomplete', 'legacy-post', 'legacy-comment', 'replacement'),
      ('cleared-revision', 'CLEARED', 'incomplete', 'legacy-post', 'replacement', NULL)`);
    await rejectsCode(db.query(`INSERT INTO "AcceptedSolutionChange" (id, action)
      VALUES ('selected-revision', 'SELECTED')`), '23505');
    for (const action of ['DELETED', 'selected', '']) {
      await rejectsCode(db.query('INSERT INTO "AcceptedSolutionChange" (id, action) VALUES ($1, $2)',
        [`invalid-action-${action}`, action]), '23514');
    }
    await rejectsCode(db.query(`UPDATE "AcceptedSolutionChange" SET action = 'DELETED' WHERE id = 'selected-revision'`), '23514');
    for (const column of ['actorId', 'postId', 'previousCommentId', 'commentId']) {
      await rejectsCode(db.query(`INSERT INTO "AcceptedSolutionChange" (id, action, ${quoteIdent(column)})
        VALUES ($1, 'SELECTED', 'missing')`, [`missing-${column}`]), '23503');
    }
    const current = await read('AcceptedSolution');
    const audit = await read('AcceptedSolutionChange');
    deploy(url);
    assert.deepEqual(await history(db), upgradedHistory);
    assert.deepEqual(await read('AcceptedSolution'), current, 'redeploy altered selection revision or date');
    assert.deepEqual(await read('AcceptedSolutionChange'), audit, 'redeploy altered decision history');
    for (const [table, rows] of before) assert.deepEqual(await read(table), rows, `${table} changed on redeploy`);
    await db.query(`UPDATE "_app_schema_upgrades" SET checksum = 'tampered' WHERE name = '0006_accepted_solutions.sql'`);
    await assert.rejects(applyPostgresqlUpgrades(url), /history mismatch for 0006_accepted_solutions.sql/);
    assert.deepEqual(await read('AcceptedSolution'), current, 'rejected checksum replay changed the live signal');
    assert.deepEqual(await read('AcceptedSolutionChange'), audit, 'rejected checksum replay changed decision history');
    for (const [table, rows] of before) assert.deepEqual(await read(table), rows, `${table} changed after rejected replay`);
    await db.query('UPDATE "_app_schema_upgrades" SET checksum = $1 WHERE name = $2',
      [expectedChecksums.get('0006_accepted_solutions.sql'), '0006_accepted_solutions.sql']);
    assert.deepEqual(await history(db), upgradedHistory);

    await db.query(`DELETE FROM "User" WHERE id = 'incomplete'`);
    assert.deepEqual(await read('AcceptedSolution'), current, 'deleting only the decision actor must retain the live reply');
    assert.deepEqual((await read('AcceptedSolutionChange')).map(row => row.actorId), [null, null, null]);
    await db.query(`DELETE FROM "Comment" WHERE id = 'legacy-comment'`);
    assert.equal(await count(db, 'AcceptedSolution'), 0, 'deleting an accepted reply must erase its current signal');
    assert.deepEqual((await db.query(`SELECT "previousCommentId", "commentId" FROM "AcceptedSolutionChange"
      WHERE id = 'changed-revision'`)).rows, [{ previousCommentId: null, commentId: 'replacement' }]);
    await select('legacy-post', 'replacement', 'reselected-revision');
    await db.query(`DELETE FROM "Post" WHERE id = 'legacy-post'`);
    assert.equal(await count(db, 'AcceptedSolution'), 0, 'deleting a discussion must cascade the live signal');
    assert.deepEqual((await read('AcceptedSolutionChange')).map(row => [row.id, row.action, row.actorId, row.postId, row.previousCommentId, row.commentId]),
      audit.map(row => [row.id, row.action, null, null, null, null]), 'retained audits must anonymize erased identities and targets');
    assert.deepEqual(await read('RewardLedger'), before.get('RewardLedger'), 'solution deletions must not alter learning points');
    assert.deepEqual(await read('RewardLedgerChange'), before.get('RewardLedgerChange'));

    await select('other-post', 'other-reply', 'account-revision');
    await db.query(`INSERT INTO "AcceptedSolutionChange" (id, action, "actorId", "postId", "commentId")
      VALUES ('account-revision', 'SELECTED', 'teacher', 'other-post', 'other-reply')`);
    await db.query(`DELETE FROM "User" WHERE id = 'completed'`);
    assert.equal(await count(db, 'AcceptedSolution'), 0, 'deleting a reply author must remove their live signal');
    assert.deepEqual((await db.query(`SELECT "actorId", "postId", "commentId" FROM "AcceptedSolutionChange"
      WHERE id = 'account-revision'`)).rows, [{ actorId: 'teacher', postId: 'other-post', commentId: null }]);
    await db.query(`DELETE FROM "User" WHERE id = 'teacher'`);
    assert.deepEqual((await db.query(`SELECT id, action, "actorId", "postId", "commentId" FROM "AcceptedSolutionChange"
      WHERE id = 'account-revision'`)).rows, [{ id: 'account-revision', action: 'SELECTED', actorId: null, postId: null, commentId: null }]);
    assert.equal(await count(db, 'AcceptedSolutionChange'), audit.length + 1, 'erasure must not invent a decision');
  });
});

test('assignment grade decisions are append-only while foreign-key cascades remain valid', async () => {
  await withSchema({ mainBaseline: true }, async (db, url) => {
    await applyPostgresqlUpgrades(url, { baselineCurrentSchema: true });
    await db.query(`
      INSERT INTO "User" ("id", "email", "updatedAt") VALUES
        ('assignment-teacher', 'assignment-teacher@example.invalid', CURRENT_TIMESTAMP),
        ('assignment-submission-user', 'assignment-submission-user@example.invalid', CURRENT_TIMESTAMP),
        ('assignment-account-user', 'assignment-account-user@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt")
        VALUES ('assignment-course', 'Assignment course', '', 'assignment-teacher', CURRENT_TIMESTAMP);
      INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
        VALUES ('assignment-publication', 'assignment-course', 1, 'AUTHOR', '{}', 'digest', 1);
      INSERT INTO "AssignmentSubmission" ("id", "userId", "courseId", "contentId", "publicationId", "revision",
        "passingScore", "requestId", "response", "responseDigest", "attemptNumber") VALUES
        ('assignment-submission', 'assignment-submission-user', 'assignment-course', 'assignment-content',
          'assignment-publication', 'revision', 70, 'submit-one', 'Response', 'response-digest-one', 1),
        ('assignment-account-submission', 'assignment-account-user', 'assignment-course', 'assignment-content',
          'assignment-publication', 'revision', 70, 'submit-two', 'Response', 'response-digest-two', 1);
      INSERT INTO "AssignmentGradeDecision" ("id", "submissionId", "requestId", "graderId", "action", "score", "sequence") VALUES
        ('assignment-decision', 'assignment-submission', 'grade-one', 'assignment-teacher', 'GRADED', 85, 1),
        ('assignment-account-decision', 'assignment-account-submission', 'grade-two', 'assignment-teacher', 'GRADED', 85, 1);
    `);
    // PrismaPg qualifies the target model but does not set the connection's
    // search_path. The trigger must use the target table's schema even if a
    // caller selects another search path or shadows CoursePublication in temp.
    const schema = new URL(url).searchParams.get('schema');
    assert.ok(schema);
    await db.query(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt")
      VALUES ('assignment-other-course', 'Other course', '', 'assignment-teacher', CURRENT_TIMESTAMP)`);
    await db.query(`CREATE TEMP TABLE "CoursePublication" ("id" TEXT, "courseId" TEXT)`);
    await db.query(`INSERT INTO pg_temp."CoursePublication" VALUES ('assignment-publication', 'assignment-other-course')`);
    await db.query('SET search_path TO pg_catalog');
    try {
      const insert = (id, courseId, requestId) => db.query(`
        INSERT INTO ${quoteIdent(schema)}."AssignmentSubmission" ("id", "userId", "courseId", "contentId", "publicationId",
          "revision", "passingScore", "requestId", "response", "responseDigest", "attemptNumber")
        VALUES ($1, 'assignment-submission-user', $2, 'assignment-shadow-content', 'assignment-publication',
          'revision', 70, $3, 'Response', 'response-digest', 1)`, [id, courseId, requestId]);
      await insert('assignment-shadow-valid', 'assignment-course', 'submit-shadow-valid');
      await rejectsCode(insert('assignment-shadow-cross-course', 'assignment-other-course', 'submit-shadow-invalid'), '23514');
      await rejectsCode(db.query(`UPDATE ${quoteIdent(schema)}."AssignmentSubmission"
        SET "courseId" = 'assignment-other-course' WHERE "id" = 'assignment-shadow-valid'`), '23514');
      assert.equal((await db.query(`SELECT "courseId" FROM ${quoteIdent(schema)}."AssignmentSubmission"
        WHERE "id" = 'assignment-shadow-valid'`)).rows[0].courseId, 'assignment-course');
    } finally {
      await db.query(`SET search_path TO ${quoteIdent(schema)}`);
      await db.query(`DROP TABLE pg_temp."CoursePublication"`);
    }
    await rejectsCode(db.query(`UPDATE "AssignmentGradeDecision" SET "feedback" = 'Illicit edit'
      WHERE "id" = 'assignment-decision'`), '23514');
    await rejectsCode(db.query(`UPDATE "AssignmentGradeDecision" SET "feedback" = "feedback"
      WHERE "id" = 'assignment-decision'`), '23514');
    await rejectsCode(db.query(`UPDATE "AssignmentGradeDecision" SET "submissionId" = 'assignment-account-submission'
      WHERE "id" = 'assignment-decision'`), '23514');
    await rejectsCode(db.query(`DELETE FROM "AssignmentGradeDecision" WHERE "id" = 'assignment-decision'`), '23514');
    await rejectsCode(db.query(`INSERT INTO "AssignmentGradeDecision"
      ("id", "submissionId", "requestId", "graderId", "action", "score", "sequence")
      VALUES ('assignment-decision', 'assignment-submission', 'upsert-grade', 'assignment-teacher', 'GRADED', 10, 2)
      ON CONFLICT ("id") DO UPDATE SET "score" = EXCLUDED."score"`), '23514');
    await rejectsCode(db.query(`TRUNCATE "AssignmentGradeDecision"`), '23514');
    // A caller-controlled search path must not make the guard inspect a shadow table.
    await db.query(`CREATE TEMP TABLE "AssignmentSubmission" ("id" TEXT)`);
    await rejectsCode(db.query(`DELETE FROM "AssignmentGradeDecision" WHERE "id" = 'assignment-decision'`), '23514');
    await db.query(`DROP TABLE pg_temp."AssignmentSubmission"`);
    assert.deepEqual((await db.query(`SELECT "submissionId", "score", "feedback" FROM "AssignmentGradeDecision"
      WHERE "id" = 'assignment-decision'`)).rows, [{ submissionId: 'assignment-submission', score: 85, feedback: null }]);

    await db.query(`UPDATE "AssignmentSubmission" SET "id" = 'assignment-submission-renamed'
      WHERE "id" = 'assignment-submission'`);
    assert.deepEqual((await db.query(`SELECT "submissionId" FROM "AssignmentGradeDecision"
      WHERE "id" = 'assignment-decision'`)).rows, [{ submissionId: 'assignment-submission-renamed' }]);
    await db.query(`DELETE FROM "AssignmentSubmission" WHERE "id" = 'assignment-submission-renamed'`);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM "AssignmentGradeDecision"
      WHERE "id" = 'assignment-decision'`)).rows[0].count, 0);
    await db.query(`DELETE FROM "User" WHERE "id" = 'assignment-account-user'`);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM "AssignmentSubmission"
      WHERE "id" = 'assignment-account-submission'`)).rows[0].count, 0);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM "AssignmentGradeDecision"
      WHERE "id" = 'assignment-account-decision'`)).rows[0].count, 0);
  });
});

test('private pathway definitions and audit are immutable but account deletion cascades in a custom schema', async () => {
  await withSchema({}, async (db, url) => {
    await applyPostgresqlUpgrades(url, { initializeEmptySchema: true });
    await db.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ('learner', 'learner-pathway@example.invalid', CURRENT_TIMESTAMP)`);
    await db.query(`INSERT INTO "LearningPathway" (id, title, description, "badgeLabel", "createdById")
      VALUES ('path', 'Sequence', 'Private', 'Finished', 'admin')`);
    await db.query(`INSERT INTO "LearningPathwayCourse" ("pathwayId", position, "courseId", title)
      VALUES ('path', 0, 'first', 'First')`);
    await rejectsCode(db.query(`UPDATE "LearningPathway" SET "sealedAt"=CURRENT_TIMESTAMP WHERE id='path'`), '23514');
    await db.query(`INSERT INTO "LearningPathwayCourse" ("pathwayId", position, "courseId", title)
      VALUES ('path', 1, 'second', 'Second')`);
    await db.query(`UPDATE "LearningPathway" SET "sealedAt"=CURRENT_TIMESTAMP WHERE id='path'`);
    await rejectsCode(db.query(`UPDATE "LearningPathway" SET title='Changed' WHERE id='path'`), '23514');
    await rejectsCode(db.query(`DELETE FROM "LearningPathwayCourse" WHERE "pathwayId"='path'`), '23514');
    await rejectsCode(db.query(`INSERT INTO "LearningPathwayCourse" ("pathwayId", position, "courseId", title)
      VALUES ('path', 2, 'third', 'Third')`), '23514');
    await rejectsCode(db.query(`TRUNCATE "LearningPathwayCourse"`), '23514');
    await db.query(`INSERT INTO "LearningPathwayParticipation"
      ("userId", "pathwayId", "badgeActive", "badgeFirstAwardedAt", "stateVersion")
      VALUES ('learner', 'path', true, CURRENT_TIMESTAMP, 1)`);
    await db.query(`INSERT INTO "LearningPathwayChange" (id, "userId", "pathwayId", version, type)
      VALUES ('change', 'learner', 'path', 1, 'AWARDED')`);
    await rejectsCode(db.query(`UPDATE "LearningPathwayChange" SET type='REINSTATED' WHERE id='change'`), '23514');
    await rejectsCode(db.query(`DELETE FROM "LearningPathwayChange" WHERE id='change'`), '23514');
    await rejectsCode(db.query(`DELETE FROM "LearningPathwayParticipation" WHERE "userId"='learner'`), '23514');
    await rejectsCode(db.query(`TRUNCATE "LearningPathwayParticipation" CASCADE`), '23514');
    await db.query(`DELETE FROM "User" WHERE id='learner'`);
    assert.equal(await count(db, 'LearningPathwayParticipation'), 0);
    assert.equal(await count(db, 'LearningPathwayChange'), 0);
    assert.equal(await count(db, 'LearningPathwayCourse'), 2);
    assert.equal(await count(db, 'LearningPathway'), 1);
  });
});

test('a concurrent child insert cannot slip past pathway sealing in a custom schema', async () => {
  await withSchema({}, async (sealer, url) => {
    await applyPostgresqlUpgrades(url, { initializeEmptySchema: true });
    await sealer.query(`INSERT INTO "LearningPathway" (id, title, description, "badgeLabel", "createdById")
      VALUES ('race-path', 'Sequence', 'Private', 'Finished', 'admin')`);
    await sealer.query(`INSERT INTO "LearningPathwayCourse" ("pathwayId", position, "courseId", title)
      VALUES ('race-path', 0, 'first', 'First'), ('race-path', 1, 'second', 'Second')`);
    const schema = new URL(url).searchParams.get('schema');
    const inserter = new pg.Client({ connectionString: baseUrl });
    let sealerOpen = false;
    let inserterOpen = false;
    let pendingInsert;
    try {
      await inserter.connect();
      await inserter.query(`SET search_path TO ${quoteIdent(schema)}`);
      await sealer.query('BEGIN');
      sealerOpen = true;
      await sealer.query(`UPDATE "LearningPathway" SET "sealedAt" = CURRENT_TIMESTAMP WHERE id = 'race-path'`);
      const sealerPid = (await sealer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await inserter.query('BEGIN');
      inserterOpen = true;
      await inserter.query(`SET LOCAL lock_timeout = '10s'`);
      const inserterPid = (await inserter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pendingInsert = inserter.query(`INSERT INTO "LearningPathwayCourse" ("pathwayId", position, "courseId", title)
        VALUES ('race-path', 2, 'third', 'Third')`);
      // Attach a rejection handler immediately; the assertion below awaits
      // the original promise after the sealing transaction commits.
      void pendingInsert.catch(() => {});
      let blocked = false;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        blocked = (await sealer.query('SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked',
          [sealerPid, inserterPid])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.ok(blocked, 'Child insert did not wait for the concurrent seal transaction.');
      await sealer.query('COMMIT');
      sealerOpen = false;
      await rejectsCode(pendingInsert, '23514');
      await inserter.query('ROLLBACK');
      inserterOpen = false;
      assert.equal((await sealer.query(`SELECT COUNT(*)::integer AS count FROM "LearningPathwayCourse"
        WHERE "pathwayId" = 'race-path'`)).rows[0].count, 2, 'A child appeared after the pathway was sealed.');
    } finally {
      if (sealerOpen) await sealer.query('ROLLBACK').catch(() => {});
      if (pendingInsert) await pendingInsert.catch(() => {});
      if (inserterOpen) await inserter.query('ROLLBACK').catch(() => {});
      await inserter.end().catch(() => {});
    }
  });
});
