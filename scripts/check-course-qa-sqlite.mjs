import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeSqlite } from './sqlite-init.mjs';

function fixture() {
  const url = `file:${join(mkdtempSync(join(tmpdir(), 'forge-course-qa-sqlite-')), 'db.sqlite')}`;
  process.env.DATABASE_PROVIDER = 'sqlite';
  initializeSqlite(url);
  const db = new DatabaseSync(url.slice(5));
  db.exec('PRAGMA foreign_keys = ON');
  for (const id of ['teacher', 'learner', 'other']) {
    db.prepare('INSERT INTO "User" ("id", "email", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run(id, `${id}@example.invalid`);
  }
  for (const courseId of ['a', 'b']) {
    db.prepare('INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .run(courseId, courseId, '', 'teacher');
  }
  return db;
}

test('course Q&A database confines selected answers and cascades erasure', () => {
  const db = fixture();
  try {
    for (const [id, courseId] of [['q-a', 'a'], ['q-b', 'b']]) {
      db.prepare(`INSERT INTO "CourseQuestion" ("id", "courseId", "authorId", "requestId", "title", "body", "updatedAt")
        VALUES (?, ?, 'learner', ?, 'Question', 'Body', CURRENT_TIMESTAMP)`).run(id, courseId, `request-${id}`);
      db.prepare(`INSERT INTO "CourseAnswer" ("id", "questionId", "authorId", "requestId", "body")
        VALUES (?, ?, 'teacher', ?, 'Answer')`).run(`a-${id}`, id, `request-a-${id}`);
    }
    assert.throws(() => db.prepare(`INSERT INTO "CourseQuestionSolution" ("questionId", "answerId", "revision")
      VALUES ('q-a', 'a-q-b', 'cross')`).run(), /FOREIGN KEY constraint/);
    db.prepare(`INSERT INTO "CourseQuestionSolution" ("questionId", "answerId", "revision")
      VALUES ('q-a', 'a-q-a', 'current')`).run();
    db.prepare(`UPDATE "CourseQuestion" SET "solutionRevision"='current' WHERE "id"='q-a'`).run();
    assert.throws(() => db.prepare(`INSERT INTO "CourseQuestionSolution" ("questionId", "answerId", "revision")
      VALUES ('q-b', 'a-q-a', 'reuse')`).run(), /UNIQUE|FOREIGN KEY/);
    db.prepare(`DELETE FROM "CourseAnswer" WHERE "id"='a-q-a'`).run();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "CourseQuestionSolution"`).get().n, 0);
    db.prepare(`DELETE FROM "Course" WHERE "id"='b'`).run();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "CourseQuestion" WHERE "courseId"='b'`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "CourseAnswer" WHERE "id"='a-q-b'`).get().n, 0);
    db.prepare(`DELETE FROM "User" WHERE "id"='learner'`).run();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "CourseQuestion" WHERE "courseId"='a'`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "CourseAnswer"`).get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
});
