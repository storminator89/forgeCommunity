import 'server-only';

import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import {
  d1BoundedResponse, d1Date, d1DateMs, d1ProjectionBudgetCtes,
  d1SpaceAccessCtes, d1SpaceDatabase, d1TextBytes, type D1StoredDate,
} from '@/lib/server/d1-space-reads';

const PAGE_SIZE = 10;
type Cursor = { id: string; createdAt: Date };
type ReadKind = 'list' | 'detail';
type ContextRow = {
  kind: 'context'; authorized: number; fits: number; keysValid: number;
  hasMore: number; isMember: number; canManage: number;
};
type PollRow = {
  kind: 'poll'; id: string; spaceId: string; question: string;
  createdAt: D1StoredDate; closedAt: D1StoredDate | null; hiddenAt: D1StoredDate | null;
  moderationRevision: number; createdAtMs: number; ownOptionId: string | null; ownRevision: number | null;
};
type KeyRow = { kind: 'key'; id: string; createdAt: D1StoredDate; createdAtMs: number };
type OptionRow = {
  kind: 'option'; id: string; pollId: string; label: string; position: number; votes: number; createdAtMs: number;
};
type Row = ContextRow | KeyRow | PollRow | OptionRow;

type PollDto = {
  id: string; spaceId: string; question: string; createdAt: string; closedAt: string | null; hiddenAt: string | null;
  moderationRevision: number; options: Array<{ id: string; label: string; votes: number }>; totalVotes: number;
  ownVote: { optionId: string | null; revision: number }; canVote: boolean; canManage: boolean;
};

const notFound = () => new SpaceApiError('Umfrage nicht gefunden', 404);

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SPACE_ID_RE.test(value)) throw new Error('Invalid D1 Space poll identifier');
}

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid D1 Space poll text');
}

function integer(value: unknown, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error('Invalid D1 Space poll integer');
  }
}

function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 Space poll access flag');
}

/** Match the supported stored date representations without allowing Date's
 * permissive parsing to turn malformed calendar dates into a different day. */
function storedDate(value: unknown): Date {
  if (typeof value === 'number') {
    integer(value, Number.MIN_SAFE_INTEGER);
    return d1Date(value);
  }
  if (typeof value !== 'string') throw new Error('Invalid D1 Space poll timestamp');
  const parts = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/.exec(value);
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 Space poll timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  const days = calendar.getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 Space poll timestamp');
  }
  return d1Date(value);
}

/** The first ten polls and all of their options are separate typed records.
 * All eleven raw keys are validated; the sentinel's bodies are not projected.
 * No vote rows, voter identities, creator data or durable receipts are returned.
 * Every request value is bound, and each call executes one protected SELECT. */
