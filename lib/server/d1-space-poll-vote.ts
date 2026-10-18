import 'server-only';

import { createHash } from 'node:crypto';
import { SPACE_ID_RE, SPACE_REQUEST_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import type { parsePollVote } from '@/lib/server/space-polls';
import type { d1SpacePoll } from '@/lib/server/d1-space-poll-reads';
import {
  D1_SPACE_ROW_BYTES, d1BoundedResponse, d1Date, d1DateMs, d1ProjectionBudgetCtes,
  d1SpaceDatabase, d1TextBytes,
} from '@/lib/server/d1-space-reads';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Input = ReturnType<typeof parsePollVote>;
type PollDto = Awaited<ReturnType<typeof d1SpacePoll>>;
type Scalar = string | number | null;
const columns = [
  'kind', 'authorized', 'pollExists', 'canManage', 'isMember', 'actorRole', 'visibility', 'memberJoinedAt',
  'receiptExists', 'receiptDigest', 'digestMatches', 'selectedOptionExists', 'perPoll', 'recent', 'quotaDatesValid', 'fits',
  'id', 'spaceId', 'question', 'createdAt', 'createdAtMs', 'closedAt', 'hiddenAt', 'moderationRevision',
  'ownExists', 'ownOptionId', 'ownRevision', 'ownCreatedAt', 'ownUpdatedAt', 'pollId', 'label', 'position', 'votes',
] as const;
type Row = Record<typeof columns[number], Scalar> & { kind: 'context' | 'poll' | 'option' };
type Snapshot = { rows: Row[]; context: Row; poll?: Row; options: Row[] };
type Scope = { userId: string; spaceId: string; id: string; input: Input };
type AttemptTime = { now: string; nowMs: number; since: number };
const DATE_LIMIT = 8640000000000000;
const MAX_REVISION = 2147483646;
const notFound = () => new SpaceApiError('Umfrage nicht gefunden', 404);
const conflict = () => new SpaceApiError('Die Auswahl wurde inzwischen geändert. Bitte neu laden.', 409);
const invariantFailure = "json_extract('[]', 'D1_SPACE_POLL_VOTE_WRITE_INVARIANT')";

function selectRow(kind: Row['kind'], values: Partial<Record<typeof columns[number], string>>) {
  return `SELECT ${columns.map(column => `${column === 'kind' ? `'${kind}'` : values[column] ?? 'NULL'} AS "${column}"`).join(', ')}`;
}

/** Copied pure date validation from native CREATE. Malformed user receipt dates
 * cannot disappear below a permissively parsed cutoff. Replay disables quotas. */
function quotaDateValid() {
  return `CASE
    WHEN typeof(raw) IN ('integer', 'real') THEN raw = CAST(raw AS INTEGER)
      AND raw BETWEEN -${DATE_LIMIT} AND ${DATE_LIMIT}
    WHEN typeof(raw) = 'text' THEN
      instr(CAST(raw AS BLOB), x'00') = 0
      AND substr(raw, 1, 19) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][ T][0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
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

/** ?1 live actor, ?2 Space, ?3 exact poll, ?4 selected option, ?5 scoped
 * request, ?6 server digest, ?7 minute cutoff, ?8 final new-receipt quota flag.
 * Only the actor's own raw vote and scoped receipt digest leave SQL. */
function snapshotSql() {
  const normalizedDate = `substr(raw, 1, 19)
    || CASE WHEN fractionEnd > 19 THEN '.' || substr(substr(raw, 21, MIN(3, fractionEnd - 20)) || '000', 1, 3) ELSE '' END
    || CASE zoneLength WHEN 1 THEN 'Z' WHEN 6 THEN substr(raw, -6) ELSE '' END`;
  const contextBytes = d1TextBytes('a."role"', 'a."visibility"', 'a."joinedAt"', 'r."payloadDigest"',
    'q.perPoll', 'q.recent', 'q.quotaDatesValid');
  const pollBytes = d1TextBytes('p."id"', 'p."spaceId"', 'p."question"', 'p."createdAt"',
    'p.createdAtMs', 'p."closedAt"', 'p."hiddenAt"', 'p."moderationRevision"', 'p.ownOptionId',
    'p.ownRevision', 'p.ownCreatedAt', 'p.ownUpdatedAt');
  const optionBytes = d1TextBytes('o."id"', 'o."pollId"', 'o."label"', 'o."position"', 'o.votes');
  return `WITH actor AS (
      SELECT "id", "role" FROM "User" WHERE "id" = ?1
    ), access AS (
      SELECT s."id", s."visibility", a."role", (a."role" = 'ADMIN') AS canManage,
        (m."userId" IS NOT NULL) AS isMember, m."joinedAt"
      FROM actor a JOIN "Space" s ON s."id" = ?2
      LEFT JOIN "SpaceMember" m ON m."spaceId" = s."id" AND m."userId" = a."id"
      WHERE s."visibility" = 'PUBLIC' OR a."role" = 'ADMIN' OR m."userId" IS NOT NULL
    ), visible_poll AS (
      SELECT p."id", p."spaceId", p."question", p."createdAt", p."closedAt", p."hiddenAt", p."moderationRevision"
      FROM access a JOIN "SpacePoll" p ON p."spaceId" = a."id" AND p."id" = ?3
      WHERE a.canManage = 1 OR p."hiddenAt" IS NULL
    ), poll_rows AS (
      SELECT p."id", p."spaceId", p."question", p."createdAt", ${d1DateMs('p."createdAt"')} AS createdAtMs,
        p."closedAt", p."hiddenAt", p."moderationRevision", (own."userId" IS NOT NULL) AS ownExists,
        own."optionId" AS ownOptionId, own."revision" AS ownRevision,
        own."createdAt" AS ownCreatedAt, own."updatedAt" AS ownUpdatedAt
      FROM visible_poll p CROSS JOIN access a
      LEFT JOIN "SpacePollVote" own ON own."pollId" = p."id" AND own."userId" = ?1
      WHERE a.isMember = 1
    ), option_rows AS (
      SELECT o."id", o."pollId", o."label", o."position",
        (SELECT COUNT(*) FROM "SpacePollVote" v WHERE v."pollId" = o."pollId" AND v."optionId" = o."id") AS votes
      FROM poll_rows p JOIN "SpacePollOption" o ON o."pollId" = p."id"
    ), receipt AS (
      SELECT r."payloadDigest" FROM poll_rows p JOIN "SpacePollVoteRequest" r
        ON r."pollId" = p."id" AND r."userId" = ?1 AND r."requestId" = ?5
    ), quota_enabled AS (
      SELECT 1 FROM poll_rows WHERE ?8 = 1 OR NOT EXISTS(SELECT 1 FROM receipt)
    ), quota_source AS (
      SELECT r."pollId", r."createdAt" AS raw FROM "SpacePollVoteRequest" r
      WHERE r."userId" = ?1 AND EXISTS(SELECT 1 FROM quota_enabled)
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
          THEN COALESCE(SUM(CASE WHEN "pollId" = ?3 THEN 1 ELSE 0 END), 0) ELSE NULL END AS perPoll,
        CASE WHEN EXISTS(SELECT 1 FROM quota_enabled)
          THEN COALESCE(SUM(CASE WHEN atMs >= ?7 THEN 1 ELSE 0 END), 0) ELSE NULL END AS recent,
        CASE WHEN EXISTS(SELECT 1 FROM quota_enabled) THEN NOT EXISTS(SELECT 1 FROM quota_times
          WHERE dateValid IS NOT 1 OR typeof(atMs) <> 'integer' OR atMs NOT BETWEEN -${DATE_LIMIT} AND ${DATE_LIMIT})
          ELSE NULL END AS quotaDatesValid
      FROM quota_times
    ), ${d1ProjectionBudgetCtes(`SELECT ${contextBytes} AS bytes FROM access a CROSS JOIN quota q LEFT JOIN receipt r ON 1 = 1
      UNION ALL SELECT ${pollBytes} AS bytes FROM poll_rows p
      UNION ALL SELECT ${optionBytes} AS bytes FROM option_rows o`)}
    ${selectRow('context', {
      authorized: 'EXISTS(SELECT 1 FROM access)', pollExists: 'EXISTS(SELECT 1 FROM visible_poll)',
      canManage: 'COALESCE((SELECT canManage FROM access), 0)', isMember: 'COALESCE((SELECT isMember FROM access), 0)',
      actorRole: 'CASE WHEN b.fits = 1 THEN (SELECT "role" FROM access) ELSE NULL END',
      visibility: 'CASE WHEN b.fits = 1 THEN (SELECT "visibility" FROM access) ELSE NULL END',
      memberJoinedAt: 'CASE WHEN b.fits = 1 THEN (SELECT "joinedAt" FROM access) ELSE NULL END',
      receiptExists: 'EXISTS(SELECT 1 FROM receipt)',
      receiptDigest: 'CASE WHEN b.fits = 1 THEN (SELECT "payloadDigest" FROM receipt) ELSE NULL END',
      digestMatches: 'EXISTS(SELECT 1 FROM receipt WHERE "payloadDigest" = ?6)',
      selectedOptionExists: 'EXISTS(SELECT 1 FROM option_rows WHERE "id" = ?4)',
      perPoll: 'q.perPoll', recent: 'q.recent', quotaDatesValid: 'q.quotaDatesValid', fits: 'b.fits',
      spaceId: '(SELECT "id" FROM access)',
    })} FROM projection_budget b CROSS JOIN quota q
    UNION ALL
    ${selectRow('poll', {
      id: 'p."id"', spaceId: 'p."spaceId"', question: 'p."question"', createdAt: 'p."createdAt"', createdAtMs: 'p.createdAtMs',
      closedAt: 'p."closedAt"', hiddenAt: 'p."hiddenAt"', moderationRevision: 'p."moderationRevision"',
      ownExists: 'p.ownExists', ownOptionId: 'p.ownOptionId', ownRevision: 'p.ownRevision',
      ownCreatedAt: 'p.ownCreatedAt', ownUpdatedAt: 'p.ownUpdatedAt',
    })} FROM projection_budget b JOIN poll_rows p ON b.fits = 1
    UNION ALL
    ${selectRow('option', {
      id: 'o."id"', pollId: 'o."pollId"', label: 'o."label"', position: 'o."position"', votes: 'o.votes',
    })} FROM projection_budget b JOIN option_rows o ON b.fits = 1
    ORDER BY kind, position, id`;
}

function values(scope: Scope, time: AttemptTime, includeQuotas = false) {
  return [scope.userId, scope.spaceId, scope.id, scope.input.optionId, scope.input.requestId,
    scope.input.payloadDigest, time.since, includeQuotas ? 1 : 0];
}

async function readSnapshot(db: Database, scope: Scope, time: AttemptTime): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql()).bind(...values(scope, time)).all<Row>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('Incomplete D1 Space poll VOTE snapshot');
  const rows = result.results;
  const contexts = rows.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Missing D1 Space poll VOTE context');
  return { rows, context: contexts[0], poll: rows.find(row => row.kind === 'poll'), options: rows.filter(row => row.kind === 'option') };
}

function integer(value: unknown, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid D1 Space poll VOTE integer');
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SPACE_ID_RE.test(value)) throw new Error('Invalid D1 Space poll VOTE identifier');
}

function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 Space poll VOTE flag');
}

function storedDate(value: unknown): Date {
  if (typeof value === 'number') {
    integer(value, Number.MIN_SAFE_INTEGER);
    return d1Date(value);
  }
  if (typeof value !== 'string') throw new Error('Invalid D1 Space poll VOTE timestamp');
  const parts = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/.exec(value);
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 Space poll VOTE timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > calendar.getUTCDate() ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 Space poll VOTE timestamp');
  }
  return d1Date(value);
}

/** Preserve service precedence: live access/target404, current membership403,
 * scoped receipt409, then new-only closed/option/revision/receipt quotas. */
function prepareSnapshot(snapshot: Snapshot, scope: Scope, includeQuotas = false): PollDto {
  const c = snapshot.context;
  if (c.authorized !== 1 || c.pollExists !== 1) throw notFound();
  if (c.isMember !== 1) throw new SpaceApiError('Zum Abstimmen ist eine Mitgliedschaft erforderlich', 403);
  if (c.receiptExists === 1 && c.digestMatches !== 1) throw new SpaceApiError('Anfrage-ID bereits verwendet', 409);
  if (c.fits !== 1) throw new Error('D1 Space poll VOTE projection exceeds safe byte limits');
  const keys = new Set<string>();
  for (const row of snapshot.rows) {
    if (!['context', 'poll', 'option'].includes(row.kind) || Object.keys(row).length !== columns.length ||
        columns.some(column => !Object.hasOwn(row, column) || (row[column] !== null && typeof row[column] !== 'string' &&
          (typeof row[column] !== 'number' || !Number.isSafeInteger(row[column]))))) throw new Error('Invalid D1 Space poll VOTE scalar');
    const key = `${row.kind}:${row.id}`;
    if (keys.has(key)) throw new Error('Duplicate D1 Space poll VOTE snapshot row');
    keys.add(key);
  }
  flag(c.canManage); flag(c.receiptExists); flag(c.digestMatches); flag(c.selectedOptionExists);
  if (typeof c.actorRole !== 'string' ||
      c.canManage !== (c.actorRole === 'ADMIN' ? 1 : 0) || c.spaceId !== scope.spaceId ||
      (c.visibility !== 'PUBLIC' && c.visibility !== 'PRIVATE')) throw new Error('Invalid D1 Space poll VOTE authority');
  storedDate(c.memberJoinedAt);
  if (c.receiptExists === 1) {
    if (c.receiptDigest !== scope.input.payloadDigest || c.digestMatches !== 1) throw new Error('Invalid D1 Space poll VOTE receipt');
  } else if (c.receiptDigest !== null || c.digestMatches !== 0) throw new Error('Unexpected D1 Space poll VOTE receipt');
  const poll = snapshot.poll;
  if (!poll || snapshot.rows.length !== snapshot.options.length + 2) throw new Error('Incomplete D1 Space poll VOTE poll');
  identifier(poll.id); identifier(poll.spaceId);
  integer(poll.moderationRevision); integer(poll.createdAtMs, Number.MIN_SAFE_INTEGER); flag(poll.ownExists);
  if (poll.id !== scope.id || poll.spaceId !== scope.spaceId || typeof poll.question !== 'string') throw new Error('Invalid D1 Space poll VOTE poll');
  const createdAt = storedDate(poll.createdAt);
  if (createdAt.getTime() !== poll.createdAtMs) throw new Error('Invalid D1 Space poll VOTE date key');
  const closedAt = poll.closedAt === null ? null : storedDate(poll.closedAt).toISOString();
  const hiddenAt = poll.hiddenAt === null ? null : storedDate(poll.hiddenAt).toISOString();
  if (hiddenAt !== null && c.canManage !== 1) throw new Error('Invalid D1 Space poll VOTE visibility');
  let ownVote: PollDto['ownVote'];
  if (poll.ownExists === 0) {
    if (poll.ownOptionId !== null || poll.ownRevision !== null || poll.ownCreatedAt !== null || poll.ownUpdatedAt !== null) {
      throw new Error('Unexpected D1 Space poll VOTE own row');
    }
    ownVote = { optionId: null, revision: 0 };
  } else {
    identifier(poll.ownOptionId); integer(poll.ownRevision);
    storedDate(poll.ownCreatedAt); storedDate(poll.ownUpdatedAt);
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
        (previousPosition !== undefined && option.position <= previousPosition)) throw new Error('Invalid D1 Space poll VOTE option');
    totalVotes += option.votes;
    integer(totalVotes);
    options.push({ id: option.id, label: option.label, votes: option.votes });
    optionIds.add(option.id);
    previousPosition = option.position;
  }
  if (ownVote.optionId !== null && !options.some(option => option.id === ownVote.optionId && option.votes >= 1)) {
    throw new Error('Invalid D1 Space poll VOTE own option');
  }
  if (c.selectedOptionExists !== (optionIds.has(scope.input.optionId) ? 1 : 0)) throw new Error('Invalid D1 Space poll VOTE selected option');
  if (c.receiptExists === 0) {
    if (closedAt !== null || hiddenAt !== null) throw new SpaceApiError('Diese Umfrage ist geschlossen oder ausgeblendet', 409);
    if (c.selectedOptionExists !== 1) throw new SpaceApiError('Antwort gehört nicht zu dieser Umfrage', 400);
    if (ownVote.revision !== scope.input.expectedRevision) throw conflict();
  }
  if (includeQuotas || c.receiptExists === 0) {
    integer(c.perPoll); integer(c.recent);
    if (c.quotaDatesValid !== 1) throw new Error('Invalid D1 Space poll VOTE quota timestamp');
    if (c.receiptExists === 0 && c.perPoll >= 100) {
      throw new SpaceApiError('Für diese Umfrage sind höchstens 100 gespeicherte Abstimmungen pro Person möglich.', 429);
    }
    if (c.receiptExists === 0 && c.recent >= 12) throw new SpaceApiError('Zu viele Änderungen. Bitte später erneut versuchen.', 429);
  } else if (c.perPoll !== null || c.recent !== null || c.quotaDatesValid !== null) throw new Error('Unexpected D1 Space poll VOTE replay quota');
  return d1BoundedResponse({
    id: poll.id, spaceId: poll.spaceId, question: poll.question, createdAt: createdAt.toISOString(), closedAt, hiddenAt,
    moderationRevision: poll.moderationRevision, options, totalVotes, ownVote,
    canVote: closedAt === null && hiddenAt === null, canManage: c.canManage === 1,
  });
}

function manifest(snapshot: Snapshot) {
  const json = JSON.stringify(snapshot.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  // Complete legacy option sets are bounded, never silently capped at eight.
  if (Buffer.byteLength(json, 'utf8') > D1_SPACE_ROW_BYTES) throw new Error('D1 Space poll VOTE snapshot manifest exceeds safe byte limits');
  return json;
}

/** A single bounded JSON bind avoids a bind per option/field. Raw IS equality
 * in both directions plus exact cardinality covers nullable dates and absence. */
function guardedSnapshot(db: Database, scope: Scope, time: AttemptTime, expected: string,
  includeQuotas = false, final = false) {
  const equality = columns.map(column => `c."${column}" IS e."${column}"`).join(' AND ');
  return db.prepare(`WITH current AS (${snapshotSql()}), expected AS (
      SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(?9) j
    ), matched AS (
      SELECT (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
        AND NOT EXISTS(SELECT 1 FROM current c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equality}))
        AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM current c WHERE ${equality})) AS valid
    ), assertion AS (
      SELECT CASE WHEN valid THEN 1 ELSE ${final ? invariantFailure : "json('D1_SPACE_POLL_VOTE_SNAPSHOT_CONFLICT')"} END AS guarded FROM matched
    ) ${final ? 'SELECT c.*, a.guarded FROM assertion a CROSS JOIN current c ORDER BY c.kind, c.position, c.id' : 'SELECT guarded FROM assertion'}`)
    .bind(...values(scope, time, includeQuotas), expected);
}

function afterVote(before: Snapshot, scope: Scope, time: AttemptTime): Snapshot {
  const oldPoll = before.poll!;
  const poll: Row = { ...oldPoll, ownExists: 1, ownOptionId: scope.input.optionId,
    ownRevision: scope.input.expectedRevision + 1,
    ownCreatedAt: oldPoll.ownExists === 1 ? oldPoll.ownCreatedAt : time.now, ownUpdatedAt: time.now };
  const options = before.options.map((option): Row => ({ ...option,
    votes: (option.votes as number) - (oldPoll.ownExists === 1 && oldPoll.ownOptionId === option.id ? 1 : 0)
      + (option.id === scope.input.optionId ? 1 : 0),
  }));
  const context: Row = { ...before.context, receiptExists: 1, receiptDigest: scope.input.payloadDigest, digestMatches: 1,
    perPoll: (before.context.perPoll as number) + 1, recent: (before.context.recent as number) + 1 };
  return { rows: [context, ...options, poll], context, poll, options };
}

function writeVote(db: Database, scope: Scope, before: Snapshot, time: AttemptTime) {
  if (before.poll!.ownExists === 0) {
    return db.prepare(`INSERT INTO "SpacePollVote" ("pollId", "userId", "optionId", "revision", "createdAt", "updatedAt")
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)`)
      .bind(scope.id, scope.userId, scope.input.optionId, scope.input.expectedRevision + 1, time.now);
  }
  return db.prepare(`UPDATE "SpacePollVote" SET "optionId" = ?3, "revision" = ?4, "updatedAt" = ?5
    WHERE "pollId" = ?1 AND "userId" = ?2 AND "revision" = ?6`)
    .bind(scope.id, scope.userId, scope.input.optionId, scope.input.expectedRevision + 1, time.now, scope.input.expectedRevision);
}

function insertReceipt(db: Database, scope: Scope, time: AttemptTime) {
  return db.prepare(`INSERT INTO "SpacePollVoteRequest" ("pollId", "userId", "requestId", "payloadDigest", "createdAt")
    VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(scope.id, scope.userId, scope.input.requestId, scope.input.payloadDigest, time.now);
}

