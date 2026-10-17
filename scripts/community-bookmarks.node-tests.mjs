import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { initializeSqlite as applySqliteMigrations, sqlitePath } from './sqlite-init.mjs';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import { inspectCommunityBookmarkStorage } from './community-bookmark-storage.mjs';
import testDatabase from './space-mission-test-database.cjs';

function initializeSqlite(url, directory) {
  const previous = process.env.DATABASE_PROVIDER;
  process.env.DATABASE_PROVIDER = 'sqlite';
  try { return applySqliteMigrations(url, directory); }
  finally { if (previous === undefined) delete process.env.DATABASE_PROVIDER; else process.env.DATABASE_PROVIDER = previous; }
}
const sqliteTail = '0030_community_bookmarks.sql';
const pgTail = '0029_community_bookmarks.sql';
const sqliteNames = readdirSync(new URL('../prisma/sqlite-migrations/', import.meta.url)).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
assert.equal(sqliteNames.at(-1), sqliteTail);
const sqliteDdl = readFileSync(new URL(`../prisma/sqlite-migrations/${sqliteTail}`, import.meta.url), 'utf8');
function fixture(previous = false) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-community-bookmarks-migration-')); const migrations = join(dir, 'migrations'); mkdirSync(migrations);
  for (const name of previous ? sqliteNames.slice(0, -1) : sqliteNames) copyFileSync(new URL(`../prisma/sqlite-migrations/${name}`, import.meta.url), join(migrations, name));
  const url = `file:${join(dir, 'test.db')}`; initializeSqlite(url, migrations);
  const db = new DatabaseSync(sqlitePath(url)); db.exec('PRAGMA foreign_keys=ON');
  return { db, url, migrations };
}
function seedSqlite(db) {
  db.exec(`INSERT INTO "User" ("id","email","updatedAt") VALUES ('owner','owner@example.invalid',CURRENT_TIMESTAMP),('peer','peer@example.invalid',CURRENT_TIMESTAMP);
    INSERT INTO "Post" ("id","title","content","published","authorId","updatedAt") VALUES ('post','Kept title','Kept content',1,'owner',CURRENT_TIMESTAMP);
    INSERT INTO "Comment" ("id","content","postId","authorId","updatedAt") VALUES ('comment','Kept answer','post','peer',CURRENT_TIMESTAMP);`);
}
test('numbered community bookmark tails are additive and omit destructive scope changes', () => {
  const pgDdl = readFileSync(new URL(`../prisma/postgresql-upgrades/${pgTail}`, import.meta.url), 'utf8');
  for (const sql of [sqliteDdl, pgDdl]) {
    assert.doesNotMatch(sql, /\b(?:DROP|DELETE|UPDATE|ALTER)\b\s+(?:TABLE|SCHEMA|"?(?:User|Post|Comment)"?)\b/i);
    assert.doesNotMatch(sql, /CREATE\s+TRIGGER|public\.|CREATE\s+SCHEMA|search_path/i);
    assert.match(sql, /CommunityBookmark_target_shape/); assert.match(sql, /CommunityBookmark_revision_shape/);
  }
});
test('populated invitation predecessor upgrades without content loss, receipts remain idempotent', async () => {
  const f = fixture(true);
  try {
    seedSqlite(f.db); const before = f.db.prepare('SELECT id,title,content,published,authorId FROM "Post"').all();
    copyFileSync(new URL(`../prisma/sqlite-migrations/${sqliteTail}`, import.meta.url), join(f.migrations, sqliteTail)); initializeSqlite(f.url, f.migrations); initializeSqlite(f.url, f.migrations);
    assert.deepEqual(f.db.prepare('SELECT id,title,content,published,authorId FROM "Post"').all(), before);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM "CommunityBookmark"').get().n, 0);
    const receipt = f.db.prepare('SELECT checksum FROM _app_migrations WHERE name=?').get(sqliteTail); assert.equal(receipt.checksum, createHash('sha256').update(sqliteDdl).digest('hex'));
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
  } finally { f.db.close(); }
});
test('actual SQLite tail enforces shapes, uniqueness, FK and complete account/target tombstone cleanup', async () => {
  const f = fixture();
  try {
    seedSqlite(f.db);
    const insert = f.db.prepare('INSERT INTO "CommunityBookmark" (id,userId,postId,commentId,savedAt,revision,lastRequestId,lastExpectedRevision) VALUES (?,?,?,?,?,?,?,?)');
    const row = ['b','owner','post',null,null,1,randomUUID(),0]; insert.run(...row);
    for (const values of [['dup',...row.slice(1)], ['none','owner',null,null,null,1,randomUUID(),0], ['both','peer','post','comment',null,1,randomUUID(),0], ['missing','owner','gone',null,null,1,randomUUID(),0], ['bad','peer',null,'comment',null,0,randomUUID(),0]]) assert.throws(() => insert.run(...values), /constraint|FOREIGN|UNIQUE/i);
    insert.run('c','peer',null,'comment',null,1,randomUUID(),0);
    f.db.exec('DELETE FROM "User" WHERE id=\'owner\''); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM "CommunityBookmark"').get().n,0);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]); assert.equal(await assertCoursePublicationReady(f.url,'sqlite'),true);
  } finally { f.db.close(); }
});
for (const [name, mutate] of [
  ['missing table with valid receipts', db => db.exec('DROP TABLE "CommunityBookmark"')],
  ['index moved to wrong table', db => db.exec('DROP INDEX "CommunityBookmark_postId_idx"; CREATE INDEX "CommunityBookmark_postId_idx" ON "Post"("id")')],
  ['missing composite uniqueness', db => db.exec('DROP INDEX "CommunityBookmark_userId_postId_key"')],
  ['weakened target CHECK', db => { db.exec('DROP TABLE "CommunityBookmark"'); db.exec(sqliteDdl.replace(/CONSTRAINT "CommunityBookmark_target_shape" CHECK \([^\n]+\),/, 'CONSTRAINT "CommunityBookmark_target_shape" CHECK (1),')); }],
  ['changed nullable/default shape', db => { db.exec('DROP TABLE "CommunityBookmark"'); db.exec(sqliteDdl.replace('"lastRequestId" TEXT NOT NULL', '"lastRequestId" TEXT DEFAULT \'changed\'')); }],
  ['missing receipt', db => db.prepare('DELETE FROM _app_migrations WHERE name=?').run(sqliteTail)],
  ['tampered receipt', db => db.prepare('UPDATE _app_migrations SET checksum=\'changed\' WHERE name=?').run(sqliteTail)],
]) test(`readiness rejects ${name}`, async () => {
  const f=fixture();try { assert.equal(await assertCoursePublicationReady(f.url,'sqlite'),true); mutate(f.db); await assert.rejects(assertCoursePublicationReady(f.url,'sqlite'), /bookmark|history|migration/i); } finally { f.db.close(); }
});

