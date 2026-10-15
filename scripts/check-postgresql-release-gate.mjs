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
assert.deepEqual(upgradeNames, [
  '0001_skill_endorsements.sql',
  '0002_course_progress.sql',
  '0003_reports.sql',
  '0004_reward_ledger.sql',
]);
const expectedChecksums = new Map(upgradeNames.map(name => [name, createHash('sha256')
  .update(readFileSync(new URL(`../prisma/postgresql-upgrades/${name}`, import.meta.url)))
  .digest('hex')]));

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
  `);
}

async function history(db) {
  const { rows } = await db.query('SELECT name, checksum, applied_at::text AS applied_at FROM "_app_schema_upgrades" ORDER BY name');
  assert.deepEqual(rows.map(row => row.name), upgradeNames);
  for (const row of rows) assert.equal(row.checksum, expectedChecksums.get(row.name), `checksum for ${row.name}`);
  return rows;
}

async function assertCurrentSchema(db) {
  for (const table of [
    'SkillEndorsement', 'CourseContentProgress', 'QuizAttempt', 'ContentReport',
    'RewardLedger', 'RewardLedgerChange', 'CourseCompletionRecord',
  ]) {
    assert.ok((await db.query('SELECT to_regclass($1) AS relation', [`"${table}"`])).rows[0].relation, `${table} missing`);
  }
  const requiredFks = [
    'CourseContentProgress_userId_fkey', 'CourseContentProgress_courseId_fkey',
    'CourseContentProgress_contentId_fkey', 'QuizAttempt_userId_fkey',
    'QuizAttempt_courseId_fkey', 'RewardLedger_userId_fkey',
    'RewardLedgerChange_ledgerId_fkey', 'CourseCompletionRecord_userId_fkey',
  ];
  const { rows: foreignKeys } = await db.query(`
    SELECT c.conname AS name, c.convalidated AS validated, c.confdeltype AS on_delete
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.contype = 'f' AND t.relname IN
      ('CourseContentProgress', 'QuizAttempt', 'RewardLedger', 'RewardLedgerChange', 'CourseCompletionRecord')`);
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
    return catalog;
  });

  assert.deepEqual(freshMainCatalog, emptyCatalog, 'empty install and main-baseline upgrade must reach the same table columns');
  assert.deepEqual(populatedCatalog, emptyCatalog, 'populated upgrade must reach the same table columns as empty install');
});
