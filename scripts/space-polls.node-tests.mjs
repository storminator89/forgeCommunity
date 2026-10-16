import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeSqlite } from './sqlite-init.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';

const root = new URL('../', import.meta.url);
const source = name => readFileSync(new URL(name, root), 'utf8');
const directory = new URL('../prisma/sqlite-migrations/', import.meta.url);
const names = readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const tail = '0025_space_polls.sql';
function database() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON');
  for (const name of names) db.exec(readFileSync(new URL(name, directory), 'utf8'));
  db.exec(`INSERT INTO "User" (id,email,updatedAt) VALUES ('a','a@example.invalid',CURRENT_TIMESTAMP),('b','b@example.invalid',CURRENT_TIMESTAMP);
    INSERT INTO "Space" (id,name,description,visibility,updatedAt) VALUES ('s','Space','Description','PRIVATE',CURRENT_TIMESTAMP);
    INSERT INTO "SpacePoll" (id,spaceId,creatorId,requestId,payloadDigest,question) VALUES ('p','s','a','p','digest','Which topic?'),('q','s','a','q','digest','Which method?');
    INSERT INTO "SpacePollOption" (id,pollId,position,label) VALUES ('one','p',0,'First'),('two','p',1,'Second'),('other','q',0,'Other');`);
  return db;
}

test('paired poll tails are additive, scoped and have matching tables/checks/indexes', () => {
  assert.deepEqual(names.slice(-2), [tail, '0026_space_mission_week.sql']);
  const sqlite = source(`prisma/sqlite-migrations/${tail}`);
  const postgres = source('prisma/postgresql-upgrades/0024_space_polls.sql');
  assert.equal(sqlite.replaceAll('DATETIME', 'TIMESTAMP(3)'), postgres);
  const stripped = sqlite.replace(/^--.*$/gm, '');
  assert.ok(!/\b(?:DROP|ALTER|UPDATE|DELETE|INSERT)\b(?!\s+(?:RESTRICT|CASCADE|SET))/i.test(stripped.replaceAll('ON DELETE', '').replaceAll('ON UPDATE', '')));
  for (const table of ['SpacePoll', 'SpacePollOption', 'SpacePollVote', 'SpacePollVoteRequest']) assert.match(sqlite, new RegExp(`CREATE TABLE "${table}"`));
  assert.match(sqlite, /FOREIGN KEY \("pollId", "optionId"\) REFERENCES "SpacePollOption"\("pollId", "id"\)/);
  assert.match(sqlite, /PRIMARY KEY \("pollId", "userId", "requestId"\)/);
  assert.match(sqlite, /CHECK \("position" BETWEEN 0 AND 7\)/);
});

