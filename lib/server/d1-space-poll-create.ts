import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { SPACE_ID_RE, SPACE_REQUEST_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import type { parsePollInput } from '@/lib/server/space-polls';
import type { d1SpacePoll } from '@/lib/server/d1-space-poll-reads';
import {
  D1_SPACE_ROW_BYTES, d1BoundedResponse, d1Date, d1DateMs, d1ProjectionBudgetCtes,
  d1SpaceDatabase, d1TextBytes,
} from '@/lib/server/d1-space-reads';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Input = ReturnType<typeof parsePollInput>;
type PollDto = Awaited<ReturnType<typeof d1SpacePoll>>;
type Scalar = string | number | null;
const columns = [
  'kind', 'authorized', 'canManage', 'isMember', 'actorRole', 'visibility', 'memberJoinedAt',
  'existing', 'creatorMatches', 'digestMatches', 'spaceDaily', 'ownDaily', 'quotaDatesValid', 'fits',
  'id', 'spaceId', 'creatorId', 'payloadDigest', 'question', 'createdAt', 'createdAtMs', 'closedAt',
  'hiddenAt', 'moderationRevision', 'ownOptionId', 'ownRevision', 'pollId', 'label', 'position', 'votes',
] as const;
type Row = Record<typeof columns[number], Scalar> & { kind: 'context' | 'poll' | 'option' };
type Snapshot = { rows: Row[]; context: Row; poll?: Row; options: Row[] };
type Scope = { userId: string; spaceId: string; input: Input };
type AttemptTime = { now: string; nowMs: number; since: number };
const DATE_LIMIT = 8640000000000000;
const notFound = () => new SpaceApiError('Umfrage nicht gefunden', 404);
const invariantFailure = "json_extract('[]', 'D1_SPACE_POLL_CREATE_WRITE_INVARIANT')";

function selectRow(kind: Row['kind'], values: Partial<Record<typeof columns[number], string>>) {
  return `SELECT ${columns.map(column => `${column === 'kind' ? `'${kind}'` : values[column] ?? 'NULL'} AS "${column}"`).join(', ')}`;
}

/** Validate every relevant quota timestamp, including those whose malformed
 * value could otherwise disappear below the cutoff. No quota row is projected.
 * Text fractions are truncated to milliseconds just as Date does; calendar and
 * zone components are checked before trusting SQLite's permissive date parser. */
function quotaDateValid() {
  return `CASE
    WHEN typeof(raw) IN ('integer', 'real') THEN raw = CAST(raw AS INTEGER)
      AND raw BETWEEN -${DATE_LIMIT} AND ${DATE_LIMIT}
    WHEN typeof(raw) = 'text' THEN
      instr(CAST(raw AS BLOB), x'00') = 0
      AND substr(raw, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND substr(raw, 11, 9) GLOB '[ T][0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
      AND CAST(substr(raw, 6, 2) AS INTEGER) BETWEEN 1 AND 12
      AND CAST(substr(raw, 9, 2) AS INTEGER) BETWEEN 1 AND
        CASE CAST(substr(raw, 6, 2) AS INTEGER)
          WHEN 2 THEN 28 + (CAST(substr(raw, 1, 4) AS INTEGER) % 4 = 0
            AND (CAST(substr(raw, 1, 4) AS INTEGER) % 100 <> 0 OR CAST(substr(raw, 1, 4) AS INTEGER) % 400 = 0))
          WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END
      AND CAST(substr(raw, 12, 2) AS INTEGER) BETWEEN 0 AND 23
      AND CAST(substr(raw, 15, 2) AS INTEGER) BETWEEN 0 AND 59
      AND CAST(substr(raw, 18, 2) AS INTEGER) BETWEEN 0 AND 59
      AND (fractionEnd = 19 OR (fractionEnd >= 21 AND substr(raw, 20, 1) = '.'
        AND substr(raw, 21, fractionEnd - 20) NOT GLOB '*[^0-9]*'))
      AND (zoneLength <> 6 OR (substr(raw, -6) GLOB '[+-][0-9][0-9]:[0-9][0-9]'
        AND CAST(substr(raw, -5, 2) AS INTEGER) BETWEEN 0 AND 23
        AND CAST(substr(raw, -2, 2) AS INTEGER) BETWEEN 0 AND 59))
    ELSE 0 END`;
}

/** ?1 actor, ?2 Space, ?3 scoped request, ?4 server digest, ?5 cutoff,
 * ?6 keeps quotas enabled for the new receipt's final-state assertion only. */
function snapshotSql() {
  const normalizedDate = `substr(raw, 1, 19)
    || CASE WHEN fractionEnd > 19 THEN '.' || substr(substr(raw, 21, MIN(3, fractionEnd - 20)) || '000', 1, 3) ELSE '' END
    || CASE zoneLength WHEN 1 THEN 'Z' WHEN 6 THEN substr(raw, -6) ELSE '' END`;
  const contextBytes = d1TextBytes('a."role"', 'a."visibility"', 'a."joinedAt"');
  const pollBytes = d1TextBytes('p."id"', 'p."spaceId"', 'p."creatorId"', 'p."payloadDigest"',
    'p."question"', 'p."createdAt"', 'p."closedAt"', 'p."hiddenAt"', 'p."moderationRevision"',
    'p."ownOptionId"', 'p."ownRevision"');
  const optionBytes = d1TextBytes('o."id"', 'o."pollId"', 'o."label"', 'o."position"', 'o."votes"');
  return `WITH actor AS (
      SELECT "id", "role" FROM "User" WHERE "id" = ?1
    ), access AS (
      SELECT s."id", s."visibility", a."role", (a."role" = 'ADMIN') AS canManage,
        (m."userId" IS NOT NULL) AS isMember, m."joinedAt"
      FROM actor a JOIN "Space" s ON s."id" = ?2
      LEFT JOIN "SpaceMember" m ON m."spaceId" = s."id" AND m."userId" = a."id"
      WHERE s."visibility" = 'PUBLIC' OR a."role" = 'ADMIN' OR m."userId" IS NOT NULL
    ), receipt AS (
      SELECT p.*, ${d1DateMs('p."createdAt"')} AS createdAtMs,
        own."optionId" AS ownOptionId, own."revision" AS ownRevision
      FROM access a JOIN "SpacePoll" p ON p."spaceId" = a."id" AND p."requestId" = ?3
      LEFT JOIN "SpacePollVote" own ON own."pollId" = p."id" AND own."userId" = ?1
      WHERE a.canManage = 1
    ), option_rows AS (
      SELECT o."id", o."pollId", o."label", o."position",
        (SELECT COUNT(*) FROM "SpacePollVote" v WHERE v."pollId" = o."pollId" AND v."optionId" = o."id") AS votes
      FROM receipt p JOIN "SpacePollOption" o ON o."pollId" = p."id"
    ), quota_enabled AS (
      SELECT 1 FROM access WHERE canManage = 1 AND (?6 = 1 OR NOT EXISTS(SELECT 1 FROM receipt))
    ), quota_source AS (
      SELECT p."spaceId", p."creatorId", p."createdAt" AS raw FROM "SpacePoll" p
      WHERE EXISTS(SELECT 1 FROM quota_enabled) AND (p."spaceId" = ?2 OR p."creatorId" = ?1)
    ), quota_zones AS (
      SELECT *, CASE WHEN typeof(raw) = 'text' AND substr(raw, -1) = 'Z' THEN 1
        WHEN typeof(raw) = 'text' AND substr(raw, -6, 1) IN ('+', '-') THEN 6 ELSE 0 END AS zoneLength
      FROM quota_source
    ), quota_parts AS (
      SELECT *, length(raw) - zoneLength AS fractionEnd FROM quota_zones
    ), quota_times AS (
      SELECT *, ${quotaDateValid()} AS dateValid,
        ${d1DateMs(`CASE WHEN typeof(raw) = 'text' THEN ${normalizedDate} ELSE raw END`)} AS atMs
      FROM quota_parts
    ), quota AS (
      SELECT CASE WHEN EXISTS(SELECT 1 FROM quota_enabled)
          THEN COALESCE(SUM(CASE WHEN "spaceId" = ?2 AND atMs >= ?5 THEN 1 ELSE 0 END), 0) ELSE NULL END AS spaceDaily,
        CASE WHEN EXISTS(SELECT 1 FROM quota_enabled)
          THEN COALESCE(SUM(CASE WHEN "creatorId" = ?1 AND atMs >= ?5 THEN 1 ELSE 0 END), 0) ELSE NULL END AS ownDaily,
        CASE WHEN EXISTS(SELECT 1 FROM quota_enabled) THEN NOT EXISTS(SELECT 1 FROM quota_times
          WHERE dateValid IS NOT 1 OR typeof(atMs) <> 'integer' OR atMs NOT BETWEEN -${DATE_LIMIT} AND ${DATE_LIMIT})
          ELSE NULL END AS quotaDatesValid
      FROM quota_times
    ), ${d1ProjectionBudgetCtes(`SELECT ${contextBytes} AS bytes FROM access a
      UNION ALL SELECT ${pollBytes} AS bytes FROM receipt p
      UNION ALL SELECT ${optionBytes} AS bytes FROM option_rows o`)}
    ${selectRow('context', {
      authorized: 'EXISTS(SELECT 1 FROM access)',
      canManage: 'COALESCE((SELECT canManage FROM access), 0)',
      isMember: 'COALESCE((SELECT isMember FROM access), 0)',
      actorRole: 'CASE WHEN b.fits = 1 THEN (SELECT "role" FROM access) ELSE NULL END',
      visibility: 'CASE WHEN b.fits = 1 THEN (SELECT "visibility" FROM access) ELSE NULL END',
      memberJoinedAt: 'CASE WHEN b.fits = 1 THEN (SELECT "joinedAt" FROM access) ELSE NULL END',
      existing: 'EXISTS(SELECT 1 FROM receipt)',
      creatorMatches: 'EXISTS(SELECT 1 FROM receipt WHERE "creatorId" = ?1)',
      digestMatches: 'EXISTS(SELECT 1 FROM receipt WHERE "payloadDigest" = ?4)',
      spaceDaily: 'q.spaceDaily', ownDaily: 'q.ownDaily', quotaDatesValid: 'q.quotaDatesValid', fits: 'b.fits',
      spaceId: '(SELECT "id" FROM access)',
    })} FROM projection_budget b CROSS JOIN quota q
    UNION ALL
    ${selectRow('poll', {
      id: 'p."id"', spaceId: 'p."spaceId"', creatorId: 'p."creatorId"', payloadDigest: 'p."payloadDigest"',
      question: 'p."question"', createdAt: 'p."createdAt"', createdAtMs: 'p.createdAtMs', closedAt: 'p."closedAt"',
      hiddenAt: 'p."hiddenAt"', moderationRevision: 'p."moderationRevision"', ownOptionId: 'p.ownOptionId', ownRevision: 'p.ownRevision',
    })} FROM projection_budget b JOIN receipt p ON b.fits = 1
    UNION ALL
    ${selectRow('option', {
      id: 'o."id"', pollId: 'o."pollId"', label: 'o."label"', position: 'o."position"', votes: 'o.votes',
    })} FROM projection_budget b JOIN option_rows o ON b.fits = 1
    ORDER BY kind, position, id`;
}

function values(scope: Scope, time: AttemptTime, includeQuotas = false) {
  return [scope.userId, scope.spaceId, scope.input.requestId, scope.input.payloadDigest, time.since, includeQuotas ? 1 : 0];
}

async function readSnapshot(db: Database, scope: Scope, time: AttemptTime): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql()).bind(...values(scope, time)).all<Row>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('Incomplete D1 Space poll CREATE snapshot');
  const rows = result.results;
  const contexts = rows.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Missing D1 Space poll CREATE context');
  return { rows, context: contexts[0], poll: rows.find(row => row.kind === 'poll'), options: rows.filter(row => row.kind === 'option') };
}

