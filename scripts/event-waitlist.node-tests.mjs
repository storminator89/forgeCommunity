import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const source = name => readFileSync(new URL(name, root), 'utf8');
const checksum = value => createHash('sha256').update(value).digest('hex');
const sqliteTail = '0024_event_waitlist.sql';
const postgresTail = '0023_event_waitlist.sql';
const sqliteDirectory = new URL('prisma/sqlite-migrations/', root);
const postgresDirectory = new URL('prisma/postgresql-upgrades/', root);
const migrationNames = directory => readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const sqliteNames = migrationNames(sqliteDirectory);
const postgresNames = migrationNames(postgresDirectory);
const migrationSql = (name, directory = sqliteDirectory) => readFileSync(new URL(name, directory), 'utf8');

function sqliteFixture({ beforeTail = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'forge-event-waitlist-'));
  const migrations = join(directory, 'migrations');
  mkdirSync(migrations);
  for (const name of sqliteNames.filter(name => !beforeTail || name < sqliteTail)) {
    copyFileSync(new URL(name, sqliteDirectory), join(migrations, name));
  }
  const path = join(directory, 'test.db');
  const url = `file:${path}`;
  const deploy = () => {
    const previous = process.env.DATABASE_PROVIDER;
    process.env.DATABASE_PROVIDER = 'sqlite';
    try { initializeSqlite(url, migrations); }
    finally {
      if (previous === undefined) delete process.env.DATABASE_PROVIDER;
      else process.env.DATABASE_PROVIDER = previous;
    }
  };
  deploy();
  return {
    url, migrations, deploy,
    addTail: () => { for (const name of sqliteNames.filter(name => name >= sqliteTail)) copyFileSync(new URL(name, sqliteDirectory), join(migrations, name)); },
    open: () => {
      const db = new DatabaseSync(path);
      db.exec('PRAGMA foreign_keys = ON');
      return db;
    },
  };
}

const seedSql = `INSERT INTO "User" (id,email,"updatedAt") VALUES
  ('a','waitlist-a@example.invalid',CURRENT_TIMESTAMP),
  ('b','waitlist-b@example.invalid',CURRENT_TIMESTAMP),
  ('c','waitlist-c@example.invalid',CURRENT_TIMESTAMP),
  ('d','waitlist-d@example.invalid',CURRENT_TIMESTAMP);
  INSERT INTO "Event" (id,title,description,date,location,"maxAttendees",category,"startTime","endTime","updatedAt") VALUES
  ('e','Preserved event','Original description','2030-01-01','Online',1,'community','10:00','11:00',CURRENT_TIMESTAMP),
  ('other','Other event','Original description','2030-01-02','Online',NULL,'community','10:00','11:00',CURRENT_TIMESTAMP);
  INSERT INTO "EventAttendee" (id,"eventId","userId",status) VALUES
  ('registered','e','a','REGISTERED'),('confirmed','e','b','CONFIRMED'),
  ('cancelled','e','c','CANCELLED'),('attended','e','d','ATTENDED');`;

