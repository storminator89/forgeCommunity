import 'server-only';

import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import type { parsePollModeration } from '@/lib/server/space-polls';
import type { d1SpacePoll } from '@/lib/server/d1-space-poll-reads';
import {
  D1_SPACE_ROW_BYTES, d1BoundedResponse, d1Date, d1DateMs, d1ProjectionBudgetCtes,
  d1SpaceDatabase, d1TextBytes,
} from '@/lib/server/d1-space-reads';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Input = ReturnType<typeof parsePollModeration>;
type PollDto = Awaited<ReturnType<typeof d1SpacePoll>>;
type Scalar = string | number | null;
const columns = [
  'kind', 'authorized', 'pollExists', 'canManage', 'isMember', 'actorRole', 'visibility', 'memberJoinedAt', 'fits',
  'id', 'spaceId', 'question', 'createdAt', 'createdAtMs', 'closedAt', 'hiddenAt', 'moderationRevision',
  'ownExists', 'ownOptionId', 'ownRevision', 'pollId', 'label', 'position', 'votes',
] as const;
type Row = Record<typeof columns[number], Scalar> & { kind: 'context' | 'poll' | 'option' };
type Snapshot = { rows: Row[]; context: Row; poll?: Row; options: Row[] };
type Scope = { userId: string; spaceId: string; id: string; input: Input };
const MAX_REVISION = 2147483646;
const notFound = () => new SpaceApiError('Umfrage nicht gefunden', 404);
const conflict = () => new SpaceApiError('Die Auswahl wurde inzwischen geändert. Bitte neu laden.', 409);
const invariantFailure = "json_extract('[]', 'D1_SPACE_POLL_MODERATION_WRITE_INVARIANT')";

function selectRow(kind: Row['kind'], values: Partial<Record<typeof columns[number], string>>) {
  return `SELECT ${columns.map(column => `${column === 'kind' ? `'${kind}'` : values[column] ?? 'NULL'} AS "${column}"`).join(', ')}`;
}

/** ?1 is the stored live actor, ?2 the readable Space and ?3 the exact poll.
 * Keep readable access separate from ADMIN so non-admins receive403 before
 * target lookup. Poll bodies, complete options and only the caller's own
 * option/revision are projected after the current stored ADMIN check. */
