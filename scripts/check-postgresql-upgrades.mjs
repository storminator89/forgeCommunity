import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';

const baseUrl = process.env.DATABASE_URL;
const baselineSql = readFileSync(new URL('../prisma/postgresql-baselines/0000_main_7814799.sql', import.meta.url), 'utf8');
const upgradeNames = readdirSync(new URL('../prisma/postgresql-upgrades/', import.meta.url)).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
if (!/^postgres(?:ql)?:\/\//.test(baseUrl ?? '')) {
  throw new Error('Set DATABASE_URL to a disposable PostgreSQL database before running this integration test.');
}

async function fixture(run) {
  const schema = `forge_upgrade_test_${randomUUID().replaceAll('-', '_')}`;
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  const database = new pg.Client({ connectionString: baseUrl });
  await database.connect();
  try {
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(`SET search_path TO "${schema}"`);
    await database.query(baselineSql);
    // The reviewed main baseline already contains the first upgrade's table.
    // Remove only that empty table here to exercise the normal 0001 upgrade.
    await database.query(`
      DROP TABLE "SkillEndorsement";
      INSERT INTO "User" (id, email, "updatedAt") VALUES
        ('recipient', 'recipient@example.invalid', CURRENT_TIMESTAMP),
        ('endorser', 'endorser@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Skill" (id, name, category) VALUES ('skill', 'Legacy skill', 'test');
      INSERT INTO "UserSkill" (id, "userId", "skillId", level, endorsements)
      VALUES ('userSkill', 'recipient', 'skill', 2, 7);
      INSERT INTO "Post" (id, title, content, published, "authorId", "updatedAt")
        VALUES ('kept-post', 'Preserved title', 'Preserved content', true, 'recipient', CURRENT_TIMESTAMP);
      INSERT INTO "Comment" (id, content, "postId", "authorId", "updatedAt")
        VALUES ('kept-comment', 'Preserved reply', 'kept-post', 'endorser', CURRENT_TIMESTAMP);
      INSERT INTO "LikePost" (id, "postId", "userId") VALUES ('kept-like', 'kept-post', 'endorser');
      INSERT INTO "LikeComment" (id, "commentId", "userId") VALUES ('kept-comment-like', 'kept-comment', 'recipient');`);
    await run({ database, url: url.toString() });
  } finally {
    // This generated schema is the only object this integration test drops.
    await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.end();
  }
}

test('upgrades a populated baseline atomically, idempotently, and rejects modified checksums', async () => {
  await fixture(async ({ database, url }) => {
    // Make the index statement fail after CREATE TABLE to test transaction rollback.
    await database.query(`CREATE TABLE "Collision" (id TEXT); CREATE INDEX "SkillEndorsement_endorserId_userSkillId_key" ON "Collision"(id)`);
    await assert.rejects(applyPostgresqlUpgrades(url), /already exists/);
    const { rows: [{ target, history }] } = await database.query(`
      SELECT to_regclass('"SkillEndorsement"') AS target, to_regclass('"_app_schema_upgrades"') AS history`);
    assert.equal(target, null);
    assert.equal(history, null);
    await database.query('DROP TABLE "Collision"');

    await applyPostgresqlUpgrades(url);
    await applyPostgresqlUpgrades(url);
    const { rows: [{ endorsements, migrations }] } = await database.query(`
      SELECT (SELECT endorsements FROM "UserSkill" WHERE id='userSkill') AS endorsements,
             (SELECT COUNT(*)::int FROM "_app_schema_upgrades") AS migrations`);
    assert.equal(endorsements, 7);
    assert.deepEqual((await database.query('SELECT id, title FROM "Post"')).rows, [{ id: 'kept-post', title: 'Preserved title' }]);
    assert.deepEqual((await database.query('SELECT id, content FROM "Comment"')).rows, [{ id: 'kept-comment', content: 'Preserved reply' }]);
    for (const name of ['Post_createdAt_id_idx', 'Post_published_createdAt_id_idx', 'Post_authorId_createdAt_id_idx', 'Comment_postId_createdAt_id_idx', 'Comment_authorId_postId_idx', 'LikePost_postId_idx', 'LikeComment_commentId_idx']) {
      assert.ok((await database.query('SELECT to_regclass($1) AS index', [`"${name}"`])).rows[0].index, `${name} missing`);
    }
    assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM "LikePost"')).rows[0].n, 1);
    assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM "LikeComment"')).rows[0].n, 1);
    assert.equal(migrations, upgradeNames.length);
    await database.query(`INSERT INTO "SkillEndorsement" (id, "endorserId", "userSkillId")
                          VALUES ('one', 'endorser', 'userSkill')`);
    await assert.rejects(database.query(`INSERT INTO "SkillEndorsement" (id, "endorserId", "userSkillId")
                                         VALUES ('two', 'endorser', 'userSkill')`), error => error.code === '23505');
    await database.query(`DELETE FROM "User" WHERE id='endorser'`);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "SkillEndorsement"')).rows[0].count, 0);

    await database.query(`UPDATE "_app_schema_upgrades" SET checksum = 'changed'`);
    await assert.rejects(applyPostgresqlUpgrades(url), /history mismatch/);
    assert.equal((await database.query('SELECT endorsements FROM "UserSkill"')).rows[0].endorsements, 7);
  });
});

test('requires an explicit, verified baseline for an already-current fresh schema', async () => {
  await fixture(async ({ database, url }) => {
    const upgrade = readFileSync(new URL('../prisma/postgresql-upgrades/0001_skill_endorsements.sql', import.meta.url), 'utf8');
    await database.query(upgrade);
    await assert.rejects(applyPostgresqlUpgrades(url), /without upgrade history/);
    await applyPostgresqlUpgrades(url, { baselineCurrentSchema: true });
    await applyPostgresqlUpgrades(url);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "_app_schema_upgrades"')).rows[0].count, upgradeNames.length);
    await assert.rejects(applyPostgresqlUpgrades(url, { baselineCurrentSchema: true }), /requires an untracked/);
  });
});

test('refuses a malformed target instead of silently baselining it', async () => {
  await fixture(async ({ database, url }) => {
    const upgrade = readFileSync(new URL('../prisma/postgresql-upgrades/0001_skill_endorsements.sql', import.meta.url), 'utf8');
    await database.query(upgrade);
    await database.query('DROP INDEX "SkillEndorsement_endorserId_userSkillId_key"');
    await assert.rejects(applyPostgresqlUpgrades(url, { baselineCurrentSchema: true }), /indexes differ/);
    const { rows: [{ history }] } = await database.query('SELECT to_regclass(\'"_app_schema_upgrades"\') AS history');
    assert.equal(history, null);
  });
});