test('paired waitlist tails are strictly additive and preserve the existing attendee enum contract', () => {
  assert.ok(sqliteNames.includes(sqliteTail));
  assert.ok(postgresNames.includes(postgresTail));
  for (const [directory, name] of [[sqliteDirectory, sqliteTail], [postgresDirectory, postgresTail]]) {
    const sql = migrationSql(name, directory);
    const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
    assert.equal(statements.length, 4);
    assert.match(statements[0], /^CREATE TABLE "EventWaitlist"/);
    assert.ok(statements.slice(1).every(value => /^CREATE (?:UNIQUE )?INDEX "EventWaitlist_/.test(value)));
    assert.match(sql, /CREATE UNIQUE INDEX "EventWaitlist_eventId_userId_key" ON "EventWaitlist"\("eventId", "userId"\)/);
    assert.match(sql, /CREATE INDEX "EventWaitlist_eventId_id_idx" ON "EventWaitlist"\("eventId", "id"\)/);
    assert.match(sql, /CREATE INDEX "EventWaitlist_userId_idx" ON "EventWaitlist"\("userId"\)/);
    for (const [column, target] of [['eventId', 'Event'], ['userId', 'User']]) {
      assert.ok(sql.includes(`FOREIGN KEY ("${column}") REFERENCES "${target}" ("id") ON DELETE CASCADE ON UPDATE CASCADE`));
    }
  }
  assert.match(migrationSql(sqliteTail), /"id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT/);
  assert.match(migrationSql(postgresTail, postgresDirectory), /"id" SERIAL NOT NULL/);
  for (const path of ['prisma/schema.prisma', 'prisma/schema.sqlite.prisma']) {
    const schema = source(path);
    assert.match(schema, /model EventWaitlist \{[\s\S]*?id\s+Int\s+@id @default\(autoincrement\(\)\)/);
    assert.match(schema, /enum AttendeeStatus \{\s+REGISTERED\s+CONFIRMED\s+CANCELLED\s+ATTENDED\s+\}/);
  }
});

test('fresh SQLite waitlist enforces unique membership, required values, indexes and cascading foreign keys', () => {
  const f = sqliteFixture();
  const db = f.open();
  try {
    db.exec(seedSql);
    const insert = db.prepare('INSERT INTO "EventWaitlist" ("eventId","userId") VALUES (?,?)');
    insert.run('e', 'a');
    assert.throws(() => insert.run('e', 'a'), /UNIQUE/);
    assert.throws(() => insert.run('missing', 'b'), /FOREIGN KEY/);
    assert.throws(() => insert.run('e', 'missing'), /FOREIGN KEY/);
    assert.throws(() => insert.run(null, 'b'), /NOT NULL/);
    assert.throws(() => insert.run('e', null), /NOT NULL/);
    insert.run('other', 'a');
    insert.run('e', 'b');
    const indexes = db.prepare('PRAGMA index_list("EventWaitlist")').all();
    for (const [name, columns, unique] of [
      ['EventWaitlist_eventId_userId_key', ['eventId', 'userId'], 1],
      ['EventWaitlist_eventId_id_idx', ['eventId', 'id'], 0],
      ['EventWaitlist_userId_idx', ['userId'], 0],
    ]) {
      assert.equal(indexes.find(index => index.name === name)?.unique, unique);
      assert.deepEqual(db.prepare(`PRAGMA index_info("${name}")`).all().map(row => row.name), columns);
    }
    assert.ok(db.prepare('SELECT "createdAt" FROM "EventWaitlist" LIMIT 1').get().createdAt);
    db.exec(`UPDATE "Event" SET id='renamed' WHERE id='e'; UPDATE "User" SET id='renamed-a' WHERE id='a'`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "EventWaitlist" WHERE "eventId"=?').get('renamed').n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "EventWaitlist" WHERE "userId"=?').get('renamed-a').n, 2);
    db.exec(`DELETE FROM "User" WHERE id='renamed-a'`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "EventWaitlist"').get().n, 1);
    db.exec(`DELETE FROM "Event" WHERE id='renamed'`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "EventWaitlist"').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
});

test('SQLite FIFO IDs ignore timestamp ties and clock changes, and rejoin never reuses a removed ID', () => {
  const f = sqliteFixture();
  const db = f.open();
  try {
    db.exec(seedSql);
    const insert = db.prepare('INSERT INTO "EventWaitlist" ("eventId","userId","createdAt") VALUES (?,?,?)');
    const first = Number(insert.run('e', 'a', '2030-01-03').lastInsertRowid);
    const second = Number(insert.run('e', 'b', '2030-01-01').lastInsertRowid);
    const third = Number(insert.run('e', 'c', '2030-01-01').lastInsertRowid);
    const queue = () => db.prepare('SELECT id,"userId" FROM "EventWaitlist" WHERE "eventId"=? ORDER BY id').all('e');
    assert.deepEqual(queue().map(row => row.userId), ['a', 'b', 'c']);
    assert.ok(first < second && second < third);
    db.prepare('DELETE FROM "EventWaitlist" WHERE id=?').run(first);
    const rejoined = Number(insert.run('e', 'a', '2020-01-01').lastInsertRowid);
    assert.ok(rejoined > third);
    assert.deepEqual(queue().map(row => row.userId), ['b', 'c', 'a']);
    db.exec('DELETE FROM "EventWaitlist"');
    const afterEmpty = Number(insert.run('e', 'a', '2020-01-01').lastInsertRowid);
    assert.ok(afterEmpty > rejoined, 'emptying the queue must not reuse promotion-notification IDs');
  } finally { db.close(); }
});

test('populated SQLite deploy preserves every existing event and attendee, creates no waitlist rows, and replays safely', async () => {
  const f = sqliteFixture({ beforeTail: true });
  const db = f.open();
  let events, attendees;
  try {
    db.exec(seedSql);
    events = db.prepare('SELECT * FROM "Event" ORDER BY id').all();
    attendees = db.prepare('SELECT * FROM "EventAttendee" ORDER BY id').all();
  } finally { db.close(); }
  await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing, divergent or has changed checksums/);
  f.addTail();
  f.deploy();
  f.deploy();
  assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
  const upgraded = f.open();
  try {
    assert.deepEqual(upgraded.prepare('SELECT * FROM "Event" ORDER BY id').all(), events);
    assert.deepEqual(upgraded.prepare('SELECT * FROM "EventAttendee" ORDER BY id').all(), attendees);
    assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM "EventWaitlist"').get().n, 0);
    assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM _app_migrations WHERE name=?').get(sqliteTail).n, 1);
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { upgraded.close(); }
});

test('SQLite readiness/deploy fail closed for absent, tampered, gapped and divergent waitlist migration history', async () => {
  const f = sqliteFixture();
  const db = f.open();
  try {
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
    const rows = db.prepare('SELECT name,checksum FROM _app_migrations ORDER BY name').all();
    for (const name of [sqliteTail, '0023_space_mission_contributions.sql']) {
      const expected = rows.find(row => row.name === name).checksum;
      db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run('tampered', name);
      await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing, divergent or has changed checksums/);
      assert.throws(f.deploy, /checksum changed/);
      db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run(expected, name);
      db.prepare('DELETE FROM _app_migrations WHERE name=?').run(name);
      await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing, divergent or has changed checksums/);
      assert.throws(f.deploy, name === sqliteTail ? /gap before 0025_space_polls\.sql/ : /gap before 0024_event_waitlist\.sql/);
      db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run(name, expected);
    }
    db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run('0025_unreviewed.sql', 'unreviewed');
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing, divergent or has changed checksums/);
    assert.throws(f.deploy, /not present in the image/);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run('0025_unreviewed.sql');
    assert.deepEqual(db.prepare('SELECT name,checksum FROM _app_migrations ORDER BY name').all(), rows);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
  } finally { db.close(); }
});

test('SQLite waitlist DDL failure rolls back the entire tail and its history without changing events or attendees', () => {
  const f = sqliteFixture({ beforeTail: true });
  const db = f.open();
  let events, attendees;
  try {
    db.exec(seedSql);
    events = db.prepare('SELECT * FROM "Event" ORDER BY id').all();
    attendees = db.prepare('SELECT * FROM "EventAttendee" ORDER BY id').all();
  } finally { db.close(); }
  writeFileSync(join(f.migrations, sqliteTail), `${migrationSql(sqliteTail)}\nINSERT INTO "MissingWaitlistTestTable" VALUES (1);`);
  assert.throws(f.deploy, /no such table/);
  const after = f.open();
  try {
    assert.equal(after.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'EventWaitlist%'").get().n, 0);
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM _app_migrations WHERE name=?').get(sqliteTail).n, 0);
    assert.deepEqual(after.prepare('SELECT * FROM "Event" ORDER BY id').all(), events);
    assert.deepEqual(after.prepare('SELECT * FROM "EventAttendee" ORDER BY id').all(), attendees);
  } finally { after.close(); }
  f.addTail();
  f.deploy();
});

// Only a local disposable forge_test target is permitted, before any connection.
const pgUrl = process.env.POSTGRESQL_RELEASE_GATE_DISPOSABLE === '1'
  ? testDatabase.disposablePostgresqlTestUrl(process.env.DATABASE_URL) : null;

async function withPostgresSchema(run) {
  const db = new pg.Client({ connectionString: pgUrl });
  const schema = `forge_event_waitlist_${randomUUID().replaceAll('-', '_')}`;
  const url = new URL(pgUrl);
  url.searchParams.set('schema', schema);
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET search_path TO "${schema}"`);
    await run(db, url.toString());
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.end();
  }
}

test('PostgreSQL fresh deploy enforces FIFO IDs, membership uniqueness, defaults, indexes and cascades', { skip: !pgUrl }, async () => {
  await withPostgresSchema(async (db, url) => {
    await applyPostgresqlUpgrades(url, { initializeEmptySchema: true });
    await applyPostgresqlUpgrades(url);
    assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
    await db.query(seedSql);
    const insert = async (event, user, created = '2030-01-01') => (await db.query(
      'INSERT INTO "EventWaitlist" ("eventId","userId","createdAt") VALUES ($1,$2,$3) RETURNING id', [event, user, created])).rows[0].id;
    const first = await insert('e', 'a', '2030-01-03');
    const second = await insert('e', 'b');
    await assert.rejects(insert('e', 'a'), error => error.code === '23505');
    await assert.rejects(insert('missing', 'c'), error => error.code === '23503');
    await assert.rejects(insert('e', 'missing'), error => error.code === '23503');
    await assert.rejects(insert(null, 'c'), error => error.code === '23502');
    await assert.rejects(insert('e', null), error => error.code === '23502');
    await db.query('DELETE FROM "EventWaitlist" WHERE id=$1', [first]);
    const rejoined = await insert('e', 'a', '2020-01-01');
    assert.ok(first < second && second < rejoined);
    assert.deepEqual((await db.query('SELECT "userId" FROM "EventWaitlist" WHERE "eventId"=$1 ORDER BY id', ['e'])).rows.map(row => row.userId), ['b', 'a']);
    await db.query('DELETE FROM "EventWaitlist"');
    const afterEmpty = await insert('e', 'a');
    assert.ok(afterEmpty > rejoined);
    await db.query('INSERT INTO "EventWaitlist" ("eventId","userId") VALUES ($1,$2)', ['other', 'a']);
    assert.ok((await db.query('SELECT "createdAt" FROM "EventWaitlist" WHERE "eventId"=$1', ['other'])).rows[0].createdAt);
    const indexes = (await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='EventWaitlist'`)).rows;
    for (const [name, fields, unique] of [
      ['EventWaitlist_pkey', 'id', true],
      ['EventWaitlist_eventId_userId_key', '"eventId", "userId"', true],
      ['EventWaitlist_eventId_id_idx', '"eventId", id', false],
      ['EventWaitlist_userId_idx', '"userId"', false],
    ]) {
      const definition = indexes.find(index => index.indexname === name)?.indexdef;
      assert.ok(definition?.endsWith(`(${fields})`), `${name} columns differ`);
      assert.equal(definition.startsWith('CREATE UNIQUE INDEX'), unique);
    }
    assert.equal(indexes.length, 4);
    const sequence = (await db.query(`SELECT s.seqcycle FROM pg_sequence s WHERE s.seqrelid=pg_get_serial_sequence('"EventWaitlist"','id')::regclass`)).rows[0];
    assert.equal(sequence.seqcycle, false);
    await db.query(`UPDATE "Event" SET id='renamed' WHERE id='e'; UPDATE "User" SET id='renamed-a' WHERE id='a'`);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM "EventWaitlist" WHERE "userId"=$1', ['renamed-a'])).rows[0].n, 2);
    await db.query(`DELETE FROM "Event" WHERE id='renamed'`);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM "EventWaitlist"')).rows[0].n, 1);
    await db.query(`DELETE FROM "User" WHERE id='renamed-a'`);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM "EventWaitlist"')).rows[0].n, 0);
  });
});