function integer(value: unknown, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid D1 Space poll CREATE integer');
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SPACE_ID_RE.test(value)) throw new Error('Invalid D1 Space poll CREATE identifier');
}

function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 Space poll CREATE flag');
}

function storedDate(value: unknown): Date {
  if (typeof value === 'number') {
    integer(value, Number.MIN_SAFE_INTEGER);
    return d1Date(value);
  }
  if (typeof value !== 'string') throw new Error('Invalid D1 Space poll CREATE timestamp');
  const parts = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/.exec(value);
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 Space poll CREATE timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > calendar.getUTCDate() ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 Space poll CREATE timestamp');
  }
  return d1Date(value);
}

/** Access404 and current stored ADMIN403 precede receipt/quota/projection errors. */
function prepareSnapshot(snapshot: Snapshot, scope: Scope, includeQuotas = false): PollDto | undefined {
  const c = snapshot.context;
  if (c.authorized !== 1) throw notFound();
  if (c.canManage !== 1) throw new SpaceApiError('Nicht autorisiert', 403);
  if (c.existing === 1 && (c.creatorMatches !== 1 || c.digestMatches !== 1)) {
    throw new SpaceApiError('Anfrage-ID bereits verwendet', 409);
  }
  if (c.fits !== 1) throw new Error('D1 Space poll CREATE projection exceeds safe byte limits');
  const keys = new Set<string>();
  for (const row of snapshot.rows) {
    if (!['context', 'poll', 'option'].includes(row.kind) || columns.some(column => {
      const value = row[column];
      return value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isSafeInteger(value));
    })) throw new Error('Invalid D1 Space poll CREATE scalar');
    const key = `${row.kind}:${row.id}`;
    if (keys.has(key)) throw new Error('Duplicate D1 Space poll CREATE snapshot row');
    keys.add(key);
  }
  flag(c.isMember); flag(c.existing); flag(c.creatorMatches); flag(c.digestMatches);
  if (c.actorRole !== 'ADMIN' || c.spaceId !== scope.spaceId ||
      (c.visibility !== 'PUBLIC' && c.visibility !== 'PRIVATE')) throw new Error('Invalid D1 Space poll CREATE authority');
  if (c.isMember === 1) storedDate(c.memberJoinedAt);
  else if (c.memberJoinedAt !== null) throw new Error('Invalid D1 Space poll CREATE membership');
  if (includeQuotas || c.existing === 0) {
    integer(c.spaceDaily); integer(c.ownDaily);
    if (c.quotaDatesValid !== 1) throw new Error('Invalid D1 Space poll CREATE quota timestamp');
    if (c.existing === 0 && (c.spaceDaily >= 10 || c.ownDaily >= 20)) {
      throw new SpaceApiError('Heute wurden bereits genügend Umfragen erstellt. Bitte später erneut versuchen.', 429);
    }
  } else if (c.spaceDaily !== null || c.ownDaily !== null || c.quotaDatesValid !== null) {
    throw new Error('Unexpected D1 Space poll CREATE replay quota');
  }
  if (c.existing === 0) {
    if (snapshot.rows.length !== 1 || snapshot.poll || snapshot.options.length || c.creatorMatches !== 0 || c.digestMatches !== 0) {
      throw new Error('Unexpected D1 Space poll CREATE receipt');
    }
    return undefined;
  }
  const poll = snapshot.poll;
  if (!poll || snapshot.rows.length !== snapshot.options.length + 2) throw new Error('Incomplete D1 Space poll CREATE receipt');
  identifier(poll.id); identifier(poll.spaceId);
  integer(poll.moderationRevision); integer(poll.createdAtMs, Number.MIN_SAFE_INTEGER);
  if (poll.spaceId !== scope.spaceId || poll.creatorId !== scope.userId || poll.payloadDigest !== scope.input.payloadDigest ||
      typeof poll.question !== 'string') throw new Error('Invalid D1 Space poll CREATE receipt');
  const createdAt = storedDate(poll.createdAt);
  if (createdAt.getTime() !== poll.createdAtMs) throw new Error('Invalid D1 Space poll CREATE date key');
  const closedAt = poll.closedAt === null ? null : storedDate(poll.closedAt).toISOString();
  const hiddenAt = poll.hiddenAt === null ? null : storedDate(poll.hiddenAt).toISOString();
  let ownVote: PollDto['ownVote'];
  if (poll.ownOptionId === null && poll.ownRevision === null) ownVote = { optionId: null, revision: 0 };
  else {
    identifier(poll.ownOptionId); integer(poll.ownRevision);
    ownVote = { optionId: poll.ownOptionId, revision: poll.ownRevision };
  }
  const options: PollDto['options'] = [];
  const optionIds = new Set<string>();
  let previousPosition: number | undefined;
  let totalVotes = 0;
  for (const option of snapshot.options) {
    identifier(option.id); identifier(option.pollId);
    integer(option.position, Number.MIN_SAFE_INTEGER); integer(option.votes);
    if (option.pollId !== poll.id || typeof option.label !== 'string' || optionIds.has(option.id) ||
        (previousPosition !== undefined && option.position <= previousPosition)) throw new Error('Invalid D1 Space poll CREATE option');
    totalVotes += option.votes;
    integer(totalVotes);
    options.push({ id: option.id, label: option.label, votes: option.votes });
    optionIds.add(option.id);
    previousPosition = option.position;
  }
  if (ownVote.optionId !== null && !optionIds.has(ownVote.optionId)) throw new Error('Invalid D1 Space poll CREATE own vote');
  return d1BoundedResponse({
    id: poll.id, spaceId: poll.spaceId, question: poll.question, createdAt: createdAt.toISOString(), closedAt, hiddenAt,
    moderationRevision: poll.moderationRevision, options, totalVotes, ownVote,
    canVote: c.isMember === 1 && closedAt === null && hiddenAt === null, canManage: true,
  });
}

