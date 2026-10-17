import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { initializeSqlite } from './sqlite-init.mjs';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import testDatabase from './space-mission-test-database.cjs';

const root = new URL('../', import.meta.url);
const sqliteDirectory = new URL('prisma/sqlite-migrations/', root);
const postgresDirectory = new URL('prisma/postgresql-upgrades/', root);
const sqliteTail = '0027_space_mission_bookmarks.sql';
const postgresTail = '0026_space_mission_bookmarks.sql';
const sqliteSuccessor = '0028_course_qa_lesson_context.sql';
const postgresSuccessor = '0027_course_qa_lesson_context.sql';
const sqliteInvitationSuccessor = '0029_space_mission_invitations.sql';
const postgresInvitationSuccessor = '0028_space_mission_invitations.sql';
const sqliteCommunitySuccessor = '0030_community_bookmarks.sql';
const postgresCommunitySuccessor = '0029_community_bookmarks.sql';
const contextIndex = 'CourseQuestion_lesson_scope_page_idx';
const setting = 'SpaceMissionBookmarkSetting';
const access = 'SpaceMissionBookmarkAccess';
const bookmarkTables = [setting, access];
const bookmarkIndex = 'SpaceMissionBookmarkSetting_userId_savedAt_idx';
const names = directory => readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const sql = (name, directory = sqliteDirectory) => readFileSync(new URL(name, directory), 'utf8');
const checksum = value => createHash('sha256').update(value).digest('hex');
const historyFailure = /history is missing, divergent or has changed checksums/;
const quote = name => `"${name.replaceAll('"', '""')}"`;
const seedSql = `INSERT INTO "User" (id,email,"updatedAt") VALUES
  ('a','a@example.invalid',CURRENT_TIMESTAMP),('b','b@example.invalid',CURRENT_TIMESTAMP),
  ('observer','observer@example.invalid',CURRENT_TIMESTAMP);
  INSERT INTO "Space" (id,name,description,visibility,"updatedAt") VALUES
    ('s','Private','Keep topic','PRIVATE',CURRENT_TIMESTAMP),('t','Other Space','Keep other topic','PRIVATE',CURRENT_TIMESTAMP);
  INSERT INTO "SpaceMember" ("spaceId","userId") VALUES ('s','a'),('s','b'),('t','a');
  INSERT INTO "SpaceMission" (id,"spaceId","creatorId","requestId","payloadDigest",title,prompt,
    "weekStartsOn","weekTimezone","weekStartsAt","weekEndsAt") VALUES
    ('m','s','a','request','legacy-digest','Existing relay','Original prompt',
      '2026-10-19','Europe/Berlin','2026-10-18 22:00:00','2026-10-25 23:00:00'),
    ('other','t','a','other-request','other-digest','Other relay','Other prompt',NULL,NULL,NULL,NULL);
  INSERT INTO "SpaceMissionParticipation" ("missionId","userId",epoch) VALUES ('m','a',1),('m','b',2);
  INSERT INTO "SpaceMissionContribution" (id,"missionId","authorId",epoch,kind,content,"targetContributionId","requestId","payloadDigest") VALUES
    ('insight','m','a',1,'INSIGHT','Keep this insight',NULL,'insight','digest'),
    ('build','m','b',2,'BUILD_ON','Keep this build-on','insight','build','digest');`;

