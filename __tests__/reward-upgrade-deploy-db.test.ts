/** @jest-environment node */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const migrations = ['0001_initial.sql', '0002_skill_endorsements.sql', '0003_course_progress.sql', '0004_reports.sql'];
const migrationCount = readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter(name => /^\d+_.*\.sql$/.test(name)).length;
const sql = (name: string) => readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8');

test('ordered clean-main SQLite upgrade preserves old completions, privacy defaults, and history on repeat deploy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'forge-reward-upgrade-'));
  const path = join(directory, 'legacy.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE _app_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const insertMigration = db.prepare('INSERT INTO _app_migrations (name, checksum) VALUES (?, ?)');
    for (const name of migrations) {
      db.exec('BEGIN IMMEDIATE');
      db.exec(sql(name));
      insertMigration.run(name, createHash('sha256').update(sql(name)).digest('hex'));
      db.exec('COMMIT');
    }
    const insertUser = db.prepare('INSERT INTO "User" ("id", "email", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)');
    for (const [id, email] of [['teacher', 'teacher@example.invalid'], ['completed', 'completed@example.invalid'], ['incomplete', 'incomplete@example.invalid'], ['other', 'other@example.invalid']]) insertUser.run(id, email);
    db.prepare('INSERT INTO "UserSettings" ("id", "userId") VALUES (?, ?)').run('settings-1', 'completed');
    db.prepare('INSERT INTO "UserSettings" ("id", "userId") VALUES (?, ?)').run('settings-2', 'other');
    db.prepare('INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .run('legacy-course', 'Original title', 'Course', 'teacher');
    db.prepare('INSERT INTO "Enrollment" ("id", "userId", "courseId", "completedAt") VALUES (?, ?, ?, ?)')
      .run('old-completed', 'completed', 'legacy-course', '2026-09-01 12:00:00');
    db.prepare('INSERT INTO "Enrollment" ("id", "userId", "courseId") VALUES (?, ?, ?)')
      .run('old-incomplete', 'incomplete', 'legacy-course');

    const deploy = () => spawnSync(process.execPath, ['scripts/sqlite-init.mjs'], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_PROVIDER: 'sqlite', DATABASE_URL: `file:${path}` },
    });
    expect(deploy()).toMatchObject({ status: 0 });
    expect(db.prepare('SELECT "userId", "courseTitle", "completedAt" FROM "CourseCompletionRecord"').all())
      .toEqual([{ userId: 'completed', courseTitle: 'Original title', completedAt: '2026-09-01 12:00:00' }]);
    expect(db.prepare('SELECT "publicRankingOptIn" FROM "UserSettings" WHERE "userId" = ?').get('completed'))
      .toMatchObject({ publicRankingOptIn: 0 });
    expect(db.prepare('SELECT "rewardEligible" FROM "Course" WHERE "id" = ?').get('legacy-course'))
      .toMatchObject({ rewardEligible: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM "RewardLedger"').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM _app_migrations').get()).toMatchObject({ n: migrationCount });
    expect(deploy()).toMatchObject({ status: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM "CourseCompletionRecord"').get()).toMatchObject({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM _app_migrations').get()).toMatchObject({ n: migrationCount });

    db.prepare('UPDATE "UserSettings" SET "publicRankingOptIn" = true WHERE "userId" = ?').run('other');
    db.prepare('INSERT INTO "RewardLedger" ("id", "userId", "eventType", "sourceId", "courseTitle", "points") VALUES (?, ?, ?, ?, ?, ?)')
      .run('reward-1', 'completed', 'COURSE_COMPLETED', 'legacy-course', 'Original title', 50);
    db.prepare('INSERT INTO "RewardLedger" ("id", "userId", "eventType", "sourceId", "courseTitle", "points") VALUES (?, ?, ?, ?, ?, ?)')
      .run('reward-2', 'other', 'COURSE_COMPLETED', 'legacy-course', 'Original title', 50);
    expect(db.prepare('SELECT u."id" FROM "User" u JOIN "UserSettings" s ON s."userId" = u."id" JOIN "RewardLedger" r ON r."userId" = u."id" WHERE u."role" = \'USER\' AND u."isTestAccount" = false AND s."publicRankingOptIn" = true AND r."revokedAt" IS NULL').all())
      .toEqual([{ id: 'other' }]);

    db.prepare('DELETE FROM "Course" WHERE "id" = ?').run('legacy-course');
    expect(db.prepare('SELECT "courseTitle" FROM "CourseCompletionRecord" WHERE "userId" = ?').get('completed'))
      .toMatchObject({ courseTitle: 'Original title' });
    db.prepare('DELETE FROM "User" WHERE "id" = ?').run('completed');
    expect(db.prepare('SELECT COUNT(*) AS n FROM "CourseCompletionRecord"').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM "RewardLedger" WHERE "userId" = ?').get('completed')).toMatchObject({ n: 0 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
