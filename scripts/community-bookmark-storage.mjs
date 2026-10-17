import { readFileSync } from 'node:fs';

const compact = value => value.replace(/\s+/g, ' ').trim().replace(/;$/, '');
// Only unquoted whitespace is insignificant. Preserve grouping, casts and
// quoted identifiers/literals; removing their characters can change a CHECK.
function checkShape(value) {
  let quote = null; let result = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      result += character;
      if (character === quote) {
        if (value[index + 1] === quote) result += value[++index];
        else quote = null;
      }
    } else if (character === "'" || character === '"') { quote = character; result += character; }
    else if (!/\s/.test(character)) result += character;
  }
  if (quote) throw new Error('Invalid community bookmark CHECK quoting');
  return result;
}
// Exact pg_get_constraintdef forms captured from the unchanged reviewed DDL
// with the existing PGlite17.5 deparser. This is not a general SQL normalizer.
const postgresCheckDefinitions = {
  "CommunityBookmark_revision_shape": "CHECK (((revision > 0) AND (revision <= 2147483647) AND (\"lastExpectedRevision\" >= 0) AND (\"lastExpectedRevision\" < revision)))",
  "CommunityBookmark_target_shape": "CHECK ((((\"postId\" IS NOT NULL) AND (\"commentId\" IS NULL)) OR ((\"postId\" IS NULL) AND (\"commentId\" IS NOT NULL))))"
};
const columns = {
  id: ['text', false, null], userId: ['text', false, null], postId: ['text', true, null], commentId: ['text', true, null],
  savedAt: ['timestamp without time zone', true, null], revision: ['integer', false, '1'],
  lastRequestId: ['text', false, null], lastExpectedRevision: ['integer', false, null],
};
const indexes = {
  CommunityBookmark_pkey: { columns: ['id'], unique: true, primary: true },
  CommunityBookmark_userId_postId_key: { columns: ['userId', 'postId'], unique: true },
  CommunityBookmark_userId_commentId_key: { columns: ['userId', 'commentId'], unique: true },
  CommunityBookmark_userId_savedAt_id_idx: { columns: ['userId', 'savedAt', 'id'], unique: false },
  CommunityBookmark_postId_idx: { columns: ['postId'], unique: false },
  CommunityBookmark_commentId_idx: { columns: ['commentId'], unique: false },
};
function readChecks(ddl) {
  return [...ddl.matchAll(/CONSTRAINT "([^"]+)" CHECK \(/g)].map(match => {
    const start = match.index + match[0].length - 1;
    let end = start + 1; let depth = 1;
    while (depth && end < ddl.length) { if (ddl[end] === '(') depth++; if (ddl[end] === ')') depth--; end++; }
    if (depth) throw new Error('Invalid reviewed community bookmark CHECK');
    return [match[1], checkShape(`CHECK ${ddl.slice(start, end)}`)];
  });
}
/** Read-only readiness on the selected namespace. History receipts alone must
 * not hide missing/wrong columns, weakened CHECKs/FKs or indexes on another table. */
