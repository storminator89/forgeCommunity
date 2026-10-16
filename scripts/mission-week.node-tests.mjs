import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { initializeSqlite } from './sqlite-init.mjs';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import testDatabase from './space-mission-test-database.cjs';

const root = new URL('../', import.meta.url);
const sqliteDirectory = new URL('prisma/sqlite-migrations/', root);
const postgresDirectory = new URL('prisma/postgresql-upgrades/', root);
const sqliteTail = '0026_space_mission_week.sql';
const postgresTail = '0025_space_mission_week.sql';
const names = directory => readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const sql = (name, directory = sqliteDirectory) => readFileSync(new URL(name, directory), 'utf8');
const checksum = value => createHash('sha256').update(value).digest('hex');
const fields = ['weekStartsOn', 'weekTimezone', 'weekStartsAt', 'weekEndsAt'];
const seedSql = `INSERT INTO "User" (id,email,"updatedAt") VALUES
  ('a','a@example.invalid',CURRENT_TIMESTAMP),('b','b@example.invalid',CURRENT_TIMESTAMP);
  INSERT INTO "Space" (id,name,description,visibility,"updatedAt") VALUES ('s','Private','Keep topic','PRIVATE',CURRENT_TIMESTAMP);
  INSERT INTO "SpaceMember" ("spaceId","userId") VALUES ('s','a'),('s','b');
  INSERT INTO "SpaceMission" (id,"spaceId","creatorId","requestId","payloadDigest",title,prompt)
    VALUES ('m','s','a','request','legacy-digest','Existing relay','Original prompt');
  INSERT INTO "SpaceMissionParticipation" ("missionId","userId",epoch) VALUES ('m','a',1),('m','b',1);
  INSERT INTO "SpaceMissionContribution" (id,"missionId","authorId",epoch,kind,content,"targetContributionId","requestId","payloadDigest")
    VALUES ('insight','m','a',1,'INSIGHT','Keep this insight',NULL,'insight','digest'),
      ('build','m','b',1,'BUILD_ON','Keep this build-on','insight','build','digest');`;

function fixture(beforeTail = false) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-mission-week-'));
  const migrations = join(dir, 'migrations'); mkdirSync(migrations);
  for (const name of names(sqliteDirectory).filter(name => !beforeTail || name < sqliteTail)) {
    copyFileSync(new URL(name, sqliteDirectory), join(migrations, name));
  }
  const url = `file:${join(dir, 'test.db')}`;
  const deploy = () => {
    const previous = process.env.DATABASE_PROVIDER; process.env.DATABASE_PROVIDER = 'sqlite';
    try { initializeSqlite(url, migrations); }
    finally { if (previous === undefined) delete process.env.DATABASE_PROVIDER; else process.env.DATABASE_PROVIDER = previous; }
  };
  deploy();
  return { url, migrations, deploy, addTail: () => {
    for (const name of names(sqliteDirectory).filter(name => name >= sqliteTail)) {
      copyFileSync(new URL(name, sqliteDirectory), join(migrations, name));
    }
  },
    open: () => { const db = new DatabaseSync(url.slice(5)); db.exec('PRAGMA foreign_keys=ON'); return db; } };
}
const sqliteIndexes = db => db.prepare(`SELECT name,sql FROM sqlite_master WHERE type='index'
  AND tbl_name IN ('SpaceMission','SpaceMissionParticipation','SpaceMissionContribution') ORDER BY name`).all();
const legacyMission = db => db.prepare(`SELECT id,"spaceId","creatorId","requestId","payloadDigest",title,prompt,"createdAt","closedAt" FROM "SpaceMission" ORDER BY id`).all();
const columns = db => db.prepare('PRAGMA table_info("SpaceMission")').all().map(row => row.name);

test('paired current week tails add exactly four nullable columns and a complete positive-range check without rebuilding history', () => {
  assert.deepEqual(names(sqliteDirectory).slice(-3), ['0025_space_polls.sql', sqliteTail, '0027_space_mission_bookmarks.sql']);
  assert.deepEqual(names(postgresDirectory).slice(-3), ['0024_space_polls.sql', postgresTail, '0026_space_mission_bookmarks.sql']);
  for (const ddl of [sql(sqliteTail), sql(postgresTail, postgresDirectory)]) {
    const statements = ddl.replace(/^--.*$/gm, '');
    assert.ok(!/\b(?:DROP|DELETE|UPDATE|INSERT|CREATE|RENAME)\b/i.test(statements));
    for (const field of fields) assert.match(ddl, new RegExp(`ADD COLUMN "${field}"`));
    assert.match(ddl, /"SpaceMission_week_complete_range"/);
    assert.match(ddl, /"weekEndsAt" > "weekStartsAt"/);
    assert.match(ddl, /length\("weekTimezone"\) BETWEEN 1 AND 100/);
  }
});