function fixture({ predecessor = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-mission-bookmarks-'));
  const migrations = join(dir, 'migrations'); mkdirSync(migrations);
  const addFiles = files => {
    for (const name of files) writeFileSync(join(migrations, name), sql(name));
  };
  addFiles(names(sqliteDirectory).filter(name => !predecessor || name < sqliteTail));
  const url = `file:${join(dir, 'test.db')}`;
  const deploy = () => {
    const previous = process.env.DATABASE_PROVIDER; process.env.DATABASE_PROVIDER = 'sqlite';
    try { initializeSqlite(url, migrations); }
    finally { if (previous === undefined) delete process.env.DATABASE_PROVIDER; else process.env.DATABASE_PROVIDER = previous; }
  };
  deploy();
  return { url, migrations, deploy, addTail: () => addFiles([sqliteTail]),
    addSuccessor: () => addFiles(names(sqliteDirectory).filter(name => name >= sqliteSuccessor)),
    open: () => { const db = new DatabaseSync(url.slice(5)); db.exec('PRAGMA foreign_keys=ON'); return db; } };
}

function sqliteRows(db, { includeBookmarks = false } = {}) {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  return Object.fromEntries(tables.filter(({ name }) => name !== '_app_migrations' &&
    (includeBookmarks || !bookmarkTables.includes(name))).map(({ name }) => [name,
    db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all()]));
}
const sqliteSchema = db => db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_%' AND tbl_name NOT IN ('SpaceMissionBookmarkSetting','SpaceMissionBookmarkAccess')
  ORDER BY type,name`).all();
const sqliteHistory = db => db.prepare('SELECT * FROM _app_migrations ORDER BY name').all();
const sqliteIntegrity = db => {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
};

test('paired bookmark tails create only the two private sidecars with provider-equivalent keys, checks and user-leading index', () => {
  assert.deepEqual(names(sqliteDirectory).slice(-5), ['0026_space_mission_week.sql', sqliteTail, sqliteSuccessor, sqliteInvitationSuccessor, sqliteCommunitySuccessor]);
  assert.deepEqual(names(postgresDirectory).slice(-5), ['0025_space_mission_week.sql', postgresTail, postgresSuccessor, postgresInvitationSuccessor, postgresCommunitySuccessor]);
  const sqlite = sql(sqliteTail); const postgres = sql(postgresTail, postgresDirectory);
  assert.equal(sqlite.replaceAll('DATETIME', 'TIMESTAMP(3)').replace(/typeof\("(?:revision|epoch)"\) = 'integer' AND /g, ''), postgres);
  for (const ddl of [sqlite, postgres]) {
    const statements = ddl.replace(/^--.*$/gm, '').replaceAll('ON DELETE', '').replaceAll('ON UPDATE', '');
    assert.ok(!/\b(?:DROP|ALTER|UPDATE|DELETE|INSERT|RENAME)\b/i.test(statements));
    assert.deepEqual([...ddl.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]), bookmarkTables);
    assert.match(ddl, /PRIMARY KEY \("missionId", "userId"\)/);
    assert.match(ddl, /PRIMARY KEY \("userId"\)/);
    assert.match(ddl, /"revision" > 0 AND "revision" <= 2147483647/);
    assert.match(ddl, /"epoch" >= 0 AND "epoch" <= 2147483647/);
    assert.match(ddl, /CREATE INDEX "SpaceMissionBookmarkSetting_userId_savedAt_idx" ON "SpaceMissionBookmarkSetting" \("userId", "savedAt"\)/);
    assert.equal([...ddl.matchAll(/ON DELETE CASCADE ON UPDATE CASCADE/g)].length, 3);
  }
});

test('fresh SQLite migration creates empty, narrowly shaped bookmark storage and readiness stays write-free', async () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql);
    assert.deepEqual(db.prepare(`PRAGMA table_info("${setting}")`).all().map(row => [row.name, row.type, row.notnull, row.pk]),
      [['missionId','TEXT',1,1], ['userId','TEXT',1,2], ['savedAt','DATETIME',0,0], ['revision','INTEGER',1,0]]);
    assert.deepEqual(db.prepare(`PRAGMA table_info("${access}")`).all().map(row => [row.name, row.type, row.notnull, row.pk]),
      [['userId','TEXT',1,1], ['epoch','INTEGER',1,0]]);
    for (const table of bookmarkTables) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get().n, 0);
    assert.deepEqual(db.prepare(`PRAGMA index_info("${bookmarkIndex}")`).all().map(row => row.name), ['userId', 'savedAt']);
    for (const [table, expected] of [[setting, [['missionId','SpaceMission'],['userId','User']]], [access, [['userId','User']]]]) {
      const fks = db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all();
      assert.deepEqual(fks.map(row => [row.from,row.table]).sort(), expected.sort());
      for (const fk of fks) assert.equal(`${fk.to}/${fk.on_delete}/${fk.on_update}`, 'id/CASCADE/CASCADE');
    }
    const before = sqliteRows(db, { includeBookmarks: true }); const history = sqliteHistory(db);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
    assert.deepEqual(sqliteRows(db, { includeBookmarks: true }), before);
    assert.deepEqual(sqliteHistory(db), history);
    sqliteIntegrity(db);
  } finally { db.close(); }
});

test('SQLite readiness rejects missing bookmark tables and every required column even when all history checksums remain valid', async () => {
  const f = fixture(); const db = f.open();
  const schemaFailure = /Bookmark schema is missing or incomplete; startup refused/;
  try {
    const history = sqliteHistory(db);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
    for (const table of bookmarkTables) {
      const temporary = `${table}_readiness_missing`;
      db.exec(`ALTER TABLE ${quote(table)} RENAME TO ${quote(temporary)}`);
      try { await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), schemaFailure, `missing table ${table}`); }
      finally { db.exec(`ALTER TABLE ${quote(temporary)} RENAME TO ${quote(table)}`); }
    }
    for (const [table, fields] of [[setting, ['missionId','userId','savedAt','revision']], [access, ['userId','epoch']]]) {
      for (const field of fields) {
        const temporary = `${field}_readiness_missing`;
        db.exec(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(field)} TO ${quote(temporary)}`);
        try { await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), schemaFailure, `missing column ${table}.${field}`); }
        finally { db.exec(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(temporary)} TO ${quote(field)}`); }
      }
    }
    assert.deepEqual(sqliteHistory(db), history);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); sqliteIntegrity(db);
  } finally { db.close(); }
});

test('SQLite enforces composite/account keys, missing-parent FKs and provider-safe integer revision/epoch on inserts and updates', () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql);
    const save = db.prepare(`INSERT INTO "${setting}" ("missionId","userId","savedAt",revision) VALUES (?,?,?,?)`);
    for (const invalid of [0, -1, 2147483648, 1.5, 'not-an-integer', null]) {
      assert.throws(() => save.run('m','a',null,invalid), /CHECK|NOT NULL/, String(invalid));
    }
    for (const [mission, user] of [['missing','a'], ['m','missing']]) assert.throws(() => save.run(mission,user,null,1), /FOREIGN KEY/);
    for (const [mission, user] of [[null,'a'], ['m',null]]) assert.throws(() => save.run(mission,user,null,1), /NOT NULL/);
    save.run('m','a',null,1); save.run('m','b','2026-10-19 12:00:00',2147483647); save.run('other','a',0,1);
    assert.throws(() => save.run('m','a',null,2), /UNIQUE/);
    for (const invalid of [0, -1, 2147483648, 1.5, 'not-an-integer', null]) {
      assert.throws(() => db.prepare(`UPDATE "${setting}" SET revision=? WHERE "missionId"='m' AND "userId"='a'`).run(invalid), /CHECK|NOT NULL/);
    }
    const fence = db.prepare(`INSERT INTO "${access}" ("userId",epoch) VALUES (?,?)`);
    for (const invalid of [-1, 2147483648, 1.5, 'not-an-integer', null]) assert.throws(() => fence.run('a',invalid), /CHECK|NOT NULL/);
    assert.throws(() => fence.run('missing',0), /FOREIGN KEY/); assert.throws(() => fence.run(null,0), /NOT NULL/);
    fence.run('a',0); fence.run('b',2147483647); assert.throws(() => fence.run('a',1), /UNIQUE/);
    for (const invalid of [-1, 2147483648, 1.5, 'not-an-integer', null]) {
      assert.throws(() => db.prepare(`UPDATE "${access}" SET epoch=? WHERE "userId"='a'`).run(invalid), /CHECK|NOT NULL/);
    }
    assert.throws(() => db.exec(`UPDATE "${setting}" SET revision=revision+1 WHERE "userId"='b'`), /CHECK/);
    assert.throws(() => db.exec(`UPDATE "${access}" SET epoch=epoch+1 WHERE "userId"='b'`), /CHECK/);
    sqliteIntegrity(db);
  } finally { db.close(); }
});

test('SQLite unsave tombstones persist without participation; mission/account cascades remove only their own bookmark state', () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql);
    const before = sqliteRows(db);
    db.exec(`INSERT INTO "${setting}" ("missionId","userId","savedAt",revision) VALUES
      ('m','observer',CURRENT_TIMESTAMP,1),('m','b',CURRENT_TIMESTAMP,1),('other','observer',CURRENT_TIMESTAMP,3),('other','b',CURRENT_TIMESTAMP,1);
      INSERT INTO "${access}" ("userId",epoch) VALUES ('observer',2),('b',4);
      UPDATE "${setting}" SET "savedAt"=NULL,revision=revision+1 WHERE "missionId"='m' AND "userId"='observer';`);
    assert.deepEqual({ ...db.prepare(`SELECT "savedAt",revision FROM "${setting}" WHERE "missionId"='m' AND "userId"='observer'`).get() },
      { savedAt: null, revision: 2 });
    assert.deepEqual(sqliteRows(db), before);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM "SpaceMissionParticipation" WHERE "userId"='observer'`).get().n, 0);
    assert.throws(() => db.exec(`DELETE FROM "Space" WHERE id='s'`), /FOREIGN KEY/);
    db.exec(`DELETE FROM "User" WHERE id='observer'`);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM "${setting}" WHERE "userId"='observer'`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM "${access}" WHERE "userId"='observer'`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM "${setting}" WHERE "userId"='b'`).get().n, 2);
    db.exec(`DELETE FROM "SpaceMission" WHERE id='m'`);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM "${setting}" WHERE "missionId"='m'`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM "${setting}" WHERE "missionId"='other' AND "userId"='b'`).get().n, 1);
    assert.equal(db.prepare(`SELECT epoch FROM "${access}" WHERE "userId"='b'`).get().epoch, 4);
    sqliteIntegrity(db);
  } finally { db.close(); }
});

test('populated SQLite predecessor upgrade preserves every old row, table/index definition and tracked checksum', async () => {
  const f = fixture({ predecessor: true }); const db = f.open();
  try {
    db.exec(seedSql);
    const rows = sqliteRows(db); const schema = sqliteSchema(db); const history = sqliteHistory(db);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    f.addTail(); f.deploy(); f.deploy();
    assert.deepEqual(sqliteRows(db), rows); assert.deepEqual(sqliteSchema(db), schema);
    assert.deepEqual(db.prepare('SELECT * FROM _app_migrations WHERE name < ? ORDER BY name').all(sqliteTail), history);
    assert.equal(db.prepare('SELECT checksum FROM _app_migrations WHERE name=?').get(sqliteTail).checksum, checksum(sql(sqliteTail)));
    for (const table of bookmarkTables) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get().n, 0);
    // Preserve the bookmark-only checkpoint above before applying any successor.
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    f.addSuccessor(); f.deploy();
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); sqliteIntegrity(db);
  } finally { db.close(); }
});

test('SQLite bookmark DDL failure rolls back both sidecars, their index and history while preserving populated predecessor', async () => {
  const f = fixture({ predecessor: true }); const db = f.open();
  try {
    db.exec(seedSql); const rows = sqliteRows(db); const schema = sqliteSchema(db); const history = sqliteHistory(db);
    writeFileSync(join(f.migrations, sqliteTail), `${sql(sqliteTail)}\nINSERT INTO "MissingBookmarkTestTable" VALUES (1);`);
    assert.throws(f.deploy, /no such table/);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'SpaceMissionBookmark%'`).get().n, 0);
    assert.deepEqual(sqliteRows(db), rows); assert.deepEqual(sqliteSchema(db), schema); assert.deepEqual(sqliteHistory(db), history);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    f.addTail(); f.deploy();
    assert.deepEqual(sqliteRows(db), rows); assert.deepEqual(sqliteSchema(db), schema);
    assert.deepEqual(db.prepare('SELECT * FROM _app_migrations WHERE name < ? ORDER BY name').all(sqliteTail), history);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    f.addSuccessor(); f.deploy();
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); sqliteIntegrity(db);
  } finally { db.close(); }
});

