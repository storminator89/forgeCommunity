import 'server-only';

import { randomUUID } from 'node:crypto';
import { SPACE_ID_RE, SpaceApiError, type parseDiscussionInput, type parseReplyInput } from '@/lib/server/space-api';
import type { SpaceDiscussionDto, SpaceReplyDto } from '@/lib/server/space-discussions';
import { d1BoundedResponse, d1Date, d1ProjectionBudgetCtes, d1SpaceDatabase,
  d1TextBytes, type D1StoredDate } from '@/lib/server/d1-space-reads';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Mode = 'discussion' | 'reply';
type Input = ReturnType<typeof parseDiscussionInput> | ReturnType<typeof parseReplyInput>;
type Scalar = string | number | null;
const columns = ['kind', 'writable', 'parentReadable', 'isAdmin', 'existing', 'digestMatches', 'hidden', 'fits',
  'id', 'parentId', 'title', 'content', 'createdAt', 'updatedAt', 'hiddenAt', 'name', 'image'] as const;
type Row = Record<typeof columns[number], Scalar> & { kind: 'context' | 'content' | 'person' };
type Snapshot = { rows: Row[]; context: Row; record?: Row; person?: Row };
type Scope = { mode: Mode; userId: string; spaceId: string; discussionId: string; input: Input };
const MAX_COUNT = Number.MAX_SAFE_INTEGER;

function baseValues(scope: Scope) {
  return [scope.userId, scope.spaceId, scope.discussionId, scope.input.requestId, scope.input.payloadDigest];
}

/** Only source-owned table/column branches are interpolated. No large JSON cell:
 * response content and the current profile are distinct bounded typed rows. */
function snapshotSql(mode: Mode) {
  const discussion = mode === 'discussion';
  const table = discussion ? 'SpaceDiscussion' : 'SpaceReply';
  const parentColumn = discussion ? 'spaceId' : 'discussionId';
  const contentBytes = d1TextBytes('c."id"', `c."${parentColumn}"`, 'c."content"', 'c."createdAt"',
    'c."updatedAt"', 'c."hiddenAt"', ...(discussion ? ['c."title"'] : []));
  const personBytes = d1TextBytes('a."id"', 'a."name"', 'a."image"');
  return `WITH actor AS (
      SELECT "id", "name", "image", ("role" = 'ADMIN') AS isAdmin FROM "User" WHERE "id" = ?1
    ), writable AS (
      SELECT s."id" FROM actor a JOIN "SpaceMember" m ON m."userId" = a."id"
      JOIN "Space" s ON s."id" = m."spaceId" WHERE s."id" = ?2
    ), parent AS (
      ${discussion ? 'SELECT "id" FROM writable' : `SELECT d."id" FROM writable w JOIN "SpaceDiscussion" d
        ON d."spaceId" = w."id" AND d."id" = ?3 WHERE d."hiddenAt" IS NULL`}
    ), existing AS (
      SELECT c.* FROM parent p JOIN "${table}" c ON c."${parentColumn}" = p."id"
      WHERE c."authorId" = ?1 AND c."requestId" = ?4
    ), person AS (
      SELECT a.* FROM actor a WHERE EXISTS(SELECT 1 FROM parent)
    ), ${d1ProjectionBudgetCtes(`SELECT ${contentBytes} AS bytes FROM existing c
        UNION ALL SELECT ${personBytes} AS bytes FROM person a`,
      `SELECT ${personBytes} + COALESCE((SELECT ${contentBytes} FROM existing c), 0) AS bytes FROM person a`)}
    SELECT 'context' AS kind, EXISTS(SELECT 1 FROM writable) AS writable,
      EXISTS(SELECT 1 FROM parent) AS parentReadable,
      EXISTS(SELECT 1 FROM actor WHERE isAdmin = 1) AS isAdmin,
      EXISTS(SELECT 1 FROM existing) AS existing,
      EXISTS(SELECT 1 FROM existing WHERE "payloadDigest" = ?5) AS digestMatches,
      EXISTS(SELECT 1 FROM existing WHERE "hiddenAt" IS NOT NULL) AS hidden, b.fits,
      NULL AS id, NULL AS parentId, NULL AS title, NULL AS content, NULL AS createdAt,
      NULL AS updatedAt, NULL AS hiddenAt, NULL AS name, NULL AS image FROM projection_budget b
    UNION ALL
    SELECT 'content', NULL, NULL, NULL, NULL, NULL, NULL, NULL, c."id", c."${parentColumn}",
      ${discussion ? 'c."title"' : 'NULL'}, c."content", c."createdAt", c."updatedAt", c."hiddenAt", NULL, NULL
      FROM projection_budget b JOIN existing c ON b.fits = 1
    UNION ALL
    SELECT 'person', NULL, NULL, NULL, NULL, NULL, NULL, NULL, a."id", NULL, NULL, NULL,
      NULL, NULL, NULL, a."name", a."image" FROM projection_budget b JOIN person a ON b.fits = 1`;
}

