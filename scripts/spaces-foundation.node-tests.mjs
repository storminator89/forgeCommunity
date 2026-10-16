import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const root = new URL('../', import.meta.url);
const rootFile = name => readFileSync(new URL(name, root), 'utf8');
const sqliteDirectory = new URL('../prisma/sqlite-migrations/', import.meta.url);
const sql = (name) => readFileSync(new URL(name, sqliteDirectory), 'utf8');
const migration = '0020_spaces.sql';
const migrations = readdirSync(sqliteDirectory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();

function database(through = migration) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of migrations) {
    if (name > through) break;
    db.exec(sql(name));
  }
  return db;
}

function account(db, id) {
  db.prepare('INSERT INTO "User" (id, email, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(id, `${id}@example.invalid`);
}

function space(db, id, visibility) {
  db.prepare(`INSERT INTO "Space" (id, name, description, visibility, updatedAt)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(id, `Space ${id}`, 'A scoped discussion', visibility);
}

function discussion(db, id, spaceId, authorId, requestId) {
  db.prepare(`INSERT INTO "SpaceDiscussion"
    (id, spaceId, authorId, requestId, payloadDigest, title, content, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .run(id, spaceId, authorId, requestId, 'digest', 'A question', 'A scoped question',);
}

function reply(db, id, discussionId, authorId, requestId) {
  db.prepare(`INSERT INTO "SpaceReply"
    (id, discussionId, authorId, requestId, payloadDigest, content, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .run(id, discussionId, authorId, requestId, 'digest', 'An answer');
}

test('space schema is additive and agrees with both provider migrations', () => {
  const canonical = rootFile('prisma/schema.prisma');
  const sqliteSchema = rootFile('prisma/schema.sqlite.prisma');
  const pg = rootFile('prisma/postgresql-upgrades/0019_spaces.sql');
  const sqlite = sql(migration);
  for (const schema of [canonical, sqliteSchema]) {
    for (const model of ['Space', 'SpaceMember', 'SpaceDiscussion', 'SpaceReply']) {
      assert.match(schema, new RegExp(`model ${model} \\{`));
    }
    assert.match(schema, /scopeSpaceId\s+String\?/);
    assert.equal((schema.match(/hiddenAt\s+DateTime\?/g) ?? []).length >= 4, true);
    assert.match(schema, /@@unique\(\[spaceId, authorId, requestId\]\)/);
    assert.match(schema, /@@unique\(\[discussionId, authorId, requestId\]\)/);
  }
  for (const script of [pg, sqlite]) {
    for (const table of ['Space', 'SpaceMember', 'SpaceDiscussion', 'SpaceReply']) {
      assert.ok(script.includes(`CREATE TABLE "${table}"`));
    }
    assert.ok(script.includes('ALTER TABLE "ContentReport" ADD COLUMN'));
    assert.ok(script.includes('"scopeSpaceId" TEXT'));
    assert.equal((script.match(/"hiddenAt" (?:DATETIME|TIMESTAMP\(3\))/g) ?? []).length, 2);
    assert.ok(script.includes('SpaceDiscussion_spaceId_authorId_requestId_key'));
    assert.ok(script.includes('SpaceReply_discussionId_authorId_requestId_key'));
    assert.ok(!script.includes('DROP TABLE'));
    assert.ok(!script.includes('DELETE FROM'));
  }
  assert.ok(!sqlite.includes("SPACE_DISCUSSION"));
  assert.ok(!pg.includes("SPACE_DISCUSSION"));
});

test('fresh SQLite space tables enforce scoped retries, foreign keys and account cascades', () => {
  const db = database();
  try {
    account(db, 'owner'); account(db, 'member'); account(db, 'outsider');
    space(db, 'public', 'PUBLIC'); space(db, 'private', 'PRIVATE');
    db.prepare('INSERT INTO "SpaceMember" (spaceId, userId) VALUES (?, ?)').run('private', 'owner');
    assert.throws(() => db.prepare('INSERT INTO "SpaceMember" (spaceId, userId) VALUES (?, ?)').run('private', 'owner'), /UNIQUE/);
    assert.throws(() => db.prepare('INSERT INTO "SpaceMember" (spaceId, userId) VALUES (?, ?)').run('missing', 'owner'), /FOREIGN KEY/);
    discussion(db, 'first', 'private', 'owner', 'request-one');
    assert.throws(() => discussion(db, 'duplicate', 'private', 'owner', 'request-one'), /UNIQUE/);
    discussion(db, 'second', 'private', 'member', 'request-one');
    discussion(db, 'third', 'public', 'owner', 'request-one');
    assert.throws(() => discussion(db, 'bad', 'missing', 'owner', 'request-two'), /FOREIGN KEY/);
    reply(db, 'reply-one', 'first', 'member', 'request-one');
    assert.throws(() => reply(db, 'reply-two', 'first', 'member', 'request-one'), /UNIQUE/);
    reply(db, 'reply-three', 'first', 'owner', 'request-one');
    reply(db, 'reply-four', 'second', 'member', 'request-one');
    assert.throws(() => reply(db, 'bad-reply', 'missing', 'member', 'request-two'), /FOREIGN KEY/);
    db.prepare('UPDATE "SpaceDiscussion" SET hiddenAt = CURRENT_TIMESTAMP WHERE id = ?').run('first');
    db.prepare('UPDATE "SpaceReply" SET hiddenAt = CURRENT_TIMESTAMP WHERE id = ?').run('reply-one');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "SpaceDiscussion" WHERE spaceId = ? AND hiddenAt IS NULL').get('private').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "SpaceReply" WHERE discussionId = ? AND hiddenAt IS NULL').get('first').n, 1);
    db.prepare('UPDATE "SpaceDiscussion" SET hiddenAt = NULL WHERE id = ?').run('first');
    db.prepare('UPDATE "SpaceReply" SET hiddenAt = NULL WHERE id = ?').run('reply-one');
    assert.equal(db.prepare('SELECT hiddenAt FROM "SpaceDiscussion" WHERE id = ?').get('first').hiddenAt, null);
    assert.equal(db.prepare('SELECT hiddenAt FROM "SpaceReply" WHERE id = ?').get('reply-one').hiddenAt, null);
    assert.throws(() => db.prepare('DELETE FROM "Space" WHERE id = ?').run('private'), /FOREIGN KEY/);
    db.prepare('DELETE FROM "User" WHERE id = ?').run('owner');
    assert.deepEqual(db.prepare('SELECT id FROM "SpaceDiscussion" ORDER BY id').all().map(row => row.id), ['second']);
    assert.deepEqual(db.prepare('SELECT id FROM "SpaceReply" ORDER BY id').all().map(row => row.id), ['reply-four']);
    assert.deepEqual(db.prepare('SELECT * FROM "SpaceMember"').all(), []);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('populated SQLite installation retains old content and reports across additive upgrade', () => {
  const predecessor = migrations[migrations.indexOf(migration) - 1];
  assert.equal(predecessor, '0019_course_qa.sql');
  const db = database(predecessor);
  try {
    account(db, 'writer');
    db.exec(`INSERT INTO "Post" (id, title, content, published, authorId, updatedAt)
      VALUES ('old-post', 'Existing post', 'Unchanged body', 1, 'writer', CURRENT_TIMESTAMP)`);
    db.exec(`INSERT INTO "ContentReport" (id, reporterId, targetType, targetId, reason)
      VALUES ('old-report', 'writer', 'POST', 'old-post', 'SPAM')`);
    const post = db.prepare('SELECT * FROM "Post" WHERE id = ?').get('old-post');
    const report = db.prepare('SELECT * FROM "ContentReport" WHERE id = ?').get('old-report');
    db.exec(sql(migration));
    assert.deepEqual({ ...db.prepare('SELECT * FROM "Post" WHERE id = ?').get('old-post') }, { ...post });
    assert.deepEqual({ ...db.prepare('SELECT id, reporterId, targetType, targetId, reason, status FROM "ContentReport" WHERE id = ?').get('old-report') },
      { id: report.id, reporterId: report.reporterId, targetType: report.targetType, targetId: report.targetId, reason: report.reason, status: report.status });
    assert.deepEqual({ ...db.prepare('SELECT scopeSpaceId FROM "ContentReport" WHERE id = ?').get('old-report') }, { scopeSpaceId: null });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "Space"').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