function snapshotSql() {
  const contextBytes = d1TextBytes('a."role"', 'a."visibility"', 'a."joinedAt"');
  const pollBytes = d1TextBytes('p."id"', 'p."spaceId"', 'p."question"', 'p."createdAt"',
    'p.createdAtMs', 'p."closedAt"', 'p."hiddenAt"', 'p."moderationRevision"', 'p.ownOptionId', 'p.ownRevision');
  const optionBytes = d1TextBytes('o."id"', 'o."pollId"', 'o."label"', 'o."position"', 'o.votes');
  return `WITH actor AS (
      SELECT "id", "role" FROM "User" WHERE "id" = ?1
    ), access AS (
      SELECT s."id", s."visibility", a."role", (a."role" = 'ADMIN') AS canManage,
        (m."userId" IS NOT NULL) AS isMember, m."joinedAt"
      FROM actor a JOIN "Space" s ON s."id" = ?2
      LEFT JOIN "SpaceMember" m ON m."spaceId" = s."id" AND m."userId" = a."id"
      WHERE s."visibility" = 'PUBLIC' OR a."role" = 'ADMIN' OR m."userId" IS NOT NULL
    ), poll_rows AS (
      SELECT p."id", p."spaceId", p."question", p."createdAt", ${d1DateMs('p."createdAt"')} AS createdAtMs,
        p."closedAt", p."hiddenAt", p."moderationRevision", (own."userId" IS NOT NULL) AS ownExists,
        own."optionId" AS ownOptionId, own."revision" AS ownRevision
      FROM access a JOIN "SpacePoll" p ON p."spaceId" = a."id" AND p."id" = ?3
      LEFT JOIN "SpacePollVote" own ON own."pollId" = p."id" AND own."userId" = ?1
      WHERE a.canManage = 1
    ), option_rows AS (
      SELECT o."id", o."pollId", o."label", o."position",
        (SELECT COUNT(*) FROM "SpacePollVote" v WHERE v."pollId" = o."pollId" AND v."optionId" = o."id") AS votes
      FROM poll_rows p JOIN "SpacePollOption" o ON o."pollId" = p."id"
    ), ${d1ProjectionBudgetCtes(`SELECT ${contextBytes} AS bytes FROM access a
      UNION ALL SELECT ${pollBytes} AS bytes FROM poll_rows p
      UNION ALL SELECT ${optionBytes} AS bytes FROM option_rows o`)}
    ${selectRow('context', {
      authorized: 'EXISTS(SELECT 1 FROM access)', pollExists: 'EXISTS(SELECT 1 FROM poll_rows)',
      canManage: 'COALESCE((SELECT canManage FROM access), 0)', isMember: 'COALESCE((SELECT isMember FROM access), 0)',
      actorRole: 'CASE WHEN b.fits = 1 THEN (SELECT "role" FROM access) ELSE NULL END',
      visibility: 'CASE WHEN b.fits = 1 THEN (SELECT "visibility" FROM access) ELSE NULL END',
      memberJoinedAt: 'CASE WHEN b.fits = 1 THEN (SELECT "joinedAt" FROM access) ELSE NULL END',
      fits: 'b.fits', spaceId: '(SELECT "id" FROM access)',
    })} FROM projection_budget b
    UNION ALL
    ${selectRow('poll', {
      id: 'p."id"', spaceId: 'p."spaceId"', question: 'p."question"', createdAt: 'p."createdAt"', createdAtMs: 'p.createdAtMs',
      closedAt: 'p."closedAt"', hiddenAt: 'p."hiddenAt"', moderationRevision: 'p."moderationRevision"',
      ownExists: 'p.ownExists', ownOptionId: 'p.ownOptionId', ownRevision: 'p.ownRevision',
    })} FROM projection_budget b JOIN poll_rows p ON b.fits = 1
    UNION ALL
    ${selectRow('option', {
      id: 'o."id"', pollId: 'o."pollId"', label: 'o."label"', position: 'o."position"', votes: 'o.votes',
    })} FROM projection_budget b JOIN option_rows o ON b.fits = 1
    ORDER BY kind, position, id`;
}

async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql()).bind(scope.userId, scope.spaceId, scope.id).all<Row>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('Incomplete D1 Space poll MODERATION snapshot');
  const rows = result.results;
  const contexts = rows.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Missing D1 Space poll MODERATION context');
  return { rows, context: contexts[0], poll: rows.find(row => row.kind === 'poll'), options: rows.filter(row => row.kind === 'option') };
}

function integer(value: unknown, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid D1 Space poll MODERATION integer');
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SPACE_ID_RE.test(value)) throw new Error('Invalid D1 Space poll MODERATION identifier');
}

function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 Space poll MODERATION flag');
}

/** Match the native reads' supported raw date representations, rejecting
 * malformed calendar dates before Date can normalize them. Numeric zero is
 * an existing timestamp; only SQL/JavaScript null denotes an absent date. */
function storedDate(value: unknown): Date {
  if (typeof value === 'number') {
    integer(value, Number.MIN_SAFE_INTEGER);
    return d1Date(value);
  }
  if (typeof value !== 'string') throw new Error('Invalid D1 Space poll MODERATION timestamp');
  const parts = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/.exec(value);
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 Space poll MODERATION timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > calendar.getUTCDate() ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 Space poll MODERATION timestamp');
  }
  return d1Date(value);
}

/** Preserve service precedence: readable live actor/Space404, stored ADMIN403,
 * exact target404, then bounded typed DTO validation before any mutation. */
