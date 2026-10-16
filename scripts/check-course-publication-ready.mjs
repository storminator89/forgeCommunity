import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { initializeSqlite, sqlitePath } from './sqlite-init.mjs';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import testDatabase from './space-mission-test-database.cjs';

const sqliteNames = readdirSync(new URL('../prisma/sqlite-migrations/', import.meta.url))
  .filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
assert.equal(sqliteNames.at(-1), '0026_space_mission_week.sql');
const publicationIndex = sqliteNames.indexOf('0010_staged_course_publication.sql');
assert.ok(publicationIndex >= 0);

function fixture({ legacy = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-publication-fresh-'));
  const migrations = join(dir, 'migrations');
  mkdirSync(migrations);
  for (const name of sqliteNames.slice(0, publicationIndex)) {
    copyFileSync(new URL(`../prisma/sqlite-migrations/${name}`, import.meta.url), join(migrations, name));
  }
  process.env.DATABASE_PROVIDER = 'sqlite';
  const url = `file:${join(dir, 'db.sqlite')}`;
  initializeSqlite(url, migrations);
  if (legacy) {
    const db = new DatabaseSync(sqlitePath(url));
    db.exec('PRAGMA foreign_keys = ON');
    db.prepare('INSERT INTO "User" ("id", "email", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run('author', 'author@example.invalid');
    db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt")
      VALUES ('legacy', 'Original', 'Keep me', 'author', CURRENT_TIMESTAMP)`).run();
    db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "updatedAt")
      VALUES ('leaf', 'Raw', '  bytes  ', 1, 'legacy', CURRENT_TIMESTAMP)`).run();
    db.close();
  }
  return {
    url, migrations,
    upgrade: () => {
      for (const name of sqliteNames.slice(publicationIndex)) copyFileSync(new URL(`../prisma/sqlite-migrations/${name}`, import.meta.url), join(migrations, name));
      initializeSqlite(url, migrations);
    },
    db: () => {
      const db = new DatabaseSync(sqlitePath(url));
      db.exec('PRAGMA foreign_keys = ON');
      return db;
    },
  };
}

test('fresh SQLite install accepts private drafts and published same-course references', async () => {
  const f = fixture();
  f.upgrade();
  assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
  const db = f.db();
  db.prepare(`INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('author', 'author@example.invalid', CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt")
    VALUES ('new-course', 'Private title', '', 'author', CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO "CourseDraft" ("courseId", "payload", "digest", "updatedAt")
    VALUES ('new-course', '{}', 'digest', CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
    VALUES ('publication', 'new-course', 1, 'AUTHOR', '{}', 'digest', 0)`).run();
  db.prepare(`UPDATE "Course" SET "activePublicationId"='publication' WHERE "id"='new-course'`).run();
  assert.throws(() => db.prepare(`INSERT INTO "CoursePublication"
    ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
    VALUES ('baseline','new-course',2,'BASELINE','{}','digest',0)`).run(), /CHECK constraint/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
  assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
  initializeSqlite(f.url, f.migrations);
  assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
});

test('SQLite refuses cross-course references at the database boundary', () => {
  const f = fixture(); f.upgrade();
  const db = f.db();
  db.prepare(`INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('author','author@example.invalid',CURRENT_TIMESTAMP)`).run();
  for (const id of ['a', 'b']) {
    db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt")
      VALUES (?, ?, '', 'author', CURRENT_TIMESTAMP)`).run(id, id);
    db.prepare(`INSERT INTO "CourseDraft" ("courseId", "payload", "digest", "updatedAt")
      VALUES (?, '{}', 'digest', CURRENT_TIMESTAMP)`).run(id);
    db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
      VALUES (?, ?, 1, 'AUTHOR', '{}', 'digest', 0)`).run(`p-${id}`, id);
  }
  for (const sql of [
    `UPDATE "Course" SET "activePublicationId"='p-b' WHERE id='a'`,
    `UPDATE "CourseDraft" SET "basePublicationId"='p-b' WHERE "courseId"='a'`,
    `INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount", "previousPublicationId")
      VALUES ('p-a-2','a',2,'RESTORE','{}','digest',0,'p-b')`,
    `INSERT INTO "PublicationRequest" ("courseId", "requestId", "actorId", "requestDigest", "publicationId")
      VALUES ('a','req','author','digest','p-b')`,
    `INSERT INTO "Certificate" ("id", "userId", "courseId", "courseName", "userName", "publicationId")
      VALUES ('cert','author','a','Course','Author','p-b')`,
  ]) assert.throws(() => db.exec(sql), /Cross-course/);
  db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "updatedAt")
    VALUES ('quiz','Quiz','?',1,'a',CURRENT_TIMESTAMP)`).run();
  assert.throws(() => db.exec(`INSERT INTO "QuizAttempt"
    ("id","userId","courseId","contentId","submissionId","answerDigest","revision","score","passed","publicationId")
    VALUES ('attempt','author','a','quiz','s','digest','rev',1,1,'p-b')`), /Cross-course/);
  db.prepare(`DELETE FROM "Course" WHERE id='a'`).run();
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "CoursePublication" WHERE "courseId"='a'`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "CourseDraft" WHERE "courseId"='a'`).get().n, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('populated SQLite main upgrade preserves old rows but refuses phase-2 startup', async () => {
  const f = fixture({ legacy: true });
  const before = f.db();
  const course = before.prepare(`SELECT * FROM "Course" WHERE id='legacy'`).get();
  const content = before.prepare(`SELECT * FROM "CourseContent" WHERE id='leaf'`).get();
  before.close();
  f.upgrade();
  await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /Legacy course legacy has no saved draft.*fresh empty database/);
  const after = f.db();
  assert.deepEqual({ ...after.prepare(`SELECT * FROM "Course" WHERE id='legacy'`).get() }, { ...course, activePublicationId: null });
  assert.deepEqual({ ...after.prepare(`SELECT * FROM "CourseContent" WHERE id='leaf'`).get() }, { ...content, archivedAt: null });
  assert.equal(after.prepare('SELECT COUNT(*) AS n FROM "CoursePublication"').get().n, 0);
  assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(after.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  after.close();
});

test('SQLite migration still rolls back an injected DDL failure', () => {
  const f = fixture({ legacy: true });
  const sql = readFileSync(new URL('../prisma/sqlite-migrations/0010_staged_course_publication.sql', import.meta.url), 'utf8');
  writeFileSync(join(f.migrations, '0010_staged_course_publication.sql'), `${sql}\nINSERT INTO "Missing" VALUES (1);`);
  assert.throws(() => initializeSqlite(f.url, f.migrations), /no such table/);
  const db = f.db();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM _app_migrations WHERE name LIKE '0010_%'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('Course') WHERE name='activePublicationId'").get().n, 0);
  assert.equal(db.prepare(`SELECT title FROM "Course" WHERE id='legacy'`).get().title, 'Original');
  db.close();
});

test('SQLite readiness refuses missing, changed, gapped and divergent migration history through mission weeks', async () => {
  for (const mutate of [
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0026_space_mission_week.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0026_space_mission_week.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0025_space_polls.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0025_space_polls.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0024_event_waitlist.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0024_event_waitlist.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0023_space_mission_contributions.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0023_space_mission_contributions.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0022_space_mission_foundation.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0022_space_mission_foundation.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0021_space_report_targets.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0021_space_report_targets.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0020_spaces.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0020_spaces.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0019_course_qa.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0019_course_qa.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0018_chat_read_cursor.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0018_chat_read_cursor.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0017_chat_message_cursor_index.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0017_chat_message_cursor_index.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0016_formative_practice_learner.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0016_formative_practice_learner.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0015_formative_practice_authoring.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0015_formative_practice_authoring.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0014_quiz_confidence_evidence.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0014_quiz_confidence_evidence.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0013_verified_learning_pathways.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0013_verified_learning_pathways.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0012_manual_assignments.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0010_staged_course_publication.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='changed' WHERE name='0010_staged_course_publication.sql'`).run(),
    db => db.prepare(`DELETE FROM _app_migrations WHERE name='0008_notification_targets.sql'`).run(),
    db => db.prepare(`UPDATE _app_migrations SET checksum='627c3b-pr6' WHERE name='0003_course_progress.sql'`).run(),
  ]) {
    const f = fixture(); f.upgrade();
    const db = f.db(); mutate(db); db.close();
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), /history is missing, divergent or has changed checksums/);
  }
});

