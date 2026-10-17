import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { initializeSqlite } from './sqlite-init.mjs';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import testDatabase from './space-mission-test-database.cjs';

const root = new URL('../', import.meta.url);
const sqliteDirectory = new URL('prisma/sqlite-migrations/', root);
const postgresDirectory = new URL('prisma/postgresql-upgrades/', root);
const sqliteTail = '0029_space_mission_invitations.sql';
const postgresTail = '0028_space_mission_invitations.sql';
const tables = ['SpaceMissionInvitationSetting', 'SpaceMissionInvitationAccess', 'SpaceMissionInvitationRequest', 'SpaceMissionInvitation'];
const fields = {
  SpaceMissionInvitationSetting: ['userId', 'enabled', 'revision', 'accountEpoch'],
  SpaceMissionInvitationAccess: ['missionId', 'userId', 'epoch'],
  SpaceMissionInvitationRequest: ['missionId', 'senderId', 'requestId', 'payloadDigest'],
  SpaceMissionInvitation: ['id', 'missionId', 'recipientId', 'senderId', 'state', 'revision', 'createdAt', 'expiresAt', 'senderEpoch', 'senderAccessEpoch', 'senderAccountEpoch', 'recipientAccessEpoch', 'recipientAccountEpoch', 'recipientSettingRevision', 'recipientEpoch'],
};
const index = 'SpaceMissionInvitation_recipient_pending_idx';
const quote = name => `"${name.replaceAll('"', '""')}"`;
const names = directory => readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
const sql = (name, directory = sqliteDirectory) => readFileSync(new URL(name, directory), 'utf8');
const checksum = value => createHash('sha256').update(value).digest('hex');
const historyFailure = /history is missing, divergent or has changed checksums/;
const schemaFailure = /Mission invitation schema or constraints are missing or incomplete/;
const fixtures = [];
// Keep disposable fixtures until the caller has retained the complete test log.
// Only these exact, newly generated paths are eligible for later cleanup.
after(() => console.log(`Invitation migration disposable fixtures: ${JSON.stringify(fixtures)}`));
const seedSql = `INSERT INTO "User" (id,email,"updatedAt") VALUES
  ('a','a@example.test',CURRENT_TIMESTAMP),('b','b@example.test',CURRENT_TIMESTAMP),
  ('c','c@example.test',CURRENT_TIMESTAMP),('erase','erase@example.test',CURRENT_TIMESTAMP);
  INSERT INTO "Space" (id,name,description,visibility,"updatedAt") VALUES
    ('s','Private','Keep topic','PRIVATE',CURRENT_TIMESTAMP),('t','Other','Keep other topic','PRIVATE',CURRENT_TIMESTAMP);
  INSERT INTO "SpaceMember" ("spaceId","userId") VALUES ('s','a'),('s','b'),('s','c'),('t','a');
  INSERT INTO "SpaceMission" (id,"spaceId","creatorId","requestId","payloadDigest",title,prompt,
    "weekStartsOn","weekTimezone","weekStartsAt","weekEndsAt") VALUES
    ('m','s','a','request','legacy-digest','Existing relay','Original prompt',
      '2026-10-19','Europe/Berlin','2026-10-18 22:00:00','2026-10-25 23:00:00'),
    ('other','t','a','other-request','other-digest','Other relay','Other prompt',NULL,NULL,NULL,NULL);
  INSERT INTO "SpaceMissionParticipation" ("missionId","userId",epoch) VALUES ('m','a',1),('m','b',2);
  INSERT INTO "SpaceMissionContribution" (id,"missionId","authorId",epoch,kind,content,"targetContributionId","requestId","payloadDigest","hiddenAt","withdrawnAt") VALUES
    ('insight','m','a',1,'INSIGHT','Keep insight',NULL,'insight','digest',NULL,NULL),
    ('build','m','b',2,'BUILD_ON','Keep build-on','insight','build','digest',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  INSERT INTO "SpaceMissionBookmarkSetting" ("missionId","userId","savedAt",revision) VALUES ('m','b',CURRENT_TIMESTAMP,3);
  INSERT INTO "SpaceMissionBookmarkAccess" ("userId",epoch) VALUES ('b',4);
  INSERT INTO "ContentReport" (id,"reporterId","targetType","targetId",reason,"scopeSpaceId")
    VALUES ('report','b','SPACE_MISSION_CONTRIBUTION','build','OTHER','s');
  INSERT INTO "Notification" (id,"userId",type,content,"targetType","targetId")
    VALUES ('legacy-notice','b','SYSTEM','Keep legacy notice',NULL,NULL);
  INSERT INTO "Course" (id,title,description,"instructorId","updatedAt")
    VALUES ('course','Keep course','Keep description','a',CURRENT_TIMESTAMP);
  INSERT INTO "CourseDraft" ("courseId",payload,digest,"updatedAt") VALUES ('course','{}','digest',CURRENT_TIMESTAMP);
  INSERT INTO "CourseQuestion" (id,"courseId","authorId","requestId",title,body,"updatedAt","contextPublicationId","contextContentId")
    VALUES ('question','course','b','question-request','Keep Q&A','Keep body',CURRENT_TIMESTAMP,'historical-publication','historical-content');`;