async function readRows(kind: ReadKind, userId: string, spaceId: string, id = '',
  cursor: Cursor | null = null, cursorValid = true) {
  // The session route owns401; a malformed/deleted actor has no readable poll.
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId)) throw notFound();
  const detail = kind === 'detail';
  const keyBytes = d1TextBytes('p."id"', 'p."createdAt"');
  const pollBytes = d1TextBytes('p."id"', 'p."spaceId"', 'p."question"', 'p."createdAt"',
    'p."closedAt"', 'p."hiddenAt"', 'p."moderationRevision"', 'own."optionId"', 'own."revision"');
  const optionBytes = d1TextBytes('o."id"', 'o."pollId"', 'o."label"', 'o."position"');
  const result = await d1SpaceDatabase().prepare(`
    WITH ${d1SpaceAccessCtes()},
    readable AS (
      SELECT p."id", ${d1DateMs('p."createdAt"')} AS "createdAtMs"
      FROM access a JOIN "SpacePoll" p ON p."spaceId" = a."id"
      WHERE ?7 = 1 AND (a."canManage" = 1 OR p."hiddenAt" IS NULL)
        ${detail ? 'AND p."id" = ?3' : ''}
    ), page AS (
      SELECT * FROM readable
      WHERE ?4 = 0 OR "createdAtMs" IS NULL OR "createdAtMs" < ?5 OR ("createdAtMs" = ?5 AND "id" < ?6)
      ORDER BY "createdAtMs" DESC, "id" DESC LIMIT ${detail ? 1 : PAGE_SIZE + 1}
    ), page_keys AS (
      SELECT NOT EXISTS (SELECT 1 FROM page WHERE typeof("id") <> 'text'
        OR length("id") NOT BETWEEN 1 AND 100 OR "id" GLOB '*[^A-Za-z0-9_-]*'
        OR instr(CAST("id" AS BLOB), x'00') <> 0
        OR typeof("createdAtMs") <> 'integer' OR "createdAtMs" NOT BETWEEN -8640000000000000 AND 8640000000000000) AS valid
    ), projected AS (
      SELECT page.* FROM page JOIN page_keys keys ON keys.valid = 1
      ORDER BY "createdAtMs" DESC, "id" DESC LIMIT ${detail ? 1 : PAGE_SIZE}
    ), ${d1ProjectionBudgetCtes(`
      SELECT ${keyBytes} AS bytes FROM page item JOIN "SpacePoll" p ON p."id" = item."id"
      UNION ALL
      SELECT ${pollBytes} AS bytes FROM projected item JOIN "SpacePoll" p ON p."id" = item."id"
        LEFT JOIN "SpacePollVote" own ON own."pollId" = p."id" AND own."userId" = ?1
      UNION ALL
      SELECT ${optionBytes} AS bytes FROM projected item JOIN "SpacePollOption" o ON o."pollId" = item."id"`,
      'SELECT bytes FROM projection_sizes')}
    SELECT 'context' AS kind, EXISTS(SELECT 1 FROM ${detail ? 'readable' : 'access'}) AS authorized, b.fits, keys.valid AS keysValid,
      ${detail ? '0' : `(SELECT COUNT(*) FROM page) > ${PAGE_SIZE}`} AS hasMore,
      COALESCE((SELECT "isMember" FROM access), 0) AS isMember,
      COALESCE((SELECT "canManage" FROM access), 0) AS canManage,
      NULL AS id, NULL AS spaceId, NULL AS question, NULL AS createdAt, NULL AS closedAt,
      NULL AS hiddenAt, NULL AS moderationRevision, NULL AS createdAtMs,
      NULL AS ownOptionId, NULL AS ownRevision, NULL AS pollId, NULL AS label, NULL AS position, NULL AS votes
    FROM projection_budget b CROSS JOIN page_keys keys
    UNION ALL
    SELECT 'key', NULL, NULL, NULL, NULL, NULL, NULL,
      p."id", NULL, NULL, p."createdAt", NULL, NULL, NULL, item."createdAtMs", NULL, NULL, NULL, NULL, NULL, NULL
    FROM projection_budget b JOIN page item ON b.fits = 1 JOIN "SpacePoll" p ON p."id" = item."id"
    UNION ALL
    SELECT 'poll', NULL, NULL, NULL, NULL, NULL, NULL,
      p."id", p."spaceId", p."question", p."createdAt", p."closedAt", p."hiddenAt", p."moderationRevision",
      item."createdAtMs", own."optionId", own."revision", NULL, NULL, NULL, NULL
    FROM projection_budget b JOIN projected item ON b.fits = 1 JOIN "SpacePoll" p ON p."id" = item."id"
      LEFT JOIN "SpacePollVote" own ON own."pollId" = p."id" AND own."userId" = ?1
    UNION ALL
    SELECT 'option', NULL, NULL, NULL, NULL, NULL, NULL,
      o."id", NULL, NULL, NULL, NULL, NULL, NULL, item."createdAtMs", NULL, NULL,
      o."pollId", o."label", o."position",
      (SELECT COUNT(*) FROM "SpacePollVote" vote WHERE vote."pollId" = o."pollId" AND vote."optionId" = o."id")
    FROM projection_budget b JOIN projected item ON b.fits = 1 JOIN "SpacePollOption" o ON o."pollId" = item."id"
    ORDER BY kind, createdAtMs DESC, pollId DESC, position ASC, id DESC
  `).bind(userId, spaceId, id, cursor ? 1 : 0, cursor?.createdAt.getTime() ?? 0,
    cursor?.id ?? '', cursorValid ? 1 : 0).all<Row>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('Incomplete D1 Space poll read');
  const contexts = result.results.filter((row): row is ContextRow => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Missing D1 Space poll read context');
  const context = contexts[0];
  // Access/target404 deliberately precedes every projection validation failure.
  if (context.authorized !== 1) throw notFound();
  if (context.keysValid !== 1) throw new Error('Invalid D1 Space poll pagination key');
  if (context.fits !== 1) throw new Error('D1 Space poll projection exceeds safe byte limits');
  flag(context.hasMore); flag(context.isMember); flag(context.canManage);
  const keys: KeyRow[] = [];
  const polls: PollRow[] = [];
  const options: OptionRow[] = [];
  for (const row of result.results) {
    if (row.kind === 'key') keys.push(row);
    else if (row.kind === 'poll') polls.push(row);
    else if (row.kind === 'option') options.push(row);
    else if (row.kind !== 'context') throw new Error('Invalid D1 Space poll row kind');
  }
  if (polls.length > (detail ? 1 : PAGE_SIZE) || (detail && polls.length !== 1) ||
      (context.hasMore === 1 && polls.length !== PAGE_SIZE) ||
      keys.length !== polls.length + context.hasMore ||
      (!cursorValid && (polls.length !== 0 || options.length !== 0 || context.hasMore !== 0))) {
    throw new Error('Incomplete D1 Space poll page');
  }
  const keyById = new Map<string, number>();
  let previous: KeyRow | undefined;
  for (const key of keys) {
    identifier(key.id); integer(key.createdAtMs, Number.MIN_SAFE_INTEGER);
    if (storedDate(key.createdAt).getTime() !== key.createdAtMs || keyById.has(key.id) ||
        (previous && (previous.createdAtMs < key.createdAtMs ||
          (previous.createdAtMs === key.createdAtMs && previous.id <= key.id)))) {
      throw new Error('Invalid D1 Space poll pagination key');
    }
    keyById.set(key.id, key.createdAtMs);
    previous = key;
  }
  for (const poll of polls) {
    if (keyById.get(poll.id) !== poll.createdAtMs) throw new Error('Missing D1 Space poll pagination key');
  }
  return { context, polls, options };
}

