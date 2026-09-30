import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';

// Catalog-response tests exercise the runner without a PostgreSQL service.
// Actual SQL, transactions, defaults and cascades are covered separately by
// check-postgresql-upgrades.mjs against a disposable PostgreSQL database.
const upgrades = ['0001_skill_endorsements.sql', '0002_course_progress.sql'].map(name => {
  const sql = readFileSync(new URL(`../prisma/postgresql-upgrades/${name}`, import.meta.url), 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const recorded = count => upgrades.slice(0, count).map(({ name, checksum }) => ({ name, checksum }));

function catalog(table, keys, timestamp, extraIndexes) {
  return {
    relkind: 'r',
    columns: [
      ...['id', ...keys.map(([name]) => name)].map(column_name => ({ column_name, data_type: 'text', is_nullable: 'NO', column_default: null })),
      { column_name: timestamp, data_type: 'timestamp without time zone', datetime_precision: 3, is_nullable: 'NO', column_default: 'CURRENT_TIMESTAMP' },
    ],
    constraints: [
      { conname: `${table}_pkey`, contype: 'p', convalidated: true, condeferrable: false, columns: ['id'] },
      ...keys.map(([name, reference]) => ({ conname: `${table}_${name}_fkey`, contype: 'f', convalidated: true,
        condeferrable: false, columns: [name], referenced_columns: ['id'], referenced_table: reference,
        references_current_schema: true, confdeltype: 'c', confupdtype: 'c' })),
    ],
    indexes: [[`${table}_pkey`, ['id'], true, true], ...extraIndexes].map(([name, columns, unique, primary = false]) => ({
      name, columns, indisunique: unique, indisprimary: primary, indisvalid: true, indisready: true,
      no_predicate: true, no_expression: true, indnkeyatts: columns.length,
    })),
  };
}

function fixture(t, options = {}) {
  const state = { history: null, endorsement: false, progress: false, required: false, ...options };
  const tables = {
    SkillEndorsement: catalog('SkillEndorsement', [['endorserId', 'User'], ['userSkillId', 'UserSkill']], 'createdAt', [
      ['SkillEndorsement_endorserId_userSkillId_key', ['endorserId', 'userSkillId'], true],
    ]),
    ContentProgress: catalog('ContentProgress', [['enrollmentId', 'Enrollment'], ['contentId', 'CourseContent']], 'completedAt', [
      ['ContentProgress_enrollmentId_contentId_key', ['enrollmentId', 'contentId'], true],
      ['ContentProgress_contentId_idx', ['contentId'], false],
    ]),
  };
  const requiredColumn = { data_type: 'boolean', is_nullable: 'NO', column_default: 'true' };
  const executed = [];
  const queries = [];
  let transaction;
  const client = {
    async connect() {},
    async end() {},
    async query(sql, params) {
      queries.push(sql);
      const rows = value => ({ rows: value });
      if (sql === 'BEGIN') transaction = structuredClone(state);
      else if (sql === 'ROLLBACK') Object.assign(state, transaction);
      else if (sql === 'COMMIT' || sql.startsWith('SET LOCAL') || sql.includes('pg_advisory_xact_lock')) { /* no catalog change */ }
      else if (sql === 'SELECT current_schema()') return rows([{ current_schema: 'public' }]);
      else if (sql.includes('SELECT table_name, column_name')) return rows(
        ['User.id', 'UserSkill.id', 'UserSkill.userId', 'UserSkill.skillId', 'UserSkill.endorsements', 'CourseContent.id', 'Enrollment.id']
          .map(column => { const [table_name, column_name] = column.split('.'); return { table_name, column_name }; }));
      else if (sql.includes('AS history')) return rows([{
        history: state.history === null ? null : '_app_schema_upgrades',
        endorsement: state.endorsement ? 'SkillEndorsement' : null,
        progress: state.progress ? 'ContentProgress' : null, required: state.required,
      }]);
      else if (sql.includes('SELECT c.relkind')) {
        const table = params[0].replaceAll('"', '');
        const present = table === 'SkillEndorsement' ? state.endorsement : state.progress;
        return rows(present ? [{ relkind: tables[table].relkind }] : []);
      } else if (sql.includes('SELECT column_name, data_type')) return rows(tables[params[0]].columns);
      else if (sql.includes('FROM pg_constraint')) return rows(tables[params[0].replaceAll('"', '')].constraints);
      else if (sql.includes('FROM pg_index')) return rows(tables[params[0].replaceAll('"', '')].indexes);
      else if (sql.includes('SELECT data_type, is_nullable')) return rows(state.required ? [requiredColumn] : []);
      else if (sql.startsWith('CREATE TABLE "_app_schema_upgrades"')) state.history = [];
      else if (sql.startsWith('SELECT name, checksum')) return rows(structuredClone(state.history));
      else if (sql.startsWith('INSERT INTO "_app_schema_upgrades"')) state.history.push({ name: params[0], checksum: params[1] });
      else {
        const upgrade = upgrades.find(upgrade => upgrade.sql === sql);
        assert.ok(upgrade, `Unexpected SQL in runner test: ${sql}`);
        executed.push(upgrade.name);
        if (upgrade === upgrades[0]) {
          assert.equal(state.endorsement, false, 'runner must not recreate an existing endorsement table');
          state.endorsement = true;
        } else {
          assert.equal(state.progress, false, 'runner must not recreate existing progress');
          assert.equal(state.required, false, 'runner must not re-add an existing required column');
          if (state.failProgress) throw new Error('simulated pending progress failure');
          state.progress = true;
          state.required = true;
        }
      }
      return rows([]);
    },
  };
  t.mock.method(pg, 'Client', function Client() { return client; });
  return { state, tables, requiredColumn, executed, queries };
}

for (const count of [0, 1, 2]) {
  test(`runs only the missing suffix with ${count} recorded upgrades`, async t => {
    const { state, executed } = fixture(t, {
      history: count ? recorded(count) : null, endorsement: count >= 1, progress: count >= 2, required: count >= 2,
    });
    await applyPostgresqlUpgrades('postgresql://unused/database');
    assert.deepEqual(state.history, recorded(2));
    assert.deepEqual(executed, upgrades.slice(count).map(upgrade => upgrade.name));
    await applyPostgresqlUpgrades('postgresql://unused/database');
    assert.deepEqual(state.history, recorded(2));
    assert.equal(executed.length, 2 - count);
  });
}

for (const count of [1, 2]) {
  test(`baselines all ${count} verified untracked upgrades before applying the missing suffix`, async t => {
    const { state, executed } = fixture(t, { endorsement: true, progress: count === 2, required: count === 2 });
    await assert.rejects(applyPostgresqlUpgrades('postgresql://unused/database'), /without upgrade history/);
    assert.equal(state.history, null);
    await applyPostgresqlUpgrades('postgresql://unused/database', { baselineCurrentSchema: true });
    assert.deepEqual(state.history, recorded(2));
    assert.deepEqual(executed, upgrades.slice(count).map(upgrade => upgrade.name));
  });
}

const tampering = [
  ['partial progress column', ({ state }) => { state.progress = false; }, /ordinary table/],
  ['partial progress table', ({ state }) => { state.required = false; }, /isRequired differs/],
  ['required default', ({ requiredColumn }) => { requiredColumn.column_default = 'false'; }, /isRequired differs/],
  ['required nullability', ({ requiredColumn }) => { requiredColumn.is_nullable = 'YES'; }, /isRequired differs/],
  ['table kind', ({ tables }) => { tables.ContentProgress.relkind = 'v'; }, /ordinary table/],
  ['unexpected column', ({ tables }) => { tables.ContentProgress.columns.push({ column_name: 'unexpected' }); }, /unexpected columns/],
  ['timestamp precision', ({ tables }) => { tables.ContentProgress.columns[3].datetime_precision = 6; }, /completedAt differs/],
  ['foreign key cascade', ({ tables }) => { tables.ContentProgress.constraints[1].confdeltype = 'r'; }, /foreign key .* differs/],
  ['foreign key schema', ({ tables }) => { tables.ContentProgress.constraints[1].references_current_schema = false; }, /foreign key .* differs/],
  ['primary key', ({ tables }) => { tables.ContentProgress.constraints[0].columns = ['contentId']; }, /primary key differs/],
  ['missing lookup index', ({ tables }) => { tables.ContentProgress.indexes.pop(); }, /indexes differ/],
  ['missing unique constraint', ({ tables }) => { tables.ContentProgress.indexes[1].indisunique = false; }, /index .* differs/],
  ['index order', ({ tables }) => { tables.ContentProgress.indexes[1].columns.reverse(); }, /index .* differs/],
  ['partial index', ({ tables }) => { tables.ContentProgress.indexes[2].no_predicate = false; }, /index .* differs/],
  ['endorsement index', ({ tables }) => { tables.SkillEndorsement.indexes.pop(); }, /SkillEndorsement baseline indexes differ/],
];
for (const [name, change, expected] of tampering) {
  test(`refuses malformed baseline ${name} before recording history`, async t => {
    const result = fixture(t, { endorsement: true, progress: true, required: true });
    change(result);
    await assert.rejects(applyPostgresqlUpgrades('postgresql://unused/database', { baselineCurrentSchema: true }), expected);
    assert.equal(result.state.history, null);
    assert.deepEqual(result.executed, []);
    assert.equal(result.queries.at(-1), 'ROLLBACK');
  });
}

for (const [name, options, expected] of [
  ['missing endorsement', { history: recorded(2), progress: true, required: true }, /SkillEndorsement is missing/],
  ['missing progress', { history: recorded(2), endorsement: true, required: true }, /Course progress schema is missing/],
  ['missing required column', { history: recorded(2), endorsement: true, progress: true }, /Course progress schema is missing/],
  ['history gap', { history: recorded(2).slice(1), endorsement: true, progress: true, required: true }, /history has a gap/],
  ['changed checksum', { history: [{ ...recorded(1)[0], checksum: 'changed' }], endorsement: true }, /history mismatch/],
]) {
  test(`refuses recorded ${name}`, async t => {
    const { executed } = fixture(t, options);
    await assert.rejects(applyPostgresqlUpgrades('postgresql://unused/database'), expected);
    assert.deepEqual(executed, []);
  });
}

test('rolls back a newly verified baseline if applying its pending suffix fails', async t => {
  const { state, queries } = fixture(t, { endorsement: true, failProgress: true });
  await assert.rejects(applyPostgresqlUpgrades('postgresql://unused/database', { baselineCurrentSchema: true }), /simulated pending progress failure/);
  assert.equal(state.history, null);
  assert.equal(state.endorsement, true);
  assert.equal(state.progress, false);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('explicit baselining cannot alter an existing tracked history', async t => {
  const { state, executed } = fixture(t, { history: recorded(1), endorsement: true });
  await assert.rejects(applyPostgresqlUpgrades('postgresql://unused/database', { baselineCurrentSchema: true }), /requires an untracked/);
  assert.deepEqual(state.history, recorded(1));
  assert.deepEqual(executed, []);
});
