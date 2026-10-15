/** @jest-environment node */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = join(process.cwd(), 'prisma', 'sqlite-migrations');
const migration = '0009_private_learning_goals.sql';
const migrations = readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const sql = (name: string) => readFileSync(join(directory, name), 'utf8');

function fixture(run: (db: DatabaseSync, deploy: () => ReturnType<typeof spawnSync>) => void) {
  const temporary = mkdtempSync(join(tmpdir(), 'forge-private-goal-upgrade-'));
  const path = join(temporary, 'app.db');
  const db = new DatabaseSync(path);
  const deploy = () => spawnSync(process.execPath, ['scripts/sqlite-init.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, DATABASE_PROVIDER: 'sqlite', DATABASE_URL: `file:${path}` },
  });
  try { db.exec('PRAGMA foreign_keys = ON'); run(db, deploy); }
  finally { db.close(); rmSync(temporary, { recursive: true, force: true }); }
}

function history(db: DatabaseSync) {
  return db.prepare('SELECT name, checksum, applied_at FROM _app_migrations ORDER BY name').all();
}

function checkGoalSchema(db: DatabaseSync) {
  db.prepare('SELECT name FROM sqlite_master').all();
  expect(db.prepare('PRAGMA table_info("LearningGoal")').all().map(row => row.name)).toEqual([
    'userId', 'targetLeaves', 'durationDays', 'timezone', 'startedAt', 'endsAt',
    'pausedAt', 'createdAt', 'updatedAt',
  ]);
  expect(db.prepare('PRAGMA foreign_key_list("LearningGoal")').all()).toEqual([
    expect.objectContaining({ table: 'User', from: 'userId', to: 'id', on_delete: 'CASCADE' }),
  ]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

test('both provider migrations and Prisma schemas define the same private account-owned goal', () => {
  const pg = readFileSync(join(process.cwd(), 'prisma', 'postgresql-upgrades', '0008_private_learning_goals.sql'), 'utf8');
  const sqlite = sql(migration);
  for (const source of [pg, sqlite]) {
    expect(source).toContain('CREATE TABLE "LearningGoal"');
    expect(source).toContain('ON DELETE CASCADE');
    expect(source).toContain('"userId" TEXT NOT NULL PRIMARY KEY');
    expect(source).not.toContain('completedLeaves');
  }
  for (const schema of ['schema.prisma', 'schema.sqlite.prisma']) {
    const contents = readFileSync(join(process.cwd(), 'prisma', schema), 'utf8');
    expect(contents).toContain('model LearningGoal {');
    expect(contents).toContain('userId      String    @id');
    expect(contents).toContain('learningGoal       LearningGoal?');
  }
});

test('fresh install creates an empty opt-in table with account isolation, constraints, cascade and replay', () => fixture((db, deploy) => {
  expect(deploy()).toMatchObject({ status: 0 });
  checkGoalSchema(db);
  expect(db.prepare('SELECT COUNT(*) AS n FROM "LearningGoal"').get()).toMatchObject({ n: 0 });
  db.exec(`INSERT INTO "User" (id, email, updatedAt) VALUES
    ('alice', 'alice@example.invalid', CURRENT_TIMESTAMP),
    ('bob', 'bob@example.invalid', CURRENT_TIMESTAMP),
    ('carol', 'carol@example.invalid', CURRENT_TIMESTAMP),
    ('dave', 'dave@example.invalid', CURRENT_TIMESTAMP)`);
  const insert = db.prepare(`INSERT INTO "LearningGoal"
    ("userId", "targetLeaves", "durationDays", "timezone", "startedAt", "endsAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
  insert.run('alice', 3, 7, 'Europe/Berlin', '2026-10-15 12:00:00', '2026-10-22 22:00:00');
  insert.run('bob', 1, 14, 'UTC', '2026-10-15 12:00:00', '2026-10-29 00:00:00');
  expect(() => insert.run('alice', 1, 7, 'UTC', '2026-10-15', '2026-10-22')).toThrow(/UNIQUE/);
  expect(() => insert.run('missing', 1, 7, 'UTC', '2026-10-15', '2026-10-22')).toThrow(/FOREIGN KEY/);
  expect(() => insert.run('carol', 2, 7, 'UTC', '2026-10-15', '2026-10-22')).toThrow(/CHECK/);
  expect(() => insert.run('dave', 3, 1, 'UTC', '2026-10-15', '2026-10-22')).toThrow(/CHECK/);
  expect(() => insert.run('dave', 3, 7, 'UTC', '2026-10-22', '2026-10-15')).toThrow(/CHECK/);
  const firstHistory = history(db);
  expect(firstHistory.map(row => row.name)).toEqual(migrations);
  expect(deploy()).toMatchObject({ status: 0 });
  expect(history(db)).toEqual(firstHistory);
  expect(db.prepare('SELECT "userId" FROM "LearningGoal" ORDER BY "userId"').all()).toEqual([{ userId: 'alice' }, { userId: 'bob' }]);
  db.prepare('DELETE FROM "User" WHERE id = ?').run('alice');
  expect(db.prepare('SELECT "userId" FROM "LearningGoal"').all()).toEqual([{ userId: 'bob' }]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}));

test('populated upgrade leaves existing members and rewards unchanged and rejects a tampered replay', () => fixture((db, deploy) => {
  db.exec('CREATE TABLE _app_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of migrations.filter(name => name < migration)) {
    db.exec(sql(name));
    db.prepare('INSERT INTO _app_migrations (name, checksum) VALUES (?, ?)').run(name, createHash('sha256').update(sql(name)).digest('hex'));
  }
  db.exec(`
    INSERT INTO "User" (id, email, updatedAt) VALUES ('member', 'member@example.invalid', CURRENT_TIMESTAMP);
    INSERT INTO "RewardLedger" (id, userId, eventType, sourceId, courseTitle, points)
      VALUES ('reward', 'member', 'COURSE_COMPLETED', 'old-course', 'Older course', 50);
  `);
  const before = db.prepare('SELECT * FROM "RewardLedger"').all();
  expect(deploy()).toMatchObject({ status: 0 });
  checkGoalSchema(db);
  expect(db.prepare('SELECT * FROM "RewardLedger"').all()).toEqual(before);
  expect(db.prepare('SELECT COUNT(*) AS n FROM "LearningGoal"').get()).toMatchObject({ n: 0 });
  db.exec(`INSERT INTO "LearningGoal" ("userId", "targetLeaves", "durationDays", "timezone", "startedAt", "endsAt", "updatedAt")
    VALUES ('member', 3, 7, 'UTC', '2026-10-15 12:00:00', '2026-10-22 00:00:00', CURRENT_TIMESTAMP)`);
  const saved = db.prepare('SELECT * FROM "LearningGoal"').all();
  const firstHistory = history(db);
  expect(deploy()).toMatchObject({ status: 0 });
  expect(history(db)).toEqual(firstHistory);
  expect(db.prepare('SELECT * FROM "LearningGoal"').all()).toEqual(saved);
  db.prepare('UPDATE _app_migrations SET checksum = ? WHERE name = ?').run('wrong', migration);
  const rejected = deploy();
  expect(rejected.status).not.toBe(0);
  expect(String(rejected.stderr)).toContain('checksum changed');
  expect(db.prepare('SELECT * FROM "LearningGoal"').all()).toEqual(saved);
}));
