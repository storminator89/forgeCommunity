import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { LearningPathwayConflictError, LearningPathwayError } from '@/lib/server/learning-pathways';

// This helper writes only private participation and its append-only history.
// Operational bounds fail closed, without truncating a cohort or imposing a
// domain participation/course cap. Malformed legacy scalars are not repaired.
type Scalar = string | number | null;
const columns = ['kind', 'id', 'courseId', 'position', 'title', 'description', 'badgeLabel', 'sealedAt',
  'joinedAt', 'optedOutAt', 'badgeActive', 'badgeFirstAwardedAt', 'stateVersion', 'exists', 'publicationId',
  'enrolled', 'rewarded', 'changeId', 'version', 'type', 'reason', 'createdAt', 'authorized', 'found',
  'missing', 'published', 'total', 'needsAvailability', 'fits'] as const;
type Column = typeof columns[number];
type Kind = 'context' | 'definition' | 'course' | 'participation' | 'history';
type Row = Record<Column, Scalar> & { kind: Kind };
type Snapshot = { rows: Row[]; context: Row };
type Scope = { pathwayId: string; userId: string; join: boolean; now: string; operationId: string };
type State = { pathwayId: string; joinedAt: Scalar; optedOutAt: Scalar; badgeActive: number;
  badgeFirstAwardedAt: Scalar; stateVersion: number };
type Event = { id: string; pathwayId: string; version: number; type: 'AWARDED' | 'REINSTATED' | 'REVOKED';
  reason: 'ACCOUNT_INELIGIBLE' | 'OPTED_OUT' | 'REWARD_INVALIDATED' | null; createdAt: string };
type Update = { pathwayId: string; before: State; after: State };
type Pathway = { id: string; title: string; description: string; badgeLabel: string;
  courses: { courseId: string; title: string; order: number; available: boolean; isEnrolled: boolean; creditActive: boolean }[];
  unavailable: boolean; requiredCount: number; creditedCount: number;
  participation: null | { joinedAt: string; optedOutAt: string | null; badgeActive: boolean; badgeFirstAwardedAt: string | null };
  history: { type: string; reason: string | null; at: string }[] };
type Plan = { after: Snapshot; created: boolean; initial: State | null; updates: Update[]; events: Event[]; pathway: Pathway | null };
const MAX_VERSION = 2147483647;
const DATE_LIMIT = 8640000000000000;
const ROW_BYTES = 200000;
const RESULT_BYTES = 1200000;
const MANIFEST_BYTES = 1400000; // Strictly below D1's 1.5 MB conservative cell budget.
const snapshotMarker = 'D1_PATHWAY_PARTICIPATION_SNAPSHOT_CONFLICT';
const invariantMarker = 'D1_PATHWAY_PARTICIPATION_WRITE_INVARIANT';
const notFoundMarker = 'D1_PATHWAY_PARTICIPATION_FINAL_NOT_FOUND';
const failure = (marker: string) => `json_extract('[]', '${marker}')`;
const notFound = () => new LearningPathwayError('Pathway not found', 404);

function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
type Database = ReturnType<typeof database>;

function selectRow(kind: Kind, expressions: Partial<Record<Column, string>>) {
  return `SELECT ${columns.map(column => `${column === 'kind' ? `'${kind}'` : expressions[column] ?? 'NULL'} AS "${column}"`).join(', ')}`;
}
function textBytes(expressions: readonly string[]) {
  return expressions.map(expression => `COALESCE(length(CAST(${expression} AS BLOB)), 0)`).join(' + ');
}

/** One primary snapshot, not a callback transaction. Small source authority and
 * ordered domain checks precede all private transport/budget errors. Course
 * publication is checked with IS NOT NULL for first/rejoin, but its private DTO
 * uses JS string truthiness. Complete own sets include foreign/unsealed paths;
 * no LIMIT is used except the source-owned target history window of twenty. */
