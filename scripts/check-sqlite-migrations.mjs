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
