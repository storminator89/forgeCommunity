import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeSqlite } from './sqlite-init.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';

const directories = [];
after(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }); });
function temporaryDirectory() { const directory = mkdtempSync(join(tmpdir(), 'forge-course-qa-sqlite-')); directories.push(directory); return directory; }
function fixture() {
  const url = `file:${join(temporaryDirectory(), 'db.sqlite')}`;
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

const directory = new URL('../prisma/sqlite-migrations/', import.meta.url);
const tail = '0028_course_qa_lesson_context.sql';
const predecessor = '0027_space_mission_bookmarks.sql';
const contextIndex = 'CourseQuestion_lesson_scope_page_idx';
const quote = name => `"${name.replaceAll('"', '""')}"`;
const migrationNames = readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const tailSql = readFileSync(new URL(tail, directory), 'utf8');
function predecessorFixture() {
  const dir = temporaryDirectory(); const migrations = join(dir, 'migrations'); mkdirSync(migrations);
  for (const name of migrationNames.filter(name => name < tail)) copyFileSync(new URL(name, directory), join(migrations, name));
  const url = `file:${join(dir, 'db.sqlite')}`;
  const deploy = () => { process.env.DATABASE_PROVIDER = 'sqlite'; initializeSqlite(url, migrations); };
  deploy();
  const db = new DatabaseSync(url.slice(5)); db.exec('PRAGMA foreign_keys=ON');
  db.exec(`INSERT INTO "User" (id,email,"updatedAt") VALUES
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
  return { db, url, migrations, deploy, addTail: () => writeFileSync(join(migrations,tail),tailSql) };
}
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
function snapshot(db) {
  return Object.fromEntries(tables(db).filter(name => name !== '_app_migrations').map(name => {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
    return [name, { columns, rows: db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)} ORDER BY rowid`).all() }];
  }));
}
function assertSnapshot(db, before) {
  for (const [table, { columns, rows }] of Object.entries(before)) {
    assert.deepEqual(db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY rowid`).all(),rows,table);
  }
}
const history = db => db.prepare('SELECT * FROM _app_migrations ORDER BY name').all();
async function readyWithInvitationSuccessor(f) {
  const successor = '0029_space_mission_invitations.sql';
  assert.ok(!history(f.db).some(row => row.name === successor));
  await assert.rejects(assertCoursePublicationReady(f.url,'sqlite'),/history is missing, divergent or has changed checksums/);
  writeFileSync(join(f.migrations,successor),readFileSync(new URL(successor,directory),'utf8'));
  f.deploy();
  return assertCoursePublicationReady(f.url,'sqlite');
}

const indexes = db => db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='index' ORDER BY name").all();
const foreignKeys = db => Object.fromEntries(tables(db).map(name => [name, db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all()]));
const schema = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();

test('populated exact SQLite predecessor preserves all old bytes, chosen solution, FKs/indexes and null legacy anchors', async () => {
  const f = predecessorFixture(); const { db } = f;
  try {
    const rows = snapshot(db), oldTables = tables(db), oldIndexes = indexes(db), fks = foreignKeys(db), oldHistory = history(db);
    f.addTail(); f.deploy();
    assertSnapshot(db,rows); assert.deepEqual(tables(db),oldTables); assert.deepEqual(foreignKeys(db),fks);
    assert.deepEqual(indexes(db).filter(row => row.name !== contextIndex),oldIndexes);
    assert.equal(indexes(db).length,oldIndexes.length+1);
    assert.deepEqual(db.prepare(`PRAGMA index_info(${quote(contextIndex)})`).all().map(row => row.name),
      ['courseId','contextPublicationId','contextContentId','createdAt','id']);
    assert.deepEqual(db.prepare('SELECT * FROM _app_migrations WHERE name < ? ORDER BY name').all(tail),oldHistory);
    for (const row of db.prepare('SELECT "contextPublicationId","contextContentId" FROM "CourseQuestion"').all())
      assert.deepEqual({ ...row },{ contextPublicationId:null, contextContentId:null });
    const deployedHistory = history(db); f.deploy(); assert.deepEqual(history(db),deployedHistory); assertSnapshot(db,rows);
    assert.equal(await readyWithInvitationSuccessor(f),true);
    // Compatible rollback: old-column reads/writes continue with the longer schema retained.
    db.exec(`INSERT INTO "CourseQuestion" (id,"courseId","authorId","requestId",title,body,"updatedAt")
      VALUES ('old-image-write','course','learner','request-old-image','Course question','Old shape still works',CURRENT_TIMESTAMP)`);
    assert.equal(db.prepare(`SELECT "contextContentId" FROM "CourseQuestion" WHERE id='old-image-write'`).get().contextContentId,null);
    rmSync(join(f.migrations,tail));
    assert.throws(f.deploy,/0028_course_qa_lesson_context\.sql is not present in the image/);
    f.addTail(); f.deploy();
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally { db.close(); }
});

test('SQLite paired anchor check rejects both half-null inserts and updates; scalar provenance has no new FK', () => {
  const db = fixture();
  try {
    const insert = db.prepare(`INSERT INTO "CourseQuestion" (id,"courseId","authorId","requestId",title,body,"updatedAt","contextPublicationId","contextContentId")
      VALUES (?,'a','learner',?,'Question','Body',CURRENT_TIMESTAMP,?,?)`);
    for (const [publication,content] of [[null,'content'],['publication',null]]) {
      assert.throws(() => insert.run('invalid','invalid-request',publication,content),/CHECK constraint/);
    }
    insert.run('course-only','request-course-only',null,null);
    insert.run('anchored','request-anchored','historical-publication','historical-content');
    const update = db.prepare('UPDATE "CourseQuestion" SET "contextPublicationId"=?,"contextContentId"=? WHERE id=?');
    for (const id of ['course-only','anchored']) for (const pair of [[null,'content'],['publication',null]])
      assert.throws(() => update.run(...pair,id),/CHECK constraint/);
    update.run('other-publication','other-content','course-only'); update.run(null,null,'course-only');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_list("CourseQuestion")').all().map(row => row.from).sort(),['authorId','courseId']);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

for (const failure of ['after-first-column','index-collision']) {
  test(`SQLite new-tail ${failure} rolls back both columns/index/history and preserves populated predecessor`, () => {
    const f = predecessorFixture(); const { db } = f;
    try {
      if (failure === 'index-collision') db.exec(`CREATE INDEX ${quote(contextIndex)} ON "User" (id)`);
      const rows = snapshot(db), oldSchema = schema(db), oldHistory = history(db);
      const ddl = failure === 'after-first-column'
        ? tailSql.replace(';','; INSERT INTO "MissingContextFixture" VALUES (1);') : tailSql;
      writeFileSync(join(f.migrations,tail),ddl);
      assert.throws(f.deploy,failure === 'after-first-column' ? /no such table/ : /already exists/);
      assertSnapshot(db,rows); assert.deepEqual(schema(db),oldSchema); assert.deepEqual(history(db),oldHistory);
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM pragma_table_info('CourseQuestion') WHERE name IN ('contextPublicationId','contextContentId')`).get().n,0);
      if (failure === 'index-collision') db.exec(`DROP INDEX ${quote(contextIndex)}`);
      f.addTail(); f.deploy(); assertSnapshot(db,rows);
    } finally { db.close(); }
  });
}

