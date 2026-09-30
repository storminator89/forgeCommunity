import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeSqlite, sqlitePath } from './sqlite-init.mjs';

process.env.DATABASE_PROVIDER = 'sqlite';

function fixture(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-sqlite-test-'));
  const migrations = join(dir, 'migrations');
  mkdirSync(migrations);
  writeFileSync(join(migrations, '0001_initial.sql'), sql);
  const url = `file:${join(dir, 'db.sqlite')}`;
  return { dir, migrations, url };
}

test('tracks migrations and preserves data across repeated initialization', () => {
  const { migrations, url } = fixture('CREATE TABLE Example (id INTEGER PRIMARY KEY, value TEXT);');
  initializeSqlite(url, migrations);
  const db = new DatabaseSync(sqlitePath(url));
  db.exec("INSERT INTO Example (value) VALUES ('kept')");
  db.close();
  initializeSqlite(url, migrations);
  const reopened = new DatabaseSync(sqlitePath(url));
  assert.equal(reopened.prepare('SELECT value FROM Example').get().value, 'kept');
  assert.equal(reopened.prepare('SELECT count(*) AS count FROM _app_migrations').get().count, 1);
  reopened.close();
});

test('upgrades a populated 0001 database without losing historical skill totals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-skill-upgrade-'));
  const migrations = join(dir, 'migrations');
  mkdirSync(migrations);
  copyFileSync(new URL('../prisma/sqlite-migrations/0001_initial.sql', import.meta.url), join(migrations, '0001_initial.sql'));
  const url = `file:${join(dir, 'db.sqlite')}`;
  initializeSqlite(url, migrations);
  const db = new DatabaseSync(sqlitePath(url));
  db.exec('PRAGMA foreign_keys = ON');
  try {
    const createUser = db.prepare('INSERT INTO "User" (id, email, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)');
    createUser.run('recipient', 'recipient@example.test');
    createUser.run('endorser', 'endorser@example.test');
    db.prepare('INSERT INTO "Skill" (id, name, category) VALUES (?, ?, ?)').run('skill', 'Skill', 'test');
    db.prepare('INSERT INTO "UserSkill" (id, userId, skillId, level, endorsements) VALUES (?, ?, ?, ?, ?)')
      .run('userSkill', 'recipient', 'skill', 50, 7);
  } finally {
    db.close();
  }

  copyFileSync(new URL('../prisma/sqlite-migrations/0002_skill_endorsements.sql', import.meta.url), join(migrations, '0002_skill_endorsements.sql'));
  initializeSqlite(url, migrations);
  initializeSqlite(url, migrations);
  const upgraded = new DatabaseSync(sqlitePath(url));
  upgraded.exec('PRAGMA foreign_keys = ON');
  try {
    assert.equal(upgraded.prepare('SELECT endorsements FROM "UserSkill"').get().endorsements, 7);
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM _app_migrations').get().count, 2);
    const addEndorsement = upgraded.prepare('INSERT INTO "SkillEndorsement" (id, endorserId, userSkillId) VALUES (?, ?, ?)');
    addEndorsement.run('endorsement', 'endorser', 'userSkill');
    assert.throws(() => addEndorsement.run('duplicate', 'endorser', 'userSkill'), /UNIQUE/);
    upgraded.prepare('DELETE FROM "User" WHERE id = ?').run('endorser');
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM "SkillEndorsement"').get().count, 0);
  } finally {
    upgraded.close();
  }
});