// Metadata-fixture tests execute the actual PostgreSQL inspector without a DB.
// They do not claim that a real PostgreSQL server was exercised.
const postgresDdl = readFileSync(new URL(`../prisma/postgresql-upgrades/${pgTail}`, import.meta.url), 'utf8');
function postgresInspectorMetadata(){
  const shapes={id:['text','NO',null],userId:['text','NO',null],postId:['text','YES',null],commentId:['text','YES',null],savedAt:['timestamp without time zone','YES',null],revision:['integer','NO','1'],lastRequestId:['text','NO',null],lastExpectedRevision:['integer','NO',null]};
  const columns=Object.entries(shapes).map(([column_name,[data_type,is_nullable,column_default]])=>({column_name,data_type,is_nullable,column_default,datetime_precision:column_name==='savedAt'?3:null,is_identity:'NO',is_generated:'NEVER',domain_schema:null,domain_name:null,native_type:true,type_kind:'b'}));
  const constraints=[{conname:'CommunityBookmark_pkey',contype:'p',convalidated:true,condeferrable:false,columns:['id']}];
  for(const match of postgresDdl.matchAll(/CONSTRAINT "([^"]+)" CHECK \(/g)){
    const start=match.index+match[0].length-1;let end=start+1,depth=1;
    while(depth){if(postgresDdl[end]==='(')depth++;if(postgresDdl[end]===')')depth--;end++;}
    constraints.push({conname:match[1],contype:'c',convalidated:true,condeferrable:false,definition:`CHECK ${postgresDdl.slice(start,end)}`});
  }
  for(const [field,target] of [['userId','User'],['postId','Post'],['commentId','Comment']])constraints.push({conname:`CommunityBookmark_${field}_fkey`,contype:'f',convalidated:true,condeferrable:false,condeferred:false,confdeltype:'c',confupdtype:'c',reference_table:target,reference_schema:true,columns:[field],reference_columns:['id']});
  const indexes=[['CommunityBookmark_pkey',['id'],true,true],['CommunityBookmark_userId_postId_key',['userId','postId'],true,false],['CommunityBookmark_userId_commentId_key',['userId','commentId'],true,false],['CommunityBookmark_userId_savedAt_id_idx',['userId','savedAt','id'],false,false],['CommunityBookmark_postId_idx',['postId'],false,false],['CommunityBookmark_commentId_idx',['commentId'],false,false]].map(([name,columns,is_unique,is_primary])=>({name,columns,is_unique,is_primary,valid:true,ready:true,no_predicate:true,no_expression:true,method:'btree',key_count:columns.length,total_count:columns.length}));
  return{columns,constraints,indexes};
}
const inspectPostgresMetadata=async data=>inspectCommunityBookmarkStorage(async query=>{
  if(query.includes('SELECT c.relkind'))return[{relkind:'r'}];
  if(query.includes('FROM information_schema.columns'))return data.columns;
  if(query.includes('FROM pg_constraint'))return data.constraints;
  if(query.includes('FROM pg_index'))return data.indexes;
  throw Error('Unexpected query');
},'postgresql');

