import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import prismaPackage from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import testDatabase from './space-mission-test-database.cjs';

if (process.env.POSTGRESQL_RELEASE_GATE_DISPOSABLE !== '1') {
  throw new Error('Course Q&A PostgreSQL gate requires POSTGRESQL_RELEASE_GATE_DISPOSABLE=1.');
}
const baseUrl = testDatabase.disposablePostgresqlTestUrl(process.env.DATABASE_URL);

const quote = name => `"${name.replaceAll('"', '""')}"`;
const rejectCode = (promise, code) => assert.rejects(promise, error => error?.code === code);
const { PrismaClient } = prismaPackage;

test('fresh custom-schema PostgreSQL Q&A keeps same-question FK and deletion cascade', async () => {
  const db = new pg.Client({ connectionString: baseUrl });
  await db.connect();
  const schema = `forge_qa_${randomUUID().replaceAll('-', '_')}`;
  const scopedUrl = new URL(baseUrl); scopedUrl.searchParams.set('schema', schema);
  try {
    await db.query(`CREATE SCHEMA ${quote(schema)}`);
    await applyPostgresqlUpgrades(scopedUrl.toString(), { initializeEmptySchema: true });
    assert.equal(await assertCoursePublicationReady(scopedUrl.toString(), 'postgresql'), true);
    await db.query(`SET search_path TO ${quote(schema)}`);
    await db.query(`INSERT INTO "User" ("id", "email", "updatedAt") VALUES
      ('teacher', 'teacher@example.invalid', CURRENT_TIMESTAMP),
      ('learner', 'learner@example.invalid', CURRENT_TIMESTAMP)`);
    await db.query(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "updatedAt") VALUES
      ('a', 'a', '', 'teacher', CURRENT_TIMESTAMP), ('b', 'b', '', 'teacher', CURRENT_TIMESTAMP)`);
    await db.query(`INSERT INTO "CourseQuestion" ("id", "courseId", "authorId", "requestId", "title", "body", "updatedAt") VALUES
      ('q-a', 'a', 'learner', 'request-q-a', 'Question', 'Body', CURRENT_TIMESTAMP),
      ('q-b', 'b', 'learner', 'request-q-b', 'Question', 'Body', CURRENT_TIMESTAMP)`);
    await db.query(`INSERT INTO "CourseAnswer" ("id", "questionId", "authorId", "requestId", "body") VALUES
      ('a-a', 'q-a', 'teacher', 'request-a-a', 'Answer'),
      ('a-b', 'q-b', 'teacher', 'request-a-b', 'Answer')`);
    await rejectCode(db.query(`INSERT INTO "CourseQuestionSolution" ("questionId", "answerId", "revision")
      VALUES ('q-a', 'a-b', 'cross')`), '23503');
    await db.query(`INSERT INTO "CourseQuestionSolution" ("questionId", "answerId", "revision")
      VALUES ('q-a', 'a-a', 'current')`);
    await db.query(`UPDATE "CourseQuestion" SET "solutionRevision"='current' WHERE "id"='q-a'`);
    await db.query(`DELETE FROM "CourseAnswer" WHERE "id"='a-a'`);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM "CourseQuestionSolution"')).rows[0].n, 0);
    await db.query(`DELETE FROM "Course" WHERE "id"='b'`);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CourseQuestion" WHERE "courseId"='b'`)).rows[0].n, 0);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CourseAnswer" WHERE "id"='a-b'`)).rows[0].n, 0);
    // Exercise the generated PostgreSQL client against the *custom* schema,
    // not merely the SQL migration or a public-schema fallback.
    const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: baseUrl }, { schema }) });
    try {
      const question = await runtime.courseQuestion.findUniqueOrThrow({ where: { id: 'q-a' },
        select: { courseId: true, answers: { select: { id: true } }, solution: { select: { answerId: true } } } });
      assert.equal(question.courseId, 'a');
      assert.deepEqual(question.answers, []);
      assert.equal(question.solution, null);
      await runtime.$transaction(async tx => {
        await tx.courseAnswer.create({ data: { id: 'a-runtime', questionId: 'q-a', authorId: 'teacher',
          requestId: 'request-runtime-answer', body: 'Runtime answer' } });
        await tx.courseQuestion.update({ where: { id: 'q-a' }, data: { solutionRevision: 'runtime' } });
        await tx.courseQuestionSolution.create({ data: { questionId: 'q-a', answerId: 'a-runtime', revision: 'runtime' } });
      }, { isolationLevel: 'Serializable' });
      assert.equal((await runtime.courseQuestion.findUniqueOrThrow({ where: { id: 'q-a' },
        select: { solution: { select: { answerId: true } } } })).solution?.answerId, 'a-runtime');
    } finally { await runtime.$disconnect(); }
    await db.query(`DELETE FROM "User" WHERE "id"='learner'`);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CourseQuestion" WHERE "courseId"='a'`)).rows[0].n, 0);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CourseAnswer"`)).rows[0].n, 0);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM "CourseQuestionSolution"`)).rows[0].n, 0);
    // The synthetic courses have no saved authoring drafts; remove the fixture
    // before asserting the production fresh-install readiness contract.
    await db.query(`DELETE FROM "Course" WHERE id = 'a'`);
    assert.equal(await assertCoursePublicationReady(scopedUrl.toString(), 'postgresql'), true);
  } finally {
    try { await db.query(`RESET search_path`); await db.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`); }
    finally { await db.end(); }
  }
});
