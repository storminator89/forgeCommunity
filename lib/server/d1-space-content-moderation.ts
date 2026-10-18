import 'server-only';

import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import type { SpaceDiscussionDto, SpaceReplyDto } from '@/lib/server/space-discussions';
import {
  D1_SPACE_ROW_BYTES, D1_SPACE_RESULT_BYTES, d1BoundedResponse, d1Date,
  d1ProjectionBudgetCtes, d1SpaceDatabase, d1TextBytes,
} from '@/lib/server/d1-space-reads';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Scalar = string | number | null;
type Mode = 'discussion' | 'reply';
type Scope = { mode: Mode; userId: string; spaceId: string; discussionId: string; replyId: string; hidden: boolean; now: string };
const columns = ['kind', 'isAdmin', 'authorized', 'spaceFits', 'targetExists', 'fits', 'id', 'spaceId',
  'discussionId', 'authorId', 'title', 'content', 'createdAt', 'updatedAt', 'hiddenAt',
  'replyCount', 'name', 'image'] as const;
type Column = typeof columns[number];
type Kind = 'context' | 'space' | 'parent' | 'target' | 'person';
type Row = Record<Column, Scalar> & { kind: Kind };
type Snapshot = { rows: Row[]; context: Row };
const DATE_LIMIT = 8640000000000000;
const snapshotMarker = 'D1_SPACE_CONTENT_MODERATION_SNAPSHOT_CONFLICT';
const invariantMarker = 'D1_SPACE_CONTENT_MODERATION_WRITE_INVARIANT';
const failure = (marker: string) => `json_extract('[]', '${marker}')`;
const notFound = (scope: Pick<Scope, 'mode'>) => new SpaceApiError(
  scope.mode === 'discussion' ? 'Diskussion nicht gefunden' : 'Antwort nicht gefunden', 404);
const conflict = () => new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);

function selectRow(kind: Kind, expressions: Partial<Record<Column, string>>) {
  return `SELECT ${columns.map(column => `${column === 'kind' ? `'${kind}'` : expressions[column] ?? 'NULL'} AS "${column}"`).join(', ')}`;
}

/** The stored ADMIN lookup precedes the raw caller-ID format gate. ADMIN
 * access has no visibility or membership predicate. Never select Space text,
 * private account fields, receipts, or a hidden-filtered parent/target. */