test('SQLite bookmark readiness/deployment fail closed for missing, tampered, gapped, unknown and old-image history', async () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql); const rows = sqliteRows(db); const schema = sqliteSchema(db);
    const expected = checksum(sql(sqliteTail));
    db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run('tampered',sqliteTail);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure); assert.throws(f.deploy, /checksum changed/);
    db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run(expected,sqliteTail);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run('0026_space_mission_week.sql');
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    assert.throws(f.deploy, /gap before 0027_space_mission_bookmarks\.sql/);
    db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run('0026_space_mission_week.sql',checksum(sql('0026_space_mission_week.sql')));
    const savedTails = db.prepare('SELECT * FROM _app_migrations WHERE name IN (?,?,?,?) ORDER BY name').all(sqliteTail,sqliteSuccessor,sqliteInvitationSuccessor,sqliteCommunitySuccessor);
    assert.equal(savedTails.length,4);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run(sqliteTail);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    assert.throws(f.deploy, /gap before 0028_course_qa_lesson_context\.sql/);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run(sqliteSuccessor);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    assert.throws(f.deploy, /gap before 0029_space_mission_invitations\.sql/);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run(sqliteInvitationSuccessor);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    assert.throws(f.deploy, /gap before 0030_community_bookmarks\.sql/);
    // Only after removing every saved successor receipt may the original
    // duplicate-DDL guard run. Restore every checksum/applied_at afterwards.
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run(sqliteCommunitySuccessor);
    assert.throws(f.deploy, /already exists/);
    for (const row of savedTails) db.prepare('INSERT INTO _app_migrations (name,checksum,applied_at) VALUES (?,?,?)')
      .run(row.name,row.checksum,row.applied_at);
    assert.deepEqual(db.prepare('SELECT * FROM _app_migrations WHERE name IN (?,?,?,?) ORDER BY name').all(sqliteTail,sqliteSuccessor,sqliteInvitationSuccessor,sqliteCommunitySuccessor),savedTails);
    db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run('0028_unreviewed_bookmarks.sql','unknown');
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure); assert.throws(f.deploy, /not present in the image/);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run('0028_unreviewed_bookmarks.sql');
    const old = fixture({ predecessor: true });
    const previous = process.env.DATABASE_PROVIDER; process.env.DATABASE_PROVIDER = 'sqlite';
    try { assert.throws(() => initializeSqlite(f.url, old.migrations), /0027_space_mission_bookmarks\.sql is not present in the image/); }
    finally { if (previous === undefined) delete process.env.DATABASE_PROVIDER; else process.env.DATABASE_PROVIDER = previous; }
    assert.deepEqual(sqliteRows(db), rows); assert.deepEqual(sqliteSchema(db), schema);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); sqliteIntegrity(db);
  } finally { db.close(); }
});