function fixture({ predecessor = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-mission-invitations-')); fixtures.push(dir);
  const migrations = join(dir, 'migrations'); mkdirSync(migrations);
  const addFiles = files => { for (const name of files) writeFileSync(join(migrations, name), sql(name)); };
  addFiles(names(sqliteDirectory).filter(name => !predecessor || name < sqliteTail));
  const url = `file:${join(dir, 'test.db')}`;
  const deploy = (directory = migrations) => {
    const previous = process.env.DATABASE_PROVIDER; process.env.DATABASE_PROVIDER = 'sqlite';
    try { initializeSqlite(url, directory); }
    finally { if (previous === undefined) delete process.env.DATABASE_PROVIDER; else process.env.DATABASE_PROVIDER = previous; }
  };
  deploy();
  return { dir, url, migrations, deploy, addTail: () => addFiles([sqliteTail]),
    open: () => { const db = new DatabaseSync(url.slice(5)); db.exec('PRAGMA foreign_keys=ON'); return db; } };
}
function sqliteRows(db, { includeInvitations = false } = {}) {
  return Object.fromEntries(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()
    .filter(({ name }) => name !== '_app_migrations' && (includeInvitations || !tables.includes(name)))
    .map(({ name }) => [name, db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all().map(row => {
      const result = { ...row }; if (!includeInvitations && name === 'SpaceMission') delete result.invitationAttemptCount; return result;
    })]));
}
const sqliteSchema = db => db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all();
const sqliteHistory = db => db.prepare('SELECT * FROM _app_migrations ORDER BY name').all();
const integrity = db => {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
};
const pending = (overrides = {}) => ({ id: 'invite', missionId: 'm', recipientId: 'b', senderId: 'a', state: 'PENDING', revision: 1,
  createdAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-24T00:00:00.000Z', senderEpoch: 1,
  senderAccessEpoch: 0, senderAccountEpoch: 0, recipientAccessEpoch: 0, recipientAccountEpoch: 0,
  recipientSettingRevision: 1, recipientEpoch: 0, ...overrides });
const terminal = (overrides = {}) => ({ ...Object.fromEntries(fields.SpaceMissionInvitation.map(field => [field, null])),
  id: 'terminal', missionId: 'm', recipientId: 'b', state: 'DECLINED', revision: 2, ...overrides });
function sqliteInvite(db, row) {
  return db.prepare(`INSERT INTO "SpaceMissionInvitation" (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map(() => '?')})`).run(...Object.values(row));
}


// Actual inspector/function execution against synthetic catalog rows is not a
// PostgreSQL provider run. The fixed forms were deparsed separately in PGlite;
// the genuine PostgreSQL tests below must independently establish compatibility.
const canonicalInvitationChecks = new Map([
  [
    "SpaceMissionInvitationAccess_epoch_check",
    "CHECK (((epoch >= 0) AND (epoch <= 2147483647)))"
  ],
  [
    "SpaceMissionInvitationRequest_payloadDigest_check",
    "CHECK ((\"payloadDigest\" ~ '^[0-9a-f]{64}$'::text))"
  ],
  [
    "SpaceMissionInvitationSetting_accountEpoch_check",
    "CHECK (((\"accountEpoch\" >= 0) AND (\"accountEpoch\" <= 2147483647)))"
  ],
  [
    "SpaceMissionInvitationSetting_revision_check",
    "CHECK (((revision >= 0) AND (revision <= 2147483647)))"
  ],
  [
    "SpaceMissionInvitation_distinct_users_check",
    "CHECK (((\"senderId\" IS NULL) OR (\"senderId\" <> \"recipientId\")))"
  ],
  [
    "SpaceMissionInvitation_pending_shape_check",
    "CHECK ((((state = 'PENDING'::\"SpaceMissionInvitationState\") AND (\"senderId\" IS NOT NULL) AND (\"createdAt\" IS NOT NULL) AND (\"expiresAt\" IS NOT NULL) AND (\"senderEpoch\" IS NOT NULL) AND (\"senderAccessEpoch\" IS NOT NULL) AND (\"senderAccountEpoch\" IS NOT NULL) AND (\"recipientAccessEpoch\" IS NOT NULL) AND (\"recipientAccountEpoch\" IS NOT NULL) AND (\"recipientSettingRevision\" IS NOT NULL) AND (\"recipientEpoch\" IS NOT NULL)) OR ((state = ANY (ARRAY['ACCEPTED'::\"SpaceMissionInvitationState\", 'DECLINED'::\"SpaceMissionInvitationState\", 'REVOKED'::\"SpaceMissionInvitationState\", 'EXPIRED'::\"SpaceMissionInvitationState\"])) AND (\"senderId\" IS NULL) AND (\"createdAt\" IS NULL) AND (\"expiresAt\" IS NULL) AND (\"senderEpoch\" IS NULL) AND (\"senderAccessEpoch\" IS NULL) AND (\"senderAccountEpoch\" IS NULL) AND (\"recipientAccessEpoch\" IS NULL) AND (\"recipientAccountEpoch\" IS NULL) AND (\"recipientSettingRevision\" IS NULL) AND (\"recipientEpoch\" IS NULL))))"
  ],
  [
    "SpaceMissionInvitation_recipientAccessEpoch_check",
    "CHECK (((\"recipientAccessEpoch\" IS NULL) OR ((\"recipientAccessEpoch\" >= 0) AND (\"recipientAccessEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_recipientAccountEpoch_check",
    "CHECK (((\"recipientAccountEpoch\" IS NULL) OR ((\"recipientAccountEpoch\" >= 0) AND (\"recipientAccountEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_recipientEpoch_check",
    "CHECK (((\"recipientEpoch\" IS NULL) OR ((\"recipientEpoch\" >= 0) AND (\"recipientEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_recipientSettingRevision_check",
    "CHECK (((\"recipientSettingRevision\" IS NULL) OR ((\"recipientSettingRevision\" >= 0) AND (\"recipientSettingRevision\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_revision_check",
    "CHECK (((revision >= 1) AND (revision <= 2147483647)))"
  ],
  [
    "SpaceMissionInvitation_senderAccessEpoch_check",
    "CHECK (((\"senderAccessEpoch\" IS NULL) OR ((\"senderAccessEpoch\" >= 0) AND (\"senderAccessEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_senderAccountEpoch_check",
    "CHECK (((\"senderAccountEpoch\" IS NULL) OR ((\"senderAccountEpoch\" >= 0) AND (\"senderAccountEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMissionInvitation_senderEpoch_check",
    "CHECK (((\"senderEpoch\" IS NULL) OR ((\"senderEpoch\" >= 1) AND (\"senderEpoch\" <= 2147483647))))"
  ],
  [
    "SpaceMission_invitationAttemptCount_check",
    "CHECK (((\"invitationAttemptCount\" >= 0) AND (\"invitationAttemptCount\" <= 20)))"
  ]
]);
function inspectorFunctions() {
  const source = readFileSync(new URL('scripts/assert-course-publication-ready.mjs', root), 'utf8');
  const start = source.indexOf('const invitationTables =');
  const end = source.indexOf('\nasync function inspect(query, provider)', start);
  assert.ok(start >= 0 && end > start);
  return runInNewContext(`${source.slice(start, end)}; ({ compactCheck, inspectInvitationStorage })`,
    { readFileSync, resolve, root: fileURLToPath(root) });
}
function catalogFixture({ digestSpace = false, counterDomain = false, formatted = false } = {}) {
  const ddl = sql(postgresTail, postgresDirectory);
  const columns = [], constraints = [], indexes = [];
  const types = { TEXT: ['text', 'text'], BOOLEAN: ['bool', 'boolean'], INTEGER: ['int4', 'integer'],
    'TIMESTAMP(3)': ['timestamp', 'timestamp(3) without time zone'] };
  const makeConstraint = (name, table_name, rest) => ({ name, table_name, validated: true, deferrable: false, ...rest });
  const owners = new Map([['SpaceMission_invitationAttemptCount_check', 'SpaceMission']]);
  for (const [, table, body] of ddl.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)) {
    for (const [, name] of body.matchAll(/CONSTRAINT "([^"]+)"/g)) owners.set(name, table);
    for (const [, name, type, suffix] of body.matchAll(/^  "([^"]+)" (TEXT|BOOLEAN|INTEGER|TIMESTAMP\(3\)|"SpaceMissionInvitationState")([^\n]*)$/gm)) {
      const state = type === '"SpaceMissionInvitationState"';
      const value = suffix.match(/\bDEFAULT ([^,\n]+)/)?.[1] ?? null;
      columns.push({ table_name: table, column_name: name, formatted_type: state ? '"SpaceMissionInvitationState"' : types[type][1],
        type_name: state ? 'SpaceMissionInvitationState' : types[type][0], type_schema: state ? 'fixture' : 'pg_catalog',
        type_kind: state ? 'e' : 'b', same_schema_type: true, is_invitation_state: state,
        required: /\bNOT NULL\b/.test(suffix), identity_kind: '', generated_kind: '',
        default_expression: state ? `${value}::"SpaceMissionInvitationState"` : value });
    }
  }
  for (const [name, raw] of canonicalInvitationChecks) {
    let definition = raw;
    if (digestSpace && name === 'SpaceMissionInvitationRequest_payloadDigest_check') definition = definition.replace("'^[0-9a-f]", "'^ [0-9a-f]");
    if (formatted) definition = ` \n${definition.replace('CHECK ', 'CHECK \n ')}\t `;
    constraints.push(makeConstraint(name, owners.get(name), { type: 'c', definition }));
  }
  for (const [, name, fields] of ddl.matchAll(/CONSTRAINT "([^"]+)" PRIMARY KEY \(([^)]+)\)/g)) {
    constraints.push(makeConstraint(name, owners.get(name), { type: 'p', columns: [...fields.matchAll(/"([^"]+)"/g)].map(m => m[1]) }));
  }
  for (const [, name, field, table, action] of ddl.matchAll(/CONSTRAINT "([^"]+)" FOREIGN KEY \("([^"]+)"\) REFERENCES "([^"]+)" \("id"\) ON DELETE (CASCADE|SET NULL) ON UPDATE CASCADE/g)) {
    constraints.push(makeConstraint(name, owners.get(name), { type: 'f', columns: [field], referenced_columns: ['id'],
      referenced_table: table, same_schema: true, on_update: 'c', on_delete: action === 'CASCADE' ? 'c' : 'n' }));
  }
  for (const [, unique, name, table, fields] of ddl.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)" \(([^)]+)\)/g)) {
    const keys = [...fields.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    indexes.push({ name, table_name: table, is_unique: !!unique, valid: true, ready: true,
      no_predicate: true, no_expression: true, key_columns: keys.length, columns: keys });
  }
  const counter = { formatted_type: counterDomain ? '"RejectSeven"' : 'integer', type_name: counterDomain ? 'RejectSeven' : 'int4',
    type_schema: counterDomain ? 'fixture' : 'pg_catalog', type_kind: counterDomain ? 'd' : 'b',
    required: true, identity_kind: '', generated_kind: '', default_expression: '0' };
  const query = async statement => {
    assert.match(statement.trimStart(), /^SELECT /, 'Inspector remains read-only');
    if (statement.includes('FROM pg_attribute')) return statement.includes("c.relname='SpaceMission'") ? [counter] : columns;
    if (statement.includes('FROM pg_constraint')) return constraints;
    if (statement.includes('FROM pg_index')) return indexes;
    if (statement.includes('JOIN pg_enum')) return ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'].map(state => ({ state }));
    // This legacy shape intentionally looks like an integer to the old helper.
    if (statement.includes('FROM information_schema.columns')) return [{ data_type: 'integer', is_nullable: 'NO', column_default: '0', domain_name: counterDomain ? 'RejectSeven' : null }];
    assert.fail('Unexpected inspector query');
  };
  return { query };
}
test('inspector fixture accepts all reviewed canonical CHECK forms and benign unquoted whitespace', async () => {
  const { inspectInvitationStorage } = inspectorFunctions();
  await inspectInvitationStorage(catalogFixture().query, 'postgresql');
  await inspectInvitationStorage(catalogFixture({ formatted: true }).query, 'postgresql');
});
test('inspector fixture rejects a leading-space digest regex despite otherwise exact catalog rows', async () => {
  await assert.rejects(inspectorFunctions().inspectInvitationStorage(catalogFixture({ digestSpace: true }).query, 'postgresql'), /Invitation CHECK .* differs/);
});
test('inspector fixture rejects an integer-based rejecting counter domain despite legacy integer metadata', async () => {
  await assert.rejects(inspectorFunctions().inspectInvitationStorage(catalogFixture({ counterDomain: true }).query, 'postgresql'), /Invitation counter differs/);
});
test('CHECK normal form preserves literal spaces/case/brackets, escaped quotes and quoted identifier bytes', () => {
  const { compactCheck } = inspectorFunctions();
  for (const [left, right] of [
    ["CHECK (x ~ '^[0-9a-f]{64}$')", "CHECK (x ~ '^ [0-9a-f]{64}$')"],
    ["CHECK (x = 'a b')", "CHECK (x = 'ab')"],
    ["CHECK (x = 'a')", "CHECK (x = 'A')"],
    ["CHECK (x = 'a'' b')", "CHECK (x = 'a''b')"],
    ["CHECK (x = '[a]')", "CHECK (x = '[a')"],
    ['CHECK ("a b" = 1)', 'CHECK ("ab" = 1)'],
    ['CHECK ("a"" b" = 1)', 'CHECK ("a""b" = 1)'],
    ['CHECK ("a" = 1)', 'CHECK ("A" = 1)'],
  ]) assert.notEqual(compactCheck(left), compactCheck(right));
  assert.equal(compactCheck(" CHECK ( x = 'a  b'' c' ) "), compactCheck("CHECK(\n x\t=\n'a  b'' c' )"));
});
test('CHECK normal form preserves AND/OR grouping, parentheses and casts instead of accepting old collisions', () => {
  const { compactCheck } = inspectorFunctions();
  assert.notEqual(compactCheck('CHECK ((a AND b) OR c)'), compactCheck('CHECK (a AND (b OR c))'));
  assert.notEqual(compactCheck('CHECK ((x > 1::integer))'), compactCheck('CHECK ((x > 1::bigint))'));
  assert.notEqual(compactCheck('CHECK ("a" = 1)'), compactCheck('CHECK (a = 1)'));
});
test('CHECK normal form fails closed for unterminated quoted tokens and forbidden marker bytes', () => {
  const { compactCheck } = inspectorFunctions();
  for (const text of ["CHECK (x = 'unterminated)", 'CHECK ("unterminated = 1)', "CHECK (x = '\0')"]) assert.throws(() => compactCheck(text));
});