test('real SQLite FKs/uniqueness/checks forbid cross-poll, duplicate member votes, invalid sizes and duplicate receipts', () => {
  const db = database();
  try {
    const vote = db.prepare('INSERT INTO "SpacePollVote" (pollId,userId,optionId,revision,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP)');
    vote.run('p','b','one',1);
    assert.throws(() => vote.run('p','b','two',2), /UNIQUE/);
    assert.throws(() => vote.run('p','a','other',1), /FOREIGN KEY/);
    assert.throws(() => vote.run('p','a','one',0), /CHECK/);
    assert.throws(() => vote.run('p','missing','one',1), /FOREIGN KEY/);
    const option = db.prepare('INSERT INTO "SpacePollOption" (id,pollId,position,label) VALUES (?,?,?,?)');
    assert.throws(() => option.run('dup','p',1,'Duplicate position'), /UNIQUE/);
    assert.throws(() => option.run('large','p',8,'Ninth'), /CHECK/);
    assert.throws(() => option.run('empty','p',2,''), /CHECK/);
    assert.throws(() => option.run('long','p',2,'x'.repeat(101)), /CHECK/);
    assert.throws(() => db.prepare('UPDATE "SpacePoll" SET question=? WHERE id=?').run('😀😀😀','p'), /CHECK/);
    const receipt = db.prepare('INSERT INTO "SpacePollVoteRequest" (pollId,userId,requestId,payloadDigest) VALUES (?,?,?,?)');
    receipt.run('p','b','req','digest'); assert.throws(() => receipt.run('p','b','req','other'), /UNIQUE/);
    assert.throws(() => db.prepare('DELETE FROM "Space" WHERE id=?').run('s'), /FOREIGN KEY/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('deleting an account erases private choice/receipts, creator deletion preserves poll, poll deletion cascades', () => {
  const db = database();
  try {
    db.exec(`INSERT INTO "SpacePollVote" (pollId,userId,optionId,revision,updatedAt) VALUES ('p','b','one',1,CURRENT_TIMESTAMP);
      INSERT INTO "SpacePollVoteRequest" (pollId,userId,requestId,payloadDigest) VALUES ('p','b','req','digest');
      DELETE FROM "User" WHERE id='b';`);
    for (const table of ['SpacePollVote', 'SpacePollVoteRequest']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n, 0);
    db.exec(`DELETE FROM "User" WHERE id='a'`); assert.equal(db.prepare('SELECT creatorId FROM "SpacePoll" WHERE id=?').get('p').creatorId, null);
    db.exec(`DELETE FROM "SpacePoll" WHERE id='p'`); assert.equal(db.prepare('SELECT COUNT(*) n FROM "SpacePollOption" WHERE pollId=?').get('p').n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('populated predecessor upgrade preserves Spaces/discussions, is replayable and readiness requires poll tail', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'forge-polls-upgrade-')); const migrations = join(temp, 'migrations'); mkdirSync(migrations);
  const url = `file:${join(temp, 'test.db')}`; process.env.DATABASE_PROVIDER = 'sqlite';
  for (const name of names.filter(name => name < tail)) copyFileSync(new URL(name, directory), join(migrations, name));
  initializeSqlite(url, migrations);
  const db = new DatabaseSync(url.slice(5));
  try {
    db.exec(`INSERT INTO "User" (id,email,updatedAt) VALUES ('u','u@example.invalid',CURRENT_TIMESTAMP);
      INSERT INTO "Space" (id,name,description,visibility,updatedAt) VALUES ('s','Keep Space','Original','PRIVATE',CURRENT_TIMESTAMP);
      INSERT INTO "SpaceDiscussion" (id,spaceId,authorId,requestId,payloadDigest,title,content,updatedAt) VALUES ('d','s','u','r','digest','Keep title','Keep content',CURRENT_TIMESTAMP);`);
    const spaces = db.prepare('SELECT * FROM "Space"').all(); const discussions = db.prepare('SELECT * FROM "SpaceDiscussion"').all();
    await assert.rejects(assertCoursePublicationReady(url, 'sqlite'), /history is missing/);
    for (const name of names.filter(name => name >= tail)) copyFileSync(new URL(name, directory), join(migrations, name));
    initializeSqlite(url, migrations); initializeSqlite(url, migrations);
    assert.equal(await assertCoursePublicationReady(url, 'sqlite'), true);
    assert.deepEqual(db.prepare('SELECT * FROM "Space"').all(), spaces); assert.deepEqual(db.prepare('SELECT * FROM "SpaceDiscussion"').all(), discussions);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM "SpacePoll"').get().n, 0);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run(tail);
    await assert.rejects(assertCoursePublicationReady(url, 'sqlite'), /history is missing/);
    assert.throws(() => initializeSqlite(url, migrations), /gap before 0026_space_mission_week\.sql/);
  } finally { db.close(); }
});

test('poll DDL failure rolls back every poll table and migration history', () => {
  const temp = mkdtempSync(join(tmpdir(), 'forge-polls-rollback-')); const migrations = join(temp, 'migrations'); mkdirSync(migrations);
  const url = `file:${join(temp, 'test.db')}`; process.env.DATABASE_PROVIDER = 'sqlite';
  for (const name of names.filter(name => name < tail)) copyFileSync(new URL(name, directory), join(migrations, name));
  initializeSqlite(url, migrations);
  writeFileSync(join(migrations, tail), source(`prisma/sqlite-migrations/${tail}`) + '\nINSERT INTO "MissingPollTestTable" VALUES (1);');
  assert.throws(() => initializeSqlite(url, migrations), /no such table/);
  const db = new DatabaseSync(url.slice(5));
  try {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'SpacePoll%'`).get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM _app_migrations WHERE name=?').get(tail).n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