export async function inspectCommunityBookmarkStorage(query, provider) {
  const file = provider === 'sqlite' ? '../prisma/sqlite-migrations/0030_community_bookmarks.sql' : '../prisma/postgresql-upgrades/0029_community_bookmarks.sql';
  const ddl = readFileSync(new URL(file, import.meta.url), 'utf8');
  if (provider === 'sqlite') {
    const objects = await query(`SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND tbl_name='CommunityBookmark' AND sql IS NOT NULL`);
    const actual = new Map(objects.map(row => [row.name, compact(row.sql ?? '')]));
    const expected = [...ddl.matchAll(/CREATE (?:TABLE|(?:UNIQUE )?INDEX) "([^"]+)"[\s\S]*?;/g)];
    if (actual.size !== expected.length) throw new Error('Community bookmark storage object inventory differs');
    for (const match of expected) if (actual.get(match[1]) !== compact(match[0])) throw new Error('Community bookmark storage shape differs');
    return;
  }
  if (provider !== 'postgresql') throw new Error('Unsupported community bookmark provider');
  const ordinary = await query(`SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname='CommunityBookmark'`);
  if (ordinary.length !== 1 || ordinary[0].relkind !== 'r') throw new Error('Community bookmark table is not an ordinary table in the selected schema');
  // information_schema.data_type describes a domain's underlying scalar, so
  // also require the column's actual OID to be the reviewed pg_catalog base type.
  const actualColumns = await query(`SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.datetime_precision, c.is_identity, c.is_generated,
      c.domain_schema, c.domain_name, pt.typtype AS type_kind,
      a.atttypid = CASE c.column_name
        WHEN 'savedAt' THEN 'pg_catalog.timestamp'::pg_catalog.regtype
        WHEN 'revision' THEN 'pg_catalog.int4'::pg_catalog.regtype
        WHEN 'lastExpectedRevision' THEN 'pg_catalog.int4'::pg_catalog.regtype
        ELSE 'pg_catalog.text'::pg_catalog.regtype END AS native_type
    FROM information_schema.columns c
    JOIN pg_catalog.pg_namespace n ON n.nspname=c.table_schema
    JOIN pg_catalog.pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name
    JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name AND a.attnum>0 AND NOT a.attisdropped
    JOIN pg_catalog.pg_type pt ON pt.oid=a.atttypid
    WHERE c.table_schema=current_schema() AND c.table_name='CommunityBookmark'`);
  if (actualColumns.length !== Object.keys(columns).length) throw new Error('Community bookmark column inventory differs');
  for (const [name, [type, nullable, fallback]] of Object.entries(columns)) {
    const column = actualColumns.find(value => value.column_name === name);
    if (!column || column.data_type !== type || column.is_nullable !== (nullable ? 'YES' : 'NO') || column.column_default !== fallback ||
        column.is_identity !== 'NO' || column.is_generated !== 'NEVER' || column.native_type !== true || column.type_kind !== 'b' ||
        column.domain_schema !== null || column.domain_name !== null || name === 'savedAt' && column.datetime_precision !== 3) throw new Error('Community bookmark column type/null/default differs');
  }
  const constraints = await query(`SELECT c.conname, c.contype, c.convalidated, c.condeferrable, c.condeferred,
      c.confdeltype, c.confupdtype, rt.relname AS reference_table, rn.nspname=current_schema() AS reference_schema,
      pg_get_constraintdef(c.oid) AS definition,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum,n) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.n) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum,n) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.n) AS reference_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_class rt ON rt.oid=c.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rt.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='CommunityBookmark'`);
  if (constraints.length !== 6) throw new Error('Community bookmark constraint inventory differs');
  const primary = constraints.find(row => row.conname === 'CommunityBookmark_pkey');
  if (!primary || primary.contype !== 'p' || !primary.convalidated || primary.condeferrable || JSON.stringify(primary.columns) !== '["id"]') throw new Error('Community bookmark primary key differs');
  for (const [name, shape] of readChecks(ddl)) {
    const row = constraints.find(value => value.conname === name);
    const nativeShape = postgresCheckDefinitions[name];
    if (!nativeShape || !row || row.contype !== 'c' || !row.convalidated || row.condeferrable ||
        ![shape, checkShape(nativeShape)].includes(checkShape(row.definition))) throw new Error('Community bookmark CHECK differs');
  }
  for (const [field, table] of [['userId', 'User'], ['postId', 'Post'], ['commentId', 'Comment']]) {
    const row = constraints.find(value => value.conname === `CommunityBookmark_${field}_fkey`);
    if (!row || row.contype !== 'f' || !row.convalidated || row.condeferrable || row.condeferred || row.confdeltype !== 'c' || row.confupdtype !== 'c' ||
        row.reference_table !== table || !row.reference_schema || JSON.stringify(row.columns) !== JSON.stringify([field]) || JSON.stringify(row.reference_columns) !== '["id"]') throw new Error('Community bookmark FK target/cascade differs');
  }
  const actualIndexes = await query(`SELECT idx.relname AS name, i.indisunique AS is_unique, i.indisprimary AS is_primary, i.indisvalid AS valid, i.indisready AS ready,
      i.indpred IS NULL AS no_predicate, i.indexprs IS NULL AS no_expression, i.indnkeyatts AS key_count, i.indnatts AS total_count, am.amname AS method,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum,n) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY k.n) AS columns
    FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=idx.relam
    WHERE n.nspname=current_schema() AND t.relname='CommunityBookmark'`);
  if (actualIndexes.length !== Object.keys(indexes).length) throw new Error('Community bookmark index inventory differs');
  for (const [name, expected] of Object.entries(indexes)) {
    const row = actualIndexes.find(value => value.name === name);
    if (!row || row.is_unique !== expected.unique || row.is_primary !== Boolean(expected.primary) || !row.valid || !row.ready || !row.no_predicate || !row.no_expression || row.method !== 'btree' ||
        row.key_count !== expected.columns.length || row.total_count !== expected.columns.length || JSON.stringify(row.columns) !== JSON.stringify(expected.columns)) throw new Error('Community bookmark index owner/order/uniqueness differs');
  }
}