function snapshotSql() {
  const contextFields = { authorized: 'a.authorized', found: 'a.found', missing: 'a.missing',
    published: 'a.published', total: 'a.total', needsAvailability: 'a.needsAvailability', fits: 'b.fits' };
  return `WITH own AS (
      SELECT p.* FROM LearningPathwayParticipation p WHERE p.userId = ?1
    ), target AS (
      SELECT d.id, d.title, d.description, d.badgeLabel, d.sealedAt FROM LearningPathway d WHERE d.id = ?2 AND d.sealedAt IS NOT NULL
    ), definition_courses AS (
      SELECT c.pathwayId, c.position, c.courseId, c.title FROM LearningPathwayCourse c
      WHERE c.pathwayId = ?2 OR EXISTS(SELECT 1 FROM own p WHERE p.pathwayId = c.pathwayId)
    ), authority AS (
      SELECT EXISTS(SELECT 1 FROM User u WHERE u.id = ?1 AND u.role = 'USER' AND u.isTestAccount = 0) AS authorized,
        EXISTS(SELECT 1 FROM target) AS found,
        (SELECT COUNT(*) FROM definition_courses c LEFT JOIN Course live ON live.id = c.courseId
          WHERE c.pathwayId = ?2 AND live.id IS NULL) AS missing,
        (SELECT COUNT(*) FROM definition_courses c JOIN Course live ON live.id = c.courseId
          WHERE c.pathwayId = ?2 AND live.activePublicationId IS NOT NULL) AS published,
        (SELECT COUNT(*) FROM definition_courses c WHERE c.pathwayId = ?2) AS total,
        (?3 = 1 AND NOT EXISTS(SELECT 1 FROM own p WHERE p.pathwayId = ?2 AND p.optedOutAt IS NULL)) AS needsAvailability
    ), access AS (
      SELECT * FROM authority WHERE authorized = 1 AND found = 1
        AND (needsAvailability = 0 OR (missing = 0 AND published = total))
    ), recent_history AS (
      SELECT h.id, h.pathwayId, h.version, h.type, h.reason, h.createdAt FROM LearningPathwayChange h
      WHERE h.userId = ?1 AND h.pathwayId = ?2 AND EXISTS(SELECT 1 FROM own p WHERE p.pathwayId = ?2)
      ORDER BY h.version DESC LIMIT 20
    ), records AS (
      ${selectRow('definition', { id: 'd.id', title: 'd.title', description: 'd.description', badgeLabel: 'd.badgeLabel', sealedAt: 'd.sealedAt' })}
        FROM access a CROSS JOIN target d
      UNION ALL ${selectRow('participation', { id: 'p.pathwayId', joinedAt: 'p.joinedAt', optedOutAt: 'p.optedOutAt',
    badgeActive: 'p.badgeActive', badgeFirstAwardedAt: 'p.badgeFirstAwardedAt', stateVersion: 'p.stateVersion',
    exists: 'EXISTS(SELECT 1 FROM LearningPathway d WHERE d.id = p.pathwayId)' })} FROM access a CROSS JOIN own p
      UNION ALL ${selectRow('course', { id: 'c.pathwayId', courseId: 'c.courseId', position: 'c.position',
    title: 'CASE WHEN c.pathwayId = ?2 THEN c.title END', exists: 'CASE WHEN c.pathwayId = ?2 THEN live.id IS NOT NULL END',
    publicationId: 'CASE WHEN c.pathwayId = ?2 THEN live.activePublicationId END',
    enrolled: 'CASE WHEN c.pathwayId = ?2 THEN EXISTS(SELECT 1 FROM Enrollment e WHERE e.userId = ?1 AND e.courseId = c.courseId) END',
    rewarded: `EXISTS(SELECT 1 FROM RewardLedger r WHERE r.userId = ?1 AND r.eventType = 'COURSE_COMPLETED'
      AND r.sourceId = c.courseId AND r.revokedAt IS NULL)` })}
        FROM access a CROSS JOIN definition_courses c LEFT JOIN Course live ON c.pathwayId = ?2 AND live.id = c.courseId
      UNION ALL ${selectRow('history', { id: 'h.pathwayId', changeId: 'h.id', version: 'h.version', type: 'h.type',
    reason: 'h.reason', createdAt: 'h.createdAt' })} FROM access a CROSS JOIN recent_history h
    ), sizes AS (
      SELECT ${textBytes(columns.map(column => `r."${column}"`))} AS bytes,
        (${columns.map(column => `typeof(r."${column}") IN ('null', 'text', 'integer', 'real')`).join(' AND ')}) AS typed FROM records r
    ), budget AS (
      SELECT (COALESCE(MIN(typed), 1) = 1 AND COALESCE(MAX(bytes), 0) <= ${ROW_BYTES}
        AND COALESCE(SUM(6 * bytes + 4096), 0) + 4096 <= ${RESULT_BYTES}) AS fits FROM sizes
    )
    ${selectRow('context', contextFields)} FROM authority a CROSS JOIN budget b
    UNION ALL SELECT r.* FROM records r CROSS JOIN budget b WHERE b.fits = 1`;
}

/** Source-owned numbered slots only; JSON is bound data, never SQL text.
 * At most six occupied slots; every cell, emitted SQL and numeric binding is
 * checked before submission. No json_object has an arity proportional to rows. */