test('paired invitation tails follow exact PR80 predecessors and add only bounded counter/four private models', () => {
  assert.deepEqual(names(sqliteDirectory).slice(-2), ['0028_course_qa_lesson_context.sql', sqliteTail]);
  assert.deepEqual(names(postgresDirectory).slice(-2), ['0027_course_qa_lesson_context.sql', postgresTail]);
  for (const ddl of [sql(sqliteTail), sql(postgresTail, postgresDirectory)]) {
    assert.deepEqual([...ddl.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]), tables);
    assert.equal([...ddl.matchAll(/ALTER TABLE /g)].length, 1);
    assert.match(ddl, /"invitationAttemptCount" >= 0 AND "invitationAttemptCount" <= 20/);
    assert.ok(!/\b(?:DROP|INSERT|RENAME)\b/i.test(ddl.replace(/^--.*$/gm, '')));
    assert.ok(!/recipientHash|senderHash|deliveredAt|rateLimit|queue/i.test(ddl));
    assert.match(ddl, /PRIMARY KEY \("missionId", "senderId", "requestId"\)/);
    assert.match(ddl, /UNIQUE INDEX "SpaceMissionInvitation_missionId_recipientId_key"/);
    assert.match(ddl, /ON DELETE SET NULL ON UPDATE CASCADE/);
    assert.match(ddl, /"recipientId", "state", "expiresAt", "createdAt", "id"/);
  }
});

test('fresh SQLite full chain creates exactly four empty private tables, bounded default counter and write-free readiness', async () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql);
    for (const table of tables) {
      assert.deepEqual(db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row => row.name), fields[table]);
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get().n, 0);
    }
    assert.deepEqual(db.prepare('SELECT "invitationAttemptCount" n FROM "SpaceMission" ORDER BY id').all().map(row => row.n), [0, 0]);
    const before = sqliteRows(db, { includeInvitations: true }); const history = sqliteHistory(db); const schema = sqliteSchema(db);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); f.deploy();
    assert.deepEqual(sqliteRows(db, { includeInvitations: true }), before); assert.deepEqual(sqliteHistory(db), history); assert.deepEqual(sqliteSchema(db), schema);
    integrity(db);
  } finally { db.close(); }
});