function prepareSnapshot(snapshot: Snapshot, scope: Scope): PollDto {
  const c = snapshot.context;
  if (c.authorized !== 1) throw notFound();
  if (c.canManage !== 1) throw new SpaceApiError('Nicht autorisiert', 403);
  if (c.pollExists !== 1) throw notFound();
  if (c.fits !== 1) throw new Error('D1 Space poll MODERATION projection exceeds safe byte limits');
  const keys = new Set<string>();
  for (const row of snapshot.rows) {
    if (!['context', 'poll', 'option'].includes(row.kind) || Object.keys(row).length !== columns.length ||
        columns.some(column => !Object.hasOwn(row, column) || (row[column] !== null && typeof row[column] !== 'string' &&
          (typeof row[column] !== 'number' || !Number.isSafeInteger(row[column]))))) throw new Error('Invalid D1 Space poll MODERATION scalar');
    const key = `${row.kind}:${row.id}`;
    if (keys.has(key)) throw new Error('Duplicate D1 Space poll MODERATION snapshot row');
    keys.add(key);
  }
  flag(c.isMember);
  if (c.actorRole !== 'ADMIN' || c.spaceId !== scope.spaceId ||
      (c.visibility !== 'PUBLIC' && c.visibility !== 'PRIVATE')) throw new Error('Invalid D1 Space poll MODERATION authority');
  if (c.isMember === 1) storedDate(c.memberJoinedAt);
  else if (c.memberJoinedAt !== null) throw new Error('Invalid D1 Space poll MODERATION membership');
  const poll = snapshot.poll;
  if (!poll || snapshot.rows.length !== snapshot.options.length + 2) throw new Error('Incomplete D1 Space poll MODERATION poll');
  identifier(poll.id); identifier(poll.spaceId);
  integer(poll.moderationRevision); integer(poll.createdAtMs, Number.MIN_SAFE_INTEGER); flag(poll.ownExists);
  if (poll.id !== scope.id || poll.spaceId !== scope.spaceId || typeof poll.question !== 'string') throw new Error('Invalid D1 Space poll MODERATION poll');
  const createdAt = storedDate(poll.createdAt);
  if (createdAt.getTime() !== poll.createdAtMs) throw new Error('Invalid D1 Space poll MODERATION date key');
  const closedAt = poll.closedAt === null ? null : storedDate(poll.closedAt).toISOString();
  const hiddenAt = poll.hiddenAt === null ? null : storedDate(poll.hiddenAt).toISOString();
  let ownVote: PollDto['ownVote'];
  if (poll.ownExists === 0) {
    if (poll.ownOptionId !== null || poll.ownRevision !== null) throw new Error('Unexpected D1 Space poll MODERATION own row');
    ownVote = { optionId: null, revision: 0 };
  } else {
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
        (previousPosition !== undefined && option.position <= previousPosition)) throw new Error('Invalid D1 Space poll MODERATION option');
    totalVotes += option.votes;
    integer(totalVotes);
    options.push({ id: option.id, label: option.label, votes: option.votes });
    optionIds.add(option.id);
    previousPosition = option.position;
  }
  if (ownVote.optionId !== null && !options.some(option => option.id === ownVote.optionId && option.votes >= 1)) {
    throw new Error('Invalid D1 Space poll MODERATION own option');
  }
  return d1BoundedResponse({
    id: poll.id, spaceId: poll.spaceId, question: poll.question, createdAt: createdAt.toISOString(), closedAt, hiddenAt,
    moderationRevision: poll.moderationRevision, options, totalVotes, ownVote,
    canVote: c.isMember === 1 && closedAt === null && hiddenAt === null, canManage: true,
  });
}

function needsChange(snapshot: Snapshot, input: Input) {
  const poll = snapshot.poll!;
  if (input.closed === true) return poll.closedAt === null;
  // Same-state replay precedes revision comparison, including a stale but
  // parser-valid expectedRevision. Closing never changes this CAS revision.
  if ((poll.hiddenAt !== null) === input.hidden) return false;
  if (poll.moderationRevision !== input.expectedRevision) throw conflict();
  return true;
}

