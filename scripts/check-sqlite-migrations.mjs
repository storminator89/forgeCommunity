import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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