// Validate the original authority before opening any connection. Only a local,
// explicitly disposable forge_test database is eligible. Every object written
// below belongs to a new random schema; public is never reset or inspected.
const pgUrl = process.env.POSTGRESQL_RELEASE_GATE_DISPOSABLE === '1'
  ? testDatabase.disposablePostgresqlTestUrl(process.env.DATABASE_URL) : null;
async function withPostgres(run) {
  const db = new pg.Client({ connectionString: pgUrl });
  const schema = `forge_mission_bookmarks_${randomUUID().replaceAll('-', '_')}`;
  const url = new URL(pgUrl); url.searchParams.set('schema',schema);
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA ${quote(schema)}`); await db.query(`SET search_path TO ${quote(schema)}`);
    await run(db,url.toString());
  } finally { try { await db.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`); } finally { await db.end(); } }
}
async function postgresPredecessor(db) {
  await db.query(readFileSync(new URL('prisma/postgresql-baselines/0000_main_7814799.sql', root), 'utf8'));
  await db.query('CREATE TABLE "_app_schema_upgrades" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of names(postgresDirectory).filter(name => name < postgresTail)) {
    const ddl = sql(name,postgresDirectory);
    if (name !== '0001_skill_endorsements.sql') await db.query(ddl);
    await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)',[name,checksum(ddl)]);
  }
}
async function postgresRows(db, { predecessorInventory = false } = {}) {
  const tables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name`)).rows;
  const result = {};
  for (const { table_name: name } of tables) {
    if (name === '_app_schema_upgrades' || bookmarkTables.includes(name) || name.startsWith('SpaceMissionInvitation') || (predecessorInventory && name === 'CommunityBookmark')) continue;
    result[name] = (await db.query(`SELECT ${name === 'SpaceMission' ? "to_jsonb(t) - 'invitationAttemptCount'" : 'to_jsonb(t)'} AS row FROM ${quote(name)} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
const postgresHistory = async db => (await db.query('SELECT * FROM "_app_schema_upgrades" ORDER BY name')).rows;
const pgError = (...codes) => error => codes.includes(error.code);

test('PostgreSQL fresh deployment enforces bookmark keys, FKs, nullability and bounded integers without participation side effects', { skip: !pgUrl }, async () => {
  await withPostgres(async (db,url) => {
    await applyPostgresqlUpgrades(url,{ initializeEmptySchema: true }); await applyPostgresqlUpgrades(url);
    await db.query(seedSql); const before = await postgresRows(db);
    for (const table of bookmarkTables) assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM ${quote(table)}`)).rows[0].n),0);
    const columns = (await db.query(`SELECT table_name,column_name,data_type,is_nullable,datetime_precision FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`,[bookmarkTables])).rows;
    assert.deepEqual(columns.filter(row => row.table_name === setting).map(row => [row.column_name,row.data_type,row.is_nullable]),
      [['missionId','text','NO'],['userId','text','NO'],['savedAt','timestamp without time zone','YES'],['revision','integer','NO']]);
    assert.equal(columns.find(row => row.column_name === 'savedAt').datetime_precision,3);
    assert.deepEqual(columns.filter(row => row.table_name === access).map(row => [row.column_name,row.data_type,row.is_nullable]),
      [['userId','text','NO'],['epoch','integer','NO']]);
    const index = (await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname=$1`,[bookmarkIndex])).rows;
    assert.equal(index.length,1); assert.match(index[0].indexdef,/\("userId", "savedAt"\)/);
    const save = (mission,user,revision,savedAt = null) => db.query(`INSERT INTO "${setting}" ("missionId","userId",revision,"savedAt") VALUES ($1,$2,$3,$4)`,[mission,user,revision,savedAt]);
    for (const invalid of [0,-1,2147483648,1.5,'not-an-integer',null]) await assert.rejects(save('m','observer',invalid),pgError('23514','23502','22003','22P02'));
    for (const [mission,user] of [['missing','observer'],['m','missing']]) await assert.rejects(save(mission,user,1),pgError('23503'));
    for (const [mission,user] of [[null,'observer'],['m',null]]) await assert.rejects(save(mission,user,1),pgError('23502'));
    await save('m','observer',1,'2026-10-19T12:00:00.123Z'); await save('m','b',2147483647);
    await save('other','observer',1,'2026-10-19T12:00:00.123Z'); await save('other','b',1,'2026-10-19T12:00:00.123Z');
    await assert.rejects(save('m','observer',2),pgError('23505'));
    const fence = (user,epoch) => db.query(`INSERT INTO "${access}" ("userId",epoch) VALUES ($1,$2)`,[user,epoch]);
    for (const invalid of [-1,2147483648,1.5,'not-an-integer',null]) await assert.rejects(fence('observer',invalid),pgError('23514','23502','22003','22P02'));
    await assert.rejects(fence('missing',0),pgError('23503')); await assert.rejects(fence(null,0),pgError('23502'));
    await fence('observer',0); await fence('b',2147483647); await assert.rejects(fence('observer',1),pgError('23505'));
    for (const invalid of [0,-1,2147483648,1.5,'not-an-integer',null]) {
      await assert.rejects(db.query(`UPDATE "${setting}" SET revision=$1 WHERE "missionId"='m' AND "userId"='observer'`,[invalid]),pgError('23514','23502','22003','22P02'));
    }
    for (const invalid of [-1,2147483648,1.5,'not-an-integer',null]) {
      await assert.rejects(db.query(`UPDATE "${access}" SET epoch=$1 WHERE "userId"='observer'`,[invalid]),pgError('23514','23502','22003','22P02'));
    }
    await assert.rejects(db.query(`UPDATE "${setting}" SET revision=revision+1 WHERE "userId"='b'`),pgError('22003'));
    await assert.rejects(db.query(`UPDATE "${access}" SET epoch=epoch+1 WHERE "userId"='b'`),pgError('22003'));
    await db.query(`UPDATE "${setting}" SET "savedAt"=NULL,revision=revision+1 WHERE "missionId"='m' AND "userId"='observer'`);
    assert.deepEqual((await db.query(`SELECT "savedAt",revision FROM "${setting}" WHERE "missionId"='m' AND "userId"='observer'`)).rows,[{ savedAt: null, revision: 2 }]);
    assert.deepEqual(await postgresRows(db),before);
    const history = await postgresHistory(db);
    assert.equal(await assertCoursePublicationReady(url,'postgresql'),true); assert.deepEqual(await postgresHistory(db),history);
    await assert.rejects(db.query(`DELETE FROM "Space" WHERE id='s'`),pgError('23503'));
    await db.query(`DELETE FROM "User" WHERE id='observer'`);
    for (const table of bookmarkTables) assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM ${quote(table)} WHERE "userId"='observer'`)).rows[0].n),0);
    assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM "${setting}" WHERE "userId"='b'`)).rows[0].n),2);
    await db.query(`DELETE FROM "SpaceMission" WHERE id='m'`);
    assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM "${setting}" WHERE "missionId"='m'`)).rows[0].n),0);
    assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM "${setting}" WHERE "missionId"='other' AND "userId"='b'`)).rows[0].n),1);
    assert.equal((await db.query(`SELECT epoch FROM "${access}" WHERE "userId"='b'`)).rows[0].epoch,2147483647);
  });
});