function statement(db: Database, sql: string, values: Scalar[] = []) {
  const slots = [...sql.matchAll(/\?(\d+)/g)].map(match => Number(match[1]));
  const highest = Math.max(0, ...slots);
  if (Buffer.byteLength(sql, 'utf8') > 100000 || highest > 100 || highest > values.length ||
    slots.some(slot => !Number.isSafeInteger(slot) || slot < 1)) throw new Error('Unsafe D1 Pathway statement');
  const bound = values.slice(0, highest);
  if (bound.some(value => value !== null && typeof value !== 'string' &&
    (typeof value !== 'number' || !Number.isFinite(value))) ||
    bound.some(value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 1500000)) {
    throw new Error('Unsafe D1 Pathway binding');
  }
  const prepared = db.prepare(sql);
  return highest ? prepared.bind(...bound) : prepared;
}
function scopeValues(scope: Scope): Scalar[] { return [scope.userId, scope.pathwayId, scope.join ? 1 : 0]; }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Invalid D1 Pathway integer');
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > ROW_BYTES) throw new Error('Invalid D1 Pathway text');
}
function bit(value: unknown): asserts value is number {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 Pathway boolean');
}
function storedDate(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < -DATE_LIMIT || value > DATE_LIMIT) throw new Error('Invalid D1 Pathway numeric date');
    const result = new Date(value);
    if (!Number.isFinite(result.getTime())) throw new Error('Invalid D1 Pathway date');
    return result.toISOString();
  }
  text(value);
  if (!value.length || Buffer.byteLength(value, 'utf8') > 1024) throw new Error('Oversized D1 Pathway date');
  // Same bounded absolute normalizer as the reviewed content-moderation path:
  // date-only, minute precision, fractions, 24:00 and short/compact offsets.
  const dateOnly = /^\d{4}-\d\d-\d\d$/.exec(value);
  let normalized: string;
  if (dateOnly && dateOnly[0] === value) normalized = `${value}T00:00:00Z`;
  else {
    const absolute = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(value);
    if (!absolute || absolute[0] !== value || value.includes('\0')) throw new Error('Invalid D1 Pathway date');
    normalized = value.replace(' ', 'T');
    if (absolute[1] === undefined) normalized += 'Z';
    else if (absolute[1] !== 'Z' && absolute[1].length === 3) normalized += ':00';
  }
  const result = new Date(normalized);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid D1 Pathway date');
  return result.toISOString();
}
function nullableDate(value: Scalar) { return value === null ? null : storedDate(value); }

/** Compute escaped JSON size before constructing a manifest/response. The SQL
 * pre-transport bound includes per-row key/escaping overhead; this second exact
 * check protects each complete before/after/update/event cell independently. */
function boundedJson(value: unknown): string {
  let bytes = 0;
  const add = (size: number) => { bytes += size; if (bytes > MANIFEST_BYTES) throw new Error('D1 Pathway manifest exceeds safe byte limits'); };
  const visit = (item: unknown): void => {
    if (item === null) { add(4); return; }
    if (typeof item === 'string') { add(Buffer.byteLength(JSON.stringify(item), 'utf8')); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw new Error('Invalid D1 Pathway JSON number'); add(String(item).length); return; }
    if (typeof item === 'boolean') { add(item ? 4 : 5); return; }
    if (Array.isArray(item)) { add(2 + Math.max(0, item.length - 1)); for (const entry of item) visit(entry); return; }
    if (typeof item === 'object') {
      const entries = Object.entries(item);
      add(2 + Math.max(0, entries.length - 1));
      for (const [key, entry] of entries) { add(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1); visit(entry); }
      return;
    }
    throw new Error('Invalid D1 Pathway JSON scalar');
  };
  visit(value);
  const result = JSON.stringify(value);
  if (Buffer.byteLength(result, 'utf8') !== bytes) throw new Error('Invalid D1 Pathway JSON size');
  return result;
}
function key(row: Row) {
  return row.kind === 'course' ? JSON.stringify([row.kind, row.id, row.position])
    : row.kind === 'history' ? JSON.stringify([row.kind, row.changeId]) : JSON.stringify([row.kind, row.id]);
}
function single(snapshot: Snapshot, kind: Kind) {
  const rows = snapshot.rows.filter(row => row.kind === kind);
  if (rows.length !== 1) throw new Error(`Incomplete D1 Pathway ${kind}`);
  return rows[0];
}

function authorize(snapshot: Snapshot) {
  const c = snapshot.context;
  if (c.authorized !== 1) throw new LearningPathwayError('Forbidden', 403);
  if (c.found !== 1) throw notFound();
  if (c.needsAvailability === 1) {
    // The source lock's Prisma.join([]) throws before querying an empty list.
    // Preserve that generic failure only for first/rejoin, without a 2–4 cap.
    if (c.total === 0) throw new Error('Cannot lock an empty Pathway course list');
    if (c.missing !== 0) throw new LearningPathwayError('A course is no longer available', 409);
    if (c.published !== c.total) throw new LearningPathwayError('Pathway is no longer available', 409);
  }
}

/** Validate the complete typed primary snapshot, retaining raw dates for IS
 * guards. Scalar, row, aggregate and complete-manifest bounds never truncate.
 * A broken required participation→definition relation fails closed rather than
 * disappearing through an inner join. Missing live Course rows are legitimate. */