async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql(scope.mode)).bind(...baseValues(scope)).all<Row>();
  const rows = result.results;
  const context = rows.find(row => row.kind === 'context');
  if (!context || rows.length > 3 || rows.some(row => !['context', 'content', 'person'].includes(row.kind)) ||
      new Set(rows.map(row => row.kind)).size !== rows.length) throw new Error('Invalid D1 Space content snapshot');
  return { rows, context, record: rows.find(row => row.kind === 'content'), person: rows.find(row => row.kind === 'person') };
}

function authorize(snapshot: Snapshot, scope: Scope) {
  const c = snapshot.context;
  if (c.writable !== 1) throw new SpaceApiError(scope.mode === 'discussion' ? 'Space nicht gefunden' : 'Diskussion nicht gefunden', 404);
  // A hidden reply parent is inaccessible even to ADMIN, including on replay.
  if (c.parentReadable !== 1) throw new SpaceApiError('Diskussion nicht gefunden', 404);
  if (c.existing === 1 && c.digestMatches !== 1) throw new SpaceApiError('Anfrage-ID wurde bereits verwendet', 409);
  if (c.hidden === 1 && c.isAdmin !== 1) throw new SpaceApiError(scope.mode === 'discussion' ? 'Diskussion nicht gefunden' : 'Antwort nicht gefunden', 404);
  if (c.fits !== 1) throw new Error('D1 Space content projection exceeds safe byte limits');
  if (!snapshot.person || (c.existing === 1) !== Boolean(snapshot.record)) throw new Error('Missing D1 Space content relation');
}

function date(value: Scalar) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid D1 Space content date');
  return d1Date(value as D1StoredDate).toISOString();
}

function prepareItem(record: Row, person: Row, scope: Scope): SpaceReplyDto | SpaceDiscussionDto {
  if (typeof record.id !== 'string' || !record.id || record.parentId !== (scope.mode === 'discussion' ? scope.spaceId : scope.discussionId) ||
      typeof record.content !== 'string' || person.id !== scope.userId ||
      (person.name !== null && typeof person.name !== 'string') || (person.image !== null && typeof person.image !== 'string')) {
    throw new Error('Invalid D1 Space content response');
  }
  const item = { id: record.id, content: record.content, createdAt: date(record.createdAt), updatedAt: date(record.updatedAt),
    hiddenAt: record.hiddenAt === null ? null : date(record.hiddenAt),
    author: { id: scope.userId, name: person.name, image: person.image } };
  if (scope.mode === 'discussion') {
    if (typeof record.title !== 'string') throw new Error('Invalid D1 Space discussion title');
    return d1BoundedResponse({ ...item, spaceId: scope.spaceId, title: record.title, replyCount: MAX_COUNT });
  }
  return d1BoundedResponse({ ...item, discussionId: scope.discussionId });
}

function blank(kind: Row['kind']): Row {
  return Object.fromEntries(columns.map(column => [column, column === 'kind' ? kind : null])) as Row;
}

function newRecord(scope: Scope): Row {
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  return { ...blank('content'), id: randomUUID(), parentId: scope.mode === 'discussion' ? scope.spaceId : scope.discussionId,
    title: 'title' in scope.input ? scope.input.title : null, content: scope.input.content,
    createdAt: now, updatedAt: now, hiddenAt: null };
}

function snapshotGuard(db: Database, scope: Scope, expected: Row[], invariant = false) {
  // At most3 rows x17 scalars +5 scope parameters =56 binds. VALUES preserves
  // raw date/profile/content bytes without JSON escaping or a large shared cell.
  const rows = expected.map((_, rowIndex) => `(${columns.map((_, index) => `?${6 + rowIndex * columns.length + index}`).join(', ')})`).join(', ');
  const equality = columns.map(column => `c."${column}" IS e."${column}"`).join(' AND ');
  return db.prepare(`WITH current AS (${snapshotSql(scope.mode)}),
    expected (${columns.map(column => `"${column}"`).join(', ')}) AS (VALUES ${rows})
    SELECT CASE WHEN (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
      AND NOT EXISTS(SELECT 1 FROM current c LEFT JOIN expected e ON c.kind = e.kind
        WHERE e.kind IS NULL OR NOT (${equality})) THEN 1
      ELSE ${invariant ? "json_extract('[]', 'D1_SPACE_CONTENT_WRITE_INVARIANT')" : "json('D1_SPACE_CONTENT_SNAPSHOT_CONFLICT')"} END AS guarded`)
    .bind(...baseValues(scope), ...expected.flatMap(row => columns.map(column => row[column])));
}

