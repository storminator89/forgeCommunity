import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const upgradesDir = fileURLToPath(new URL('../prisma/postgresql-upgrades/', import.meta.url));

async function verifyCurrentSkillEndorsement(client) {
  const { rows: [{ relkind }] } = await client.query(`
    SELECT c.relkind FROM pg_class c WHERE c.oid = to_regclass('"SkillEndorsement"')`);
  if (relkind !== 'r') throw new Error('SkillEndorsement baseline must be an ordinary table.');
  const { rows: columns } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default, datetime_precision
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'SkillEndorsement'`);
  const actual = new Map(columns.map(column => [column.column_name, column]));
  if (actual.size !== 4 || ['id', 'endorserId', 'userSkillId', 'createdAt'].some(name => !actual.has(name))) {
    throw new Error('SkillEndorsement baseline has unexpected columns.');
  }
  for (const name of ['id', 'endorserId', 'userSkillId']) {
    const column = actual.get(name);
    if (column.data_type !== 'text' || column.is_nullable !== 'NO' || column.column_default !== null) {
      throw new Error(`SkillEndorsement baseline column ${name} differs from the reviewed upgrade.`);
    }
  }
  const created = actual.get('createdAt');
  if (created.data_type !== 'timestamp without time zone' || created.datetime_precision !== 3 ||
      created.is_nullable !== 'NO' || !/^(CURRENT_TIMESTAMP|now\(\))$/i.test(created.column_default ?? '')) {
    throw new Error('SkillEndorsement baseline createdAt differs from the reviewed upgrade.');
  }

  const { rows: constraints } = await client.query(`
    SELECT c.conname, c.contype, c.confdeltype, c.confupdtype, c.condeferrable, c.convalidated,
           c.confrelid = to_regclass('"User"') AS references_user,
           c.confrelid = to_regclass('"UserSkill"') AS references_user_skill,
           ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, n)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.n) AS columns,
           ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, n)
                 JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.n) AS referenced_columns
    FROM pg_constraint c WHERE c.conrelid = to_regclass('"SkillEndorsement"')`);
  const byName = new Map(constraints.map(constraint => [constraint.conname, constraint]));
  if (byName.size !== 3 || constraints.length !== 3) throw new Error('SkillEndorsement baseline constraints differ from the reviewed upgrade.');
  const primary = byName.get('SkillEndorsement_pkey');
  if (!primary || primary.contype !== 'p' || !primary.convalidated || primary.condeferrable ||
      JSON.stringify(primary.columns) !== '["id"]') {
    throw new Error('SkillEndorsement baseline primary key differs from the reviewed upgrade.');
  }
  for (const [name, column, reference] of [
    ['SkillEndorsement_endorserId_fkey', 'endorserId', 'references_user'],
    ['SkillEndorsement_userSkillId_fkey', 'userSkillId', 'references_user_skill'],
  ]) {
    const constraint = byName.get(name);
    if (!constraint || constraint.contype !== 'f' || !constraint[reference] ||
        constraint.confdeltype !== 'c' || constraint.confupdtype !== 'c' ||
        constraint.condeferrable || !constraint.convalidated ||
        JSON.stringify(constraint.columns) !== JSON.stringify([column]) ||
        JSON.stringify(constraint.referenced_columns) !== '["id"]') {
      throw new Error(`SkillEndorsement baseline foreign key ${name} differs from the reviewed upgrade.`);
    }
  }

  const { rows: indexes } = await client.query(`
    SELECT idx.relname AS name, i.indisunique, i.indisprimary, i.indisvalid, i.indisready,
           i.indpred IS NULL AS no_predicate, i.indexprs IS NULL AS no_expression,
           i.indnkeyatts,
           ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.n) AS columns
    FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE i.indrelid = to_regclass('"SkillEndorsement"')`);
  const byIndex = new Map(indexes.map(index => [index.name, index]));
  if (byIndex.size !== 2 || indexes.length !== 2) throw new Error('SkillEndorsement baseline indexes differ from the reviewed upgrade.');
  for (const [name, fields, primaryIndex] of [
    ['SkillEndorsement_pkey', ['id'], true],
    ['SkillEndorsement_endorserId_userSkillId_key', ['endorserId', 'userSkillId'], false],
  ]) {
    const index = byIndex.get(name);
    if (!index || !index.indisunique || index.indisprimary !== primaryIndex ||
        !index.indisvalid || !index.indisready || !index.no_predicate || !index.no_expression ||
        index.indnkeyatts !== fields.length || JSON.stringify(index.columns) !== JSON.stringify(fields)) {
      throw new Error(`SkillEndorsement baseline index ${name} differs from the reviewed upgrade.`);
    }
  }
}

export async function applyPostgresqlUpgrades(url, { baselineCurrentSchema = false } = {}) {
  if (!/^postgres(?:ql)?:\/\//.test(url ?? '')) {
    throw new Error('PostgreSQL upgrade requires DATABASE_URL=postgresql://...');
  }
  const files = readdirSync(upgradesDir).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  if (files.length === 0) throw new Error('No reviewed PostgreSQL upgrades found.');
  const known = new Map(files.map(name => {
    const sql = readFileSync(resolve(upgradesDir, name), 'utf8');
    return [name, { sql, checksum: createHash('sha256').update(sql).digest('hex') }];
  }));

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Prisma's ?schema= is not interpreted as a PostgreSQL search_path by pg.
    const requestedSchema = new URL(url).searchParams.get('schema');
    if (requestedSchema === '') throw new Error('PostgreSQL URL has an empty schema name.');
    const schema = requestedSchema ?? 'public';
    await client.query(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
    const { rows: [{ current_schema: currentSchema }] } = await client.query('SELECT current_schema()');
    if (currentSchema !== schema) throw new Error(`PostgreSQL schema ${schema} does not exist or is not accessible.`);
    // Serialize two deployments before checking history and the target schema.
    await client.query('SELECT pg_advisory_xact_lock(761834, 26)');
    const { rows: baseColumns } = await client.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('User', 'UserSkill')
        AND column_name IN ('id', 'userId', 'skillId', 'endorsements')`);
    const present = new Set(baseColumns.map(row => `${row.table_name}.${row.column_name}`));
    for (const column of ['User.id', 'UserSkill.id', 'UserSkill.userId', 'UserSkill.skillId', 'UserSkill.endorsements']) {
      if (!present.has(column)) {
        throw new Error(`Expected existing PostgreSQL baseline column ${column}; refusing to initialize a schema.`);
      }
    }

    const { rows: [{ history, target }] } = await client.query(`
      SELECT to_regclass('"_app_schema_upgrades"') AS history,
             to_regclass('"SkillEndorsement"') AS target`);
    if (!history && target) {
      if (!baselineCurrentSchema) {
        throw new Error('SkillEndorsement exists without upgrade history; use the explicit baseline option only after verifying a fresh schema.');
      }
      await verifyCurrentSkillEndorsement(client);
    } else if (baselineCurrentSchema) {
      throw new Error('Explicit baseline requires an untracked, verified SkillEndorsement table.');
    }
    if (!history) {
      await client.query(`CREATE TABLE "_app_schema_upgrades" (
        name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    }
    const { rows: applied } = await client.query('SELECT name, checksum FROM "_app_schema_upgrades" ORDER BY name');
    const completed = new Set();
    if (baselineCurrentSchema) {
      await client.query('INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)', [files[0], known.get(files[0]).checksum]);
      completed.add(files[0]);
      console.log(`Baselined verified PostgreSQL upgrade ${files[0]}`);
    }
    for (const { name, checksum } of applied) {
      if (!known.has(name) || known.get(name).checksum !== checksum) {
        throw new Error(`PostgreSQL upgrade history mismatch for ${name}; refusing to change schema.`);
      }
      completed.add(name);
    }
    if (completed.has(files[0]) && !target) {
      throw new Error('SkillEndorsement is missing despite recorded upgrade; refusing to proceed.');
    }
    let pending = false;
    for (const name of files) {
      if (!completed.has(name)) pending = true;
      else if (pending) throw new Error(`PostgreSQL upgrade history has a gap before ${name}.`);
    }
    for (const name of files) {
      if (completed.has(name)) continue;
      await client.query(known.get(name).sql);
      await client.query('INSERT INTO "_app_schema_upgrades" (name, checksum) VALUES ($1, $2)', [name, known.get(name).checksum]);
      console.log(`Applied PostgreSQL upgrade ${name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