function validate(snapshot: Snapshot, scope: Scope) {
  authorize(snapshot);
  if (snapshot.context.fits !== 1) throw new Error('D1 Pathway snapshot exceeds safe byte limits');
  const allowed: Record<Kind, readonly Column[]> = {
    context: ['authorized', 'found', 'missing', 'published', 'total', 'needsAvailability', 'fits'],
    definition: ['id', 'title', 'description', 'badgeLabel', 'sealedAt'],
    participation: ['id', 'joinedAt', 'optedOutAt', 'badgeActive', 'badgeFirstAwardedAt', 'stateVersion', 'exists'],
    course: ['id', 'courseId', 'position', 'title', 'exists', 'publicationId', 'enrolled', 'rewarded'],
    history: ['id', 'changeId', 'version', 'type', 'reason', 'createdAt'],
  };
  const keys = new Set<string>();
  let bytes = 4096;
  for (const row of snapshot.rows) {
    if (!row || typeof row !== 'object' || !Object.hasOwn(allowed, row.kind) || Object.keys(row).length !== columns.length ||
      columns.some(column => !Object.hasOwn(row, column) ||
        (row[column] !== null && typeof row[column] !== 'string' && (typeof row[column] !== 'number' || !Number.isFinite(row[column]))) ||
        (column !== 'kind' && !allowed[row.kind].includes(column) && row[column] !== null))) throw new Error('Invalid D1 Pathway row');
    const rawBytes = columns.reduce((sum, column) => sum + (typeof row[column] === 'string' ? Buffer.byteLength(row[column] as string, 'utf8') : 32), 0);
    bytes += 6 * rawBytes + 4096;
    if (rawBytes > ROW_BYTES || bytes > RESULT_BYTES) throw new Error('Oversized D1 Pathway snapshot');
    const identity = key(row);
    if (keys.has(identity)) throw new Error('Duplicate D1 Pathway snapshot row');
    keys.add(identity);
    switch (row.kind) {
      case 'context':
        for (const field of ['authorized', 'found', 'needsAvailability', 'fits'] as const) bit(row[field]);
        for (const field of ['missing', 'published', 'total'] as const) integer(row[field]);
        if ((row.published as number) > (row.total as number) || (row.missing as number) > (row.total as number)) throw new Error('Invalid D1 Pathway availability counts');
        break;
      case 'definition':
        if (row.id !== scope.pathwayId || row.sealedAt === null) throw new Error('Unscoped D1 Pathway definition');
        text(row.title); text(row.description); text(row.badgeLabel); storedDate(row.sealedAt);
        break;
      case 'participation':
        text(row.id); storedDate(row.joinedAt); nullableDate(row.optedOutAt); nullableDate(row.badgeFirstAwardedAt);
        bit(row.badgeActive); integer(row.stateVersion, 0, MAX_VERSION);
        if (row.exists !== 1) throw new Error('Missing required D1 Pathway definition');
        break;
      case 'course':
        text(row.id); text(row.courseId); integer(row.position, -2147483648, MAX_VERSION); bit(row.rewarded);
        if (row.id === scope.pathwayId) {
          text(row.title); bit(row.exists); bit(row.enrolled);
          if (row.publicationId !== null) text(row.publicationId);
          if (row.exists === 0 && row.publicationId !== null) throw new Error('Invalid D1 Pathway live course');
        } else if (row.title !== null || row.exists !== null || row.publicationId !== null || row.enrolled !== null) throw new Error('Unexpected foreign D1 Pathway projection');
        break;
      case 'history':
        if (row.id !== scope.pathwayId) throw new Error('Unscoped D1 Pathway history');
        text(row.changeId); integer(row.version, -2147483648, MAX_VERSION); text(row.type);
        if (row.reason !== null) text(row.reason);
        storedDate(row.createdAt);
        break;
    }
  }
  if (single(snapshot, 'context') !== snapshot.context) throw new Error('Invalid D1 Pathway authority row');
  single(snapshot, 'definition');
  const participations = new Set(snapshot.rows.filter(row => row.kind === 'participation').map(row => row.id));
  const courses = snapshot.rows.filter(row => row.kind === 'course');
  if (courses.some(row => row.id !== scope.pathwayId && !participations.has(row.id)) ||
    courses.filter(row => row.id === scope.pathwayId).length !== snapshot.context.total ||
    snapshot.rows.filter(row => row.kind === 'history').length > 20 ||
    (snapshot.rows.some(row => row.kind === 'history') && !participations.has(scope.pathwayId))) throw new Error('Incomplete D1 Pathway sets');
  const pairs = new Set<string>();
  for (const course of courses) {
    const pair = JSON.stringify([course.id, course.courseId]);
    if (pairs.has(pair)) throw new Error('Duplicate D1 Pathway course');
    pairs.add(pair);
  }
  boundedJson(snapshot.rows);
}
async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await statement(db, snapshotSql(), scopeValues(scope)).all<Row>();
  if (result.success !== true || !Array.isArray(result.results) || !result.results.length ||
    result.results.some(row => !row || typeof row !== 'object')) throw new Error('Incomplete D1 Pathway snapshot');
  const contexts = result.results.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Missing D1 Pathway authority');
  const snapshot = { rows: result.results, context: contexts[0] };
  validate(snapshot, scope);
  return snapshot;
}

