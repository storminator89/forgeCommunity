import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';

const baseUrl = process.env.DATABASE_URL;
const baselineSql = readFileSync(new URL('../prisma/postgresql-baselines/0000_main_7814799.sql', import.meta.url), 'utf8');
const upgradeNames = readdirSync(new URL('../prisma/postgresql-upgrades/', import.meta.url)).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
assert.ok(upgradeNames.includes('0006_accepted_solutions.sql'), 'accepted-solution upgrade missing');
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

test('accepted-solution upgrade preserves existing data and replay, enforces same-post uniqueness, and anonymizes audit references', async () => {
  await fixture(async ({ database, url }) => {
    await applyPostgresqlUpgrades(url);
    assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM "AcceptedSolution"')).rows[0].n, 0, 'likes must not backfill solutions');
    assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM "AcceptedSolutionChange"')).rows[0].n, 0);
    assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM "RewardLedger"')).rows[0].n, 0, 'solutions award no points');
    await database.query(`
      INSERT INTO "User" (id, email, "updatedAt") VALUES ('actor', 'actor@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Post" (id, title, content, published, "authorId", "updatedAt")
        VALUES ('other-post', 'Other title', 'Other content', true, 'recipient', CURRENT_TIMESTAMP);
      INSERT INTO "Comment" (id, content, "postId", "authorId", "updatedAt") VALUES
        ('replacement', 'Replacement reply', 'kept-post', 'endorser', CURRENT_TIMESTAMP),
        ('other-comment', 'Other reply', 'other-post', 'endorser', CURRENT_TIMESTAMP);
      INSERT INTO "AcceptedSolution" ("postId", "commentId", revision)
        VALUES ('kept-post', 'kept-comment', 'selected-revision');
      INSERT INTO "AcceptedSolutionChange" (id, action, "actorId", "postId", "previousCommentId", "commentId") VALUES
        ('selected-revision', 'SELECTED', 'actor', 'kept-post', NULL, 'kept-comment'),
        ('changed-revision', 'CHANGED', 'actor', 'kept-post', 'kept-comment', 'replacement'),
        ('cleared-revision', 'CLEARED', 'actor', 'kept-post', 'replacement', NULL);`);
    const insert = (postId, commentId, revision) => database.query(
      'INSERT INTO "AcceptedSolution" ("postId", "commentId", revision) VALUES ($1, $2, $3)', [postId, commentId, revision]);
    for (const values of [
      ['kept-post', 'replacement', 'duplicate-post'],
      ['other-post', 'kept-comment', 'duplicate-comment'],
      ['other-post', 'other-comment', 'selected-revision'],
    ]) await assert.rejects(insert(...values), error => error.code === '23505');
    for (const values of [
      ['other-post', 'replacement', 'cross-post'],
      ['missing-post', 'replacement', 'missing-post'],
      ['other-post', 'missing-comment', 'missing-comment'],
    ]) await assert.rejects(insert(...values), error => error.code === '23503');
    await assert.rejects(database.query(`INSERT INTO "AcceptedSolution" ("postId", "commentId")
      VALUES ('other-post', 'other-comment')`), error => error.code === '23502');
    await assert.rejects(database.query(`INSERT INTO "AcceptedSolutionChange" (id, action)
      VALUES ('selected-revision', 'SELECTED')`), error => error.code === '23505');
    for (const action of ['DELETED', 'selected', '']) {
      await assert.rejects(database.query('INSERT INTO "AcceptedSolutionChange" (id, action) VALUES ($1, $2)',
        [`invalid-action-${action}`, action]), error => error.code === '23514');
    }
    await assert.rejects(database.query(`UPDATE "AcceptedSolutionChange" SET action = 'DELETED' WHERE id = 'selected-revision'`),
      error => error.code === '23514');
    for (const column of ['actorId', 'postId', 'previousCommentId', 'commentId']) {
      await assert.rejects(database.query(`INSERT INTO "AcceptedSolutionChange" (id, action, "${column}")
        VALUES ($1, 'SELECTED', 'missing')`, [`missing-${column}`]), error => error.code === '23503');
    }
    const read = async table => (await database.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
    const snapshot = new Map();
    for (const table of ['User', 'Post', 'Comment', 'LikePost', 'LikeComment', 'AcceptedSolution', 'AcceptedSolutionChange', '_app_schema_upgrades']) {
      snapshot.set(table, await read(table));
    }
    await applyPostgresqlUpgrades(url);
    for (const [table, rows] of snapshot) assert.deepEqual(await read(table), rows, `${table} changed on replay`);
    assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM "RewardLedger"')).rows[0].n, 0);
    assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM "RewardLedgerChange"')).rows[0].n, 0);

    await database.query(`DELETE FROM "User" WHERE id = 'actor'`);
    assert.deepEqual(await read('AcceptedSolution'), snapshot.get('AcceptedSolution'));
    assert.deepEqual((await read('AcceptedSolutionChange')).map(row => row.actorId), [null, null, null]);
    await database.query(`DELETE FROM "Comment" WHERE id = 'kept-comment'`);
    assert.deepEqual(await read('AcceptedSolution'), []);
    assert.deepEqual((await database.query(`SELECT "previousCommentId", "commentId" FROM "AcceptedSolutionChange"
      WHERE id = 'changed-revision'`)).rows, [{ previousCommentId: null, commentId: 'replacement' }]);
    await insert('kept-post', 'replacement', 'reselected-revision');
    await database.query(`DELETE FROM "Post" WHERE id = 'kept-post'`);
    assert.deepEqual(await read('AcceptedSolution'), []);
    assert.deepEqual((await read('AcceptedSolutionChange')).map(row => [row.id, row.action, row.actorId, row.postId, row.previousCommentId, row.commentId]),
      snapshot.get('AcceptedSolutionChange').map(row => [row.id, row.action, null, null, null, null]));
    assert.deepEqual((await database.query('SELECT id FROM "Post"')).rows, [{ id: 'other-post' }]);
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

test('question-bank PostgreSQL upgrade enforces immutable, owner-scoped revision storage', async () => {
  await fixture(async ({ database, url }) => {
    await applyPostgresqlUpgrades(url);
    await applyPostgresqlUpgrades(url);
    assert.ok((await database.query(`SELECT to_regclass('"QuestionBankItem_ownerId_updatedAt_idx"') AS name`)).rows[0].name);
    await database.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ('bank-author', 'bank-author@example.invalid', CURRENT_TIMESTAMP)`);
    await database.query(`INSERT INTO "QuestionBankItem" (id, "ownerId") VALUES ('bank-item', 'bank-author')`);
    await assert.rejects(database.query(`INSERT INTO "QuestionBankItem" (id, "ownerId") VALUES ('orphan', 'missing')`),
      error => error.code === '23503');
    await assert.rejects(database.query(`UPDATE "QuestionBankItem" SET "latestRevision" = 0 WHERE id = 'bank-item'`),
      error => error.code === '23514');
    await database.query(`INSERT INTO "QuestionBankRevision" ("itemId", revision, "questionJson") VALUES ('bank-item', 1, '{"question":"Original"}')`);
    await assert.rejects(database.query(`INSERT INTO "QuestionBankRevision" ("itemId", revision, "questionJson") VALUES ('bank-item', 1, '{}')`),
      error => error.code === '23505');
    await assert.rejects(database.query(`UPDATE "QuestionBankRevision" SET "questionJson" = '{}' WHERE "itemId" = 'bank-item'`),
      error => error.code === '23514');
    await database.query(`UPDATE "QuestionBankItem" SET "latestRevision" = 2 WHERE id = 'bank-item'`);
    await database.query(`INSERT INTO "QuestionBankRevision" ("itemId", revision, "questionJson") VALUES ('bank-item', 2, '{"question":"Revised"}')`);
    assert.equal((await database.query(`SELECT "questionJson" FROM "QuestionBankRevision" WHERE "itemId" = 'bank-item' AND revision = 1`)).rows[0].questionJson,
      '{"question":"Original"}');
    await database.query(`DELETE FROM "User" WHERE id = 'bank-author'`);
    assert.equal((await database.query(`SELECT COUNT(*)::int AS n FROM "QuestionBankRevision" WHERE "itemId" = 'bank-item'`)).rows[0].n, 0);
    assert.equal((await database.query(`SELECT COUNT(*)::int AS n FROM "QuestionBankItem" WHERE id = 'bank-item'`)).rows[0].n, 0);
  });
});