function manifest(snapshot: Snapshot) {
  const json = JSON.stringify(snapshot.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  // Bound the entire expected-rows bind as well as every typed projection.
  // Legacy option sets are complete or rejected; they are never capped at8.
  if (Buffer.byteLength(json, 'utf8') > D1_SPACE_ROW_BYTES) throw new Error('D1 Space poll MODERATION snapshot manifest exceeds safe byte limits');
  return json;
}

/** One bounded JSON bind; exact cardinality and raw IS equality in both
 * directions protect every authority, membership, poll, option/count and own
 * scalar. The final assertion has a distinct nonretryable invariant error. */
function guardedSnapshot(db: Database, scope: Scope, expected: string, final = false) {
  const equality = columns.map(column => `c."${column}" IS e."${column}"`).join(' AND ');
  return db.prepare(`WITH current AS (${snapshotSql()}), expected AS (
      SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(?4) j
    ), matched AS (
      SELECT (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
        AND NOT EXISTS(SELECT 1 FROM current c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equality}))
        AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM current c WHERE ${equality})) AS valid
    ), assertion AS (
      SELECT CASE WHEN valid THEN 1 ELSE ${final ? invariantFailure : "json('D1_SPACE_POLL_MODERATION_SNAPSHOT_CONFLICT')"} END AS guarded FROM matched
    ) ${final ? 'SELECT c.*, a.guarded FROM assertion a CROSS JOIN current c ORDER BY c.kind, c.position, c.id' : 'SELECT guarded FROM assertion'}`)
    .bind(scope.userId, scope.spaceId, scope.id, expected);
}

function afterModeration(before: Snapshot, input: Input, now: string): Snapshot {
  const poll: Row = input.closed === true ? { ...before.poll!, closedAt: now }
    : { ...before.poll!, hiddenAt: input.hidden ? now : null, moderationRevision: input.expectedRevision + 1 };
  return { rows: before.rows.map(row => row.kind === 'poll' ? poll : row), context: before.context, poll, options: before.options };
}

function writeModeration(db: Database, scope: Scope, before: Snapshot, now: string) {
  if (scope.input.closed === true) {
    return db.prepare(`UPDATE "SpacePoll" SET "closedAt" = ?3
      WHERE "id" = ?1 AND "spaceId" = ?2 AND "closedAt" IS NULL`)
      .bind(scope.id, scope.spaceId, now);
  }
  return db.prepare(`UPDATE "SpacePoll" SET "hiddenAt" = ?3, "moderationRevision" = "moderationRevision" + 1
    WHERE "id" = ?1 AND "spaceId" = ?2 AND "moderationRevision" = ?4 AND "hiddenAt" IS ?5`)
    .bind(scope.id, scope.spaceId, scope.input.hidden ? now : null, scope.input.expectedRevision, before.poll!.hiddenAt);
}

function changedRows(db: Database) {
  return db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`);
}

/** Examine the complete bounded, cycle-safe cause chain before accepting a
 * known SQLite preguard rollback. Constraint/invariant, transport and unknown
 * commit outcomes always outrank a nested guard marker. UPDATE has no unique
 * insertion race, so no constraint error is ever a retry reason here. */
function retryableRollback(error: unknown) {
  const details: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return false;
      seen.add(current);
      if (typeof current === 'string') {
        if (current.length > 65536) return false;
        details.push(current);
        current = null;
        continue;
      }
      if (typeof current !== 'object') return false;
      const record = current as Record<string, unknown>;
      for (const field of ['message', 'name', 'code'] as const) {
        if (!(field in record)) continue;
        const value = record[field];
        if (typeof value !== 'string' || value.length > 65536) return false;
        if (field === 'code' && !/^(?:D1_ERROR|SQLITE_ERROR)$/.test(value)) return false;
        if (field === 'name' && value !== 'Error' && value !== 'D1Error' && value !== 'D1_ERROR' && value !== 'SqliteError') return false;
        details.push(value);
      }
      current = 'cause' in record ? record.cause : null;
    }
  } catch { return false; }
  if (details.some(detail => /D1_SPACE_POLL_MODERATION_WRITE_INVARIANT|JSON path|constraint|foreign[_\s-]*key|not[_\s-]*null|\bP2002\b|network|fetch|connection|transport|timeout|timed out|abort|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|unexpected token|invalid response|HTTP\s*\d/i.test(detail))) return false;
  const sqlite = details.some(detail => /\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(detail));
  return sqlite && details.some(detail => /D1_SPACE_POLL_MODERATION_SNAPSHOT_CONFLICT|malformed JSON/i.test(detail));
}

function sameSnapshot(left: Snapshot, right: Snapshot) {
  const byKey = new Map(right.rows.map(row => [`${row.kind}:${row.id}`, row]));
  return left.rows.length === right.rows.length && left.rows.every(row => {
    const other = byKey.get(`${row.kind}:${row.id}`);
    return other && columns.every(column => row[column] === other[column]);
  });
}

function parsedInput(input: Input): Input {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid parsed D1 Space poll MODERATION input');
  if (Object.hasOwn(input, 'closed')) {
    if (input.closed !== true || Object.keys(input).length !== 1) throw new Error('Invalid parsed D1 Space poll MODERATION close');
    return { closed: true };
  }
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'hidden') || !Object.hasOwn(input, 'expectedRevision') ||
      typeof input.hidden !== 'boolean' || typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 || input.expectedRevision >= MAX_REVISION) throw new Error('Invalid parsed D1 Space poll MODERATION visibility');
  return { hidden: input.hidden, expectedRevision: input.expectedRevision };
}

/** Native atomic close/hide moderation. Only closedAt OR hiddenAt/revision can
 * change. Same-state requests are zero-write current projections; without a
 * receipt this is state idempotency, not a lasting exactly-once guarantee. */
export async function moderateD1SpacePoll(userId: string, spaceId: string, id: string, input: Input): Promise<PollDto> {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId) || typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId) ||
      typeof id !== 'string' || !SPACE_ID_RE.test(id)) throw notFound();
  const scope: Scope = { userId, spaceId, id, input: parsedInput(input) };
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  for (let attempt = 0; attempt < 4; attempt++) {
    const currentItem = prepareSnapshot(snapshot, scope);
    const changed = needsChange(snapshot, scope.input);
    // A new server time belongs only to a real attempt. A later attempt can
    // occur only after a proved rollback and a changed authorized snapshot.
    const now = changed ? new Date().toISOString().replace(/Z$/, '+00:00') : '';
    const after = changed ? afterModeration(snapshot, scope.input, now) : snapshot;
    const item = changed ? prepareSnapshot(after, scope) : currentItem;
    const beforeManifest = manifest(snapshot);
    const afterManifest = changed ? manifest(after) : beforeManifest;
    const statements = [guardedSnapshot(db, scope, beforeManifest)];
    if (changed) statements.push(writeModeration(db, scope, snapshot, now), changedRows(db));
    statements.push(guardedSnapshot(db, scope, afterManifest, true));
    let results: Awaited<ReturnType<Database['batch']>>;
    try {
      results = await db.batch(statements);
    } catch (error) {
      if (!retryableRollback(error)) throw error;
      const current = await readSnapshot(db, scope);
      prepareSnapshot(current, scope);
      if (sameSnapshot(snapshot, current)) throw error;
      // The refreshed snapshot decides same-state success or stale opposite
      // transition409 on the next full attempt; no failed mutation is replayed
      // from an old authority, membership, vote or count snapshot.
      needsChange(current, scope.input);
      if (attempt === 3) throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
      snapshot = current;
      continue;
    }
    // Result/transport validation after a successful batch never retries. The
    // complete expected DTO was validated before mutation and its exact raw
    // final projection was checked by the throwing SQL assertion precommit.
    const final = results[results.length - 1];
    if (results.length !== statements.length || results.some(result => result.success !== true) ||
        !final || !Array.isArray(final.results) || final.results.length !== after.rows.length) {
      throw new Error('Missing committed D1 Space poll MODERATION result');
    }
    const expectedRows = new Map(after.rows.map(row => [`${row.kind}:${row.id}`, row]));
    for (const value of final.results) {
      const row = value as Row & { guarded?: unknown };
      if (typeof row !== 'object' || row === null || row.guarded !== 1 || Object.keys(row).length !== columns.length + 1) {
        throw new Error('Invalid committed D1 Space poll MODERATION result');
      }
      const key = `${row.kind}:${row.id}`;
      const expected = expectedRows.get(key);
      if (!expected || columns.some(column => row[column] !== expected[column])) throw new Error('Unexpected committed D1 Space poll MODERATION result');
      expectedRows.delete(key);
    }
    if (expectedRows.size !== 0) throw new Error('Incomplete committed D1 Space poll MODERATION result');
    return item;
  }
  throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