function state(row: Row): State {
  return { pathwayId: row.id as string, joinedAt: row.joinedAt, optedOutAt: row.optedOutAt,
    badgeActive: row.badgeActive as number, badgeFirstAwardedAt: row.badgeFirstAwardedAt, stateVersion: row.stateVersion as number };
}
function participationRow(value: State): Row {
  const row = Object.fromEntries(columns.map(column => [column, null])) as unknown as Row;
  return { ...row, kind: 'participation', id: value.pathwayId, joinedAt: value.joinedAt, optedOutAt: value.optedOutAt,
    badgeActive: value.badgeActive, badgeFirstAwardedAt: value.badgeFirstAwardedAt, stateVersion: value.stateVersion, exists: 1 };
}
function eventRow(value: Event): Row {
  const row = Object.fromEntries(columns.map(column => [column, null])) as unknown as Row;
  return { ...row, kind: 'history', id: value.pathwayId, changeId: value.id, version: value.version,
    type: value.type, reason: value.reason, createdAt: value.createdAt };
}
const stateFields = ['joinedAt', 'optedOutAt', 'badgeActive', 'badgeFirstAwardedAt', 'stateVersion'] as const;
function equalState(left: State, right: State) { return stateFields.every(field => left[field] === right[field]); }
function project(snapshot: Snapshot, scope: Scope): Pathway | null {
  const definition = single(snapshot, 'definition');
  const own = snapshot.rows.find(row => row.kind === 'participation' && row.id === scope.pathwayId);
  const participating = own !== undefined && own.optedOutAt === null;
  const courses = snapshot.rows.filter(row => row.kind === 'course' && row.id === scope.pathwayId)
    .sort((a, b) => (a.position as number) - (b.position as number)).map(row => ({ courseId: row.courseId as string,
      title: row.title as string, order: row.position as number, available: row.exists === 1 && Boolean(row.publicationId),
      isEnrolled: row.enrolled === 1, creditActive: participating && row.rewarded === 1 }));
  const unavailable = courses.some(course => !course.available);
  if (unavailable && !own) return null;
  const pathway: Pathway = { id: definition.id as string, title: definition.title as string,
    description: definition.description as string, badgeLabel: definition.badgeLabel as string, courses, unavailable,
    requiredCount: courses.length, creditedCount: courses.filter(course => course.creditActive).length,
    participation: own ? { joinedAt: storedDate(own.joinedAt), optedOutAt: nullableDate(own.optedOutAt),
      badgeActive: own.badgeActive === 1, badgeFirstAwardedAt: nullableDate(own.badgeFirstAwardedAt) } : null,
    history: snapshot.rows.filter(row => row.kind === 'history').sort((a, b) => (b.version as number) - (a.version as number))
      .map(row => ({ type: row.type as string, reason: row.reason as string | null, at: storedDate(row.createdAt) })) };
  boundedJson(pathway);
  return pathway;
}

/** First insert is the explicit equivalent of the source defaults. Rejoin
 * retains badge version/first-award/history. Direct badge-active Leave creates
 * exactly one event; generic reconciliation sees that already-inactive state.
 * Every increment uses old stateVersion + 1; MAX without increment is legal. */