function snapshotSql(mode: Mode) {
  const discussion = mode === 'discussion';
  const content = discussion
    ? `SELECT d.id, d.spaceId, d.authorId, d.title, d.content, d.createdAt, d.updatedAt, d.hiddenAt,
        (SELECT COUNT(*) FROM SpaceReply r WHERE r.discussionId = d.id AND r.hiddenAt IS NULL) AS replyCount
      FROM access a JOIN SpaceDiscussion d ON d.spaceId = a.id AND d.id = ?3`
    : `SELECT r.id, r.discussionId, r.authorId, r.content, r.createdAt, r.updatedAt, r.hiddenAt
      FROM parent p JOIN SpaceReply r ON r.discussionId = p.id AND r.id = ?4`;
  const targetBytes = d1TextBytes('t.id', discussion ? 't.spaceId' : 't.discussionId', 't.authorId',
    ...(discussion ? ['t.title'] : []), 't.content', 't.createdAt', 't.updatedAt', 't.hiddenAt',
    ...(discussion ? ['t.replyCount'] : []));
  const personBytes = d1TextBytes('u.id', 'u.name', 'u.image');
  return `WITH actor AS (SELECT id FROM User WHERE id = ?1 AND role = 'ADMIN'),
    access AS (SELECT s.id, s.createdAt, s.updatedAt FROM actor a JOIN Space s ON s.id = ?2 WHERE ?5 = 1),
    space_budget AS (SELECT NOT EXISTS(SELECT 1 FROM access a
      WHERE ${d1TextBytes('a.createdAt')} > 1024 OR ${d1TextBytes('a.updatedAt')} > 1024) AS fits),
    parent AS (SELECT d.id, d.spaceId FROM access a JOIN SpaceDiscussion d ON d.spaceId = a.id AND d.id = ?3),
    target AS (${content}),
    people AS (SELECT u.id, u.name, u.image FROM target t JOIN User u ON u.id = t.authorId),
    ${d1ProjectionBudgetCtes(`SELECT ${targetBytes} AS bytes FROM target t
      UNION ALL SELECT ${personBytes} AS bytes FROM people u`,
    `SELECT ${targetBytes} + ${personBytes} AS bytes FROM target t JOIN people u ON u.id = t.authorId`)}
    ${selectRow('context', { isAdmin: 'EXISTS(SELECT 1 FROM actor)', authorized: 'EXISTS(SELECT 1 FROM access)',
      spaceFits: 's.fits', targetExists: 'EXISTS(SELECT 1 FROM target)', fits: 'b.fits' })}
      FROM space_budget s CROSS JOIN projection_budget b
    UNION ALL ${selectRow('space', { id: 'a.id', createdAt: 'a.createdAt', updatedAt: 'a.updatedAt' })}
      FROM space_budget s JOIN access a ON s.fits = 1
    ${discussion ? '' : `UNION ALL ${selectRow('parent', { id: 'p.id', spaceId: 'p.spaceId' })} FROM parent p`}
    UNION ALL ${selectRow('target', { id: 't.id', ...(discussion ? { spaceId: 't.spaceId', title: 't.title', replyCount: 't.replyCount' }
      : { discussionId: 't.discussionId' }), authorId: 't.authorId', content: 't.content', createdAt: 't.createdAt',
      updatedAt: 't.updatedAt', hiddenAt: 't.hiddenAt' })}
      FROM projection_budget b JOIN target t ON b.fits = 1
    UNION ALL ${selectRow('person', { id: 'u.id', name: 'u.name', image: 'u.image' })}
      FROM projection_budget b JOIN people u ON b.fits = 1`;
}

function scopeValues(scope: Scope): Scalar[] {
  return [scope.userId, scope.spaceId, scope.discussionId, scope.replyId, SPACE_ID_RE.test(scope.userId) ? 1 : 0];
}

/** Source-owned numbered placeholders only. Trim to the actual highest slot,
 * including intentional gaps, and bound every submitted statement/bind. */
function statement(db: Database, sql: string, values: Scalar[] = []) {
  const slots = [...sql.matchAll(/\?(\d+)/g)].map(match => Number(match[1]));
  const highest = Math.max(0, ...slots);
  if (Buffer.byteLength(sql, 'utf8') > 100000 || highest > 100 || highest > values.length ||
      slots.some(slot => !Number.isSafeInteger(slot) || slot < 1)) throw new Error('Unsafe D1 content moderation statement');
  const bound = values.slice(0, highest);
  if (bound.some(value => value !== null && typeof value !== 'string' &&
      (typeof value !== 'number' || !Number.isFinite(value))) ||
      bound.some(value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') > D1_SPACE_ROW_BYTES)) {
    throw new Error('Unsafe D1 content moderation binding');
  }
  const prepared = db.prepare(sql);
  return highest ? prepared.bind(...bound) : prepared;
}

async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await statement(db, snapshotSql(scope.mode), scopeValues(scope)).all<Row>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 5 ||
      result.results.some(row => !row || typeof row !== 'object')) throw new Error('Incomplete D1 content moderation snapshot');
  const contexts = result.results.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Missing D1 content moderation authority');
  return { rows: result.results, context: contexts[0] };
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid D1 content moderation integer');
  }
}
function text(value: unknown, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.length) || Buffer.byteLength(value, 'utf8') > D1_SPACE_ROW_BYTES) {
    throw new Error('Invalid D1 content moderation text');
  }
}
function storedDate(value: unknown): Date {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < -DATE_LIMIT || value > DATE_LIMIT) throw new Error('Invalid D1 content moderation numeric date');
    return d1Date(value);
  }
  text(value, true);
  if (Buffer.byteLength(value, 'utf8') > 1024) throw new Error('Oversized D1 content moderation date');
  // The pinned Prisma DataMapper's Jp also accepts date-only and short or
  // compact offsets. Normalize its absolute forms without opening time-only
  // or relative inputs; retain the existing minute-precision datetime forms.
  const dateOnly = /^\d{4}-\d\d-\d\d$/.exec(value);
  if (dateOnly && dateOnly[0] === value) return d1Date(`${value}T00:00:00Z`);
  const absolute = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(value);
  if (!absolute || absolute[0] !== value || value.includes('\0')) {
    throw new Error('Invalid D1 content moderation date');
  }
  let normalized = value.replace(' ', 'T');
  const zone = absolute[1];
  if (zone === undefined) normalized += 'Z';
  else if (zone !== 'Z' && zone.length === 3) normalized += ':00';
  return d1Date(normalized);
}
function row(snapshot: Snapshot, kind: Kind): Row {
  const matches = snapshot.rows.filter(item => item.kind === kind);
  if (matches.length !== 1) throw new Error(`Missing D1 content moderation ${kind}`);
  return matches[0];
}

