import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeSqlite } from './sqlite-init.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import testDatabase from './space-mission-test-database.cjs';

const root = new URL('../', import.meta.url);
const source = name => readFileSync(new URL(name, root), 'utf8');
const directory = new URL('../prisma/sqlite-migrations/', import.meta.url);
const names = readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const sql = name => readFileSync(new URL(name, directory), 'utf8');

test('disposable PostgreSQL URL rejects authority overrides, sockets, SSL/options and every untrusted parameter before connecting', () => {
  const missionTestDatabaseUrl = (value, provider) => {
    // Both the mission fixture and pre-existing destructive integration gates
    // use this same pure boundary; neither raw authority nor query overrides
    // are passed to pg clients or the deployment runner after validation.
    const mission = testDatabase.missionTestDatabaseUrl(value, provider);
    assert.equal(testDatabase.disposablePostgresqlTestUrl(value), mission);
    return mission;
  };
  const local = 'postgresql://user:password@127.0.0.1:5432/forge_test';
  for (const suffix of [
    '?host=remote.example.invalid', '?hostaddr=203.0.113.1', '?host=%2Fvar%2Frun%2Fpostgresql',
    '?host=127.0.0.1&host=remote.example.invalid', '?%68ost=remote.example.invalid',
    '?port=5433', '?dbname=production', '?database=production', '?user=other', '?password=other',
    '?sslmode=disable', '?ssl=true', '?sslcert=%2Ftmp%2Fcertificate', '?sslrootcert=%2Ftmp%2Froot',
    '?options=-c%20search_path%3Dpublic', '?schema=public', '?application_name=mission-test',
    '#host=remote.example.invalid', '#fragment',
  ]) {
    assert.throws(() => missionTestDatabaseUrl(`${local}${suffix}`, 'postgresql'), /without query parameters or fragments/, suffix);
    assert.throws(() => testDatabase.disposablePostgresqlTestUrl(`${local}${suffix}`), /without query parameters or fragments/, suffix);
  }
  for (const invalid of [undefined, '', 'not a URL', 'postgresql://user@remote.example.invalid/forge_test',
    'postgresql://user@127.0.0.1/production', 'http://127.0.0.1/forge_test']) {
    assert.throws(() => missionTestDatabaseUrl(invalid, 'postgresql'));
  }
  assert.throws(() => missionTestDatabaseUrl(local, 'sqlite'));
  for (const valid of [local, 'postgres://user:p%3Fhost%3Dremote@localhost:5432/forge_test',
    'postgresql://user:password@[::1]:5432/forge_test']) {
    assert.equal(missionTestDatabaseUrl(valid, 'postgresql'), new URL(valid).toString());
  }
});

function database(through = names.at(-1)) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of names) { if (name > through) break; db.exec(sql(name)); }
  return db;
}
function seed(db) {
  db.exec(`INSERT INTO "User" (id,email,updatedAt) VALUES
    ('admin','admin@example.invalid',CURRENT_TIMESTAMP), ('a','a@example.invalid',CURRENT_TIMESTAMP), ('b','b@example.invalid',CURRENT_TIMESTAMP);
    INSERT INTO "Space" (id,name,description,visibility,updatedAt) VALUES ('s','Private','Topic','PRIVATE',CURRENT_TIMESTAMP);
    INSERT INTO "SpaceMission" (id,spaceId,creatorId,requestId,payloadDigest,title,prompt) VALUES ('m','s','admin','create','digest','Topic','Teach it back');
    INSERT INTO "SpaceMissionParticipation" (missionId,userId,epoch) VALUES ('m','a',1),('m','b',1);`);
}
const insertContribution = (db, id, author = 'a', kind = 'INSIGHT', target = null, mission = 'm', request = id, epoch = 1) =>
  db.prepare(`INSERT INTO "SpaceMissionContribution" (id,missionId,authorId,epoch,kind,content,targetContributionId,requestId,payloadDigest)
    VALUES (?,?,?,?,?,'A specific example',?,?,'digest')`).run(id, mission, author, epoch, kind, target, request);

test('both provider migrations enforce one open mission, scoped replay and one live contribution per kind/epoch', () => {
  for (const [foundation, contribution] of [
    ['prisma/sqlite-migrations/0022_space_mission_foundation.sql', 'prisma/sqlite-migrations/0023_space_mission_contributions.sql'],
    ['prisma/postgresql-upgrades/0021_space_mission_foundation.sql', 'prisma/postgresql-upgrades/0022_space_mission_contributions.sql'],
  ]) {
    assert.match(source(foundation), /CREATE UNIQUE INDEX "SpaceMission_one_open_per_space"[^;]+WHERE "closedAt" IS NULL/);
    assert.match(source(contribution), /CREATE UNIQUE INDEX "SpaceMissionContribution_one_live_kind"[^;]+WHERE "hiddenAt" IS NULL AND "withdrawnAt" IS NULL/);
    assert.match(source(contribution), /FOREIGN KEY \("missionId", "targetContributionId"\) REFERENCES "SpaceMissionContribution" \("missionId", "id"\)/);
    assert.match(source(contribution), /SPACE_MISSION_CONTRIBUTION/);
  }
});