test('SQLite rejects missing invitation tables, every field/counter, removed CHECKs and drifted indexes despite valid history', async () => {
  const f = fixture(); const db = f.open();
  try {
    const history = sqliteHistory(db);
    for (const table of tables) {
      db.exec(`ALTER TABLE ${quote(table)} RENAME TO ${quote(`${table}_missing`)}`);
      try { await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), schemaFailure); }
      finally { db.exec(`ALTER TABLE ${quote(`${table}_missing`)} RENAME TO ${quote(table)}`); }
    }
    for (const [table, columns] of [...Object.entries(fields), ['SpaceMission', ['invitationAttemptCount']]]) {
      for (const field of columns) {
        db.exec(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(field)} TO ${quote(`${field}_missing`)}`);
        try { await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), schemaFailure, `${table}.${field}`); }
        finally { db.exec(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(`${field}_missing`)} TO ${quote(field)}`); }
      }
    }
    db.exec(`ALTER TABLE "SpaceMissionInvitationSetting" RENAME TO "setting_original";
      CREATE TABLE "SpaceMissionInvitationSetting" ("userId" TEXT PRIMARY KEY, enabled BOOLEAN, revision INTEGER, "accountEpoch" INTEGER);`);
    try { await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), schemaFailure); }
    finally { db.exec('DROP TABLE "SpaceMissionInvitationSetting"; ALTER TABLE "setting_original" RENAME TO "SpaceMissionInvitationSetting"'); }
    db.exec(`DROP INDEX ${quote(index)}; CREATE INDEX ${quote(index)} ON "SpaceMissionInvitation" ("recipientId")`);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), schemaFailure);
    db.exec(`DROP INDEX ${quote(index)}; ${sql(sqliteTail).match(new RegExp(`CREATE INDEX "${index}"[^;]+;`))[0]}`);
    assert.deepEqual(sqliteHistory(db), history); assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); integrity(db);
  } finally { db.close(); }
});

test('SQLite full reviewed DDL rejects nullable/type/default drift and extra private columns despite exact history', async () => {
  const original = sql(sqliteTail).match(/CREATE TABLE "SpaceMissionInvitationSetting" \([\s\S]*?\n\);/)[0];
  for (const [label, changed] of [
    ['nullable', original.replace('"enabled" BOOLEAN NOT NULL', '"enabled" BOOLEAN')],
    ['type', original.replace('"revision" INTEGER', '"revision" BIGINT')],
    ['default', original.replace('"enabled" BOOLEAN NOT NULL DEFAULT false', '"enabled" BOOLEAN NOT NULL DEFAULT true')],
  ]) {
    const f = fixture(); const db = f.open();
    try {
      const history = sqliteHistory(db);
      db.exec(`ALTER TABLE "SpaceMissionInvitationSetting" RENAME TO "setting_reviewed_original"; ${changed}`);
      await assert.rejects(assertCoursePublicationReady(f.url,'sqlite'),schemaFailure,label);
      db.exec('DROP TABLE "SpaceMissionInvitationSetting"; ALTER TABLE "setting_reviewed_original" RENAME TO "SpaceMissionInvitationSetting"');
      assert.equal(await assertCoursePublicationReady(f.url,'sqlite'),true);
      assert.deepEqual(sqliteHistory(db),history); integrity(db);
    } finally { db.close(); }
  }
  for (const table of tables) {
    const f = fixture(); const db = f.open();
    try {
      const history = sqliteHistory(db);
      db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN "unexpectedPrivateDetail" TEXT`);
      await assert.rejects(assertCoursePublicationReady(f.url,'sqlite'),schemaFailure,table);
      assert.deepEqual(sqliteHistory(db),history); integrity(db);
    } finally { db.close(); }
  }
});

test('populated PR80 SQLite predecessor preserves every old row, Q&A scalar, old index/constraint and checksum through exact replay', async () => {
  const f = fixture({ predecessor: true }); const db = f.open();
  try {
    db.exec(seedSql); const rows = sqliteRows(db); const oldSchema = sqliteSchema(db); const history = sqliteHistory(db);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    f.addTail(); f.deploy(); const complete = sqliteHistory(db); f.deploy();
    assert.deepEqual(sqliteRows(db), rows); assert.deepEqual(sqliteHistory(db), complete);
    assert.deepEqual(db.prepare('SELECT * FROM _app_migrations WHERE name < ? ORDER BY name').all(sqliteTail), history);
    const current = new Map(sqliteSchema(db).map(row => [row.name, row]));
    for (const row of oldSchema) if (row.name !== 'SpaceMission') assert.deepEqual(current.get(row.name), row);
    assert.ok(current.get('SpaceMission').sql.includes('SpaceMission_week_complete_range'));
    assert.equal(db.prepare('SELECT checksum FROM _app_migrations WHERE name=?').get(sqliteTail).checksum, checksum(sql(sqliteTail)));
    assert.deepEqual({ ...db.prepare('SELECT "contextPublicationId","contextContentId" FROM "CourseQuestion"').get() },
      { contextPublicationId: 'historical-publication', contextContentId: 'historical-content' });
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); integrity(db);
  } finally { db.close(); }
});

test('injected SQLite DDL failure rolls back counter/all new tables/indexes/history while keeping populated PR80 data', async () => {
  const f = fixture({ predecessor: true }); const db = f.open();
  try {
    db.exec(seedSql); const rows = sqliteRows(db); const schema = sqliteSchema(db); const history = sqliteHistory(db);
    writeFileSync(join(f.migrations, sqliteTail), `${sql(sqliteTail)}\nINSERT INTO "MissingInvitationRollbackTable" VALUES (1);`);
    assert.throws(() => f.deploy(), /no such table/);
    assert.deepEqual(sqliteRows(db), rows); assert.deepEqual(sqliteSchema(db), schema); assert.deepEqual(sqliteHistory(db), history);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'SpaceMissionInvitation%'`).get().n, 0);
    assert.ok(!db.prepare('PRAGMA table_info("SpaceMission")').all().some(row => row.name === 'invitationAttemptCount'));
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure);
    f.addTail(); f.deploy(); assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); integrity(db);
  } finally { db.close(); }
});

test('SQLite readiness/deployment reject missing/tampered/gapped/divergent history and older images without losing data', async () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql); const rows = sqliteRows(db); const schema = sqliteSchema(db);
    const expected = checksum(sql(sqliteTail));
    db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run('tampered', sqliteTail);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure); assert.throws(() => f.deploy(), /checksum changed/);
    db.prepare('UPDATE _app_migrations SET checksum=? WHERE name=?').run(expected, sqliteTail);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run('0028_course_qa_lesson_context.sql');
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure); assert.throws(() => f.deploy(), /gap before 0029_space_mission_invitations/);
    db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run('0028_course_qa_lesson_context.sql', checksum(sql('0028_course_qa_lesson_context.sql')));
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run(sqliteTail);
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure); assert.throws(() => f.deploy(), /duplicate column/);
    db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run(sqliteTail, expected);
    db.prepare('INSERT INTO _app_migrations (name,checksum) VALUES (?,?)').run('0030_unreviewed_invitation.sql', 'unknown');
    await assert.rejects(assertCoursePublicationReady(f.url, 'sqlite'), historyFailure); assert.throws(() => f.deploy(), /not present in the image/);
    db.prepare('DELETE FROM _app_migrations WHERE name=?').run('0030_unreviewed_invitation.sql');
    const old = fixture({ predecessor: true }); assert.throws(() => f.deploy(old.migrations), /0029_space_mission_invitations.sql is not present in the image/);
    assert.deepEqual(sqliteRows(db), rows); assert.deepEqual(sqliteSchema(db), schema);
    assert.equal(await assertCoursePublicationReady(f.url, 'sqlite'), true); integrity(db);
  } finally { db.close(); }
});