test('upgrades populated 0002 course records without changing historical completion or certificates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-progress-upgrade-'));
  const migrations = join(dir, 'migrations');
  mkdirSync(migrations);
  for (const name of ['0001_initial.sql', '0002_skill_endorsements.sql']) {
    copyFileSync(new URL(`../prisma/sqlite-migrations/${name}`, import.meta.url), join(migrations, name));
  }
  const url = `file:${join(dir, 'db.sqlite')}`;
  initializeSqlite(url, migrations);
  const db = new DatabaseSync(sqlitePath(url));
  db.exec('PRAGMA foreign_keys = ON');
  const historicalTables = ['User', 'Course', 'Enrollment', 'Certificate', 'Skill', 'UserSkill', 'SkillEndorsement'];
  let historical;
  let contents;
  try {
    db.exec(`
      INSERT INTO "User" (id, email, updatedAt) VALUES
        ('instructor', 'instructor@example.test', CURRENT_TIMESTAMP),
        ('learner', 'learner@example.test', CURRENT_TIMESTAMP),
        ('other', 'other@example.test', CURRENT_TIMESTAMP);
      INSERT INTO "Course" (id, title, description, instructorId, updatedAt)
        VALUES ('course', 'Historical course', 'Keep me', 'instructor', CURRENT_TIMESTAMP);
      INSERT INTO "CourseContent" (id, title, content, "order", courseId, updatedAt) VALUES
        ('content', 'First', 'Historical lesson', 0, 'course', CURRENT_TIMESTAMP),
        ('second', 'Second', 'Optional later', 1, 'course', CURRENT_TIMESTAMP);
      INSERT INTO "Enrollment" (id, userId, courseId, completedAt) VALUES
        ('enrollment', 'learner', 'course', '2024-02-03 04:05:06'),
        ('other-enrollment', 'other', 'course', NULL);
      INSERT INTO "Certificate" (id, userId, courseId, issuedAt, courseName, userName)
        VALUES ('certificate', 'learner', 'course', '2024-02-03 04:05:06', 'Historical title', 'Historical name');
      INSERT INTO "Skill" (id, name, category) VALUES ('skill', 'Skill', 'test');
      INSERT INTO "UserSkill" (id, userId, skillId, level, endorsements) VALUES ('userSkill', 'learner', 'skill', 50, 7);
      INSERT INTO "SkillEndorsement" (id, endorserId, userSkillId) VALUES ('endorsement', 'other', 'userSkill');
    `);
    historical = historicalTables.map(table => db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all());
    contents = db.prepare('SELECT * FROM "CourseContent" ORDER BY id').all();
    // The second index fails after ALTER TABLE and CREATE TABLE: the whole
    // pending upgrade must roll back while previous migrations remain intact.
    db.exec('CREATE TABLE Collision (id TEXT); CREATE INDEX "ContentProgress_contentId_idx" ON Collision(id)');
  } finally {
    db.close();
  }
  copyFileSync(new URL('../prisma/sqlite-migrations/0003_course_progress.sql', import.meta.url), join(migrations, '0003_course_progress.sql'));
  assert.throws(() => initializeSqlite(url, migrations), /already exists/);
  const rolledBack = new DatabaseSync(sqlitePath(url));
  try {
    assert.equal(rolledBack.prepare('SELECT count(*) AS count FROM _app_migrations').get().count, 2);
    assert.equal(rolledBack.prepare("SELECT name FROM sqlite_master WHERE name = 'ContentProgress'").get(), undefined);
    assert.ok(!rolledBack.prepare('PRAGMA table_info("CourseContent")').all().some(column => column.name === 'isRequired'));
    for (const [index, table] of historicalTables.entries()) {
      assert.deepEqual(rolledBack.prepare(`SELECT * FROM "${table}" ORDER BY id`).all(), historical[index]);
    }
    rolledBack.exec('DROP TABLE Collision');
  } finally {
    rolledBack.close();
  }

  initializeSqlite(url, migrations);
  initializeSqlite(url, migrations);
  const upgraded = new DatabaseSync(sqlitePath(url));
  upgraded.exec('PRAGMA foreign_keys = ON');
  try {
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM _app_migrations').get().count, 3);
    for (const [index, table] of historicalTables.entries()) {
      assert.deepEqual(upgraded.prepare(`SELECT * FROM "${table}" ORDER BY id`).all(), historical[index]);
    }
    assert.deepEqual(upgraded.prepare('SELECT * FROM "CourseContent" ORDER BY id').all(),
      contents.map(content => Object.assign(Object.create(null), content, { isRequired: 1 })));
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM "ContentProgress"').get().count, 0);
    assert.ok(upgraded.prepare('PRAGMA index_list("ContentProgress")').all()
      .some(index => index.name === 'ContentProgress_contentId_idx' && index.unique === 0));
    const addProgress = upgraded.prepare('INSERT INTO "ContentProgress" (id, enrollmentId, contentId) VALUES (?, ?, ?)');
    addProgress.run('progress', 'enrollment', 'content');
    addProgress.run('other-progress', 'other-enrollment', 'second');
    assert.ok(upgraded.prepare('SELECT completedAt FROM "ContentProgress" WHERE id = ?').get('progress').completedAt);
    assert.throws(() => addProgress.run('duplicate', 'enrollment', 'content'), /UNIQUE/);
    assert.throws(() => addProgress.run('orphan-enrollment', 'missing', 'content'), /FOREIGN KEY/);
    assert.throws(() => addProgress.run('orphan-content', 'enrollment', 'missing'), /FOREIGN KEY/);
    assert.throws(() => upgraded.exec(`INSERT INTO "ContentProgress" (id, enrollmentId, contentId, completedAt)
      VALUES ('null-completion', 'enrollment', 'second', NULL)`), /NOT NULL/);
    upgraded.exec(`UPDATE "Enrollment" SET id = 'renamed-enrollment' WHERE id = 'enrollment';
      UPDATE "CourseContent" SET id = 'renamed-content' WHERE id = 'content';
      UPDATE "CourseContent" SET isRequired = false WHERE id = 'second'`);
    const progress = upgraded.prepare('SELECT enrollmentId, contentId FROM "ContentProgress" WHERE id = ?').get('progress');
    assert.equal(progress.enrollmentId, 'renamed-enrollment');
    assert.equal(progress.contentId, 'renamed-content');
  } finally {
    upgraded.close();
  }

  initializeSqlite(url, migrations);
  const reopened = new DatabaseSync(sqlitePath(url));
  reopened.exec('PRAGMA foreign_keys = ON');
  try {
    assert.equal(reopened.prepare('SELECT count(*) AS count FROM "ContentProgress"').get().count, 2);
    assert.equal(reopened.prepare('SELECT isRequired FROM "CourseContent" WHERE id = ?').get('second').isRequired, 0);
    reopened.exec(`DELETE FROM "Enrollment" WHERE id = 'renamed-enrollment'`);
    assert.equal(reopened.prepare('SELECT count(*) AS count FROM "ContentProgress"').get().count, 1);
    reopened.exec(`DELETE FROM "CourseContent" WHERE id = 'second'`);
    assert.equal(reopened.prepare('SELECT count(*) AS count FROM "ContentProgress"').get().count, 0);
    assert.deepEqual(reopened.prepare('SELECT * FROM "Certificate" ORDER BY id').all(), historical[historicalTables.indexOf('Certificate')]);
    assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    reopened.close();
  }
});

