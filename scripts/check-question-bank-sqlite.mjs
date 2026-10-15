import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeSqlite } from './sqlite-init.mjs';

test('question bank SQLite migration enforces revision identity, immutability and owner cascade', () => {
  process.env.DATABASE_PROVIDER = 'sqlite';
  const directory = mkdtempSync(join(tmpdir(), 'forge-question-bank-sqlite-'));
  const path = join(directory, 'test.db');
  initializeSqlite(`file:${path}`);
  initializeSqlite(`file:${path}`);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  try {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.ok(db.prepare("SELECT name FROM _app_migrations WHERE name = '0011_question_bank.sql'").get());
    db.prepare('INSERT INTO "User" (id, email, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)').run('author', 'author@invalid.test');
    const insertItem = db.prepare('INSERT INTO "QuestionBankItem" (id, ownerId) VALUES (?, ?)');
    insertItem.run('bank-item', 'author');
    assert.throws(() => insertItem.run('unknown', 'missing'), /FOREIGN KEY/);
    const insertRevision = db.prepare('INSERT INTO "QuestionBankRevision" (itemId, revision, questionJson) VALUES (?, ?, ?)');
    insertRevision.run('bank-item', 1, '{"question":"Original"}');
    assert.throws(() => insertRevision.run('bank-item', 1, '{"question":"Overwrite"}'), /UNIQUE/);
    assert.throws(() => insertRevision.run('bank-item', 0, '{}'), /CHECK/);
    assert.throws(() => insertRevision.run('missing', 1, '{}'), /FOREIGN KEY/);
    assert.throws(() => db.prepare('UPDATE "QuestionBankRevision" SET questionJson = ? WHERE itemId = ?').run('{}', 'bank-item'), /immutable/);
    db.prepare('UPDATE "QuestionBankItem" SET latestRevision = 2 WHERE id = ?').run('bank-item');
    insertRevision.run('bank-item', 2, '{"question":"Revised"}');
    assert.equal(db.prepare('SELECT questionJson FROM "QuestionBankRevision" WHERE itemId = ? AND revision = 1').get('bank-item').questionJson,
      '{"question":"Original"}');
    db.prepare('DELETE FROM "User" WHERE id = ?').run('author');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "QuestionBankItem"').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "QuestionBankRevision"').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
