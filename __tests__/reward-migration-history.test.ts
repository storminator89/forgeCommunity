/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function sql(name: string) {
  return readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8');
}

test('both reward upgrades leave test-account classification to explicit seed or administrator actions', () => {
  const pg = readFileSync(join(process.cwd(), 'prisma', 'postgresql-upgrades', '0004_reward_ledger.sql'), 'utf8');
  for (const upgrade of [pg, sql('0005_reward_ledger.sql')]) {
    expect(upgrade).not.toMatch(/UPDATE\s+"User"\s+SET\s+"isTestAccount"/i);
  }
});

test('the reward upgrade backfills only verified first completions and keeps them across course deletion', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of ['0001_initial.sql', '0002_skill_endorsements.sql', '0003_course_progress.sql', '0004_reports.sql']) db.exec(sql(name));
    const addUser = db.prepare('INSERT INTO "User" ("id", "email", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)');
    addUser.run('owner', 'owner@example.invalid');
    addUser.run('completed', 'completed@example.invalid');
    addUser.run('incomplete', 'incomplete@example.invalid');
    // A matching demo email is not proof that this particular legacy row came
    // from the guarded seed. Only an explicit administrator/seed action flags it.
    addUser.run('lookalike', 'alice@example.com');
    db.prepare('INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .run('course', 'Original title', 'Course', 'owner');
    db.prepare('INSERT INTO "Enrollment" ("id", "userId", "courseId", "completedAt") VALUES (?, ?, ?, ?)')
      .run('enrollment-1', 'completed', 'course', '2026-10-01 13:00:00');
    db.prepare('INSERT INTO "Enrollment" ("id", "userId", "courseId") VALUES (?, ?, ?)')
      .run('enrollment-2', 'incomplete', 'course');

    db.exec(sql('0005_reward_ledger.sql'));
    expect(db.prepare('SELECT "isTestAccount" FROM "User" WHERE "id" = ?').get('lookalike'))
      .toMatchObject({ isTestAccount: 0 });
    expect(db.prepare('SELECT "userId", "courseId", "courseTitle", "completedAt" FROM "CourseCompletionRecord"').all())
      .toEqual([{ userId: 'completed', courseId: 'course', courseTitle: 'Original title', completedAt: '2026-10-01 13:00:00' }]);
    db.prepare('INSERT INTO "RewardLedger" ("id", "userId", "eventType", "sourceId", "courseTitle", "points") VALUES (?, ?, ?, ?, ?, ?)')
      .run('reward', 'completed', 'COURSE_COMPLETED', 'course', 'Original title', 50);
    db.prepare('INSERT INTO "RewardLedgerChange" ("id", "ledgerId", "version", "type", "pointsDelta") VALUES (?, ?, ?, ?, ?)')
      .run('change', 'reward', 1, 'AWARDED', 50);
    expect(() => db.prepare('INSERT INTO "RewardLedger" ("id", "userId", "eventType", "sourceId", "courseTitle", "points") VALUES (?, ?, ?, ?, ?, ?)')
      .run('duplicate', 'completed', 'COURSE_COMPLETED', 'course', 'Original title', 50)).toThrow();

    db.prepare('DELETE FROM "Course" WHERE "id" = ?').run('course');
    expect(db.prepare('SELECT COUNT(*) AS n FROM "Enrollment"').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT "courseTitle" FROM "CourseCompletionRecord" WHERE "userId" = ?').get('completed'))
      .toMatchObject({ courseTitle: 'Original title' });
    db.prepare('DELETE FROM "User" WHERE "id" = ?').run('completed');
    expect(db.prepare('SELECT COUNT(*) AS n FROM "CourseCompletionRecord"').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM "RewardLedger"').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM "RewardLedgerChange"').get()).toMatchObject({ n: 0 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});