function changedRows(db: Database) {
  return db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`);
}

/** Fail closed for a truncated/cyclic cause chain. Inspect the whole bounded
 * chain before classifying; an invariant always outranks a nested race marker. */
function retryableRollback(error: unknown) {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return false;
      seen.add(current);
      const message = typeof current === 'string' ? current
        : typeof current === 'object' && 'message' in current && typeof current.message === 'string' ? current.message : '';
      if (message.length > 65536) return false;
      messages.push(message);
      current = typeof current === 'object' && 'cause' in current ? current.cause : null;
    }
  } catch { return false; }
  if (messages.some(message => /D1_SPACE_POLL_VOTE_WRITE_INVARIANT|JSON path|foreign key|not null|check constraint|\bP2002\b|network|fetch failed|connection|timeout|timed out|abort|unknown.?commit/i.test(message))) return false;
  return messages.some(message => /D1_SPACE_POLL_VOTE_SNAPSHOT_CONFLICT/i.test(message) ||
    (/malformed JSON/i.test(message) && /\b(?:D1_ERROR|SQLITE_ERROR)\b/i.test(message)) ||
    /UNIQUE constraint failed:\s*SpacePollVoteRequest\.pollId\s*,\s*SpacePollVoteRequest\.userId\s*,\s*SpacePollVoteRequest\.requestId\s*(?::|$)/i.test(message) ||
    /UNIQUE constraint failed:\s*SpacePollVote\.pollId\s*,\s*SpacePollVote\.userId\s*(?::|$)/i.test(message));
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
  return { nowMs, now: new Date(nowMs).toISOString().replace(/Z$/, '+00:00'), since: nowMs - 60_000 };
}

function parsedInput(input: Input): Input {
  if (typeof input.optionId !== 'string' || !SPACE_ID_RE.test(input.optionId) ||
      typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 || input.expectedRevision >= MAX_REVISION ||
      typeof input.requestId !== 'string' || !SPACE_REQUEST_ID_RE.test(input.requestId)) throw new Error('Invalid parsed D1 Space poll VOTE input');
  const payloadDigest = createHash('sha256').update(JSON.stringify({ optionId: input.optionId, expectedRevision: input.expectedRevision })).digest('hex');
  if (input.payloadDigest !== payloadDigest) throw new Error('Invalid parsed D1 Space poll VOTE digest');
  return { optionId: input.optionId, expectedRevision: input.expectedRevision, requestId: input.requestId, payloadDigest };
}

/** One native transaction, no adapter transactions or blind upserts. Only an
 * existing matching receipt is zero-write; a new same-option request advances
 * the revision and both quotas. Poll/option/Space dates are never changed. */
export async function voteD1SpacePoll(userId: string, spaceId: string, id: string, input: Input): Promise<PollDto> {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId) || typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId) ||
      typeof id !== 'string' || !SPACE_ID_RE.test(id)) throw notFound();
  const scope: Scope = { userId, spaceId, id, input: parsedInput(input) };
  const db = d1SpaceDatabase();
  let time = attemptTime();
  let snapshot = await readSnapshot(db, scope, time);
  for (let attempt = 0; attempt < 4; attempt++) {
    const currentItem = prepareSnapshot(snapshot, scope);
    const changed = snapshot.context.receiptExists === 0;
    const after = changed ? afterVote(snapshot, scope, time) : snapshot;
    const item = changed ? prepareSnapshot(after, scope, true) : currentItem;
    const beforeManifest = manifest(snapshot);
    const afterManifest = changed ? manifest(after) : beforeManifest;
    const statements = [guardedSnapshot(db, scope, time, beforeManifest)];
    if (changed) statements.push(writeVote(db, scope, snapshot, time), changedRows(db), insertReceipt(db, scope, time), changedRows(db));
    statements.push(guardedSnapshot(db, scope, time, afterManifest, changed, true));
    let results: Awaited<ReturnType<Database['batch']>>;
    try {
      results = await db.batch(statements);
    } catch (error) {
      if (!retryableRollback(error)) throw error;
      // Reauthorize and compare at the OLD cutoff. Mere clock movement cannot
      // justify replaying a failed mutation or relaxing a quota.
      const current = await readSnapshot(db, scope, time);
      prepareSnapshot(current, scope);
      if (sameSnapshot(snapshot, current)) throw error;
      if (attempt === 3) throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
      time = attemptTime();
      snapshot = await readSnapshot(db, scope, time);
      continue;
    }
    // Never retry transport/result validation after a successful batch. The
    // exact final projection and complete prevalidated DTO were checked before
    // commit by the throwing SQL postcondition, including receipt insertion.
    const final = results[results.length - 1];
    if (results.length !== statements.length || results.some(result => !result.success) ||
        !final || !Array.isArray(final.results) || final.results.length !== after.rows.length ||
        final.results.some(row => (row as { guarded?: unknown }).guarded !== 1)) {
      throw new Error('Missing committed D1 Space poll VOTE result');
    }
    return item;
  }
  throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