function plan(snapshot: Snapshot, scope: Scope): Plan {
  const before = new Map(snapshot.rows.filter(row => row.kind === 'participation').map(row => [row.id as string, state(row)]));
  const after = new Map([...before].map(([id, value]) => [id, { ...value }]));
  const target = after.get(scope.pathwayId);
  const created = scope.join && !target;
  const initial: State | null = created ? { pathwayId: scope.pathwayId, joinedAt: scope.now, optedOutAt: null,
    badgeActive: 0, badgeFirstAwardedAt: null, stateVersion: 0 } : null;
  if (initial) after.set(scope.pathwayId, { ...initial });
  else if (scope.join && target && target.optedOutAt !== null) { target.joinedAt = scope.now; target.optedOutAt = null; }
  const events: Event[] = [];
  const event = (value: State, type: Event['type'], reason: Event['reason']) => {
    if (value.stateVersion === MAX_VERSION) throw new Error('D1 Pathway badge version cannot be incremented');
    value.stateVersion += 1;
    events.push({ id: `${scope.operationId}:${events.length}`, pathwayId: value.pathwayId,
      version: value.stateVersion, type, reason, createdAt: scope.now });
  };
  if (!scope.join && target && target.optedOutAt === null) {
    target.optedOutAt = scope.now;
    if (target.badgeActive === 1) { event(target, 'REVOKED', 'OPTED_OUT'); target.badgeActive = 0; }
  }
  const byPath = new Map<string, Row[]>();
  for (const course of snapshot.rows.filter(row => row.kind === 'course')) {
    const items = byPath.get(course.id as string) ?? [];
    items.push(course); byPath.set(course.id as string, items);
  }
  for (const value of after.values()) {
    const courses = byPath.get(value.pathwayId) ?? [];
    const eligible = snapshot.context.authorized === 1;
    const qualifies = eligible && value.optedOutAt === null && courses.length >= 2 && courses.every(course => course.rewarded === 1);
    if (qualifies === (value.badgeActive === 1)) continue;
    event(value, qualifies ? value.badgeFirstAwardedAt === null ? 'AWARDED' : 'REINSTATED' : 'REVOKED',
      qualifies ? null : !eligible ? 'ACCOUNT_INELIGIBLE' : value.optedOutAt !== null ? 'OPTED_OUT' : 'REWARD_INVALIDATED');
    value.badgeActive = qualifies ? 1 : 0;
    if (qualifies && value.badgeFirstAwardedAt === null) value.badgeFirstAwardedAt = scope.now;
  }
  const updates: Update[] = [];
  for (const [id, value] of after) {
    const old = before.get(id) ?? initial;
    if (!old) throw new Error('Missing D1 Pathway old state');
    if (!equalState(old, value)) updates.push({ pathwayId: id, before: old, after: value });
  }
  const context = { ...snapshot.context, needsAvailability: scope.join ? 0 : snapshot.context.needsAvailability };
  const history = [...snapshot.rows.filter(row => row.kind === 'history'), ...events.filter(value => value.pathwayId === scope.pathwayId).map(eventRow)]
    .sort((a, b) => (b.version as number) - (a.version as number)).slice(0, 20);
  const rows = [context, ...snapshot.rows.filter(row => row.kind !== 'context' && row.kind !== 'participation' && row.kind !== 'history'),
    ...[...after.values()].map(participationRow), ...history];
  const result = { rows, context };
  validate(result, scope);
  boundedJson(updates); boundedJson(events);
  return { after: result, created, initial, updates, events, pathway: project(result, scope) };
}

function expectedRows(slot: number) {
  return `SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(?${slot}) j`;
}
function equality(left: string, right: string) { return columns.map(column => `${left}."${column}" IS ${right}."${column}"`).join(' AND '); }
function eventCte(slot: number) {
  return `SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.pathwayId') AS pathwayId,
    json_extract(j.value, '$.version') AS version, json_extract(j.value, '$.type') AS type,
    json_extract(j.value, '$.reason') AS reason, json_extract(j.value, '$.createdAt') AS createdAt FROM json_each(?${slot}) j`;
}

/** Cardinality plus both anti-joins fence additions/removals and raw mutable
 * facts, including all own states/course sets, active reward/enrollment facts,
 * target live publication and latest20 history. No live trigger is assumed. */