test('SQLite enforces counter/revision/epoch integer bounds, canonical digests, FKs and lifetime unique receipts/invitations', () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql);
    for (const invalid of [-1, 21, 2147483648, 0.5, 'bad', null]) assert.throws(() => db.prepare('UPDATE "SpaceMission" SET "invitationAttemptCount"=? WHERE id=\'m\'').run(invalid), /CHECK|NOT NULL/);
    for (const value of [0, 20]) db.prepare('UPDATE "SpaceMission" SET "invitationAttemptCount"=? WHERE id=\'m\'').run(value);
    assert.throws(() => db.exec('UPDATE "SpaceMission" SET "invitationAttemptCount"="invitationAttemptCount"+1 WHERE id=\'m\''), /CHECK/);
    for (const field of ['revision', 'accountEpoch']) for (const invalid of [-1, 2147483648, 0.5, 'bad', null]) {
      assert.throws(() => db.prepare(`INSERT INTO "SpaceMissionInvitationSetting" ("userId",${quote(field)}) VALUES ('c',?)`).run(invalid), /CHECK|NOT NULL/);
    }
    for (const invalid of [-1, 2147483648, 0.5, 'bad', null]) assert.throws(() => db.prepare('INSERT INTO "SpaceMissionInvitationAccess" ("missionId","userId",epoch) VALUES (\'m\',\'c\',?)').run(invalid), /CHECK|NOT NULL/);
    for (const invalid of [-1, 2, 0.5, 'bad', null]) assert.throws(() => db.prepare('INSERT INTO "SpaceMissionInvitationSetting" ("userId",enabled) VALUES (\'c\',?)').run(invalid), /CHECK|NOT NULL/);
    db.exec(`INSERT INTO "SpaceMissionInvitationSetting" ("userId") VALUES ('c'); INSERT INTO "SpaceMissionInvitationAccess" ("missionId","userId") VALUES ('m','c');`);
    for (const table of [tables[0], tables[1]]) assert.throws(() => db.exec(`INSERT INTO ${quote(table)} (${table === tables[0] ? '"userId"' : '"missionId","userId"'}) VALUES (${table === tables[0] ? "'missing'" : "'missing','c'"})`), /FOREIGN KEY/);
    const receipt = db.prepare('INSERT INTO "SpaceMissionInvitationRequest" ("missionId","senderId","requestId","payloadDigest") VALUES (?,?,?,?)');
    for (const digest of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'a'.repeat(63)+'\0', new Uint8Array(64)]) assert.throws(() => receipt.run('m','a','r',digest), /CHECK/);
    receipt.run('m','a','r','a'.repeat(64)); assert.throws(() => receipt.run('m','a','r','b'.repeat(64)), /UNIQUE/);
    assert.throws(() => receipt.run('missing','a','x','a'.repeat(64)), /FOREIGN KEY/);
    for (const field of ['revision', 'senderEpoch', ...fields.SpaceMissionInvitation.slice(9)]) {
      for (const invalid of [-1, 2147483648, 0.5, 'bad', null, ...(field === 'revision' || field === 'senderEpoch' ? [0] : [])]) {
        assert.throws(() => sqliteInvite(db, pending({ [field]: invalid })), /CHECK|NOT NULL/, `${field}=${invalid}`);
      }
    }
    assert.throws(() => sqliteInvite(db, pending({ recipientId: 'a' })), /CHECK/);
    assert.throws(() => sqliteInvite(db, pending({ senderId: 'missing' })), /FOREIGN KEY/);
    assert.throws(() => sqliteInvite(db, pending({ state: 'UNKNOWN' })), /CHECK/);
    for (const field of ['senderId', 'createdAt', 'expiresAt', ...fields.SpaceMissionInvitation.slice(8)]) assert.throws(() => sqliteInvite(db, pending({ [field]: null })), /CHECK/);
    sqliteInvite(db, pending()); assert.throws(() => sqliteInvite(db, pending({ id: 'duplicate', senderId: 'c' })), /UNIQUE/);
    db.exec('DELETE FROM "SpaceMissionInvitation"');
    for (const state of ['ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED']) {
      sqliteInvite(db, terminal({ state }));
      assert.throws(() => sqliteInvite(db, pending({ id: 'again', senderId: 'c' })), /UNIQUE/);
      for (const field of ['senderId','createdAt','expiresAt', ...fields.SpaceMissionInvitation.slice(8)]) assert.throws(() => db.prepare(`UPDATE "SpaceMissionInvitation" SET ${quote(field)}=?`).run(pending()[field]), /CHECK/);
      db.exec('DELETE FROM "SpaceMissionInvitation"');
    }
    integrity(db);
  } finally { db.close(); }
});

test('SQLite account/mission cascades preserve minimal recipient tombstones and non-personal counter without archive sidecars', () => {
  const f = fixture(); const db = f.open();
  try {
    db.exec(seedSql);
    db.exec(`UPDATE "SpaceMission" SET "invitationAttemptCount"=20 WHERE id='m';
      INSERT INTO "SpaceMissionInvitationRequest" ("missionId","senderId","requestId","payloadDigest") VALUES ('m','erase','request','${'a'.repeat(64)}');
      INSERT INTO "SpaceMissionInvitationSetting" ("userId") VALUES ('erase');
      INSERT INTO "SpaceMissionInvitationAccess" ("missionId","userId",epoch) VALUES ('m','erase',1);`);
    sqliteInvite(db, pending({ senderId: 'erase' }));
    // Raw sender erasure fails closed until the domain has scrubbed the pending row.
    assert.throws(() => db.exec(`DELETE FROM "User" WHERE id='erase'`), /CHECK/);
    const scrub = terminal({ id: 'invite', state: 'REVOKED' });
    db.prepare(`UPDATE "SpaceMissionInvitation" SET ${Object.keys(scrub).map(key => `${quote(key)}=?`)}`).run(...Object.values(scrub));
    db.exec(`DELETE FROM "User" WHERE id='erase'`);
    for (const table of tables.slice(0,3)) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get().n, 0);
    assert.deepEqual({ ...db.prepare('SELECT * FROM "SpaceMissionInvitation"').get() }, scrub);
    assert.equal(db.prepare('SELECT "invitationAttemptCount" n FROM "SpaceMission" WHERE id=\'m\'').get().n, 20);
    db.exec(`DELETE FROM "User" WHERE id='b'`); assert.equal(db.prepare('SELECT COUNT(*) n FROM "SpaceMissionInvitation"').get().n, 0);
    assert.equal(db.prepare('SELECT "invitationAttemptCount" n FROM "SpaceMission" WHERE id=\'m\'').get().n, 20);
    db.exec(`INSERT INTO "SpaceMissionInvitationAccess" ("missionId","userId") VALUES ('m','c'); DELETE FROM "SpaceMission" WHERE id='m'`);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM "SpaceMissionInvitationAccess"').get().n, 0); integrity(db);
  } finally { db.close(); }
});

// No connection is constructed unless the existing explicit disposable flag and
// canonical, parameter-free loopback forge_test boundary both succeed.
const pgUrl = process.env.POSTGRESQL_RELEASE_GATE_DISPOSABLE === '1'
  ? testDatabase.disposablePostgresqlTestUrl(process.env.DATABASE_URL) : null;