function manifest(snapshot: Snapshot) {
  const json = JSON.stringify(snapshot.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  // The bound cell and every JSON-each object stay below D1's cell/row limit.
  // An oversized legacy option collection fails closed, never truncates.
  if (Buffer.byteLength(json, 'utf8') > D1_SPACE_ROW_BYTES) throw new Error('D1 Space poll CREATE snapshot manifest exceeds safe byte limits');
  return json;
}

/** One bounded manifest, not one bind per legacy option. Equality uses raw
 * stored scalars (including dates), and both directions plus exact cardinality
 * prevent missing, extra, duplicate or partially matched projected rows. */
function balancedEquality(terms: readonly string[], start = 0, end = terms.length): string {
  if (end - start === 1) return terms[start];
  const middle = start + Math.floor((end - start) / 2);
  return `(${balancedEquality(terms, start, middle)} AND ${balancedEquality(terms, middle, end)})`;
}

function guardedSnapshot(db: Database, scope: Scope, time: AttemptTime, expected: string,
  includeQuotas = false, final = false) {
  // Preserve all 30 NULL-safe IS leaves, but reduce their AND nesting
  // from 29 levels in the left-associated chain to 5 in this balanced tree.
  const equality = balancedEquality(columns.map(column => `c."${column}" IS e."${column}"`));
  return db.prepare(`WITH current AS (${snapshotSql()}), expected AS (
      SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(?7) j
    ), matched AS (
      SELECT (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
        AND NOT EXISTS(SELECT 1 FROM current c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equality}))
        AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM current c WHERE ${equality})) AS valid
    ), assertion AS (
      SELECT CASE WHEN valid THEN 1 ELSE ${final ? invariantFailure : "json('D1_SPACE_POLL_CREATE_SNAPSHOT_CONFLICT')"} END AS guarded FROM matched
    ) ${final ? 'SELECT c.*, a.guarded FROM assertion a CROSS JOIN current c ORDER BY c.kind, c.position, c.id' : 'SELECT guarded FROM assertion'}`)
    .bind(...values(scope, time, includeQuotas), expected);
}

function blank(kind: Row['kind']): Row {
  return Object.fromEntries(columns.map(column => [column, column === 'kind' ? kind : null])) as Row;
}

function newSnapshot(before: Snapshot, scope: Scope, time: AttemptTime): Snapshot {
  const poll: Row = {
    ...blank('poll'), id: randomUUID(), spaceId: scope.spaceId, creatorId: scope.userId, payloadDigest: scope.input.payloadDigest,
    question: scope.input.question, createdAt: time.now, createdAtMs: time.nowMs,
    closedAt: null, hiddenAt: null, moderationRevision: 0, ownOptionId: null, ownRevision: null,
  };
  const options = scope.input.options.map((label, position): Row => ({
    ...blank('option'), id: randomUUID(), pollId: poll.id, label, position, votes: 0,
  }));
  const context: Row = { ...before.context, existing: 1, creatorMatches: 1, digestMatches: 1,
    spaceDaily: (before.context.spaceDaily as number) + 1, ownDaily: (before.context.ownDaily as number) + 1 };
  return { rows: [context, ...options, poll], context, poll, options };
}

function insertPoll(db: Database, scope: Scope, poll: Row) {
  return db.prepare(`INSERT INTO "SpacePoll" ("id", "spaceId", "creatorId", "requestId", "payloadDigest", "question",
      "createdAt", "closedAt", "hiddenAt", "moderationRevision") VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0)`)
    .bind(poll.id, scope.spaceId, scope.userId, scope.input.requestId, scope.input.payloadDigest, poll.question, poll.createdAt);
}

function insertOptions(db: Database, options: Row[]) {
  return db.prepare(`INSERT INTO "SpacePollOption" ("id", "pollId", "label", "position") VALUES ${options.map(() => '(?, ?, ?, ?)').join(', ')}`)
    .bind(...options.flatMap(option => [option.id, option.pollId, option.label, option.position]));
}

function changedRows(db: Database, count: number) {
  return db.prepare(`SELECT CASE WHEN changes() = ?1 THEN 1 ELSE ${invariantFailure} END AS guarded`).bind(count);
}

function retryableRollback(error: unknown) {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    messages.push(current instanceof Error ? current.message : typeof current === 'string' ? current : '');
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  if (messages.some(message => /D1_SPACE_POLL_CREATE_WRITE_INVARIANT|JSON path/i.test(message))) return false;
  // Only the precondition guard calls json() on invalid JSON. Manifest JSON
  // is generated and bounded before batch; invariant errors use a bad path.
  // A generic network/response JSON error is not proof of a SQL rollback.
  return messages.some(message => /D1_SPACE_POLL_CREATE_SNAPSHOT_CONFLICT/i.test(message) ||
    (/malformed JSON/i.test(message) && /\b(?:D1_ERROR|SQLITE_ERROR)\b/i.test(message)) ||
    /UNIQUE constraint failed:\s*SpacePoll\.spaceId\s*,\s*SpacePoll\.requestId\s*(?::|$)/i.test(message));
}

function sameSnapshot(left: Snapshot, right: Snapshot) {
  const byKey = new Map(right.rows.map(row => [`${row.kind}:${row.id}`, row]));
  return left.rows.length === right.rows.length && left.rows.every(row => {
    const other = byKey.get(`${row.kind}:${row.id}`);
    return other && columns.every(column => row[column] === other[column]);
  });
}

function attemptTime(): AttemptTime {
  const nowMs = Date.now();
  integer(nowMs, Number.MIN_SAFE_INTEGER);
  return { nowMs, now: new Date(nowMs).toISOString().replace(/Z$/, '+00:00'), since: nowMs - 24 * 60 * 60 * 1000 };
}

function parsedInput(input: Input): Input {
  if (typeof input.question !== 'string' || Array.from(input.question).length < 5 || input.question.length > 200 ||
      !Array.isArray(input.options) || input.options.length < 2 || input.options.length > 8 ||
      input.options.some(label => typeof label !== 'string' || !label.length || label.length > 100) ||
      new Set(input.options.map(label => label.toLocaleLowerCase('de-DE'))).size !== input.options.length ||
      typeof input.requestId !== 'string' || !SPACE_REQUEST_ID_RE.test(input.requestId)) throw new Error('Invalid parsed D1 Space poll CREATE input');
  // Only the server parser's sanitized strings enter this helper. Recompute
  // their digest here instead of trusting a supplied digest or original body.
  const payloadDigest = createHash('sha256').update(JSON.stringify({ question: input.question, options: input.options })).digest('hex');
  if (input.payloadDigest !== payloadDigest) throw new Error('Invalid parsed D1 Space poll CREATE digest');
  return { question: input.question, options: [...input.options], requestId: input.requestId, payloadDigest };
}

/** Native atomic CREATE with source-scoped content receipts. Receipt replay is
 * a zero-write current projection, including hidden/closed polls and all legacy
 * options; it never promises deduplication beyond that receipt's lifetime. */
export async function createD1SpacePoll(userId: string, spaceId: string, input: Input): Promise<{ item: PollDto; created: boolean }> {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId) || typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId)) throw notFound();
  const scope: Scope = { userId, spaceId, input: parsedInput(input) };
  const db = d1SpaceDatabase();
  let time = attemptTime();
  let snapshot = await readSnapshot(db, scope, time);
  for (let attempt = 0; attempt < 4; attempt++) {
    const replayItem = prepareSnapshot(snapshot, scope);
    const created = snapshot.context.existing === 0;
    const after = created ? newSnapshot(snapshot, scope, time) : snapshot;
    const item = created ? prepareSnapshot(after, scope, true) : replayItem;
    if (!item) throw new Error('Missing prepared D1 Space poll CREATE response');
    const beforeManifest = manifest(snapshot);
    const afterManifest = created ? manifest(after) : beforeManifest;
    const statements = [guardedSnapshot(db, scope, time, beforeManifest)];
    if (created) statements.push(insertPoll(db, scope, after.poll!), changedRows(db, 1),
      insertOptions(db, after.options), changedRows(db, after.options.length));
    statements.push(guardedSnapshot(db, scope, time, afterManifest, created, true));
    let results: Awaited<ReturnType<Database['batch']>>;
    try {
      results = await db.batch(statements);
    } catch (error) {
      reportPollCreateBatchFailure(error, created, attempt + 1);
      if (!retryableRollback(error)) throw error;
      const current = await readSnapshot(db, scope, time);
      prepareSnapshot(current, scope);
      if (sameSnapshot(snapshot, current)) throw error;
      if (attempt === 3) throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
      time = attemptTime();
      snapshot = await readSnapshot(db, scope, time);
      continue;
    }
    // Successful-batch/transport handling is deliberately outside the retry
    // catch. All data/date/DTO checks and exact SQL postconditions ran before
    // commit; a missing committed result can never trigger another mutation.
    const final = results[results.length - 1];
    if (results.length !== statements.length || results.some(result => !result.success) ||
        !final || !Array.isArray(final.results) || final.results.length !== after.rows.length ||
        final.results.some(row => (row as { guarded?: unknown }).guarded !== 1)) {
      throw new Error('Missing committed D1 Space poll CREATE result');
    }
    return { item, created };
  }
  throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}