function guard(db: Database, scope: Scope, expected: Snapshot, final: boolean, events: Event[] = []) {
  const values = [...scopeValues(scope), boundedJson(expected.rows), boundedJson(events)];
  const collision = `EXISTS(SELECT 1 FROM planned_events p JOIN LearningPathwayChange h
    ON h.id = p.id OR (h.userId = ?1 AND h.pathwayId = p.pathwayId AND h.version = p.version))`;
  const eventGuard = final ? `, actual_events AS (
      SELECT h.id, h.pathwayId, h.version, h.type, h.reason, h.createdAt FROM LearningPathwayChange h
      WHERE h.userId = ?1 AND substr(h.id, 1, length(?6) + 1) = ?6 || ':'
    ), events_matched AS (SELECT (SELECT COUNT(*) FROM actual_events) = (SELECT COUNT(*) FROM planned_events)
      AND NOT EXISTS(SELECT 1 FROM actual_events a WHERE NOT EXISTS(SELECT 1 FROM planned_events p
        WHERE a.id IS p.id AND a.pathwayId IS p.pathwayId AND a.version IS p.version AND a.type IS p.type AND a.reason IS p.reason AND a.createdAt IS p.createdAt))
      AND NOT EXISTS(SELECT 1 FROM planned_events p WHERE NOT EXISTS(SELECT 1 FROM actual_events a
        WHERE a.id IS p.id AND a.pathwayId IS p.pathwayId AND a.version IS p.version AND a.type IS p.type AND a.reason IS p.reason AND a.createdAt IS p.createdAt))
      AND NOT EXISTS(SELECT 1 FROM planned_events p WHERE
        (SELECT COUNT(*) FROM LearningPathwayChange h WHERE h.id = p.id) <> 1 OR
        (SELECT COUNT(*) FROM LearningPathwayChange h WHERE h.userId = ?1 AND h.pathwayId = p.pathwayId AND h.version = p.version) <> 1) AS valid)` : '';
  if (final) values.push(scope.operationId);
  const sql = `WITH current AS (${snapshotSql()}), expected AS (${expectedRows(4)}), planned_events AS (${eventCte(5)}),
    matched AS (SELECT (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
      AND NOT EXISTS(SELECT 1 FROM current c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equality('c', 'e')}))
      AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM current c WHERE ${equality('c', 'e')})) AS valid)
    ${eventGuard}, assertion AS (SELECT CASE
      WHEN m.valid = 0${final ? ' OR e.valid = 0' : ''} THEN ${failure(final ? invariantMarker : snapshotMarker)}
      ${final ? '' : `WHEN ${collision} THEN ${failure(invariantMarker)}`}
      ${final ? `WHEN NOT EXISTS(SELECT 1 FROM current p WHERE p.kind = 'participation' AND p.id = ?2)
        AND EXISTS(SELECT 1 FROM current c WHERE c.kind = 'course' AND c.id = ?2
          AND (c."exists" = 0 OR c.publicationId IS NULL OR c.publicationId = '')) THEN ${failure(notFoundMarker)}` : ''}
      ELSE 1 END AS guarded FROM matched m ${final ? 'CROSS JOIN events_matched e' : ''})
    ${final ? 'SELECT c.*, a.guarded FROM assertion a CROSS JOIN current c' : 'SELECT guarded FROM assertion'}`;
  return statement(db, sql, values);
}
function changedGuard(db: Database, count: number) {
  return statement(db, `SELECT CASE WHEN changes() = ?1 THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`, [count]);
}
function updateCte() {
  return `SELECT json_extract(j.value, '$.pathwayId') AS pathwayId,
    ${stateFields.flatMap(field => [`json_extract(j.value, '$.before.${field}') AS "old_${field}"`,
      `json_extract(j.value, '$.after.${field}') AS "new_${field}"`]).join(', ')} FROM json_each(?2) j`;
}
function batch(db: Database, scope: Scope, before: Snapshot, planned: Plan) {
  const statements = [guard(db, scope, before, false, planned.events)];
  const mutationIndexes: number[] = [];
  const addMutation = (value: ReturnType<typeof statement>, count: number) => {
    mutationIndexes.push(statements.length);
    statements.push(value, changedGuard(db, count));
  };
  if (planned.initial) addMutation(statement(db, `INSERT INTO LearningPathwayParticipation
    (userId, pathwayId, joinedAt, optedOutAt, badgeActive, badgeFirstAwardedAt, stateVersion)
    VALUES (?1, ?2, ?3, NULL, 0, NULL, 0)`, [scope.userId, scope.pathwayId, scope.now]), 1);
  if (planned.events.length) addMutation(statement(db, `WITH planned AS (${eventCte(2)})
    INSERT INTO LearningPathwayChange (id, userId, pathwayId, version, type, reason, createdAt)
    SELECT id, ?1, pathwayId, version, type, reason, createdAt FROM planned`, [scope.userId, boundedJson(planned.events)]), planned.events.length);
  if (planned.updates.length) addMutation(statement(db, `WITH planned AS (${updateCte()})
    UPDATE LearningPathwayParticipation SET
      ${stateFields.map(field => `"${field}" = (SELECT p."new_${field}" FROM planned p WHERE p.pathwayId = LearningPathwayParticipation.pathwayId)`).join(', ')}
    WHERE userId = ?1 AND EXISTS(SELECT 1 FROM planned p WHERE p.pathwayId = LearningPathwayParticipation.pathwayId
      AND ${stateFields.map(field => `LearningPathwayParticipation."${field}" IS p."old_${field}"`).join(' AND ')})`,
  [scope.userId, boundedJson(planned.updates)]), planned.updates.length);
  statements.push(guard(db, scope, planned.after, true, planned.events));
  if (statements.length > 8) throw new Error('Unexpected D1 Pathway statement count');
  return { statements, mutationIndexes };
}

function sameSnapshot(left: Snapshot, right: Snapshot) {
  const expected = new Map(right.rows.map(row => [key(row), row]));
  return left.rows.length === right.rows.length && left.rows.every(row => {
    const other = expected.get(key(row));
    return other !== undefined && columns.every(column => row[column] === other[column]);
  });
}

/** Deny-first, bounded, whole-cause SQL qualification. Only our own first
 * throwing preguard proves a retryable rollback. All constraints (including
 * event ID/version collisions), CAS/endguard, BUSY, transport and unknown
 * commit failures stop. The final404 has its own SQL-qualified rollback path. */