test('fresh SQLite requires all-null or all-four and strictly increasing UTC boundaries for both numeric and textual dates', async () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql);
    const update = db.prepare('UPDATE "SpaceMission" SET "weekStartsOn"=?,"weekTimezone"=?,"weekStartsAt"=?,"weekEndsAt"=? WHERE id=\'m\'');
    const full = ['2026-10-19', 'Europe/Berlin', Date.parse('2026-10-18T22:00:00Z'), Date.parse('2026-10-25T23:00:00Z')];
    for (let mask = 1; mask < 15; mask++) {
      assert.throws(() => update.run(...full.map((value, index) => mask & 1 << index ? value : null)), /CHECK/, `partial mask ${mask}`);
    }
    for (const [start, end] of [[full[2], full[2]], [full[3], full[2]], ['2026-10-26 00:00:00', '2026-10-19 00:00:00']]) {
      assert.throws(() => update.run(full[0], full[1], start, end), /CHECK/);
    }
    assert.throws(() => update.run(full[0], '', full[2], full[3]), /CHECK/);
    assert.throws(() => update.run(full[0], 'a'.repeat(101), full[2], full[3]), /CHECK/);
    update.run(...full);
    assert.equal(db.prepare('SELECT "weekEndsAt"-"weekStartsAt" AS elapsed FROM "SpaceMission"').get().elapsed, 169 * 3600000);
    update.run(null, null, null, null);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
  } finally { db.close(); }
});

