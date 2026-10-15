import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { initializeSqlite } from './sqlite-init.mjs';

const migrations = fileURLToPath(new URL('../prisma/sqlite-migrations/', import.meta.url));
const files = readdirSync(migrations).filter(name => /^\d+_.*\.sql$/.test(name)).sort();

function withDatabase(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-notifications-'));
  try {
    const path = join(dir, 'database.db');
    const staged = join(dir, 'migrations');
    mkdirSync(staged);
    callback({ path, staged, url: `file:${path}` });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function checkDatabase(path, expectedCount) {
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare('SELECT count(*) AS count FROM _app_migrations').get().count, expectedCount);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.ok(db.prepare('PRAGMA table_info("Notification")').all().some(column => column.name === 'targetType'));
    assert.ok(db.prepare('PRAGMA table_info("Notification")').all().some(column => column.name === 'targetId'));
  } finally { db.close(); }
}

test('notification targets migrate on a fresh install and replay without changes', () => {
  withDatabase(({ path, url }) => {
    initializeSqlite(url);
    initializeSqlite(url);
    checkDatabase(path, files.length);
  });
});

test('notification targets preserve a populated legacy inbox across upgrade and replay', () => {
  withDatabase(({ path, staged, url }) => {
    for (const file of files.filter(name => name < '0008_notification_targets.sql')) copyFileSync(join(migrations, file), join(staged, file));
    initializeSqlite(url, staged);
    const before = new DatabaseSync(path);
    try {
      before.exec('PRAGMA foreign_keys = ON');
      before.prepare('INSERT INTO "User" ("id", "email", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)').run('alice', 'alice@example.test');
      before.prepare('INSERT INTO "Notification" ("id", "userId", "type", "content") VALUES (?, ?, ?, ?)').run('old', 'alice', 'SYSTEM', 'Historical notice');
    } finally { before.close(); }
    for (const file of files.filter(name => name >= '0008_notification_targets.sql')) copyFileSync(join(migrations, file), join(staged, file));
    initializeSqlite(url, staged);
    initializeSqlite(url, staged);
    checkDatabase(path, files.length);
    const after = new DatabaseSync(path);
    try {
      assert.deepEqual({ ...after.prepare('SELECT "content", "targetType", "targetId" FROM "Notification" WHERE "id" = ?').get('old') },
        { content: 'Historical notice', targetType: null, targetId: null });
      after.prepare('INSERT INTO "Notification" ("id", "userId", "type", "content", "targetType", "targetId") VALUES (?, ?, ?, ?, ?, ?)')
        .run('new', 'alice', 'FOLLOW', 'New follower', 'USER', 'bob');
      assert.equal(after.prepare('SELECT "targetType" FROM "Notification" WHERE "id" = ?').get('new').targetType, 'USER');
    } finally { after.close(); }
  });
});