function projectRows({ context, polls, options }: Awaited<ReturnType<typeof readRows>>, spaceId: string) {
  const byId = new Map<string, { dto: PollDto; createdAtMs: number; optionIds: Set<string>; lastPosition: number | null }>();
  let previous: PollRow | undefined;
  for (const row of polls) {
    identifier(row.id); identifier(row.spaceId); text(row.question);
    integer(row.moderationRevision); integer(row.createdAtMs, Number.MIN_SAFE_INTEGER);
    const createdAt = storedDate(row.createdAt);
    const closedAt = row.closedAt === null ? null : storedDate(row.closedAt).toISOString();
    const hiddenAt = row.hiddenAt === null ? null : storedDate(row.hiddenAt).toISOString();
    if (row.spaceId !== spaceId || byId.has(row.id) || createdAt.getTime() !== row.createdAtMs ||
        (context.canManage !== 1 && hiddenAt !== null) ||
        (previous && (previous.createdAtMs < row.createdAtMs ||
          (previous.createdAtMs === row.createdAtMs && previous.id <= row.id)))) {
      throw new Error('Invalid D1 Space poll projection');
    }
    let ownVote: PollDto['ownVote'];
    if (row.ownOptionId === null && row.ownRevision === null) ownVote = { optionId: null, revision: 0 };
    else {
      identifier(row.ownOptionId); integer(row.ownRevision);
      ownVote = { optionId: row.ownOptionId, revision: row.ownRevision };
    }
    byId.set(row.id, { dto: {
      id: row.id, spaceId: row.spaceId, question: row.question, createdAt: createdAt.toISOString(), closedAt, hiddenAt,
      moderationRevision: row.moderationRevision, options: [], totalVotes: 0, ownVote,
      canVote: context.isMember === 1 && closedAt === null && hiddenAt === null, canManage: context.canManage === 1,
    }, createdAtMs: row.createdAtMs, optionIds: new Set(), lastPosition: null });
    previous = row;
  }
  const allOptionIds = new Set<string>();
  for (const option of options) {
    identifier(option.id); identifier(option.pollId); text(option.label);
    integer(option.position, Number.MIN_SAFE_INTEGER); integer(option.votes);
    integer(option.createdAtMs, Number.MIN_SAFE_INTEGER);
    const poll = byId.get(option.pollId);
    if (!poll || option.createdAtMs !== poll.createdAtMs || allOptionIds.has(option.id) ||
        (poll.lastPosition !== null && option.position <= poll.lastPosition)) {
      throw new Error('Invalid D1 Space poll option projection');
    }
    const total = poll.dto.totalVotes + option.votes;
    integer(total);
    poll.dto.options.push({ id: option.id, label: option.label, votes: option.votes });
    poll.dto.totalVotes = total;
    poll.optionIds.add(option.id);
    poll.lastPosition = option.position;
    allOptionIds.add(option.id);
  }
  const items: PollDto[] = [];
  for (const poll of byId.values()) {
    if (poll.dto.ownVote.optionId !== null && !poll.optionIds.has(poll.dto.ownVote.optionId)) {
      throw new Error('Invalid D1 Space poll own vote');
    }
    items.push(poll.dto);
  }
  return items;
}

/** Cursor parsing remains in the facade, after the same-statement ACL check. */
export async function d1SpacePolls(userId: string, spaceId: string, cursor: Cursor | null, cursorValid = true) {
  const rows = await readRows('list', userId, spaceId, '', cursor, cursorValid);
  const items = projectRows(rows, spaceId);
  const last = items[items.length - 1];
  const nextCursor = rows.context.hasMore === 1
    ? Buffer.from(JSON.stringify({ v: 1, kind: 'polls', spaceId, id: last.id, createdAt: last.createdAt })).toString('base64url')
    : null;
  return d1BoundedResponse({ items, nextCursor });
}

export async function d1SpacePoll(userId: string, spaceId: string, id: string): Promise<PollDto> {
  const rows = await readRows('detail', userId, spaceId, id);
  const items = projectRows(rows, spaceId);
  if (items.length !== 1 || items[0].id !== id) throw new Error('Missing authorized D1 Space poll');
  return d1BoundedResponse(items[0]);
}