test('SQLite deploy refuses learner tail already applied after a missing authoring predecessor', () => {
  const f = fixture(); f.upgrade();
  const db = f.db();
  db.prepare(`DELETE FROM _app_migrations WHERE name='0015_formative_practice_authoring.sql'`).run();
  db.close();
  assert.throws(() => initializeSqlite(f.url, f.migrations), /gap before 0016_formative_practice_learner\.sql/);
});

test('SQLite deploy refuses chat index tail already applied after a missing learner predecessor', () => {
  const f = fixture(); f.upgrade();
  const db = f.db();
  db.prepare(`DELETE FROM _app_migrations WHERE name='0016_formative_practice_learner.sql'`).run();
  db.close();
  assert.throws(() => initializeSqlite(f.url, f.migrations), /gap before 0017_chat_message_cursor_index\.sql/);
});

test('SQLite deploy refuses chat read cursor tail after a missing chat index predecessor', () => {
  const f = fixture(); f.upgrade();
  const db = f.db();
  db.prepare(`DELETE FROM _app_migrations WHERE name='0017_chat_message_cursor_index.sql'`).run();
  db.close();
  assert.throws(() => initializeSqlite(f.url, f.migrations), /gap before 0018_chat_read_cursor\.sql/);
});

test('SQLite deploy refuses course Q&A tail after a missing chat read predecessor', () => {
  const f = fixture(); f.upgrade();
  const db = f.db();
  db.prepare(`DELETE FROM _app_migrations WHERE name='0018_chat_read_cursor.sql'`).run();
  db.close();
  assert.throws(() => initializeSqlite(f.url, f.migrations), /gap before 0019_course_qa\.sql/);
});