/** Preserve source ordering: stored ADMIN403, caller/Space404, Space date
 * normalization500, target404, then full target/required-author validation.
 * Bounded absolute date forms use the shared JavaScript conversion; no SQL
 * date calculation or new calendar/offset restriction affects legacy dates.
 * There are no new legacy content length or sanitization rules. */
function prepare(snapshot: Snapshot, scope: Scope): SpaceDiscussionDto | SpaceReplyDto {
  const c = snapshot.context;
  if (c.isAdmin !== 1) throw new SpaceApiError('Nicht autorisiert', 403);
  if (c.authorized !== 1) throw notFound(scope);
  if (c.spaceFits !== 1) throw new Error('D1 content moderation Space dates exceed safe byte limits');
  const space = row(snapshot, 'space');
  if (space.id !== scope.spaceId) throw new Error('Invalid D1 content moderation Space');
  storedDate(space.createdAt); storedDate(space.updatedAt);
  if (c.targetExists !== 1) throw notFound(scope);
  if (c.fits !== 1) throw new Error('D1 content moderation projection exceeds safe byte limits');
  const allowed = new Map<Kind, readonly Column[]>([
    ['context', ['isAdmin', 'authorized', 'spaceFits', 'targetExists', 'fits']],
    ['space', ['id', 'createdAt', 'updatedAt']], ['parent', ['id', 'spaceId']],
    ['target', ['id', scope.mode === 'discussion' ? 'spaceId' : 'discussionId', 'authorId', 'content',
      'createdAt', 'updatedAt', 'hiddenAt', ...(scope.mode === 'discussion' ? ['title', 'replyCount'] as const : [])]],
    ['person', ['id', 'name', 'image']],
  ]);
  let bytes = 0;
  const seen = new Set<Kind>();
  for (const item of snapshot.rows) {
    const fields = allowed.get(item.kind);
    if (!fields || seen.has(item.kind) || Object.keys(item).length !== columns.length ||
        columns.some(column => !Object.hasOwn(item, column) ||
          (item[column] !== null && typeof item[column] !== 'string' &&
            (typeof item[column] !== 'number' || !Number.isFinite(item[column]) ||
              (!['createdAt', 'updatedAt', 'hiddenAt'].includes(column) && !Number.isSafeInteger(item[column])))) ||
          (column !== 'kind' && !fields.includes(column) && item[column] !== null))) {
      throw new Error('Invalid D1 content moderation row');
    }
    seen.add(item.kind);
    const size = columns.reduce((sum, column) => sum + (typeof item[column] === 'string'
      ? Buffer.byteLength(item[column] as string, 'utf8') : 32), 0);
    bytes += 6 * size + 4096;
    if (size > D1_SPACE_ROW_BYTES || bytes > D1_SPACE_RESULT_BYTES) throw new Error('Oversized D1 content moderation result');
  }
  if (snapshot.rows.length !== (scope.mode === 'discussion' ? 4 : 5) ||
      ['isAdmin', 'authorized', 'spaceFits', 'targetExists', 'fits'].some(key => c[key as Column] !== 1)) {
    throw new Error('Incomplete D1 content moderation projection');
  }
  const target = row(snapshot, 'target'), person = row(snapshot, 'person');
  if (target.id !== (scope.mode === 'discussion' ? scope.discussionId : scope.replyId)) throw new Error('Unscoped D1 content moderation target');
  text(target.authorId, true); text(target.content); text(person.id, true);
  if (target.authorId !== person.id) throw new Error('Missing required D1 content moderation author');
  if (person.name !== null) text(person.name);
  if (person.image !== null) text(person.image);
  const common = { id: target.id, content: target.content, createdAt: storedDate(target.createdAt).toISOString(),
    updatedAt: storedDate(target.updatedAt).toISOString(), hiddenAt: target.hiddenAt === null ? null : storedDate(target.hiddenAt).toISOString(),
    author: { id: person.id, name: person.name as string | null, image: person.image as string | null } };
  if (scope.mode === 'discussion') {
    if (target.spaceId !== scope.spaceId || seen.has('parent')) throw new Error('Unscoped D1 content moderation discussion');
    text(target.title); integer(target.replyCount);
    return d1BoundedResponse({ ...common, spaceId: target.spaceId, title: target.title, replyCount: target.replyCount });
  }
  const parent = row(snapshot, 'parent');
  if (parent.id !== scope.discussionId || parent.spaceId !== scope.spaceId || target.discussionId !== scope.discussionId) {
    throw new Error('Unscoped D1 content moderation reply');
  }
  return d1BoundedResponse({ ...common, discussionId: target.discussionId });
}