test('SQLite lesson-context deploy refuses changed/missing tail, predecessor gap and unknown recorded history', async () => {
  const f = predecessorFixture(); const { db } = f;
  try {
    f.addTail(); f.deploy(); const before = history(db);
    writeFileSync(join(f.migrations,tail),`${tailSql}\n-- changed`); assert.throws(f.deploy,/checksum changed/); f.addTail();
    rmSync(join(f.migrations,tail)); assert.throws(f.deploy,/not present in the image/); f.addTail();
    const saved = db.prepare('SELECT * FROM _app_migrations WHERE name=?').get(predecessor);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run(predecessor);
    assert.throws(f.deploy,/gap before 0028_course_qa_lesson_context\.sql/);
    db.prepare('INSERT INTO _app_migrations (name,checksum,applied_at) VALUES (?,?,?)').run(saved.name,saved.checksum,saved.applied_at);
    db.exec(`INSERT INTO _app_migrations (name,checksum) VALUES ('0029_unreviewed_context.sql','unknown')`);
    await assert.rejects(assertCoursePublicationReady(f.url,'sqlite'),/history is missing, divergent or has changed checksums/);
    assert.throws(f.deploy,/not present in the image/);
    db.exec(`DELETE FROM _app_migrations WHERE name='0029_unreviewed_context.sql'`);
    assert.deepEqual(history(db),before); assert.equal(await readyWithInvitationSuccessor(f),true);
  } finally { db.close(); }
});
