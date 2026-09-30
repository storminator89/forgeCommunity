import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';

const baseUrl = process.env.DATABASE_URL;
if (!/^postgres(?:ql)?:\/\//.test(baseUrl ?? '')) {
  throw new Error('Set DATABASE_URL to a disposable PostgreSQL database before running this integration test.');
}
const upgrades = ['0001_skill_endorsements.sql', '0002_course_progress.sql'].map(name => {
  const sql = readFileSync(new URL(`../prisma/postgresql-upgrades/${name}`, import.meta.url), 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});

async function fixture(run) {
  const schema = `forge_upgrade_test_${randomUUID().replaceAll('-', '_')}`;
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  const database = new pg.Client({ connectionString: baseUrl });
  await database.connect();
  try {
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(`SET search_path TO "${schema}"`);
    await database.query(`
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      CREATE TABLE "UserSkill" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"(id),
        "skillId" TEXT NOT NULL,
        endorsements INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE "Course" (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE "CourseContent" (
        id TEXT PRIMARY KEY,
        "courseId" TEXT NOT NULL REFERENCES "Course"(id),
        title TEXT NOT NULL,
        content TEXT NOT NULL
      );
      CREATE TABLE "Enrollment" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"(id),
        "courseId" TEXT NOT NULL REFERENCES "Course"(id),
        "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "completedAt" TIMESTAMP(3)
      );
      CREATE TABLE "Certificate" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"(id),
        "courseId" TEXT NOT NULL REFERENCES "Course"(id),
        "issuedAt" TIMESTAMP(3) NOT NULL,
        "courseName" TEXT NOT NULL,
        "userName" TEXT NOT NULL
      );
      INSERT INTO "User" (id) VALUES ('recipient'), ('endorser'), ('learner'), ('other');
      INSERT INTO "UserSkill" (id, "userId", "skillId", endorsements)
        VALUES ('userSkill', 'recipient', 'skill', 7);
      INSERT INTO "Course" (id, title) VALUES ('course', 'Historical course');
      INSERT INTO "CourseContent" (id, "courseId", title, content) VALUES
        ('content', 'course', 'First', 'Historical lesson'), ('second', 'course', 'Second', 'Optional later');
      INSERT INTO "Enrollment" (id, "userId", "courseId", "completedAt") VALUES
        ('enrollment', 'learner', 'course', '2024-02-03 04:05:06'), ('other-enrollment', 'other', 'course', NULL);
      INSERT INTO "Certificate" (id, "userId", "courseId", "issuedAt", "courseName", "userName")
        VALUES ('certificate', 'learner', 'course', '2024-02-03 04:05:06', 'Historical title', 'Historical name');`);
    await run({ database, url: url.toString() });
  } finally {
    // This generated schema is the only object this integration test drops.
    await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.end();
  }
}

async function trackedEndorsementBaseline(database) {
  await database.query(upgrades[0].sql);
  await database.query(`CREATE TABLE "_app_schema_upgrades" (
    name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await database.query('INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)', [upgrades[0].name, upgrades[0].checksum]);
  await database.query(`INSERT INTO "SkillEndorsement" (id, "endorserId", "userSkillId") VALUES ('existing', 'endorser', 'userSkill')`);
}

const historicalTables = ['User', 'UserSkill', 'Course', 'Enrollment', 'Certificate'];
async function historicalRows(database) {
  return Promise.all(historicalTables.map(async table => (await database.query(`SELECT * FROM "${table}" ORDER BY id`)).rows));
}

async function assertProgressConstraints(database) {
  await database.query(`INSERT INTO "ContentProgress" (id, "enrollmentId", "contentId") VALUES
    ('progress', 'enrollment', 'content'), ('other-progress', 'other-enrollment', 'second')`);
  assert.ok((await database.query('SELECT "completedAt" FROM "ContentProgress" WHERE id = $1', ['progress'])).rows[0].completedAt);
  await assert.rejects(database.query(`INSERT INTO "ContentProgress" (id, "enrollmentId", "contentId")
    VALUES ('duplicate', 'enrollment', 'content')`), error => error.code === '23505');
  for (const [id, enrollment, content] of [['orphan-enrollment', 'missing', 'content'], ['orphan-content', 'enrollment', 'missing']]) {
    await assert.rejects(database.query('INSERT INTO "ContentProgress" (id, "enrollmentId", "contentId") VALUES ($1, $2, $3)',
      [id, enrollment, content]), error => error.code === '23503');
  }
  await assert.rejects(database.query(`INSERT INTO "ContentProgress" (id, "enrollmentId", "contentId", "completedAt")
    VALUES ('null-completion', 'enrollment', 'second', NULL)`), error => error.code === '23502');
  await database.query(`UPDATE "Enrollment" SET id = 'renamed-enrollment' WHERE id = 'enrollment';
    UPDATE "CourseContent" SET id = 'renamed-content' WHERE id = 'content'`);
  assert.deepEqual((await database.query('SELECT "enrollmentId", "contentId" FROM "ContentProgress" WHERE id = $1', ['progress'])).rows,
    [{ enrollmentId: 'renamed-enrollment', contentId: 'renamed-content' }]);
  await database.query(`DELETE FROM "Enrollment" WHERE id = 'renamed-enrollment'`);
  assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "ContentProgress"')).rows[0].count, 1);
  await database.query(`DELETE FROM "CourseContent" WHERE id = 'second'`);
  assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "ContentProgress"')).rows[0].count, 0);
}

test('upgrades a populated baseline atomically, idempotently, and rejects modified checksums', async () => {
  await fixture(async ({ database, url }) => {
    const historical = await historicalRows(database);
    // Fail in the second migration, after the first migration has also run.
    await database.query(`CREATE TABLE "Collision" (id TEXT); CREATE INDEX "ContentProgress_contentId_idx" ON "Collision"(id)`);
    await assert.rejects(applyPostgresqlUpgrades(url), /already exists/);
    assert.deepEqual((await database.query(`
      SELECT to_regclass('"SkillEndorsement"') AS endorsement, to_regclass('"ContentProgress"') AS progress,
             to_regclass('"_app_schema_upgrades"') AS history`)).rows, [{ endorsement: null, progress: null, history: null }]);
    assert.equal((await database.query(`SELECT COUNT(*)::int AS count FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'CourseContent' AND column_name = 'isRequired'`)).rows[0].count, 0);
    assert.deepEqual(await historicalRows(database), historical);
    await database.query('DROP TABLE "Collision"');

    await applyPostgresqlUpgrades(url);
    await applyPostgresqlUpgrades(url);
    assert.deepEqual(await historicalRows(database), historical);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "_app_schema_upgrades"')).rows[0].count, 2);
    assert.deepEqual((await database.query('SELECT "isRequired" FROM "CourseContent" ORDER BY id')).rows, [{ isRequired: true }, { isRequired: true }]);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "ContentProgress"')).rows[0].count, 0);
    await database.query(`INSERT INTO "SkillEndorsement" (id, "endorserId", "userSkillId") VALUES ('one', 'endorser', 'userSkill')`);
    await assert.rejects(database.query(`INSERT INTO "SkillEndorsement" (id, "endorserId", "userSkillId")
      VALUES ('two', 'endorser', 'userSkill')`), error => error.code === '23505');
    await database.query(`DELETE FROM "User" WHERE id='endorser'`);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "SkillEndorsement"')).rows[0].count, 0);
    await assertProgressConstraints(database);
    assert.deepEqual((await database.query('SELECT * FROM "Certificate" ORDER BY id')).rows, historical[historicalTables.indexOf('Certificate')]);

    await database.query(`UPDATE "_app_schema_upgrades" SET checksum = 'changed'`);
    await assert.rejects(applyPostgresqlUpgrades(url), /history mismatch/);
    assert.equal((await database.query('SELECT endorsements FROM "UserSkill"')).rows[0].endorsements, 7);
  });
});

test('applies only the missing suffix to a populated tracked endorsement baseline', async () => {
  await fixture(async ({ database, url }) => {
    await trackedEndorsementBaseline(database);
    const historical = await historicalRows(database);
    const endorsement = (await database.query('SELECT * FROM "SkillEndorsement"')).rows;
    await database.query(`CREATE TABLE "Collision" (id TEXT); CREATE INDEX "ContentProgress_contentId_idx" ON "Collision"(id)`);
    await assert.rejects(applyPostgresqlUpgrades(url), /already exists/);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "_app_schema_upgrades"')).rows[0].count, 1);
    assert.equal((await database.query('SELECT to_regclass(\'"ContentProgress"\') AS progress')).rows[0].progress, null);
    assert.deepEqual((await database.query('SELECT * FROM "SkillEndorsement"')).rows, endorsement);
    await database.query('DROP TABLE "Collision"');
    await applyPostgresqlUpgrades(url);
    await database.query(`UPDATE "CourseContent" SET "isRequired" = false WHERE id = 'second';
      INSERT INTO "ContentProgress" (id, "enrollmentId", "contentId") VALUES ('existing-progress', 'enrollment', 'content')`);
    const progress = (await database.query('SELECT * FROM "ContentProgress"')).rows;
    await applyPostgresqlUpgrades(url);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "_app_schema_upgrades"')).rows[0].count, 2);
    assert.deepEqual(await historicalRows(database), historical);
    assert.deepEqual((await database.query('SELECT * FROM "SkillEndorsement"')).rows, endorsement);
    assert.deepEqual((await database.query('SELECT * FROM "ContentProgress"')).rows, progress);
    assert.equal((await database.query('SELECT "isRequired" FROM "CourseContent" WHERE id = $1', ['second'])).rows[0].isRequired, false);
  });
});

for (const count of [1, 2]) {
  test(`explicitly baselines ${count} verified untracked upgrades and applies only the missing suffix`, async () => {
    await fixture(async ({ database, url }) => {
      const historical = await historicalRows(database);
      for (const upgrade of upgrades.slice(0, count)) await database.query(upgrade.sql);
      await assert.rejects(applyPostgresqlUpgrades(url), /without upgrade history/);
      await applyPostgresqlUpgrades(url, { baselineCurrentSchema: true });
      await applyPostgresqlUpgrades(url);
      assert.deepEqual((await database.query('SELECT name, checksum FROM "_app_schema_upgrades" ORDER BY name')).rows,
        upgrades.map(({ name, checksum }) => ({ name, checksum })));
      assert.deepEqual(await historicalRows(database), historical);
      await assert.rejects(applyPostgresqlUpgrades(url, { baselineCurrentSchema: true }), /requires an untracked/);
    });
  });
}

for (const [name, tamper, expected] of [
  ['endorsement index', 'DROP INDEX "SkillEndorsement_endorserId_userSkillId_key"', /SkillEndorsement baseline indexes differ/],
  ['progress unique index', 'DROP INDEX "ContentProgress_enrollmentId_contentId_key"', /ContentProgress baseline indexes differ/],
  ['progress lookup index', 'DROP INDEX "ContentProgress_contentId_idx"', /ContentProgress baseline indexes differ/],
  ['progress index uniqueness', `DROP INDEX "ContentProgress_enrollmentId_contentId_key";
    CREATE INDEX "ContentProgress_enrollmentId_contentId_key" ON "ContentProgress" ("enrollmentId", "contentId")`, /baseline index .* differs/],
  ['required default', 'ALTER TABLE "CourseContent" ALTER COLUMN "isRequired" SET DEFAULT false', /isRequired differs/],
  ['required nullability', 'ALTER TABLE "CourseContent" ALTER COLUMN "isRequired" DROP NOT NULL', /isRequired differs/],
  ['timestamp precision', 'ALTER TABLE "ContentProgress" ALTER COLUMN "completedAt" TYPE TIMESTAMP(6)', /completedAt differs/],
  ['progress cascade', `ALTER TABLE "ContentProgress" DROP CONSTRAINT "ContentProgress_enrollmentId_fkey";
    ALTER TABLE "ContentProgress" ADD CONSTRAINT "ContentProgress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId")
    REFERENCES "Enrollment" (id) ON UPDATE CASCADE ON DELETE RESTRICT`, /baseline foreign key .* differs/],
  ['missing progress table', 'DROP TABLE "ContentProgress"', /ContentProgress baseline must be an ordinary table/],
  ['missing required column', 'ALTER TABLE "CourseContent" DROP COLUMN "isRequired"', /isRequired differs/],
]) {
  test(`refuses an untracked malformed ${name} without recording any baseline`, async () => {
    await fixture(async ({ database, url }) => {
      for (const upgrade of upgrades) await database.query(upgrade.sql);
      await database.query(tamper);
      await assert.rejects(applyPostgresqlUpgrades(url, { baselineCurrentSchema: true }), expected);
      assert.equal((await database.query('SELECT to_regclass(\'"_app_schema_upgrades"\') AS history')).rows[0].history, null);
    });
  });
}

for (const [name, tamper, expected] of [
  ['history gap', `DELETE FROM "_app_schema_upgrades" WHERE name = '0001_skill_endorsements.sql'`, /history has a gap/],
  ['missing progress table', 'DROP TABLE "ContentProgress"', /Course progress schema is missing/],
  ['missing required column', 'ALTER TABLE "CourseContent" DROP COLUMN "isRequired"', /Course progress schema is missing/],
]) {
  test(`refuses a tracked ${name}`, async () => {
    await fixture(async ({ database, url }) => {
      await applyPostgresqlUpgrades(url);
      await database.query(tamper);
      await assert.rejects(applyPostgresqlUpgrades(url), expected);
    });
  });
}