function insertContent(db: Database, scope: Scope, record: Row) {
  const values = [record.id, record.parentId, scope.userId, scope.input.requestId, scope.input.payloadDigest];
  return scope.mode === 'discussion'
    ? db.prepare(`INSERT INTO "SpaceDiscussion" ("id", "spaceId", "authorId", "requestId", "payloadDigest", "title", "content", "createdAt", "updatedAt", "hiddenAt")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(...values, record.title, record.content, record.createdAt, record.updatedAt)
    : db.prepare(`INSERT INTO "SpaceReply" ("id", "discussionId", "authorId", "requestId", "payloadDigest", "content", "createdAt", "updatedAt", "hiddenAt")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(...values, record.content, record.createdAt, record.updatedAt);
}

function finalCount(db: Database, scope: Scope, id: string) {
  if (scope.mode === 'reply') return db.prepare('SELECT 0 AS replyCount');
  return db.prepare(`WITH total AS (SELECT COUNT(*) AS n FROM "SpaceReply" WHERE "discussionId" = ?1 AND "hiddenAt" IS NULL)
    SELECT CASE WHEN typeof(n) = 'integer' AND n BETWEEN 0 AND ${MAX_COUNT} THEN n
      ELSE json_extract('[]', 'D1_SPACE_CONTENT_WRITE_INVARIANT') END AS replyCount FROM total`).bind(id);
}

function retryableRollback(error: unknown, mode: Mode) {
  let current = error;
  const fields = mode === 'discussion' ? ['SpaceDiscussion.spaceId', 'SpaceDiscussion.authorId', 'SpaceDiscussion.requestId']
    : ['SpaceReply.discussionId', 'SpaceReply.authorId', 'SpaceReply.requestId'];
  for (let depth = 0; depth < 6 && current; depth++) {
    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : '';
    if (/D1_SPACE_CONTENT_SNAPSHOT_CONFLICT|malformed JSON/i.test(message)) return true;
    // A global UUID or unexplained FK/UNIQUE collision is not a request replay.
    if (/UNIQUE constraint failed/i.test(message) && fields.every(field => message.includes(field))) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}

function sameSnapshot(left: Snapshot, right: Snapshot) {
  return left.rows.length === right.rows.length && left.rows.every(row => {
    const other = right.rows.find(value => value.kind === row.kind);
    return other && columns.every(column => row[column] === other[column]);
  });
}

async function writeContent(scope: Scope) {
  if (!SPACE_ID_RE.test(scope.userId)) throw new SpaceApiError(scope.mode === 'discussion' ? 'Space nicht gefunden' : 'Diskussion nicht gefunden', 404);
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  for (let attempt = 0; attempt < 4; attempt++) {
    authorize(snapshot, scope);
    const created = snapshot.context.existing !== 1;
    const record = snapshot.record ?? newRecord(scope);
    const item = prepareItem(record, snapshot.person!, scope);
    const statements = [snapshotGuard(db, scope, snapshot.rows)];
    if (created) {
      statements.push(insertContent(db, scope, record), db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1
        ELSE json_extract('[]', 'D1_SPACE_CONTENT_WRITE_INVARIANT') END AS guarded`));
      const after = [{ ...snapshot.context, existing: 1, digestMatches: 1, hidden: 0 }, record, snapshot.person!];
      statements.push(snapshotGuard(db, scope, after, true));
    }
    statements.push(finalCount(db, scope, record.id as string));
    try {
      const results = await db.batch(statements);
      const count = results[results.length - 1].results[0] as { replyCount: number } | undefined;
      if (!count) throw new Error('Missing committed D1 Space content result');
      // Metadata/dates/profile/full DTO were validated before any write and
      // asserted again in SQL before commit. Only the SQL-bounded count is new.
      if ('replyCount' in item) item.replyCount = count.replyCount;
      return { item, created };
    } catch (error) {
      if (!retryableRollback(error, scope.mode)) throw error;
      const current = await readSnapshot(db, scope);
      authorize(current, scope);
      if (sameSnapshot(snapshot, current)) throw error;
      snapshot = current;
    }
  }
  throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}

export async function createD1SpaceDiscussion(userId: string, spaceId: string, input: ReturnType<typeof parseDiscussionInput>) {
  return writeContent({ mode: 'discussion', userId, spaceId, discussionId: '', input });
}

export async function createD1SpaceReply(userId: string, spaceId: string, discussionId: string, input: ReturnType<typeof parseReplyInput>) {
  return writeContent({ mode: 'reply', userId, spaceId, discussionId, input });
}