test('populated predecessor upgrade preserves mission text, digest, consent, contributions, FKs, partial indexes and prior checksums', async () => {
  const f = fixture(true); const db = f.open();
  try {
    db.exec(seedSql);
    const mission = legacyMission(db);
    const consent = db.prepare('SELECT * FROM "SpaceMissionParticipation" ORDER BY "userId"').all();
    const contributions = db.prepare('SELECT * FROM "SpaceMissionContribution" ORDER BY id').all();
    const indexes = sqliteIndexes(db);
    const fks = db.prepare('PRAGMA foreign_key_list("SpaceMissionContribution")').all();
    const history = db.prepare('SELECT * FROM _app_migrations ORDER BY name').all();
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing/);
    f.addTail(); f.deploy(); f.deploy();
    assert.deepEqual(legacyMission(db), mission);
    assert.deepEqual(db.prepare('SELECT * FROM "SpaceMissionParticipation" ORDER BY "userId"').all(), consent);
    assert.deepEqual(db.prepare('SELECT * FROM "SpaceMissionContribution" ORDER BY id').all(), contributions);
    assert.deepEqual(sqliteIndexes(db), indexes);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_list("SpaceMissionContribution")').all(), fks);
    assert.deepEqual(db.prepare('SELECT * FROM _app_migrations WHERE name < ? ORDER BY name').all(sqliteTail), history);
    assert.deepEqual({ ...db.prepare('SELECT "weekStartsOn","weekTimezone","weekStartsAt","weekEndsAt" FROM "SpaceMission"').get() }, Object.fromEntries(fields.map(field => [field, null])));
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
    assert.throws(() => db.exec(`INSERT INTO "SpaceMission" (id,"spaceId","requestId","payloadDigest",title,prompt) VALUES ('duplicate','s','other','d','Title','Prompt')`), /UNIQUE/);
    assert.throws(() => db.exec(`INSERT INTO "SpaceMissionContribution" (id,"missionId","authorId",epoch,kind,content,"requestId","payloadDigest")
      VALUES ('duplicate','m','a',1,'INSIGHT','Another','other','d')`), /UNIQUE/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('SQLite week tail remains checksum/order guarded and DDL failure rolls back all four additions and history', async () => {
  const f = fixture(true); const db = f.open();
  try {
    db.exec(seedSql);
    const before = legacyMission(db); const indexes = sqliteIndexes(db);
    writeFileSync(join(f.migrations, sqliteTail), `${sql(sqliteTail)}\nINSERT INTO MissingWeekTestTable VALUES (1);`);
    assert.throws(f.deploy, /no such table/);
    assert.equal(columns(db).some(name => fields.includes(name)), false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM _app_migrations WHERE name=?').get(sqliteTail).n, 0);
    assert.deepEqual(legacyMission(db), before); assert.deepEqual(sqliteIndexes(db), indexes);
    f.addTail(); f.deploy();
    const expected = checksum(sql(sqliteTail));
    db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run('tampered', sqliteTail);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing/);
    assert.throws(f.deploy, /checksum changed/);
    db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run(expected, sqliteTail);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run('0025_space_polls.sql');
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing/);
    assert.throws(f.deploy, /gap before 0026_space_mission_week\.sql/);
    db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run('0025_space_polls.sql', checksum(sql('0025_space_polls.sql')));
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run(sqliteTail);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing/);
    assert.throws(f.deploy, /gap before 0027_space_mission_bookmarks\.sql/);
    db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run(sqliteTail, expected);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
  } finally { db.close(); }
});

// Validate the original authority before connecting. These tests can never use
// a remote DB, real database name, URL overrides or another schema's objects.
const pgUrl = process.env.POSTGRESQL_RELEASE_GATE_DISPOSABLE === '1'
  ? testDatabase.disposablePostgresqlTestUrl(process.env.DATABASE_URL) : null;
async function withPostgres(run) {
  const db = new pg.Client({ connectionString: pgUrl });
  const schema = `forge_mission_week_${randomUUID().replaceAll('-', '_')}`;
  const url = new URL(pgUrl); url.searchParams.set('schema', schema);
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET search_path TO "${schema}"`);
    await run(db, url.toString());
  } finally { try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); } }
}
const pgRows = async (db, table) => (await db.query(`SELECT * FROM "${table}" ORDER BY 1,2`)).rows;

test('PostgreSQL fresh deployment enforces every partial week/range check and retains mission uniqueness', { skip: !pgUrl }, async () => {
  await withPostgres(async (db, url) => {
    await applyPostgresqlUpgrades(url, { initializeEmptySchema: true });
    await applyPostgresqlUpgrades(url);
    assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
    await db.query(seedSql);
    const update = values => db.query(`UPDATE "SpaceMission" SET "weekStartsOn"=$1,"weekTimezone"=$2,"weekStartsAt"=$3,"weekEndsAt"=$4 WHERE id='m'`, values);
    const full = ['2026-10-19', 'Europe/Berlin', '2026-10-18T22:00:00Z', '2026-10-25T23:00:00Z'];
    for (let mask = 1; mask < 15; mask++) {
      await assert.rejects(update(full.map((value, index) => mask & 1 << index ? value : null)), error => error.code === '23514');
    }
    for (const values of [[...full.slice(0, 2), full[2], full[2]], [...full.slice(0, 2), full[3], full[2]],
      [full[0], '', ...full.slice(2)], [full[0], 'a'.repeat(101), ...full.slice(2)]]) {
      await assert.rejects(update(values), error => error.code === '23514');
    }
    await update(full);
    assert.equal(Number((await db.query(`SELECT EXTRACT(EPOCH FROM ("weekEndsAt"-"weekStartsAt"))/3600 AS hours FROM "SpaceMission" WHERE id='m'`)).rows[0].hours), 169);
    await assert.rejects(db.query(`INSERT INTO "SpaceMission" (id,"spaceId","requestId","payloadDigest",title,prompt)
      VALUES ('duplicate','s','other','d','Title','Prompt')`), error => error.code === '23505');
  });
});

test('PostgreSQL populated tracked upgrade preserves all old mission state and refuses altered or gapped history', { skip: !pgUrl }, async () => {
  await withPostgres(async (db, url) => {
    await db.query(readFileSync(new URL('prisma/postgresql-baselines/0000_main_7814799.sql', root), 'utf8'));
    await db.query('CREATE TABLE "_app_schema_upgrades" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    for (const name of names(postgresDirectory).filter(name => name < postgresTail)) {
      const ddl = sql(name, postgresDirectory);
      if (name !== '0001_skill_endorsements.sql') await db.query(ddl);
      await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)', [name, checksum(ddl)]);
    }
    await db.query(seedSql);
    const before = await pgRows(db, 'SpaceMission');
    const consent = await pgRows(db, 'SpaceMissionParticipation');
    const contributions = await pgRows(db, 'SpaceMissionContribution');
    const history = await pgRows(db, '_app_schema_upgrades');
    const indexes = (await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema()
      AND tablename IN ('SpaceMission','SpaceMissionParticipation','SpaceMissionContribution') ORDER BY indexname`)).rows;
    await assert.rejects(assertCoursePublicationReady(url, 'postgresql'), /history is missing/);
    await applyPostgresqlUpgrades(url); await applyPostgresqlUpgrades(url);
    const current = await pgRows(db, 'SpaceMission');
    for (const row of current) { for (const field of fields) { assert.equal(row[field], null); delete row[field]; } }
    assert.deepEqual(current, before);
    assert.deepEqual(await pgRows(db, 'SpaceMissionParticipation'), consent);
    assert.deepEqual(await pgRows(db, 'SpaceMissionContribution'), contributions);
    assert.deepEqual((await db.query('SELECT * FROM "_app_schema_upgrades" WHERE name < $1 ORDER BY 1,2', [postgresTail])).rows, history);
    assert.deepEqual((await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema()
      AND tablename IN ('SpaceMission','SpaceMissionParticipation','SpaceMissionContribution') ORDER BY indexname`)).rows, indexes);
    assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
    const expected = checksum(sql(postgresTail, postgresDirectory));
    await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2', ['tampered', postgresTail]);
    await assert.rejects(assertCoursePublicationReady(url, 'postgresql'), /history is missing/);
    await assert.rejects(applyPostgresqlUpgrades(url), /history mismatch/);
    await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2', [expected, postgresTail]);
    await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1', ['0024_space_polls.sql']);
    await assert.rejects(applyPostgresqlUpgrades(url), /gap before 0025_space_mission_week\.sql/);
    await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)', ['0024_space_polls.sql', checksum(sql('0024_space_polls.sql', postgresDirectory))]);
    assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
  });
});
