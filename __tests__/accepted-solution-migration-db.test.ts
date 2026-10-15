/** @jest-environment node */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const migrationDirectory = join(process.cwd(), 'prisma', 'sqlite-migrations');
const migrations = readdirSync(migrationDirectory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const newMigration = '0007_accepted_solutions.sql';
const sql = (name: string) => readFileSync(join(migrationDirectory, name), 'utf8');
const records = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all();
const history = (db: DatabaseSync) => db.prepare('SELECT name, checksum, applied_at FROM _app_migrations ORDER BY name').all();

function fixture(run: (db: DatabaseSync, deploy: () => ReturnType<typeof spawnSync>) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'forge-accepted-solution-upgrade-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  const deploy = () => spawnSync(process.execPath, ['scripts/sqlite-init.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, DATABASE_PROVIDER: 'sqlite', DATABASE_URL: `file:${path}` },
  });
  try { db.exec('PRAGMA foreign_keys = ON'); run(db, deploy); }
  finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}

function checkSchema(db: DatabaseSync) {
  // Refresh this connection's schema cache after deployment on another connection.
  db.prepare('SELECT name FROM sqlite_master').all();
  expect(db.prepare('PRAGMA table_info("AcceptedSolution")').all().map(row => row.name))
    .toEqual(['postId', 'commentId', 'revision', 'createdAt']);
  expect(db.prepare('PRAGMA table_info("AcceptedSolutionChange")').all().map(row => row.name))
    .toEqual(['id', 'action', 'createdAt', 'actorId', 'postId', 'previousCommentId', 'commentId']);
  expect(db.prepare('SELECT sql FROM sqlite_master WHERE type = \'table\' AND name = \'AcceptedSolutionChange\'').get()?.sql)
    .toContain('CONSTRAINT "AcceptedSolutionChange_action_check" CHECK');
  for (const table of ['AcceptedSolution', 'AcceptedSolutionChange']) {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
    expect(columns.filter(row => row.pk).map(row => row.name)).toEqual([table === 'AcceptedSolution' ? 'postId' : 'id']);
    for (const column of columns) {
      const nullable = table === 'AcceptedSolutionChange' && ['actorId', 'postId', 'previousCommentId', 'commentId'].includes(String(column.name));
      expect(column.notnull).toBe(nullable ? 0 : 1);
    }
  }
  for (const [table, expected] of [
    ['AcceptedSolution', [
      ['Post', 'postId', 'id', 'CASCADE', 'CASCADE'],
      ['Comment', 'postId', 'postId', 'CASCADE', 'CASCADE'],
      ['Comment', 'commentId', 'id', 'CASCADE', 'CASCADE'],
    ]],
    ['AcceptedSolutionChange', [
      ['User', 'actorId', 'id', 'SET NULL', 'CASCADE'],
      ['Post', 'postId', 'id', 'SET NULL', 'CASCADE'],
      ['Comment', 'previousCommentId', 'id', 'SET NULL', 'CASCADE'],
      ['Comment', 'commentId', 'id', 'SET NULL', 'CASCADE'],
    ]],
  ] as const) {
    const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
    const normalized = fks.map(row => [row.table, row.from, row.to, row.on_delete, row.on_update]);
    expect(normalized.sort()).toEqual([...expected].sort());
    if (table === 'AcceptedSolution') {
      const composite = fks.filter(row => row.table === 'Comment');
      expect(composite.map(row => row.id)).toEqual([composite[0].id, composite[0].id]);
    }
  }
  for (const [table, name, columns, unique] of [
    ['Comment', 'Comment_postId_id_key', ['postId', 'id'], 1],
    ['AcceptedSolution', 'AcceptedSolution_commentId_key', ['commentId'], 1],
    ['AcceptedSolution', 'AcceptedSolution_revision_key', ['revision'], 1],
    ['AcceptedSolutionChange', 'AcceptedSolutionChange_postId_createdAt_idx', ['postId', 'createdAt'], 0],
  ] as const) {
    expect(db.prepare(`PRAGMA index_list("${table}")`).all().find(row => row.name === name)).toMatchObject({ unique, partial: 0 });
    expect(db.prepare(`PRAGMA index_info("${name}")`).all().map(row => row.name)).toEqual([...columns]);
  }
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

function seedCommunity(db: DatabaseSync) {
  db.exec(`
    INSERT INTO "User" (id, email, updatedAt) VALUES
      ('owner', 'owner@example.invalid', CURRENT_TIMESTAMP),
      ('helper', 'helper@example.invalid', CURRENT_TIMESTAMP),
      ('actor', 'actor@example.invalid', CURRENT_TIMESTAMP);
    INSERT INTO "Post" (id, title, content, published, authorId, updatedAt) VALUES
      ('discussion', 'Preserved title', 'Preserved post', true, 'owner', CURRENT_TIMESTAMP),
      ('other-discussion', 'Other title', 'Other post', true, 'owner', CURRENT_TIMESTAMP),
      ('draft', 'Private title', 'Private content', false, 'owner', CURRENT_TIMESTAMP);
    INSERT INTO "Comment" (id, content, postId, authorId, updatedAt) VALUES
      ('reply', 'Preserved reply', 'discussion', 'helper', CURRENT_TIMESTAMP),
      ('replacement', 'Another reply', 'discussion', 'helper', CURRENT_TIMESTAMP),
      ('other-reply', 'Other reply', 'other-discussion', 'helper', CURRENT_TIMESTAMP);
    INSERT INTO "LikePost" (id, userId, postId) VALUES ('post-like', 'helper', 'discussion');
    INSERT INTO "LikeComment" (id, userId, commentId) VALUES ('comment-like', 'owner', 'reply');
  `);
}

test('PostgreSQL and SQLite accepted-solution migrations share additive definitions without points or content snapshots', () => {
  const pg = readFileSync(join(process.cwd(), 'prisma', 'postgresql-upgrades', '0006_accepted_solutions.sql'), 'utf8');
  expect(pg.replaceAll('TIMESTAMP(3)', 'DATETIME')).toBe(sql(newMigration));
  expect(/\b(?:ALTER|DROP|UPDATE|DELETE|INSERT)\b(?!\s+(?:CASCADE|SET NULL))/i.test(pg.replace(/^--.*$/gm, ''))).toBe(false);
  for (const schemaName of ['schema.prisma', 'schema.sqlite.prisma']) {
    const schema = readFileSync(join(process.cwd(), 'prisma', schemaName), 'utf8');
    const current = schema.match(/model AcceptedSolution \{([\s\S]*?)\n\}/)?.[1];
    expect(current).toContain('postId    String @id');
    expect(current).toContain('commentId String @unique');
    expect(current).toContain('revision  String @unique');
    expect(current).toContain('references: [postId, id], onDelete: Cascade');
    expect(schema).toContain('@@unique([postId, id])');
  }
});

test('fresh SQLite install enforces solution uniqueness, same-discussion FKs and anonymized retained audits', () => fixture((db, deploy) => {
  expect(deploy()).toMatchObject({ status: 0 });
  checkSchema(db);
  expect(records(db, 'AcceptedSolution')).toEqual([]);
  expect(records(db, 'AcceptedSolutionChange')).toEqual([]);
  seedCommunity(db);
  const select = db.prepare('INSERT INTO "AcceptedSolution" (postId, commentId, revision) VALUES (?, ?, ?)');
  select.run('discussion', 'reply', 'revision-selected');
  expect(() => select.run('discussion', 'replacement', 'revision-duplicate-post')).toThrow(/UNIQUE/);
  expect(() => select.run('other-discussion', 'reply', 'revision-duplicate-comment')).toThrow(/UNIQUE/);
  expect(() => select.run('other-discussion', 'other-reply', 'revision-selected')).toThrow(/UNIQUE/);
  expect(() => select.run('other-discussion', 'replacement', 'revision-cross-discussion')).toThrow(/FOREIGN KEY/);
  expect(() => select.run('missing', 'replacement', 'revision-missing-post')).toThrow(/FOREIGN KEY/);
  expect(() => select.run('other-discussion', 'missing', 'revision-missing-comment')).toThrow(/FOREIGN KEY/);
  expect(() => db.exec('INSERT INTO "AcceptedSolution" (postId, commentId) VALUES (\'other-discussion\', \'other-reply\')')).toThrow(/NOT NULL/);

  const change = db.prepare('INSERT INTO "AcceptedSolutionChange" (id, action, actorId, postId, previousCommentId, commentId) VALUES (?, ?, ?, ?, ?, ?)');
  change.run('revision-selected', 'SELECTED', 'actor', 'discussion', null, 'reply');
  change.run('revision-changed', 'CHANGED', 'actor', 'discussion', 'reply', 'replacement');
  change.run('revision-cleared', 'CLEARED', 'actor', 'discussion', 'replacement', null);
  expect(() => change.run('revision-selected', 'SELECTED', 'actor', 'discussion', null, 'reply')).toThrow(/UNIQUE/);
  for (const action of ['DELETED', 'selected', '']) {
    expect(() => change.run(`invalid-action-${action}`, action, 'actor', 'discussion', null, 'reply')).toThrow(/CHECK/);
  }
  expect(() => db.prepare('UPDATE "AcceptedSolutionChange" SET action = ? WHERE id = ?').run('DELETED', 'revision-selected')).toThrow(/CHECK/);
  for (const values of [
    ['missing-actor', 'SELECTED', 'missing', 'discussion', null, 'reply'],
    ['missing-post', 'SELECTED', 'actor', 'missing', null, 'reply'],
    ['missing-previous', 'CHANGED', 'actor', 'discussion', 'missing', 'replacement'],
    ['missing-comment', 'SELECTED', 'actor', 'discussion', null, 'missing'],
  ]) expect(() => change.run(...values)).toThrow(/FOREIGN KEY/);

  const firstHistory = history(db);
  const current = records(db, 'AcceptedSolution');
  const audit = records(db, 'AcceptedSolutionChange');
  expect(firstHistory.map(row => row.name)).toEqual(migrations);
  expect(deploy()).toMatchObject({ status: 0 });
  expect(history(db)).toEqual(firstHistory);
  expect(records(db, 'AcceptedSolution')).toEqual(current);
  expect(records(db, 'AcceptedSolutionChange')).toEqual(audit);
  expect(records(db, 'RewardLedger')).toEqual([]);
  expect(records(db, 'RewardLedgerChange')).toEqual([]);

  db.exec('DELETE FROM "User" WHERE id = \'actor\'');
  expect(records(db, 'AcceptedSolution')).toEqual(current);
  expect(records(db, 'AcceptedSolutionChange').map(row => row.actorId)).toEqual([null, null, null]);
  db.exec('DELETE FROM "Comment" WHERE id = \'reply\'');
  expect(records(db, 'AcceptedSolution')).toEqual([]);
  expect(db.prepare('SELECT commentId FROM "AcceptedSolutionChange" WHERE id = ?').get('revision-selected')).toMatchObject({ commentId: null });
  expect(db.prepare('SELECT previousCommentId, commentId FROM "AcceptedSolutionChange" WHERE id = ?').get('revision-changed'))
    .toMatchObject({ previousCommentId: null, commentId: 'replacement' });
  select.run('discussion', 'replacement', 'revision-reselected');
  // Deletion removes the live signal; it does not invent another user decision.
  db.exec('DELETE FROM "Post" WHERE id = \'discussion\'');
  expect(records(db, 'AcceptedSolution')).toEqual([]);
  expect(records(db, 'AcceptedSolutionChange').map(row => [row.id, row.action, row.actorId, row.postId, row.previousCommentId, row.commentId]))
    .toEqual(audit.map(row => [row.id, row.action, null, null, null, null]));
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}));

test('populated SQLite upgrade preserves community/reward data, does not backfill solutions, and rejects tampered replay', () => fixture((db, deploy) => {
  db.exec('CREATE TABLE _app_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of migrations.filter(name => name < newMigration)) {
    db.exec(sql(name));
    db.prepare('INSERT INTO _app_migrations (name, checksum) VALUES (?, ?)').run(name, createHash('sha256').update(sql(name)).digest('hex'));
  }
  seedCommunity(db);
  db.exec(`
    INSERT INTO "RewardLedger" (id, userId, eventType, sourceId, courseTitle, points)
      VALUES ('existing-reward', 'helper', 'COURSE_COMPLETED', 'removed-course', 'Preserved learning', 50);
    INSERT INTO "RewardLedgerChange" (id, ledgerId, version, type, pointsDelta)
      VALUES ('existing-reward-change', 'existing-reward', 1, 'AWARDED', 50);
  `);
  const tables = ['User', 'Post', 'Comment', 'LikePost', 'LikeComment', 'RewardLedger', 'RewardLedgerChange'];
  const before = Object.fromEntries(tables.map(table => [table, records(db, table)]));
  const earlierHistory = history(db);
  expect(deploy()).toMatchObject({ status: 0 });
  checkSchema(db);
  for (const table of tables) expect(records(db, table)).toEqual(before[table]);
  expect(records(db, 'AcceptedSolution')).toEqual([]);
  expect(records(db, 'AcceptedSolutionChange')).toEqual([]);
  const firstHistory = history(db);
  expect(firstHistory.slice(0, earlierHistory.length)).toEqual(earlierHistory);
  expect(firstHistory.map(row => row.name)).toEqual(migrations);
  db.exec(`
    INSERT INTO "AcceptedSolution" (postId, commentId, revision) VALUES ('discussion', 'reply', 'preserved-revision');
    INSERT INTO "AcceptedSolutionChange" (id, action, actorId, postId, commentId)
      VALUES ('preserved-revision', 'SELECTED', 'owner', 'discussion', 'reply');
  `);
  const selected = records(db, 'AcceptedSolution');
  const audit = records(db, 'AcceptedSolutionChange');
  expect(deploy()).toMatchObject({ status: 0 });
  expect(history(db)).toEqual(firstHistory);
  expect(records(db, 'AcceptedSolution')).toEqual(selected);
  expect(records(db, 'AcceptedSolutionChange')).toEqual(audit);
  for (const table of tables) expect(records(db, table)).toEqual(before[table]);
  db.prepare('UPDATE _app_migrations SET checksum = ? WHERE name = ?').run('tampered', newMigration);
  const rejected = deploy();
  expect(rejected.status).not.toBe(0);
  expect(String(rejected.stderr)).toContain('checksum changed');
  expect(records(db, 'AcceptedSolution')).toEqual(selected);
  expect(records(db, 'AcceptedSolutionChange')).toEqual(audit);
  for (const table of tables) expect(records(db, table)).toEqual(before[table]);

  db.exec('DELETE FROM "User" WHERE id = \'helper\'');
  expect(records(db, 'AcceptedSolution')).toEqual([]);
  expect(db.prepare('SELECT actorId, postId, commentId FROM "AcceptedSolutionChange"').all())
    .toEqual([{ actorId: 'owner', postId: 'discussion', commentId: null }]);
  db.exec('DELETE FROM "User" WHERE id = \'owner\'');
  expect(db.prepare('SELECT id, action, actorId, postId, commentId FROM "AcceptedSolutionChange"').all())
    .toEqual([{ id: 'preserved-revision', action: 'SELECTED', actorId: null, postId: null, commentId: null }]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}));