function sqlRollback(error: unknown, marker: string) {
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
  if (details.some(value => /D1_[A-Z0-9_]*INVARIANT|\binvariant\b|constraint|\bunique\b|foreign[_\s-]*key|not[_\s-]*null|primary[_\s-]*key|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|cancel|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|\bRPC\b|\bHTTP\b|\bTLS\b|\bSSL\b|\bDNS\b|disconnect|broken pipe|unexpected token|invalid response|syntax error|no such (?:table|column|function)|datatype mismatch|out of memory|\bBUSY\b|\blocked\b/i.test(value))) return false;
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? []).some(value => !['D1_ERROR', marker].includes(value)))) return false;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? []).some(value => value !== 'SQLITE_ERROR'))) return false;
  const qualified = new RegExp(`\\b(?:D1_ERROR|SQLITE_ERROR)\\b[^\\n]*\\b${marker}\\b|\\b${marker}\\b[^\\n]*\\b(?:D1_ERROR|SQLITE_ERROR)\\b`);
  return details.some(value => qualified.test(value));
}
function assertResults(results: unknown, count: number, mutationIndexes: number[], after: Snapshot): Snapshot {
  if (!Array.isArray(results) || results.length !== count || results.some(result => !result || typeof result !== 'object' ||
    result.success !== true || !Array.isArray(result.results))) throw new Error('Incomplete D1 Pathway batch');
  const smallGuard = (index: number) => {
    const rows = results[index].results;
    if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object' || Object.keys(rows[0]).length !== 1 || rows[0].guarded !== 1) {
      throw new Error('Invalid D1 Pathway assertion result');
    }
  };
  smallGuard(0);
  for (const index of mutationIndexes) {
    if (results[index].results.length !== 0) throw new Error('Unexpected D1 Pathway mutation result');
    smallGuard(index + 1);
  }
  const finalRows = results[count - 1].results;
  if (finalRows.length !== after.rows.length) throw new Error('Incomplete committed D1 Pathway projection');
  const expected = new Map(after.rows.map(row => [key(row), row]));
  const rows: Row[] = [];
  for (const item of finalRows) {
    if (!item || typeof item !== 'object' || Object.keys(item).length !== columns.length + 1 || item.guarded !== 1 ||
      columns.some(column => !Object.hasOwn(item, column))) throw new Error('Invalid committed D1 Pathway row');
    const match = expected.get(key(item));
    if (!match || columns.some(column => item[column] !== match[column])) throw new Error('Unexpected committed D1 Pathway projection');
    expected.delete(key(item));
    rows.push(Object.fromEntries(columns.map(column => [column, item[column]])) as Row);
  }
  if (expected.size) throw new Error('Missing committed D1 Pathway row');
  const contexts = rows.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Missing committed D1 Pathway authority');
  return { rows, context: contexts[0] };
}

/** <=4 snapshots plus <=4 atomic batches of <=8 statements = <=36 helper
 * statements, <=38 including the existing <=2 auth statements. No extra read
 * on the final conflict; operation identity/time are stable across proven safe
 * retries. StateVersion is badge history, not an ABA fence/client epoch or a
 * durable replay receipt. Successful decoding never enters the retry catch. */
export async function setD1LearningPathwayParticipation(pathwayId: string, userId: string, join: boolean): Promise<{ pathway: Pathway; created: boolean }> {
  if (typeof pathwayId !== 'string' || typeof userId !== 'string' || typeof join !== 'boolean') throw new Error('Invalid parsed D1 Pathway input');
  // Raw requested IDs are not trimmed, regex-normalized or reinterpreted.
  if (Buffer.byteLength(pathwayId, 'utf8') >= 1500000 || Buffer.byteLength(userId, 'utf8') >= 1500000) throw new Error('Oversized D1 Pathway input');
  const scope: Scope = { pathwayId, userId, join, now: new Date().toISOString().replace(/Z$/, '+00:00'), operationId: `pathway:${randomUUID()}` };
  const db = database();
  let snapshot = await readSnapshot(db, scope);
  for (let attempt = 0; attempt < 4; attempt++) {
    const planned = plan(snapshot, scope);
    const prepared = batch(db, scope, snapshot, planned);
    let results: unknown;
    try { results = await db.batch(prepared.statements); }
    catch (error) {
      if (sqlRollback(error, notFoundMarker)) throw notFound();
      if (!sqlRollback(error, snapshotMarker)) throw error;
      if (attempt === 3) throw new LearningPathwayConflictError();
      const fresh = await readSnapshot(db, scope);
      if (sameSnapshot(snapshot, fresh)) throw error;
      snapshot = fresh;
      continue;
    }
    const committed = assertResults(results, prepared.statements.length, prepared.mutationIndexes, planned.after);
    validate(committed, scope);
    const pathway = project(committed, scope);
    if (!pathway || !planned.pathway || boundedJson(pathway) !== boundedJson(planned.pathway)) throw new Error('Invalid committed D1 Pathway DTO');
    return { pathway, created: planned.created };
  }
  throw new LearningPathwayConflictError();
}