async function withPostgres(run) {
  const db = new pg.Client({ connectionString: pgUrl });
  const schema = `forge_mission_invitations_${randomUUID().replaceAll('-', '_')}`;
  const url = new URL(pgUrl); url.searchParams.set('schema', schema);
  let created = false;
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA ${quote(schema)}`); created = true; await db.query(`SET search_path TO ${quote(schema)}`);
    await run(db, url.toString(), schema);
  } finally { try { if (created) await db.query(`DROP SCHEMA ${quote(schema)} CASCADE`); } finally { await db.end(); } }
}
async function postgresPredecessor(db) {
  await db.query(readFileSync(new URL('prisma/postgresql-baselines/0000_main_7814799.sql', root), 'utf8'));
  await db.query('CREATE TABLE "_app_schema_upgrades" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of names(postgresDirectory).filter(name => name < postgresTail)) {
    const ddl = sql(name, postgresDirectory); if (name !== '0001_skill_endorsements.sql') await db.query(ddl);
    await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)', [name, checksum(ddl)]);
  }
}
async function postgresRows(db, includeInvitations = false) {
  const result = {};
  for (const { table_name: name } of (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name`)).rows) {
    if (name === '_app_schema_upgrades' || (!includeInvitations && tables.includes(name))) continue;
    result[name] = (await db.query(`SELECT ${!includeInvitations && name === 'SpaceMission' ? "to_jsonb(t) - 'invitationAttemptCount'" : 'to_jsonb(t)'} AS row FROM ${quote(name)} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
const pgHistory = async db => (await db.query('SELECT * FROM "_app_schema_upgrades" ORDER BY name')).rows;
const pgError = (...codes) => error => codes.includes(error.code);
const pgInvite = (db, row) => db.query(`INSERT INTO "SpaceMissionInvitation" (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map((_, index) => `$${index+1}`)})`, Object.values(row));

test('PostgreSQL fresh full chain has exact private fields/FKs/checks/indexes and write-free replay/readiness', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await applyPostgresqlUpgrades(url, { initializeEmptySchema: true }); await db.query(seedSql);
  for (const table of tables) {
    const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`, [table])).rows;
    assert.deepEqual(columns.map(row => row.column_name), fields[table]);
    assert.equal(Number((await db.query(`SELECT COUNT(*) n FROM ${quote(table)}`)).rows[0].n), 0);
  }
  const rows = await postgresRows(db,true); const history = await pgHistory(db);
  assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true); await applyPostgresqlUpgrades(url);
  assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
  assert.deepEqual(await postgresRows(db,true), rows); assert.deepEqual(await pgHistory(db), history);
}));

test('PostgreSQL exact invitation columns reject nullable/type/precision/default drift and extra private fields', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await applyPostgresqlUpgrades(url,{ initializeEmptySchema: true });
  const history = await pgHistory(db); const before = await postgresRows(db,true);
  assert.equal(await assertCoursePublicationReady(url,'postgresql'),true);
  const changes = [
    ['nullable setting revision', 'ALTER TABLE "SpaceMissionInvitationSetting" ALTER COLUMN "revision" DROP NOT NULL', 'ALTER TABLE "SpaceMissionInvitationSetting" ALTER COLUMN "revision" SET NOT NULL'],
    ['required pending sender', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "senderId" SET NOT NULL', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "senderId" DROP NOT NULL'],
    ['bigint setting revision', 'ALTER TABLE "SpaceMissionInvitationSetting" ALTER COLUMN "revision" TYPE BIGINT', 'ALTER TABLE "SpaceMissionInvitationSetting" ALTER COLUMN "revision" TYPE INTEGER'],
    ['numeric access epoch', 'ALTER TABLE "SpaceMissionInvitationAccess" ALTER COLUMN "epoch" TYPE NUMERIC', 'ALTER TABLE "SpaceMissionInvitationAccess" ALTER COLUMN "epoch" TYPE INTEGER'],
    ['timestamp precision', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "createdAt" TYPE TIMESTAMP(6)', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "createdAt" TYPE TIMESTAMP(3)'],
    ['timestamp timezone', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE \'UTC\'', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "expiresAt" TYPE TIMESTAMP(3) USING "expiresAt" AT TIME ZONE \'UTC\''],
    ['enabled default', 'ALTER TABLE "SpaceMissionInvitationSetting" ALTER COLUMN "enabled" SET DEFAULT true', 'ALTER TABLE "SpaceMissionInvitationSetting" ALTER COLUMN "enabled" SET DEFAULT false'],
    ['epoch default', 'ALTER TABLE "SpaceMissionInvitationAccess" ALTER COLUMN "epoch" SET DEFAULT 1', 'ALTER TABLE "SpaceMissionInvitationAccess" ALTER COLUMN "epoch" SET DEFAULT 0'],
    ['state default', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "state" SET DEFAULT \'DECLINED\'', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "state" SET DEFAULT \'PENDING\''],
    ['request has no default', 'ALTER TABLE "SpaceMissionInvitationRequest" ALTER COLUMN "requestId" SET DEFAULT \'unexpected\'', 'ALTER TABLE "SpaceMissionInvitationRequest" ALTER COLUMN "requestId" DROP DEFAULT'],
    ['pending time has no default', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP', 'ALTER TABLE "SpaceMissionInvitation" ALTER COLUMN "createdAt" DROP DEFAULT'],
  ];
  for (const [label, change, restore] of changes) {
    await db.query(change);
    try { await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure,label); }
    finally { await db.query(restore); }
    assert.equal(await assertCoursePublicationReady(url,'postgresql'),true,label);
  }
  for (const table of tables) {
    await db.query(`ALTER TABLE ${quote(table)} ADD COLUMN "unexpectedPrivateDetail" TEXT`);
    try { await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure,table); }
    finally { await db.query(`ALTER TABLE ${quote(table)} DROP COLUMN "unexpectedPrivateDetail"`); }
    assert.equal(await assertCoursePublicationReady(url,'postgresql'),true);
  }
  assert.deepEqual(await pgHistory(db),history); assert.deepEqual(await postgresRows(db,true),before);
}));

test('PostgreSQL invitation state requires the exact current-schema enum even with identical labels', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await applyPostgresqlUpgrades(url,{ initializeEmptySchema: true });
  const current = new URL(url).searchParams.get('schema');
  const other = `forge_invitation_enum_drift_${randomUUID().replaceAll('-', '_')}`;
  const history = await pgHistory(db);
  await db.query(`CREATE SCHEMA ${quote(other)}`);
  try {
    await db.query(`ALTER TYPE "SpaceMissionInvitationState" SET SCHEMA ${quote(other)}`);
    let replacementCreated = false;
    try {
      // Keep an identical-label current-schema enum present while the column
      // remains bound to the original enum OID now in the other owned schema.
      await db.query(sql(postgresTail,postgresDirectory).match(/CREATE TYPE "SpaceMissionInvitationState" AS ENUM \([^;]+;/)[0]);
      replacementCreated = true;
      await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure);
    } finally {
      if (replacementCreated) await db.query('DROP TYPE "SpaceMissionInvitationState"');
      await db.query(`ALTER TYPE ${quote(other)}."SpaceMissionInvitationState" SET SCHEMA ${quote(current)}`);
    }
  } finally { await db.query(`DROP SCHEMA ${quote(other)}`); }
  assert.equal(await assertCoursePublicationReady(url,'postgresql'),true); assert.deepEqual(await pgHistory(db),history);
}));

test('PostgreSQL invitation indexes must belong to the reviewed table despite identical name/columns/uniqueness', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await applyPostgresqlUpgrades(url,{ initializeEmptySchema: true });
  const name = 'SpaceMissionInvitationAccess_userId_idx';
  const saved = `${name}_reviewed_original`; const history = await pgHistory(db);
  await db.query(`ALTER INDEX ${quote(name)} RENAME TO ${quote(saved)}`);
  try {
    await db.query(`CREATE INDEX ${quote(name)} ON "SpaceMissionInvitationSetting" ("userId")`);
    try { await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure); }
    finally { await db.query(`DROP INDEX ${quote(name)}`); }
  } finally { await db.query(`ALTER INDEX ${quote(saved)} RENAME TO ${quote(name)}`); }
  assert.equal(await assertCoursePublicationReady(url,'postgresql'),true); assert.deepEqual(await pgHistory(db),history);
}));