function afterSnapshot(before: Snapshot, scope: Scope, changed: boolean): Snapshot {
  if (!changed) return before;
  return { rows: before.rows.map(item => item.kind === 'target'
    ? { ...item, hiddenAt: scope.hidden ? scope.now : null, updatedAt: scope.now } : item), context: before.context };
}

/** Bind raw scalars separately, avoiding a large JSON manifest/cell and its
 * escaping overhead. At most25 slots; NULLs remain SQL NULL, never omitted
 * fields. Exact row count plus bidirectional comparisons fence the entire
 * consumed authority, Space dates, scope, content, author and visible count. */
function guard(db: Database, scope: Scope, snapshot: Snapshot, final: boolean) {
  const values = scopeValues(scope);
  const expected = snapshot.rows.map(item => selectRow(item.kind, Object.fromEntries(columns
    .filter(column => column !== 'kind' && item[column] !== null)
    .map(column => { values.push(item[column]); return [column, `?${values.length}`]; }))));
  const equal = columns.map(column => `c."${column}" IS e."${column}"`).join(' AND ');
  return statement(db, `WITH current AS (${snapshotSql(scope.mode)}), expected AS (${expected.join(' UNION ALL ')}),
    matched AS (SELECT (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
      AND NOT EXISTS(SELECT 1 FROM current c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equal}))
      AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM current c WHERE ${equal})) AS valid),
    assertion AS (SELECT CASE WHEN valid THEN 1 ELSE ${failure(final ? invariantMarker : snapshotMarker)} END AS guarded FROM matched)
    ${final ? 'SELECT c.*, a.guarded FROM assertion a CROSS JOIN current c' : 'SELECT guarded FROM assertion'}`, values);
}

