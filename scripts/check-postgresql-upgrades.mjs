import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';

const baseUrl = process.env.DATABASE_URL;
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
    await database.query(`
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      CREATE TABLE "UserSkill" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"(id),
        "skillId" TEXT NOT NULL,
        endorsements INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO "User" (id) VALUES ('recipient'), ('endorser');
      INSERT INTO "UserSkill" (id, "userId", "skillId", endorsements)
      VALUES ('userSkill', 'recipient', 'skill', 7);`);
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
    assert.equal(migrations, 1);
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
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM "_app_schema_upgrades"')).rows[0].count, 1);
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