test('PostgreSQL named invitation FK/CHECK ownership cannot be swapped while matching old field/target checks', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await applyPostgresqlUpgrades(url,{ initializeEmptySchema: true });
  const setting = 'SpaceMissionInvitationSetting_userId_fkey';
  const access = 'SpaceMissionInvitationAccess_userId_fkey';
  const temporary = 'invitation_user_fkey_reviewed_original'; const history = await pgHistory(db);
  await db.query(`ALTER TABLE "SpaceMissionInvitationSetting" RENAME CONSTRAINT ${quote(setting)} TO ${quote(temporary)};
    ALTER TABLE "SpaceMissionInvitationAccess" RENAME CONSTRAINT ${quote(access)} TO ${quote(setting)};
    ALTER TABLE "SpaceMissionInvitationSetting" RENAME CONSTRAINT ${quote(temporary)} TO ${quote(access)}`);
  try { await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure); }
  finally {
    await db.query(`ALTER TABLE "SpaceMissionInvitationSetting" RENAME CONSTRAINT ${quote(access)} TO ${quote(temporary)};
      ALTER TABLE "SpaceMissionInvitationAccess" RENAME CONSTRAINT ${quote(setting)} TO ${quote(access)};
      ALTER TABLE "SpaceMissionInvitationSetting" RENAME CONSTRAINT ${quote(temporary)} TO ${quote(setting)}`);
  }
  assert.equal(await assertCoursePublicationReady(url,'postgresql'),true);
  const check = 'SpaceMissionInvitationSetting_revision_check';
  await db.query(`ALTER TABLE "SpaceMissionInvitationSetting" DROP CONSTRAINT ${quote(check)};
    ALTER TABLE "SpaceMissionInvitation" ADD CONSTRAINT ${quote(check)} CHECK ("revision" >= 0 AND "revision" <= 2147483647)`);
  try { await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure); }
  finally {
    await db.query(`ALTER TABLE "SpaceMissionInvitation" DROP CONSTRAINT ${quote(check)};
      ALTER TABLE "SpaceMissionInvitationSetting" ADD CONSTRAINT ${quote(check)} CHECK ("revision" >= 0 AND "revision" <= 2147483647)`);
  }
  assert.equal(await assertCoursePublicationReady(url,'postgresql'),true); assert.deepEqual(await pgHistory(db),history);
}));