test('SQLite deploy refuses spaces tail after a missing course Q&A predecessor', () => {
  const f = fixture(); f.upgrade();
  const db = f.db();
  db.prepare(`DELETE FROM _app_migrations WHERE name='0019_course_qa.sql'`).run();
  db.close();
  assert.throws(() => initializeSqlite(f.url, f.migrations), /gap before 0020_spaces\.sql/);
});

test('SQLite deploy refuses space report tail after a missing spaces predecessor', () => {
  const f = fixture(); f.upgrade();
  const db = f.db();
  db.prepare(`DELETE FROM _app_migrations WHERE name='0020_spaces.sql'`).run();
  db.close();
  assert.throws(() => initializeSqlite(f.url, f.migrations), /gap before 0021_space_report_targets\.sql/);
});

const pgUrl = process.env.POSTGRESQL_RELEASE_GATE_DISPOSABLE === '1'
  ? testDatabase.disposablePostgresqlTestUrl(process.env.DATABASE_URL) : null;
if (pgUrl) {
  test('PostgreSQL 16 fresh custom schema is ready; populated main upgrade fails closed', async () => {
    const db = new pg.Client({ connectionString: pgUrl });
    await db.connect();
    const fresh = `forge_fresh_publication_${randomUUID().replaceAll('-', '_')}`;
    const legacy = `forge_legacy_publication_${randomUUID().replaceAll('-', '_')}`;
    const freshUrl = new URL(pgUrl); freshUrl.searchParams.set('schema', fresh);
    const legacyUrl = new URL(pgUrl); legacyUrl.searchParams.set('schema', legacy);
    try {
      await db.query(`CREATE SCHEMA "${fresh}"`);
      await applyPostgresqlUpgrades(freshUrl.toString(), { initializeEmptySchema: true });
      assert.equal(await assertCoursePublicationReady(freshUrl.toString(), 'postgresql'), true);
      await db.query(`SET search_path TO "${fresh}"`);
      for (const [name, sql, file] of [
        ['missing mission week tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0025_space_mission_week.sql'`, '0025_space_mission_week.sql'],
        ['tampered mission week tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0025_space_mission_week.sql'`, '0025_space_mission_week.sql'],
        ['missing polls tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0024_space_polls.sql'`, '0024_space_polls.sql'],
        ['tampered polls tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0024_space_polls.sql'`, '0024_space_polls.sql'],
        ['missing event waitlist tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0023_event_waitlist.sql'`, '0023_event_waitlist.sql'],
        ['tampered event waitlist tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0023_event_waitlist.sql'`, '0023_event_waitlist.sql'],
        ['missing mission contribution tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0022_space_mission_contributions.sql'`, '0022_space_mission_contributions.sql'],
        ['tampered mission contribution tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0022_space_mission_contributions.sql'`, '0022_space_mission_contributions.sql'],
        ['missing mission foundation tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0021_space_mission_foundation.sql'`, '0021_space_mission_foundation.sql'],
        ['tampered mission foundation tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0021_space_mission_foundation.sql'`, '0021_space_mission_foundation.sql'],
        ['missing space-report tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0020_space_report_targets.sql'`, '0020_space_report_targets.sql'],
        ['tampered space-report tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0020_space_report_targets.sql'`, '0020_space_report_targets.sql'],
        ['missing spaces tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0019_spaces.sql'`, '0019_spaces.sql'],
        ['tampered spaces tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0019_spaces.sql'`, '0019_spaces.sql'],
        ['missing course Q&A tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0018_course_qa.sql'`, '0018_course_qa.sql'],
        ['tampered course Q&A tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0018_course_qa.sql'`, '0018_course_qa.sql'],
        ['missing chat read tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0017_chat_read_cursor.sql'`, '0017_chat_read_cursor.sql'],
        ['tampered chat read tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0017_chat_read_cursor.sql'`, '0017_chat_read_cursor.sql'],
        ['missing chat index tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0016_chat_message_cursor_index.sql'`, '0016_chat_message_cursor_index.sql'],
        ['tampered chat index tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0016_chat_message_cursor_index.sql'`, '0016_chat_message_cursor_index.sql'],
        ['missing learner practice tail', `DELETE FROM "_app_schema_upgrades" WHERE name='0015_formative_practice_learner.sql'`, '0015_formative_practice_learner.sql'],
        ['tampered learner practice tail', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0015_formative_practice_learner.sql'`, '0015_formative_practice_learner.sql'],
        ['missing authoring predecessor', `DELETE FROM "_app_schema_upgrades" WHERE name='0014_formative_practice_authoring.sql'`, '0014_formative_practice_authoring.sql'],
        ['tampered authoring predecessor', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0014_formative_practice_authoring.sql'`, '0014_formative_practice_authoring.sql'],
        ['missing confidence predecessor', `DELETE FROM "_app_schema_upgrades" WHERE name='0013_quiz_confidence_evidence.sql'`, '0013_quiz_confidence_evidence.sql'],
        ['tampered confidence predecessor', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0013_quiz_confidence_evidence.sql'`, '0013_quiz_confidence_evidence.sql'],
        ['missing pathway predecessor', `DELETE FROM "_app_schema_upgrades" WHERE name='0012_verified_learning_pathways.sql'`, '0012_verified_learning_pathways.sql'],
        ['tampered pathway predecessor', `UPDATE "_app_schema_upgrades" SET checksum='changed' WHERE name='0012_verified_learning_pathways.sql'`, '0012_verified_learning_pathways.sql'],
        ['gap before pathway', `DELETE FROM "_app_schema_upgrades" WHERE name='0011_manual_assignments.sql'`, '0011_manual_assignments.sql'],
      ]) {
        const checksum = createHash('sha256').update(readFileSync(new URL(`../prisma/postgresql-upgrades/${file}`, import.meta.url))).digest('hex');
        await db.query(sql);
        await assert.rejects(assertCoursePublicationReady(freshUrl.toString(), 'postgresql'), /history is missing, divergent or has changed checksums/, name);
        await db.query(`INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)
          ON CONFLICT (name) DO UPDATE SET checksum=EXCLUDED.checksum`, [file, checksum]);
      }
      assert.equal(await assertCoursePublicationReady(freshUrl.toString(), 'postgresql'), true);
      await db.query(`DELETE FROM "_app_schema_upgrades" WHERE name='0019_spaces.sql'`);
      await assert.rejects(applyPostgresqlUpgrades(freshUrl.toString()), /gap before 0020_space_report_targets\.sql/);
      await db.query(`INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)`, [
        '0019_spaces.sql',
        createHash('sha256').update(readFileSync(new URL('../prisma/postgresql-upgrades/0019_spaces.sql', import.meta.url))).digest('hex'),
      ]);
      assert.equal(await assertCoursePublicationReady(freshUrl.toString(), 'postgresql'), true);
      await db.query(`DELETE FROM "_app_schema_upgrades" WHERE name='0018_course_qa.sql'`);
      await assert.rejects(applyPostgresqlUpgrades(freshUrl.toString()), /gap before 0019_spaces\.sql/);
      await db.query(`INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)`, [
        '0018_course_qa.sql',
        createHash('sha256').update(readFileSync(new URL('../prisma/postgresql-upgrades/0018_course_qa.sql', import.meta.url))).digest('hex'),
      ]);
      assert.equal(await assertCoursePublicationReady(freshUrl.toString(), 'postgresql'), true);
      await db.query(`DELETE FROM "_app_schema_upgrades" WHERE name='0015_formative_practice_learner.sql'`);
      await assert.rejects(applyPostgresqlUpgrades(freshUrl.toString()), /gap before 0016_chat_message_cursor_index\.sql/);
      await db.query(`INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)`, [
        '0015_formative_practice_learner.sql',
        createHash('sha256').update(readFileSync(new URL('../prisma/postgresql-upgrades/0015_formative_practice_learner.sql', import.meta.url))).digest('hex'),
      ]);
      assert.equal(await assertCoursePublicationReady(freshUrl.toString(), 'postgresql'), true);
      await db.query(`DELETE FROM "_app_schema_upgrades" WHERE name='0016_chat_message_cursor_index.sql'`);
      await assert.rejects(applyPostgresqlUpgrades(freshUrl.toString()), /gap before 0017_chat_read_cursor\.sql/);
      await db.query(`INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)`, [
        '0016_chat_message_cursor_index.sql',
        createHash('sha256').update(readFileSync(new URL('../prisma/postgresql-upgrades/0016_chat_message_cursor_index.sql', import.meta.url))).digest('hex'),
      ]);
      assert.equal(await assertCoursePublicationReady(freshUrl.toString(), 'postgresql'), true);
      await db.query(`CREATE SCHEMA "${legacy}"`);
      await db.query(`SET search_path TO "${legacy}"`);
      await db.query(readFileSync(new URL('../prisma/postgresql-baselines/0000_main_7814799.sql', import.meta.url), 'utf8'));
      await db.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ('author','author@example.invalid',CURRENT_TIMESTAMP)`);
      await db.query(`INSERT INTO "Course" (id,title,description,"instructorId","updatedAt")
        VALUES ('legacy','Original','Preserve','author',CURRENT_TIMESTAMP)`);
      const before = (await db.query(`SELECT id,title,description,"updatedAt" FROM "Course"`)).rows;
      await applyPostgresqlUpgrades(legacyUrl.toString(), { baselineCurrentSchema: true });
      await assert.rejects(assertCoursePublicationReady(legacyUrl.toString(), 'postgresql'), /Legacy course legacy has no saved draft/);
      assert.deepEqual((await db.query(`SELECT id,title,description,"updatedAt" FROM "Course"`)).rows, before);
      await db.query(`UPDATE "_app_schema_upgrades" SET checksum='bf146e-pr6' WHERE name='0002_course_progress.sql'`);
      await assert.rejects(assertCoursePublicationReady(legacyUrl.toString(), 'postgresql'), /history is missing, divergent or has changed checksums/);
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS "${fresh}" CASCADE`);
      await db.query(`DROP SCHEMA IF EXISTS "${legacy}" CASCADE`);
      await db.end();
    }
  });
}