test('initializes a fresh database with every reviewed SQLite migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-fresh-migrations-'));
  const url = `file:${join(dir, 'db.sqlite')}`;
  initializeSqlite(url);
  initializeSqlite(url);
  const db = new DatabaseSync(sqlitePath(url));
  try {
    assert.deepEqual(db.prepare('SELECT name FROM _app_migrations ORDER BY name').all().map(row => row.name),
      ['0001_initial.sql', '0002_skill_endorsements.sql', '0003_course_progress.sql']);
    assert.equal(db.prepare('SELECT count(*) AS count FROM "ContentProgress"').get().count, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('rejects modified migration checksums', () => {
  const { migrations, url } = fixture('CREATE TABLE Example (id INTEGER PRIMARY KEY);');
  initializeSqlite(url, migrations);
  writeFileSync(join(migrations, '0001_initial.sql'), 'CREATE TABLE Altered (id INTEGER PRIMARY KEY);');
  assert.throws(() => initializeSqlite(url, migrations), /checksum changed/);
});

test('rejects an existing untracked schema', () => {
  const { migrations, url } = fixture('CREATE TABLE Example (id INTEGER PRIMARY KEY);');
  const db = new DatabaseSync(sqlitePath(url));
  db.exec('CREATE TABLE Legacy (id INTEGER PRIMARY KEY)');
  db.close();
  assert.throws(() => initializeSqlite(url, migrations), /no migration history/);
});

test('rolls back all statements and history when SQL fails', () => {
  const { migrations, url } = fixture('CREATE TABLE Example (id INTEGER PRIMARY KEY); INSERT INTO Missing VALUES (1);');
  assert.throws(() => initializeSqlite(url, migrations), /no such table/);
  const db = new DatabaseSync(sqlitePath(url));
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), []);
  db.close();
});

test('rejects provider mismatch and ambiguous paths', () => {
  const { migrations, url } = fixture('CREATE TABLE Example (id INTEGER PRIMARY KEY);');
  process.env.DATABASE_PROVIDER = 'postgresql';
  try { assert.throws(() => initializeSqlite(url, migrations), /DATABASE_PROVIDER=sqlite/); }
  finally { process.env.DATABASE_PROVIDER = 'sqlite'; }
  assert.throws(() => sqlitePath('file:./relative.db'), /absolute/);
  assert.throws(() => sqlitePath('postgresql://localhost/db'), /DATABASE_URL=file:/);
});
