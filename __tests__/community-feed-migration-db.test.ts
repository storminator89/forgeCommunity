/** @jest-environment node */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const migrationDirectory = join(process.cwd(), 'prisma', 'sqlite-migrations');
const migrations = readdirSync(migrationDirectory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const newMigration = '0006_community_feed_indexes.sql';
const sql = (name: string) => readFileSync(join(migrationDirectory, name), 'utf8');
const indexes = {
  Post_createdAt_id_idx: ['createdAt', 'id'],
  Post_published_createdAt_id_idx: ['published', 'createdAt', 'id'],
  Post_authorId_createdAt_id_idx: ['authorId', 'createdAt', 'id'],
  Comment_postId_createdAt_id_idx: ['postId', 'createdAt', 'id'],
  Comment_authorId_postId_idx: ['authorId', 'postId'],
  LikePost_postId_idx: ['postId'],
  LikeComment_commentId_idx: ['commentId'],
};

function checkIndexes(db: DatabaseSync) {
  // Refresh this connection's schema cache after deployment on a second connection.
  db.prepare('SELECT name FROM sqlite_master').all();
  for (const [name, columns] of Object.entries(indexes)) {
    expect(db.prepare(`PRAGMA index_info("${name}")`).all().map(row => row.name)).toEqual(columns);
  }
}

function fixture(run: (db: DatabaseSync, deploy: () => ReturnType<typeof spawnSync>) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'forge-community-upgrade-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  const deploy = () => spawnSync(process.execPath, ['scripts/db-deploy.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_PROVIDER: 'sqlite', DATABASE_URL: `file:${path}` },
  });
  try { db.exec('PRAGMA foreign_keys = ON'); run(db, deploy); }
  finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('new PostgreSQL/SQLite migrations are matching additive indexes with matching canonical schema definitions', () => {
  const pg = readFileSync(join(process.cwd(), 'prisma', 'postgresql-upgrades', '0005_community_feed_indexes.sql'), 'utf8');
  expect(pg).toBe(sql(newMigration));
  const statements = pg.split('\n').filter(line => line.trim() && !line.startsWith('--'));
  expect(statements).toHaveLength(7);
  expect(statements.every(line => /^CREATE INDEX "\w+" ON "\w+"\("\w+"(?:, "\w+")*\);$/.test(line))).toBe(true);
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  for (const [name, columns] of Object.entries(indexes)) {
    const table = name.split('_')[0];
    const block = schema.match(new RegExp(`model ${table} \\{([\\s\\S]*?)\\n\\}`))?.[1];
    expect(block).toContain(`@@index([${columns.join(', ')}])`);
  }
});

test('fresh SQLite installation creates all indexes and replay preserves history', () => fixture((db, deploy) => {
  expect(deploy()).toMatchObject({ status: 0 });
  checkIndexes(db);
  const history = db.prepare('SELECT name, checksum, applied_at FROM _app_migrations ORDER BY name').all();
  expect(history.map(row => row.name)).toEqual(migrations);
  expect(deploy()).toMatchObject({ status: 0 });
  expect(db.prepare('SELECT name, checksum, applied_at FROM _app_migrations ORDER BY name').all()).toEqual(history);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}));

test('populated main upgrades keep posts/comments/likes, replay safely, validate checksums and retain cascading FKs', () => fixture((db, deploy) => {
  db.exec('CREATE TABLE _app_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of migrations.filter(name => name < newMigration)) {
    db.exec(sql(name));
    db.prepare('INSERT INTO _app_migrations (name, checksum) VALUES (?, ?)').run(name, createHash('sha256').update(sql(name)).digest('hex'));
  }
  db.exec(`
    INSERT INTO "User" (id, email, updatedAt) VALUES ('owner', 'owner@example.invalid', CURRENT_TIMESTAMP), ('viewer', 'viewer@example.invalid', CURRENT_TIMESTAMP);
    INSERT INTO "Post" (id, title, content, published, authorId, updatedAt) VALUES ('public', 'Public title', 'Public content', true, 'owner', CURRENT_TIMESTAMP), ('draft', 'Private title', 'Private content', false, 'owner', CURRENT_TIMESTAMP);
    INSERT INTO "Comment" (id, content, postId, authorId, updatedAt) VALUES ('reply', 'Preserved reply', 'public', 'viewer', CURRENT_TIMESTAMP);
    INSERT INTO "LikePost" (id, userId, postId) VALUES ('post-like', 'viewer', 'public');
    INSERT INTO "LikeComment" (id, userId, commentId) VALUES ('comment-like', 'owner', 'reply');
  `);
  const tables = ['Post', 'Comment', 'LikePost', 'LikeComment'];
  const records = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()]));
  expect(deploy()).toMatchObject({ status: 0 });
  checkIndexes(db);
  for (const table of tables) expect(db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()).toEqual(records[table]);
  const history = db.prepare('SELECT name, checksum, applied_at FROM _app_migrations ORDER BY name').all();
  expect(history.map(row => row.name)).toEqual(migrations);
  expect(deploy()).toMatchObject({ status: 0 });
  expect(db.prepare('SELECT name, checksum, applied_at FROM _app_migrations ORDER BY name').all()).toEqual(history);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

  // Verify the equality-scoped, descending keyset can use the reviewed index.
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM "Comment" WHERE postId = ? AND (createdAt < ? OR (createdAt = ? AND id < ?)) ORDER BY createdAt DESC, id DESC LIMIT 51').all('public', '2026-01-01', '2026-01-01', 'z');
  expect(plan.some(row => String(row.detail).includes('Comment_postId_createdAt_id_idx'))).toBe(true);
  db.prepare('UPDATE _app_migrations SET checksum = ? WHERE name = ?').run('tampered', newMigration);
  const rejected = deploy();
  expect(rejected.status).not.toBe(0);
  expect(String(rejected.stderr)).toContain('checksum changed');
  for (const table of tables) expect(db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()).toEqual(records[table]);

  db.exec('DELETE FROM "Post" WHERE id = \'public\'');
  for (const table of ['Comment', 'LikePost', 'LikeComment']) expect(db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()).toMatchObject({ n: 0 });
  expect(db.prepare('SELECT id FROM "Post"').all()).toEqual([{ id: 'draft' }]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}));