test('PostgreSQL inspector accepts reviewed native pg_catalog scalar metadata', async () => {
  await inspectPostgresMetadata(postgresInspectorMetadata());
});
// Exact forms from the unchanged migration, deparsed by existing PGlite17.5;
// this positive fixture is distinct from real provider execution below.
const postgresDeparsedChecks = {
  "CommunityBookmark_revision_shape": "CHECK (((revision > 0) AND (revision <= 2147483647) AND (\"lastExpectedRevision\" >= 0) AND (\"lastExpectedRevision\" < revision)))",
  "CommunityBookmark_target_shape": "CHECK ((((\"postId\" IS NOT NULL) AND (\"commentId\" IS NULL)) OR ((\"postId\" IS NULL) AND (\"commentId\" IS NOT NULL))))"
};
test('PostgreSQL inspector accepts exact deparser forms and only unquoted whitespace variation', async () => {
  const data = postgresInspectorMetadata();
  for (const [name, definition] of Object.entries(postgresDeparsedChecks)) data.constraints.find(row => row.conname === name).definition = definition.replaceAll(' AND ', ' \n AND  ');
  await inspectPostgresMetadata(data);
});
for (const [name, definition] of [
  ['changed AND/OR grouping', 'CHECK ("postId" IS NOT NULL AND ("commentId" IS NULL OR "postId" IS NULL) AND "commentId" IS NOT NULL)'],
  ['changed quoted identifier content', postgresDeparsedChecks.CommunityBookmark_target_shape.replace('"postId"', '"post Id"')],
]) test(`PostgreSQL inspector rejects CHECK ${name}`, async () => {
  const data = postgresInspectorMetadata(); data.constraints.find(row => row.conname === 'CommunityBookmark_target_shape').definition = definition;
  await assert.rejects(inspectPostgresMetadata(data), /CHECK/);
});