test('PostgreSQL populated tracked upgrade preserves event/attendee history and rejects missing, tampered and gapped tails', { skip: !pgUrl }, async () => {
  await withPostgresSchema(async (db, url) => {
    await db.query(source('prisma/postgresql-baselines/0000_main_7814799.sql'));
    await db.query('CREATE TABLE "_app_schema_upgrades" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    for (const name of postgresNames.filter(name => name < postgresTail)) {
      const sql = migrationSql(name, postgresDirectory);
      // The reviewed main baseline already includes SkillEndorsement.
      if (name !== '0001_skill_endorsements.sql') await db.query(sql);
      await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)', [name, checksum(sql)]);
    }
    await db.query(seedSql);
    const events = (await db.query('SELECT * FROM "Event" ORDER BY id')).rows;
    const attendees = (await db.query('SELECT * FROM "EventAttendee" ORDER BY id')).rows;
    await assert.rejects(assertCoursePublicationReady(url, 'postgresql'), /history is missing, divergent or has changed checksums/);
    await applyPostgresqlUpgrades(url);
    await applyPostgresqlUpgrades(url);
    assert.deepEqual((await db.query('SELECT * FROM "Event" ORDER BY id')).rows, events);
    assert.deepEqual((await db.query('SELECT * FROM "EventAttendee" ORDER BY id')).rows, attendees);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM "EventWaitlist"')).rows[0].n, 0);
    assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
    for (const name of [postgresTail, '0022_space_mission_contributions.sql']) {
      const expected = checksum(migrationSql(name, postgresDirectory));
      await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2', ['tampered', name]);
      await assert.rejects(assertCoursePublicationReady(url, 'postgresql'), /history is missing, divergent or has changed checksums/);
      await assert.rejects(applyPostgresqlUpgrades(url), /history mismatch/);
      await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2', [expected, name]);
      await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1', [name]);
      await assert.rejects(assertCoursePublicationReady(url, 'postgresql'), /history is missing, divergent or has changed checksums/);
      await assert.rejects(applyPostgresqlUpgrades(url), name === postgresTail ? /gap before 0024_space_polls\.sql/ : /gap before 0023_event_waitlist\.sql/);
      await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)', [name, expected]);
    }
    assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
    assert.deepEqual((await db.query('SELECT * FROM "Event" ORDER BY id')).rows, events);
    assert.deepEqual((await db.query('SELECT * FROM "EventAttendee" ORDER BY id')).rows, attendees);
  });
});