function sameSnapshot(left: Snapshot, right: Snapshot) {
  const expected = new Map(right.rows.map(item => [item.kind, item]));
  return left.rows.length === right.rows.length && left.rows.every(item => {
    const other = expected.get(item.kind);
    return other && columns.every(column => item[column] === other[column]);
  });
}

/** Only an explicitly SQL-qualified first-preguard rollback is retryable.
 * Inspect the whole bounded cause chain; transport/unknown commit, BUSY,
 * constraints, CAS and end-invariant errors always outrank a nested marker. */
function retryableRollback(error: unknown) {
  const details: string[] = [], seen = new Set<unknown>();
  let current = error, total = 0;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return false;
      seen.add(current);
      if (typeof current === 'string') {
        if (current.length > 65536 || (total += current.length) > 262144) return false;
        details.push(current); break;
      }
      if (typeof current !== 'object') return false;
      const record = current as Record<string, unknown>;
      for (const field of ['message', 'name', 'code']) if (field in record) {
        const value = record[field];
        if (typeof value !== 'string' || value.length > 65536 || (total += value.length) > 262144) return false;
        if (field === 'code' && !/^(?:D1_ERROR|SQLITE_ERROR)$/.test(value)) return false;
        if (field === 'name' && !['Error', 'D1Error', 'D1_ERROR', 'SqliteError'].includes(value)) return false;
        details.push(value);
      }
      current = 'cause' in record ? record.cause : null;
    }
  } catch { return false; }
  if (details.some(value => /D1_[A-Z0-9_]*INVARIANT|\binvariant\b|constraint|\bunique\b|foreign[_\s-]*key|not[_\s-]*null|primary[_\s-]*key|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|cancel|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|\bRPC\b|\bHTTP\b|\bTLS\b|\bSSL\b|\bDNS\b|disconnect|broken pipe|unexpected token|invalid response|syntax error|no such (?:table|column|function)|datatype mismatch|out of memory/i.test(value))) return false;
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? [])
    .some(marker => !['D1_ERROR', snapshotMarker].includes(marker)))) return false;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? [])
    .some(code => code !== 'SQLITE_ERROR'))) return false;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b[^\n]*\bD1_SPACE_CONTENT_MODERATION_SNAPSHOT_CONFLICT\b|\bD1_SPACE_CONTENT_MODERATION_SNAPSHOT_CONFLICT\b[^\n]*\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value));
}

function assertResults(results: unknown, count: number, after: Snapshot, changed: boolean) {
  if (!Array.isArray(results) || results.length !== count || results.some(result => !result || typeof result !== 'object' ||
      result.success !== true || !Array.isArray(result.results))) throw new Error('Incomplete D1 content moderation batch');
  const smallGuard = (index: number) => {
    const rows = results[index].results;
    if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object' || Object.keys(rows[0]).length !== 1 || rows[0].guarded !== 1) {
      throw new Error('Invalid D1 content moderation assertion result');
    }
  };
  smallGuard(0);
  if (changed) {
    if (results[1].results.length !== 0) throw new Error('Unexpected D1 content moderation UPDATE result');
    smallGuard(2);
  }
  const finalRows = results[results.length - 1].results;
  if (finalRows.length !== after.rows.length) throw new Error('Incomplete committed D1 content moderation projection');
  const expected = new Map(after.rows.map(item => [item.kind, item]));
  for (const item of finalRows) {
    if (!item || typeof item !== 'object' || Object.keys(item).length !== columns.length + 1 || item.guarded !== 1) {
      throw new Error('Invalid committed D1 content moderation row');
    }
    const match = expected.get(item.kind);
    if (!match || columns.some(column => !Object.hasOwn(item, column) || item[column] !== match[column])) {
      throw new Error('Unexpected committed D1 content moderation projection');
    }
    expected.delete(item.kind);
  }
  if (expected.size !== 0) throw new Error('Missing committed D1 content moderation row');
}