for (const field of ['id','userId','postId','commentId','savedAt','revision','lastRequestId','lastExpectedRevision']) {
  test(`PostgreSQL inspector rejects a domain hiding the underlying scalar on ${field}`, async () => {
    const data = postgresInspectorMetadata(); const column = data.columns.find(row => row.column_name === field);
    column.domain_schema = 'selected_test_schema'; column.domain_name = 'restrictive_domain';
    column.native_type = false; column.type_kind = 'd';
    await assert.rejects(inspectPostgresMetadata(data), /column type/);
  });
}
for (const [name, mutate] of [
  ['different actual type OID without domain metadata', column => { column.native_type = false; }],
  ['non-base pg_type kind even with inconsistent native metadata', column => { column.type_kind = 'd'; }],
  ['missing actual type identity', column => { delete column.native_type; }],
]) test(`PostgreSQL inspector rejects ${name}`, async () => {
  const data = postgresInspectorMetadata(); mutate(data.columns.find(row => row.column_name === 'lastRequestId'));
  await assert.rejects(inspectPostgresMetadata(data), /column type/);
});

const pgEnabled = process.env.POSTGRESQL_RELEASE_GATE_DISPOSABLE === '1';
test('real PostgreSQL selected-schema shape, privacy FKs, readiness and tamper rejection', { skip: !pgEnabled }, async () => {
  const url = testDatabase.missionTestDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER);
  const schema = `forge_community_bookmark_native_${randomUUID().replaceAll('-','_')}`; const scoped = new URL(url); scoped.searchParams.set('schema',schema);
  const client = new pg.Client({connectionString:url}); await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`); await applyPostgresqlUpgrades(scoped.toString(),{initializeEmptySchema:true}); await client.query(`SET search_path TO "${schema}"`);
    const query = async sql => (await client.query(sql)).rows;
    await inspectCommunityBookmarkStorage(query,'postgresql'); assert.equal(await assertCoursePublicationReady(scoped.toString(),'postgresql'),true);
    await client.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('owner','owner@example.invalid',CURRENT_TIMESTAMP),('peer','peer@example.invalid',CURRENT_TIMESTAMP);
      INSERT INTO "Post" (id,title,content,published,"authorId","updatedAt") VALUES ('post','Kept','Kept',true,'owner',CURRENT_TIMESTAMP);
      INSERT INTO "Comment" (id,content,"postId","authorId","updatedAt") VALUES ('comment','Kept','post','peer',CURRENT_TIMESTAMP);`);
    await client.query(`INSERT INTO "CommunityBookmark" (id,"userId","postId","savedAt",revision,"lastRequestId","lastExpectedRevision") VALUES ('b','owner','post',NULL,1,'request',0)`);
    await client.query(`DELETE FROM "User" WHERE id='owner'`); assert.equal((await client.query('SELECT count(*)::integer n FROM "CommunityBookmark"')).rows[0].n,0);
    for (const mutation of [
      'ALTER TABLE "CommunityBookmark" ALTER COLUMN "lastRequestId" DROP NOT NULL',
      'ALTER TABLE "CommunityBookmark" ALTER COLUMN revision SET DEFAULT 7',
      'ALTER TABLE "CommunityBookmark" DROP CONSTRAINT "CommunityBookmark_target_shape"',
      'ALTER TABLE "CommunityBookmark" DROP CONSTRAINT "CommunityBookmark_postId_fkey"',
      'DROP INDEX "CommunityBookmark_postId_idx"; CREATE INDEX "CommunityBookmark_postId_idx" ON "Post"(id)',
      'CREATE DOMAIN "CommunityBookmarkRequestDomain" AS TEXT CHECK (length(VALUE)<=1); ALTER TABLE "CommunityBookmark" ALTER COLUMN "lastRequestId" TYPE "CommunityBookmarkRequestDomain"',
      'ALTER TABLE "CommunityBookmark" DROP CONSTRAINT "CommunityBookmark_target_shape"; ALTER TABLE "CommunityBookmark" ADD CONSTRAINT "CommunityBookmark_target_shape" CHECK ("postId" IS NOT NULL AND ("commentId" IS NULL OR "postId" IS NULL) AND "commentId" IS NOT NULL)',
    ]) {
      await client.query('BEGIN');
      try {
        await client.query(mutation); await assert.rejects(inspectCommunityBookmarkStorage(query,'postgresql'));
        if (mutation.includes('CREATE DOMAIN')) await assert.rejects(client.query('SELECT $1::"CommunityBookmarkRequestDomain"', [randomUUID()]), error => error.code === '23514');
      }
      finally { await client.query('ROLLBACK'); }
    }
  } finally { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); }
});