test('SQLite live indexes, epochs, replay keys and cross-mission targets are enforced by the actual migrated database', () => {
  const db = database();
  try {
    seed(db);
    assert.throws(() => db.exec(`INSERT INTO "SpaceMission" (id,spaceId,requestId,payloadDigest,title,prompt) VALUES ('duplicate','s','new','digest','Topic','Teach')`), /UNIQUE/);
    insertContribution(db, 'insight');
    assert.throws(() => insertContribution(db, 'same-kind'), /UNIQUE/);
    assert.throws(() => insertContribution(db, 'same-request', 'a', 'BUILD_ON', 'insight', 'm', 'insight'), /UNIQUE/);
    assert.throws(() => insertContribution(db, 'wrong-kind', 'a', 'INSIGHT', 'insight'), /CHECK/);
    assert.throws(() => insertContribution(db, 'no-target', 'b', 'BUILD_ON'), /CHECK/);
    assert.throws(() => insertContribution(db, 'bad-epoch', 'b', 'INSIGHT', null, 'm', 'bad', 0), /CHECK/);
    db.exec(`UPDATE "SpaceMission" SET closedAt=CURRENT_TIMESTAMP WHERE id='m';
      INSERT INTO "SpaceMission" (id,spaceId,requestId,payloadDigest,title,prompt) VALUES ('other','s','other','digest','Topic','Teach');`);
    assert.throws(() => insertContribution(db, 'foreign-target', 'b', 'BUILD_ON', 'insight', 'other'), /FOREIGN KEY/);
    insertContribution(db, 'build', 'b', 'BUILD_ON', 'insight');
    db.exec(`UPDATE "SpaceMissionContribution" SET hiddenAt=CURRENT_TIMESTAMP WHERE id='insight'`);
    insertContribution(db, 'replacement');
    assert.throws(() => db.exec(`UPDATE "SpaceMissionContribution" SET hiddenAt=NULL WHERE id='insight'`), /UNIQUE/);
    db.exec(`UPDATE "SpaceMissionContribution" SET withdrawnAt=CURRENT_TIMESTAMP WHERE id='replacement'`);
    insertContribution(db, 'epoch-two', 'a', 'INSIGHT', null, 'm', 'epoch-two', 2);
    db.exec(`DELETE FROM "User" WHERE id='a'`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "SpaceMissionContribution"').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('populated Space/report history survives the mission-tail upgrade, and new reports require private scope', () => {
  const db = database('0021_space_report_targets.sql');
  try {
    db.exec(`INSERT INTO "ContentReport" (id,reporterId,targetType,targetId,reason) VALUES ('old','old-user','POST','gone','SPAM');
      INSERT INTO "ContentReport" (id,reporterId,targetType,targetId,reason,status,reviewedAt,reviewedById,resolutionNote,scopeSpaceId)
      VALUES ('scoped','old-user','SPACE_REPLY','gone-reply','OTHER','DISMISSED',CURRENT_TIMESTAMP,'former-admin','Retained decision','former-space');`);
    const history = db.prepare('SELECT * FROM "ContentReport" ORDER BY id').all();
    db.exec(sql('0022_space_mission_foundation.sql'));
    db.exec(sql('0023_space_mission_contributions.sql'));
    assert.deepEqual(db.prepare('SELECT * FROM "ContentReport" ORDER BY id').all(), history);
    db.exec(`INSERT INTO "ContentReport" (id,reporterId,targetType,targetId,reason,scopeSpaceId)
      VALUES ('mission','member','SPACE_MISSION_CONTRIBUTION','contribution','SPAM','private-space')`);
    assert.throws(() => db.exec(`INSERT INTO "ContentReport" (id,reporterId,targetType,targetId,reason)
      VALUES ('unscoped','member','SPACE_MISSION_CONTRIBUTION','contribution','SPAM')`), /CHECK/);
    assert.throws(() => db.exec(`UPDATE "ContentReport" SET status='RESOLVED' WHERE id='mission'`), /CHECK/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('reviewed SQLite deployment and readiness include both mission tails and reject tampered history', async () => {
  const previousProvider = process.env.DATABASE_PROVIDER;
  process.env.DATABASE_PROVIDER = 'sqlite';
  const path = join(mkdtempSync(join(tmpdir(), 'forge-mission-readiness-')), 'test.db');
  const url = `file:${path}`;
  try {
    initializeSqlite(url);
    initializeSqlite(url);
    assert.equal(await assertCoursePublicationReady(url, 'sqlite'), true);
    const db = new DatabaseSync(path);
    try {
      const history = db.prepare(`SELECT name,checksum FROM _app_migrations WHERE name IN ('0022_space_mission_foundation.sql','0023_space_mission_contributions.sql') ORDER BY name`).all();
      assert.equal(history.length, 2);
      for (const row of history) {
        db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run('tampered', row.name);
        await assert.rejects(assertCoursePublicationReady(url, 'sqlite'), /history is missing, divergent or has changed checksums/);
        db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run(row.checksum, row.name);
      }
      assert.equal(await assertCoursePublicationReady(url, 'sqlite'), true);
    } finally { db.close(); }
  } finally {
    if (previousProvider === undefined) delete process.env.DATABASE_PROVIDER;
    else process.env.DATABASE_PROVIDER = previousProvider;
  }
});