/** Two snapshots and at most two atomic batches: <=10 helper statements,
 * <=12 including the existing <=2 auth statements. Genuine changes update
 * hiddenAt/updatedAt only, with one stable operation time, not a monotonicity
 * promise. Same-state is write-free, including legacy numeric hiddenAt0.
 * No postcommit read, receipt, revision, parent update or durable replay claim. */
async function moderate(scope: Scope): Promise<SpaceDiscussionDto | SpaceReplyDto> {
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  for (let attempt = 0; attempt < 2; attempt++) {
    const previous = prepare(snapshot, scope);
    const target = row(snapshot, 'target');
    const changed = (target.hiddenAt !== null) !== scope.hidden;
    const after = afterSnapshot(snapshot, scope, changed);
    const item = changed ? prepare(after, scope) : previous;
    const statements = [guard(db, scope, snapshot, false)];
    if (changed) {
      const sql = scope.mode === 'discussion'
        ? `UPDATE SpaceDiscussion SET hiddenAt = ?3, updatedAt = ?4
          WHERE id = ?1 AND spaceId = ?2 AND hiddenAt IS ?5 AND updatedAt IS ?6`
        : `UPDATE SpaceReply SET hiddenAt = ?3, updatedAt = ?4
          WHERE id = ?1 AND discussionId = ?2 AND hiddenAt IS ?5 AND updatedAt IS ?6
            AND EXISTS(SELECT 1 FROM SpaceDiscussion p WHERE p.id = ?2 AND p.spaceId = ?7)`;
      statements.push(statement(db, sql, [scope.mode === 'discussion' ? scope.discussionId : scope.replyId,
        scope.mode === 'discussion' ? scope.spaceId : scope.discussionId, scope.hidden ? scope.now : null,
        scope.now, target.hiddenAt, target.updatedAt, scope.spaceId]),
      statement(db, `SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`));
    }
    statements.push(guard(db, scope, after, true));
    let results: unknown;
    try { results = await db.batch(statements); }
    catch (error) {
      if (!retryableRollback(error)) throw error;
      if (attempt !== 0) throw conflict();
      const fresh = await readSnapshot(db, scope);
      prepare(fresh, scope);
      if (sameSnapshot(snapshot, fresh)) throw error;
      snapshot = fresh;
      continue;
    }
    // Successful-response decoding is outside the retry catch. The throwing
    // actual endguard already proved the complete validated DTO precommit.
    assertResults(results, statements.length, after, changed);
    return item;
  }
  throw conflict();
}

function input(mode: Mode, spaceId: string, discussionId: string, replyId: string, userId: string, hidden: boolean): Scope {
  if (typeof userId !== 'string' || typeof hidden !== 'boolean') throw new Error('Invalid parsed D1 content moderation input');
  if (typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId) || typeof discussionId !== 'string' || !SPACE_ID_RE.test(discussionId) ||
      (mode === 'reply' && (typeof replyId !== 'string' || !SPACE_ID_RE.test(replyId)))) throw notFound({ mode });
  const now = new Date();
  integer(now.getTime(), -DATE_LIMIT, DATE_LIMIT);
  return { mode, spaceId, discussionId, replyId, userId, hidden, now: now.toISOString().replace(/Z$/, '+00:00') };
}

export async function moderateD1SpaceDiscussion(
  spaceId: string, discussionId: string, userId: string, hidden: boolean,
): Promise<SpaceDiscussionDto> {
  return await moderate(input('discussion', spaceId, discussionId, '', userId, hidden)) as SpaceDiscussionDto;
}

export async function moderateD1SpaceReply(
  spaceId: string, discussionId: string, replyId: string, userId: string, hidden: boolean,
): Promise<SpaceReplyDto> {
  return await moderate(input('reply', spaceId, discussionId, replyId, userId, hidden)) as SpaceReplyDto;
}
