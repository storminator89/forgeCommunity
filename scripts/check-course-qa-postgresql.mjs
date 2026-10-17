import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
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
const { PrismaClient } = createRequire(import.meta.url)(process.env.QA_CLIENT_PATH || '@prisma/client');

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
        select: { courseId: true, contextPublicationId: true, contextContentId: true, answers: { select: { id: true } }, solution: { select: { answerId: true } } } });
      assert.equal(question.courseId, 'a');
      assert.equal(question.contextPublicationId, null); assert.equal(question.contextContentId, null);
      const anchored = await runtime.courseQuestion.create({ data: { id: 'runtime-anchored', courseId: 'a', authorId: 'learner',
        requestId: 'request-runtime-anchored', title: 'Anchored question', body: 'Original body',
        contextPublicationId: 'historical-publication', contextContentId: 'historical-content' },
        select: { contextPublicationId: true, contextContentId: true } });
      assert.deepEqual(anchored,{ contextPublicationId: 'historical-publication', contextContentId: 'historical-content' });
      assert.deepEqual(question.answers, []);
      assert.equal(question.solution, null);
      await runtime.$transaction(async tx => {
        await tx.courseAnswer.create({ data: { id: 'a-runtime', questionId: 'q-a', authorId: 'teacher',
          requestId: 'request-runtime-answer', body: 'Runtime answer' } });
        const chosen = await tx.courseQuestion.updateMany({ where: { id: 'q-a', solutionRevision: 'current' }, data: { solutionRevision: 'runtime' } });
        assert.equal(chosen.count,1);
        assert.equal((await tx.courseQuestion.updateMany({ where: { id: 'q-a', solutionRevision: 'current' }, data: { solutionRevision: 'stale' } })).count,0);
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

const upgradesDirectory = new URL('../prisma/postgresql-upgrades/', import.meta.url);
const tail = '0027_course_qa_lesson_context.sql';
const predecessor = '0026_space_mission_bookmarks.sql';
const contextIndex = 'CourseQuestion_lesson_scope_page_idx';
const upgradeNames = readdirSync(upgradesDirectory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const checksum = sql => createHash('sha256').update(sql).digest('hex');
const ddl = name => readFileSync(new URL(name,upgradesDirectory),'utf8');
const fixtureDirectories = [];
after(() => { for (const directory of fixtureDirectories) rmSync(directory,{ recursive:true,force:true }); });
async function withFixture(run) {
  const db = new pg.Client({ connectionString:baseUrl }); await db.connect();
  const schema = `forge_qa_context_${randomUUID().replaceAll('-','_')}`;
  const url = new URL(baseUrl); url.searchParams.set('schema',schema);
  try {
    await db.query(`CREATE SCHEMA ${quote(schema)}`); await db.query(`SET search_path TO ${quote(schema)}`);
    await db.query('BEGIN');
    try {
      await db.query(readFileSync(new URL('../prisma/postgresql-baselines/0000_main_7814799.sql',import.meta.url),'utf8'));
      await db.query('CREATE TABLE "_app_schema_upgrades" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      for (const name of upgradeNames.filter(name => name < tail)) {
        const sql = ddl(name); if (name !== '0001_skill_endorsements.sql') await db.query(sql);
        await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)',[name,checksum(sql)]);
      }
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    await db.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES
      ('teacher','teacher@example.invalid',CURRENT_TIMESTAMP),('learner','learner@example.invalid',CURRENT_TIMESTAMP);
      INSERT INTO "Course" (id,title,description,"instructorId","updatedAt") VALUES ('course','Keep course','  original  ','teacher',CURRENT_TIMESTAMP);
      INSERT INTO "CourseDraft" ("courseId",payload,digest,"updatedAt") VALUES ('course','{}','draft',CURRENT_TIMESTAMP);
      INSERT INTO "CoursePublication" (id,"courseId",sequence,source,payload,digest,"contentCount") VALUES ('publication','course',1,'AUTHOR','{}','digest',1);
      UPDATE "Course" SET "activePublicationId"='publication' WHERE id='course';
      INSERT INTO "CourseContent" (id,title,content,"order","courseId","updatedAt") VALUES ('leaf','Keep title','  body  ',0,'course',CURRENT_TIMESTAMP);
      INSERT INTO "Enrollment" (id,"courseId","userId") VALUES ('enrollment','course','learner');
      INSERT INTO "CourseContentProgress" ("userId","courseId","contentId",revision) VALUES ('learner','course','leaf','revision');
      INSERT INTO "Certificate" (id,"userId","courseId","courseName","userName","publicationId") VALUES ('certificate','learner','course','Keep name','Learner','publication');
      INSERT INTO "CourseQuestion" (id,"courseId","authorId","requestId",title,body,"updatedAt","solutionRevision") VALUES
        ('question','course','learner','request-original','Original question','  Original body  ',CURRENT_TIMESTAMP,'chosen-revision'),
        ('hidden','course','learner','request-hidden','Hidden question','Hidden body',CURRENT_TIMESTAMP,NULL);
      UPDATE "CourseQuestion" SET "hiddenAt"='2026-10-15 12:00:00' WHERE id='hidden';
      INSERT INTO "CourseAnswer" (id,"questionId","authorId","requestId",body) VALUES ('answer','question','teacher','request-answer','  Original answer  ');
      INSERT INTO "CourseQuestionSolution" ("questionId","answerId",revision) VALUES ('question','answer','chosen-revision');`);
    await run(db,url.toString(),schema);
  } finally {
    try { await db.query('RESET search_path'); await db.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`); }
    finally { await db.end(); }
  }
}
const tableNames = async db => (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map(row => row.table_name);
async function snapshot(db) {
  const result = {};
  for (const name of (await tableNames(db)).filter(name => name !== '_app_schema_upgrades')) {
    const columns = (await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position',[name])).rows.map(row => row.column_name);
    result[name] = { columns, rows:(await db.query(`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)} ORDER BY ctid`)).rows };
  }
  return result;
}
async function assertSnapshot(db,before) {
  for (const [name,{ columns,rows }] of Object.entries(before))
    assert.deepEqual((await db.query(`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)} ORDER BY ctid`)).rows,rows,name);
}
const history = async db => (await db.query('SELECT * FROM "_app_schema_upgrades" ORDER BY name')).rows;
const indexes = async db => (await db.query('SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY indexname')).rows;
const foreignKeys = async db => (await db.query(`SELECT c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=current_schema() AND c.contype='f' ORDER BY c.conrelid::regclass::text,c.conname`)).rows;
async function shorterImageDeployer() {
  const directory = mkdtempSync(join(tmpdir(),'forge-qa-pg-old-image-')); fixtureDirectories.push(directory);
  for (const name of upgradeNames.filter(name => name < tail)) copyFileSync(new URL(name,upgradesDirectory),join(directory,name));
  // Use the actual deployer with only its immutable image paths redirected.
  // This proves an older image refuses longer history without touching source SQL.
  const baseline = readFileSync(new URL('../prisma/postgresql-baselines/0000_main_7814799.sql',import.meta.url),'utf8');
  const source = readFileSync(new URL('./postgresql-upgrades.mjs',import.meta.url),'utf8')
    .replace("import pg from 'pg';",`import pg from ${JSON.stringify(import.meta.resolve('pg'))};`)
    .replace(/^const upgradesDir = .*;$/m,`const upgradesDir = ${JSON.stringify(directory)};`)
    .replace(/^const emptySchemaBaseline = .*;$/m,`const emptySchemaBaseline = ${JSON.stringify(baseline)};`);
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).applyPostgresqlUpgrades;
}

test('PostgreSQL exact populated predecessor retains old bytes, chosen state, FKs/indexes and null legacy anchors with repeat deploy and rollback compatibility', async () => {
  await withFixture(async (db,url) => {
    const before = await snapshot(db), oldTables = await tableNames(db), oldIndexes = await indexes(db), oldFks = await foreignKeys(db), oldHistory = await history(db);
    await applyPostgresqlUpgrades(url);
    await assertSnapshot(db,before); assert.deepEqual(await tableNames(db),oldTables); assert.deepEqual(await foreignKeys(db),oldFks);
    const currentIndexes = await indexes(db);
    assert.deepEqual(currentIndexes.filter(row => row.indexname !== contextIndex),oldIndexes); assert.equal(currentIndexes.length,oldIndexes.length+1);
    const index = (await db.query(`SELECT i.indisunique,i.indisvalid,i.indisready,i.indpred IS NULL AS no_predicate,i.indexprs IS NULL AS no_expression,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,n)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.n) AS columns
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace=current_schema()::regnamespace AND c.relname=$1`,[contextIndex])).rows;
    assert.deepEqual(index,[{ indisunique:false,indisvalid:true,indisready:true,no_predicate:true,no_expression:true,
      columns:['courseId','contextPublicationId','contextContentId','createdAt','id'] }]);
    assert.deepEqual((await db.query('SELECT * FROM "_app_schema_upgrades" WHERE name < $1 ORDER BY name',[tail])).rows,oldHistory);
    assert.deepEqual((await db.query('SELECT "contextPublicationId","contextContentId" FROM "CourseQuestion" ORDER BY id')).rows,
      [{ contextPublicationId:null,contextContentId:null },{ contextPublicationId:null,contextContentId:null }]);
    const deployedHistory = await history(db); await applyPostgresqlUpgrades(url); assert.deepEqual(await history(db),deployedHistory); await assertSnapshot(db,before);
    assert.equal(await assertCoursePublicationReady(url,'postgresql'),true);
    await db.query(`INSERT INTO "CourseQuestion" (id,"courseId","authorId","requestId",title,body,"updatedAt")
      VALUES ('old-shape','course','learner','old-shape-request','Question','Old shape',CURRENT_TIMESTAMP)`);
    assert.equal((await db.query(`SELECT "contextContentId" FROM "CourseQuestion" WHERE id='old-shape'`)).rows[0].contextContentId,null);
    await assert.rejects((await shorterImageDeployer())(url),/history mismatch for 0027_course_qa_lesson_context\.sql/);
    assert.equal(await assertCoursePublicationReady(url,'postgresql'),true);
  });
});

test('PostgreSQL pair check rejects both half-null insert/update forms while retaining scalar historical provenance', async () => {
  await withFixture(async (db,url) => {
    await applyPostgresqlUpgrades(url);
    const insert = (id,publication,content) => db.query(`INSERT INTO "CourseQuestion" (id,"courseId","authorId","requestId",title,body,"updatedAt","contextPublicationId","contextContentId")
      VALUES ($1,'course','learner',$1,'Question','Body',CURRENT_TIMESTAMP,$2,$3)`,[id,publication,content]);
    for (const pair of [[null,'content'],['publication',null]]) await rejectCode(insert('invalid',...pair),'23514');
    await insert('course-only',null,null); await insert('anchored','historical-publication','historical-content');
    for (const id of ['course-only','anchored']) for (const pair of [[null,'content'],['publication',null]])
      await rejectCode(db.query('UPDATE "CourseQuestion" SET "contextPublicationId"=$1,"contextContentId"=$2 WHERE id=$3',[...pair,id]),'23514');
    await db.query(`UPDATE "CourseQuestion" SET "contextPublicationId"='other-publication',"contextContentId"='other-content' WHERE id='course-only'`);
    await db.query(`UPDATE "CourseQuestion" SET "contextPublicationId"=NULL,"contextContentId"=NULL WHERE id='course-only'`);
    const fkColumns = (await db.query(`SELECT a.attname FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) k(attnum)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      WHERE c.conrelid='"CourseQuestion"'::regclass AND c.contype='f' ORDER BY a.attname`)).rows.map(row => row.attname);
    assert.deepEqual(fkColumns,['authorId','courseId']);
  });
});

test('PostgreSQL real new-tail index collision rolls back columns/check/history and retains every predecessor row before safe retry', async () => {
  await withFixture(async (db,url) => {
    await db.query(`CREATE INDEX ${quote(contextIndex)} ON "User" (id)`);
    const before = await snapshot(db), oldIndexes = await indexes(db), oldFks = await foreignKeys(db), oldHistory = await history(db);
    await rejectCode(applyPostgresqlUpgrades(url),'42P07');
    await assertSnapshot(db,before); assert.deepEqual(await indexes(db),oldIndexes); assert.deepEqual(await foreignKeys(db),oldFks); assert.deepEqual(await history(db),oldHistory);
    assert.equal((await db.query(`SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='CourseQuestion' AND column_name IN ('contextPublicationId','contextContentId')`)).rows[0].n,0);
    assert.equal((await db.query(`SELECT COUNT(*)::int n FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname='CourseQuestion_lesson_context_pair_check'`)).rows[0].n,0);
    await db.query(`DROP INDEX ${quote(contextIndex)}`); await applyPostgresqlUpgrades(url); await assertSnapshot(db,before);
    assert.equal(await assertCoursePublicationReady(url,'postgresql'),true);
  });
});

test('PostgreSQL context readiness/deploy refuses missing, modified, gapped and unknown history plus missing scalar columns', async () => {
  await withFixture(async (db,url) => {
    await applyPostgresqlUpgrades(url); const before = await history(db);
    for (const name of [tail,predecessor]) {
      const saved = before.find(row => row.name === name);
      await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2',['changed',name]);
      await assert.rejects(assertCoursePublicationReady(url,'postgresql'),/history is missing, divergent or has changed checksums/);
      await assert.rejects(applyPostgresqlUpgrades(url),/history mismatch/);
      await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',[name]);
      await assert.rejects(assertCoursePublicationReady(url,'postgresql'),/history is missing, divergent or has changed checksums/);
      if (name === predecessor) await assert.rejects(applyPostgresqlUpgrades(url),/gap before 0027_course_qa_lesson_context\.sql/);
      else await rejectCode(applyPostgresqlUpgrades(url),'42701');
      await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum,applied_at) VALUES ($1,$2,$3)',[saved.name,saved.checksum,saved.applied_at]);
    }
    await db.query(`INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ('0028_unreviewed_context.sql','unknown')`);
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),/history is missing, divergent or has changed checksums/);
    await assert.rejects(applyPostgresqlUpgrades(url),/history mismatch/);
    await db.query(`DELETE FROM "_app_schema_upgrades" WHERE name='0028_unreviewed_context.sql'`);
    for (const field of ['contextPublicationId','contextContentId']) {
      await db.query(`ALTER TABLE "CourseQuestion" RENAME COLUMN ${quote(field)} TO ${quote(`missing_${field}`)}`);
      try { await assert.rejects(assertCoursePublicationReady(url,'postgresql'),/lesson context schema is missing or incomplete/); }
      finally { await db.query(`ALTER TABLE "CourseQuestion" RENAME COLUMN ${quote(`missing_${field}`)} TO ${quote(field)}`); }
    }
    assert.deepEqual(await history(db),before); assert.equal(await assertCoursePublicationReady(url,'postgresql'),true);
  });
});