test('PostgreSQL populated PR80 upgrade preserves every old row, context scalar/index and exact checksum', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await postgresPredecessor(db); await db.query(seedSql); const rows = await postgresRows(db); const history = await pgHistory(db);
  const indexes = (await db.query('SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY indexname')).rows;
  await assert.rejects(assertCoursePublicationReady(url,'postgresql'), historyFailure);
  await applyPostgresqlUpgrades(url); await applyPostgresqlUpgrades(url);
  assert.deepEqual(await postgresRows(db), rows);
  assert.deepEqual((await db.query('SELECT * FROM "_app_schema_upgrades" WHERE name<$1 ORDER BY name',[postgresTail])).rows,history);
  assert.deepEqual((await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename NOT LIKE 'SpaceMissionInvitation%' ORDER BY indexname`)).rows,indexes);
  assert.equal((await db.query('SELECT checksum FROM "_app_schema_upgrades" WHERE name=$1',[postgresTail])).rows[0].checksum,checksum(sql(postgresTail,postgresDirectory)));
  assert.deepEqual((await db.query('SELECT "contextPublicationId","contextContentId" FROM "CourseQuestion"')).rows,
    [{ contextPublicationId: 'historical-publication', contextContentId: 'historical-content' }]);
  assert.equal(await assertCoursePublicationReady(url,'postgresql'),true);
}));

test('PostgreSQL late DDL collision rolls back invitation enum/counter/tables/history and preserves PR80 data', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await postgresPredecessor(db); await db.query(seedSql); const rows = await postgresRows(db); const history = await pgHistory(db);
  await db.query(`CREATE INDEX ${quote(index)} ON "User" (id)`);
  await assert.rejects(applyPostgresqlUpgrades(url),pgError('42P07'));
  assert.deepEqual(await postgresRows(db),rows); assert.deepEqual(await pgHistory(db),history);
  assert.deepEqual((await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name LIKE 'SpaceMissionInvitation%'`)).rows,[]);
  assert.deepEqual((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='SpaceMission' AND column_name='invitationAttemptCount'`)).rows,[]);
  assert.deepEqual((await db.query(`SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema() AND t.typname='SpaceMissionInvitationState'`)).rows,[]);
  await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure);
}));

test('PostgreSQL missing/tampered/gapped/divergent history and missing CHECK/index fail readiness/deployment closed', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await applyPostgresqlUpgrades(url,{ initializeEmptySchema: true }); await db.query(seedSql); const rows = await postgresRows(db);
  const expected = checksum(sql(postgresTail,postgresDirectory));
  await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2',['tampered',postgresTail]);
  await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure); await assert.rejects(applyPostgresqlUpgrades(url),/history mismatch/);
  await db.query('UPDATE "_app_schema_upgrades" SET checksum=$1 WHERE name=$2',[expected,postgresTail]);
  await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',['0027_course_qa_lesson_context.sql']);
  await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure); await assert.rejects(applyPostgresqlUpgrades(url),/gap before 0028_space_mission_invitations/);
  await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)',['0027_course_qa_lesson_context.sql',checksum(sql('0027_course_qa_lesson_context.sql',postgresDirectory))]);
  await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',[postgresTail]);
  await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure); await assert.rejects(applyPostgresqlUpgrades(url),pgError('42710'));
  await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)',[postgresTail,expected]);
  await db.query('INSERT INTO "_app_schema_upgrades" (name,checksum) VALUES ($1,$2)',['0029_unreviewed.sql','unknown']);
  await assert.rejects(assertCoursePublicationReady(url,'postgresql'),historyFailure); await assert.rejects(applyPostgresqlUpgrades(url),/history mismatch/);
  await db.query('DELETE FROM "_app_schema_upgrades" WHERE name=$1',['0029_unreviewed.sql']);
  for (const [table,columns] of [...Object.entries(fields), ['SpaceMission',['invitationAttemptCount']]]) for (const field of columns) {
    await db.query(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(field)} TO ${quote(`${field}_missing`)}`);
    try { await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure); }
    finally { await db.query(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(`${field}_missing`)} TO ${quote(field)}`); }
  }
  await db.query(`ALTER TABLE "SpaceMissionInvitationSetting" DROP CONSTRAINT "SpaceMissionInvitationSetting_revision_check"`);
  await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure);
  await db.query(`ALTER TABLE "SpaceMissionInvitationSetting" ADD CONSTRAINT "SpaceMissionInvitationSetting_revision_check" CHECK ("revision" >= 0 AND "revision" <= 2147483647)`);
  await db.query(`DROP INDEX ${quote(index)}`); await assert.rejects(assertCoursePublicationReady(url,'postgresql'),schemaFailure);
  await db.query(sql(postgresTail,postgresDirectory).match(new RegExp(`CREATE INDEX "${index}"[^;]+;`))[0]);
  assert.equal(await assertCoursePublicationReady(url,'postgresql'),true); assert.deepEqual(await postgresRows(db),rows);
}));

test('PostgreSQL bounds, pending/terminal shape, digest, lifetime uniqueness and account cascades match SQLite', { skip: !pgUrl }, async () => withPostgres(async (db,url) => {
  await applyPostgresqlUpgrades(url,{ initializeEmptySchema: true }); await db.query(seedSql);
  for (const invalid of [-1,21,2147483648,0.5,'bad',null]) await assert.rejects(db.query('UPDATE "SpaceMission" SET "invitationAttemptCount"=$1 WHERE id=\'m\'',[invalid]),pgError('23514','23502','22003','22P02'));
  for (const field of ['revision','senderEpoch',...fields.SpaceMissionInvitation.slice(9)]) for (const invalid of [-1,2147483648,0.5,'bad',null,...(field==='revision'||field==='senderEpoch'?[0]:[])]) await assert.rejects(pgInvite(db,pending({[field]:invalid})),pgError('23514','23502','22003','22P02'));
  for (const field of ['senderId','createdAt','expiresAt',...fields.SpaceMissionInvitation.slice(8)]) await assert.rejects(pgInvite(db,pending({[field]:null})),pgError('23514'));
  await assert.rejects(pgInvite(db,pending({recipientId:'a'})),pgError('23514'));
  await assert.rejects(pgInvite(db,pending({senderId:'missing'})),pgError('23503'));
  await assert.rejects(pgInvite(db,pending({state:'UNKNOWN'})),pgError('22P02'));
  for (const digest of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) await assert.rejects(db.query('INSERT INTO "SpaceMissionInvitationRequest" ("missionId","senderId","requestId","payloadDigest") VALUES (\'m\',\'erase\',\'r\',$1)',[digest]),pgError('23514'));
  await db.query('INSERT INTO "SpaceMissionInvitationRequest" ("missionId","senderId","requestId","payloadDigest") VALUES (\'m\',\'erase\',\'r\',$1)',['a'.repeat(64)]);
  await assert.rejects(db.query('INSERT INTO "SpaceMissionInvitationRequest" ("missionId","senderId","requestId","payloadDigest") VALUES (\'m\',\'erase\',\'r\',$1)',['b'.repeat(64)]),pgError('23505'));
  await pgInvite(db,pending({senderId:'erase'})); await assert.rejects(pgInvite(db,pending({id:'again',senderId:'c'})),pgError('23505'));
  await assert.rejects(db.query(`DELETE FROM "User" WHERE id='erase'`),pgError('23514'));
  const scrub=terminal({id:'invite',state:'REVOKED'});
  await db.query(`UPDATE "SpaceMissionInvitation" SET ${Object.keys(scrub).map((field,index)=>`${quote(field)}=$${index+1}`)}`,Object.values(scrub));
  await db.query(`UPDATE "SpaceMission" SET "invitationAttemptCount"=20 WHERE id='m'; DELETE FROM "User" WHERE id='erase'`);
  assert.equal(Number((await db.query('SELECT COUNT(*) n FROM "SpaceMissionInvitationRequest"')).rows[0].n),0);
  await assert.rejects(pgInvite(db,pending({id:'again',senderId:'c'})),pgError('23505'));
  await db.query(`DELETE FROM "User" WHERE id='b'`);
  assert.equal(Number((await db.query('SELECT COUNT(*) n FROM "SpaceMissionInvitation"')).rows[0].n),0);
  assert.equal((await db.query(`SELECT "invitationAttemptCount" n FROM "SpaceMission" WHERE id='m'`)).rows[0].n,20);
}));

test('PostgreSQL canonical guard rejects unsafe authority/query/socket overrides before connections', () => {
  for (const value of ['postgresql://remote/forge_test','postgresql://127.0.0.1/production','postgresql://127.0.0.1/forge_test?host=remote',
    'postgresql://127.0.0.1/forge_test?options=-csearch_path=public','postgresql://127.0.0.1/forge_test?schema=public',
    'postgresql://127.0.0.1/forge_test?host=/tmp','postgresql://127.0.0.1/forge_test#fragment']) {
    assert.throws(() => testDatabase.disposablePostgresqlTestUrl(value), /local forge_test/);
  }
});

const publicObjectInventory = async db => (await db.query(`SELECT c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' ORDER BY c.relname,c.relkind`)).rows;

test('PostgreSQL rejects literal-space digest CHECK drift and accepts the unchanged canonical deparser form', { skip: !pgUrl }, async () => withPostgres(async (db, url, schema) => {
  assert.match(schema, /^forge_mission_invitations_[a-f0-9_]+$/);
  await applyPostgresqlUpgrades(url, { initializeEmptySchema: true }); await db.query(seedSql);
  const history = await pgHistory(db); const rows = await postgresRows(db, true); const publicBefore = await publicObjectInventory(db);
  const table = `${quote(schema)}."SpaceMissionInvitationRequest"`;
  const constraint = '"SpaceMissionInvitationRequest_payloadDigest_check"';
  assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
  try {
    await db.query(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint};
      ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK ("payloadDigest" ~ '^ [0-9a-f]{64}$')`);
    try {
      await assert.rejects(assertCoursePublicationReady(url, 'postgresql'), schemaFailure);
      await assert.rejects(db.query(`INSERT INTO ${table} ("missionId","senderId","requestId","payloadDigest") VALUES ('m','a','drift-valid',$1)`, ['a'.repeat(64)]), error => error.code === '23514');
    } finally {
      await db.query(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint};
        ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK ( "payloadDigest" ~ '^[0-9a-f]{64}$' )`);
    }
    assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
    assert.deepEqual(await pgHistory(db), history); assert.deepEqual(await postgresRows(db, true), rows);
  } finally { assert.deepEqual(await publicObjectInventory(db), publicBefore); }
}));

test('PostgreSQL counter requires the plain pg_catalog integer rather than a rejecting integer domain', { skip: !pgUrl }, async () => withPostgres(async (db, url, schema) => {
  assert.match(schema, /^forge_mission_invitations_[a-f0-9_]+$/);
  await applyPostgresqlUpgrades(url, { initializeEmptySchema: true }); await db.query(seedSql);
  const history = await pgHistory(db); const rows = await postgresRows(db, true); const publicBefore = await publicObjectInventory(db);
  const table = `${quote(schema)}."SpaceMission"`; const domain = `${quote(schema)}."InvitationRejectSeven"`;
  assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
  let created = false;
  try {
    await db.query(`CREATE DOMAIN ${domain} AS INTEGER CHECK (VALUE <> 7)`); created = true;
    try {
      await db.query(`ALTER TABLE ${table} ALTER COLUMN "invitationAttemptCount" TYPE ${domain} USING "invitationAttemptCount"::${domain}`);
      const info = (await db.query(`SELECT data_type, domain_name FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='SpaceMission' AND column_name='invitationAttemptCount'`, [schema])).rows[0];
      assert.equal(info.data_type, 'integer'); assert.equal(info.domain_name, 'InvitationRejectSeven');
      await assert.rejects(assertCoursePublicationReady(url, 'postgresql'), schemaFailure);
      await assert.rejects(db.query(`UPDATE ${table} SET "invitationAttemptCount"=7 WHERE id='m'`), error => error.code === '23514');
    } finally {
      await db.query(`ALTER TABLE ${table} ALTER COLUMN "invitationAttemptCount" TYPE INTEGER USING "invitationAttemptCount"::INTEGER`);
    }
    assert.equal(await assertCoursePublicationReady(url, 'postgresql'), true);
    assert.deepEqual(await pgHistory(db), history); assert.deepEqual(await postgresRows(db, true), rows);
  } finally {
    try { if (created) await db.query(`DROP DOMAIN ${domain}`); }
    finally { assert.deepEqual(await publicObjectInventory(db), publicBefore); }
  }
}));