test('PostgreSQL populated predecessor upgrade preserves all old rows/indexes/checksums and fails closed on altered history', { skip: !pgUrl }, async () => {
  await withPostgres(async (db,url) => {
    await postgresPredecessor(db); await db.query(seedSql);
    const rows = await postgresRows(db, { predecessorInventory: true }); const history = await postgresHistory(db);
    const indexes = (await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY indexname`)).rows;
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure);
    await applyPostgresqlUpgrades(url); await applyPostgresqlUpgrades(url);
    assert.deepEqual(await postgresRows(db, { predecessorInventory: true }),rows);
    assert.equal(Number((await db.query('SELECT COUNT(*) n FROM "CommunityBookmark"')).rows[0].n),0);
    assert.deepEqual((await db.query('SELECT * FROM "_app_schema_upgrades" WHERE name < $1 ORDER BY name',[postgresTail])).rows,history);
    const currentIndexes = (await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema()
      AND tablename NOT IN ('SpaceMissionBookmarkSetting','SpaceMissionBookmarkAccess','CommunityBookmark') AND tablename NOT LIKE 'SpaceMissionInvitation%' ORDER BY indexname`)).rows;
    assert.deepEqual(currentIndexes.filter(row => row.indexname !== contextIndex),indexes);
    assert.equal(currentIndexes.length,indexes.length+1);
    assert.match(currentIndexes.find(row => row.indexname === contextIndex)?.indexdef ?? '',
      /ON .*"CourseQuestion" USING btree \("courseId", "contextPublicationId", "contextContentId", "createdAt", id\)/);
    for (const table of bookmarkTables) assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM ${quote(table)}`)).rows[0].n),0);
    const expected = checksum(sql(postgresTail,postgresDirectory));
    await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2',['tampered',postgresTail]);
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure); await assert.rejects(applyPostgresqlUpgrades(url),/history mismatch/);
    await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2',[expected,postgresTail]);
    await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',['0025_space_mission_week.sql']);
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure); await assert.rejects(applyPostgresqlUpgrades(url),/gap before 0026_space_mission_bookmarks\.sql/);
    await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)',['0025_space_mission_week.sql',checksum(sql('0025_space_mission_week.sql',postgresDirectory))]);
    const savedTails = (await db.query('SELECT name,checksum,applied_at::text AS applied_at FROM "_app_schema_upgrades" WHERE name=ANY($1::text[]) ORDER BY name',[[postgresTail,postgresSuccessor,postgresInvitationSuccessor,postgresCommunitySuccessor]])).rows;
    assert.equal(savedTails.length,4);
    await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',[postgresTail]);
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure);
    await assert.rejects(applyPostgresqlUpgrades(url),/gap before 0027_course_qa_lesson_context\.sql/);
    await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',[postgresSuccessor]);
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure);
    await assert.rejects(applyPostgresqlUpgrades(url),/gap before 0028_space_mission_invitations\.sql/);
    await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',[postgresInvitationSuccessor]);
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure);
    await assert.rejects(applyPostgresqlUpgrades(url),/gap before 0029_community_bookmarks\.sql/);
    await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',[postgresCommunitySuccessor]);
    await assert.rejects(applyPostgresqlUpgrades(url),pgError('42P07'));
    for (const row of savedTails) await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum,applied_at) VALUES ($1,$2,$3)',
      [row.name,row.checksum,row.applied_at]);
    assert.deepEqual((await db.query('SELECT name,checksum,applied_at::text AS applied_at FROM "_app_schema_upgrades" WHERE name=ANY($1::text[]) ORDER BY name',[[postgresTail,postgresSuccessor,postgresInvitationSuccessor,postgresCommunitySuccessor]])).rows,savedTails);
    await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)',['0027_unreviewed_bookmarks.sql','unknown']);
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure); await assert.rejects(applyPostgresqlUpgrades(url),/history mismatch/);
    await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',['0027_unreviewed_bookmarks.sql']);
    assert.equal(await assertCoursePublicationReady(url,'postgresql'),true); assert.deepEqual(await postgresRows(db, { predecessorInventory: true }),rows);
  });
});

test('PostgreSQL bookmark deployment rolls back new DDL/history after a late index collision and preserves predecessor data', { skip: !pgUrl }, async () => {
  await withPostgres(async (db,url) => {
    await postgresPredecessor(db); await db.query(seedSql);
    const rows = await postgresRows(db); const history = await postgresHistory(db);
    // A schema-local collision fails after CREATE TABLE, without editing a
    // reviewed SQL file or ever touching public or another test's objects.
    await db.query(`CREATE INDEX ${quote(bookmarkIndex)} ON "User" (id)`);
    await assert.rejects(applyPostgresqlUpgrades(url),pgError('42P07'));
    assert.deepEqual((await db.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`,[bookmarkTables])).rows,[]);
    assert.equal((await db.query(`SELECT tablename FROM pg_indexes WHERE schemaname=current_schema() AND indexname=$1`,[bookmarkIndex])).rows[0].tablename,'User');
    assert.deepEqual(await postgresRows(db),rows); assert.deepEqual(await postgresHistory(db),history);
    await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure);
  });
});