/** Diagnostic categories only: never return provider messages, SQL, binds,
 * identifiers or payloads. This classifier does not authorize any retry.
 * Only own data properties are inspected. Cause traversal and message text
 * use bounded heuristic prefixes; categories never prove a failing statement.
 * Accessors and uninspectable objects fall back to a fixed unknown category. */
function pollCreateErrorClass(error: unknown): string {
  try {
    const messages: string[] = [];
    const seen = new Set<object>();
    let current: unknown = error;
    let remaining = 8192;
    for (let depth = 0; depth < 6 && current !== null && current !== undefined && remaining > 0; depth++) {
      if (typeof current === 'string') {
        messages.push(current.slice(0, Math.min(2048, remaining)));
        break;
      }
      if (typeof current !== 'object' || seen.has(current)) break;
      seen.add(current);
      const message = Object.getOwnPropertyDescriptor(current, 'message');
      if (message && !Object.hasOwn(message, 'value')) return 'unknown';
      if (typeof message?.value === 'string') {
        const bounded = message.value.slice(0, Math.min(2048, remaining));
        messages.push(bounded);
        remaining -= bounded.length;
      }
      const cause = Object.getOwnPropertyDescriptor(current, 'cause');
      if (cause && !Object.hasOwn(cause, 'value')) return 'unknown';
      current = cause?.value;
    }
    const has = (pattern: RegExp) => messages.some(message => pattern.test(message));
    if (has(/network|fetch failed|timeout|timed out|connection|disconnect|cancel|abort|RPC|TLS|DNS|unknown commit/i)) return 'transport';
    const sql = has(/\b(?:D1_ERROR|D1_EXEC_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT|SQLITE_TOOBIG|SQLITE_RANGE)\b/i);
    if (!sql) return 'unknown';
    if (has(/D1_SPACE_POLL_CREATE_WRITE_INVARIANT/)) return 'own-write-invariant';
    if (has(/D1_SPACE_POLL_CREATE_SNAPSHOT_CONFLICT/)) return 'own-snapshot-guard';
    if (has(/malformed JSON|JSON path/i)) return 'sql-json';
    if (has(/too many SQL variables|variable number must be between/i)) return 'sql-limit-variables';
    if (has(/bind|parameter|SQLITE_RANGE/i)) return 'sql-binding';
    if (has(/FOREIGN KEY constraint/i)) return 'sql-foreign-key';
    if (has(/UNIQUE constraint|PRIMARY KEY|CHECK constraint|NOT NULL constraint|SQLITE_CONSTRAINT/i)) return 'sql-constraint';
    if (has(/syntax|no such table|no such column|ambiguous column|misuse/i)) return 'sql-shape';
    // Exact known diagnostic phrases only. A generic resource/limit word is
    // insufficient to attribute a specific SQLite or provider limit.
    if (has(/LIKE or GLOB pattern too complex/i)) return 'sql-limit-pattern';
    if (has(/Expression tree is too large/i)) return 'sql-limit-expression';
    if (has(/too many terms in compound SELECT/i)) return 'sql-limit-compound';
    if (has(/too many arguments on function/i)) return 'sql-limit-function-arguments';
    if (has(/parser stack overflow/i)) return 'sql-limit-parser-stack';
    if (has(/too many references to/i)) return 'sql-limit-table-references';
    if (has(/statement too long/i)) return 'sql-limit-statement-length';
    if (has(/string or blob too big/i)) return 'sql-limit-string-blob-size';
    if (has(/out of memory/i)) return 'sql-out-of-memory';
    if (has(/database or disk is full/i)) return 'sql-storage-full';
    if (has(/daily row (?:read|write) limit/i)) return 'sql-limit-daily-rows';
    if (has(/too many API requests|too many SQL statements/i)) return 'sql-limit-request-count';
    if (has(/too many|too (?:big|large)|SQLITE_TOOBIG|limit|quota|memory|resource/i)) return 'unknown';
    return 'sql-other';
  } catch {
    return 'unknown';
  }
}

function reportPollCreateBatchFailure(error: unknown, created: boolean, attempt: number) {
  // The existing throw/retry logic below the call remains the sole decision
  // path. Never let diagnostic handling replace the original failure.
  try {
    console.error('poll-create.native.batch', created ? 'plan=new' : 'plan=replay',
      `attempt=${attempt}`, `class=${pollCreateErrorClass(error)}`);
  } catch { /* Diagnostic sink failure cannot affect the operation. */ }
}
