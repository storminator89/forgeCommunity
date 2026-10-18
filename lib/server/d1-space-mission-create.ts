import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { MissionWeekError, resolveMissionWeek } from '@/lib/mission-week-clock';
import { SPACE_ID_RE, SPACE_REQUEST_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import type { parseMissionInput } from '@/lib/server/space-missions';
import {
  d1MissionDetailSql, projectD1SpaceMissionDetailRows, type D1MissionDataRow,
} from '@/lib/server/d1-space-missions';
import {
  D1_SPACE_ROW_BYTES, D1_SPACE_RESULT_BYTES, d1BoundedResponse, d1Date, d1SpaceDatabase,
} from '@/lib/server/d1-space-reads';

type Input = ReturnType<typeof parseMissionInput>;
type MissionDto = ReturnType<typeof projectD1SpaceMissionDetailRows>;
type Database = ReturnType<typeof d1SpaceDatabase>;
type Scalar = string | number | null;
type Flat = Record<string, Scalar>;
type Row = D1MissionDataRow;
type Snapshot = { rows: Row[]; context: Flat; detail: Row[] };
type Scope = { userId: string; spaceId: string; input: Input };
type Window = ReturnType<typeof resolveMissionWeek> | null;
const columns = ['kind', 'missionId', 'data', 'personId', 'name', 'image'] as const;
const contextKeys = ['authorized', 'isAdmin', 'isMember', 'actorRole', 'visibility', 'memberJoinedAt',
  'existing', 'creatorMatches', 'digestMatches', 'receiptId', 'receiptCreatorId', 'receiptDigest',
  'invitationAttempts', 'openCount', 'bookmarkAccessExists', 'bookmarkAccessRawEpoch', 'bookmarkAccessEpoch', 'fits'] as const;
const readerContextKeys = ['authorized', 'isAdmin', 'isMember', 'role', 'found', 'pageCount', 'invalidState', 'oversized'] as const;
const missionKeys = ['id', 'spaceId', 'title', 'prompt', 'creatorId', 'createdAt', 'createdAtMs', 'closedAt',
  'weekStartsOn', 'weekTimezone', 'weekStartsAt', 'weekEndsAt', 'joinedAt', 'optedOutAt', 'selfExists', 'epoch',
  'reservedSlots', 'bookmarkSaved', 'bookmarkRevision', 'bookmarkAccessEpoch', 'insightAttempts', 'buildOnAttempts'] as const;
const contributionKeys = ['id', 'authorId', 'kind', 'content', 'createdAt', 'createdAtMs', 'targetContributionId'] as const;
const DATE_LIMIT = 8640000000000000;
const MAX_VERSION = 2147483647;
const notFound = () => new SpaceApiError('Mission nicht gefunden', 404);
const conflict = () => new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
const openConflict = () => new SpaceApiError('In diesem Space ist bereits eine Mission offen', 409);
const invariantFailure = "json_extract('[]', 'D1_SPACE_MISSION_CREATE_WRITE_INVARIANT')";
const snapshotFailure = "json_extract('[]', 'D1_SPACE_MISSION_CREATE_SNAPSHOT_CONFLICT')";
const clockFailure = "json_extract('[]', 'D1_SPACE_MISSION_CREATE_CLOCK_FENCE')";

/** ?1 actor, ?2 Space, ?3 scoped request, ?4..8 unchanged reader arguments,
 * ?9 digest, ?10 enables the exact open-count postcondition for a new receipt.
 * NULL, never '', selects no mission when the scoped receipt does not exist.
 * No existing reader SQL text or its five-arm records compound is rewritten. */
function snapshotSql() {
  const detail = d1MissionDetailSql.replace(/\?3\b/g, '(SELECT id FROM create_receipt)');
  return `WITH create_actor AS (SELECT id, role, name, image FROM User WHERE id = ?1),
    create_access AS (
      SELECT s.id, s.visibility, u.role, u.name, u.image, (u.role = 'ADMIN') AS isAdmin,
        (m.userId IS NOT NULL) AS isMember, m.joinedAt
      FROM create_actor u JOIN Space s ON s.id = ?2
      LEFT JOIN SpaceMember m ON m.spaceId = s.id AND m.userId = u.id
      WHERE s.visibility = 'PRIVATE' AND (u.role = 'ADMIN' OR m.userId IS NOT NULL)
    ), create_receipt AS (
      SELECT m.id, m.creatorId, m.payloadDigest, m.invitationAttemptCount
      FROM SpaceMission m JOIN create_access a ON a.id = m.spaceId AND a.isAdmin = 1 WHERE m.requestId = ?3
    ), create_bookmark AS (
      SELECT b.epoch FROM SpaceMissionBookmarkAccess b WHERE b.userId = ?1
        AND EXISTS(SELECT 1 FROM create_access WHERE isAdmin = 1)
    ), create_guard AS (
      SELECT NOT EXISTS(SELECT 1 FROM create_access WHERE
        length(CAST(role AS BLOB)) > 1024 OR length(CAST(visibility AS BLOB)) > 1024
        OR length(CAST(COALESCE(joinedAt, '') AS BLOB)) > 1024
        OR length(CAST(COALESCE(name, '') AS BLOB)) > 256000
        OR length(CAST(COALESCE(image, '') AS BLOB)) > 256000)
      AND NOT EXISTS(SELECT 1 FROM create_receipt WHERE length(CAST(id AS BLOB)) > 1024
        OR length(CAST(COALESCE(creatorId, '') AS BLOB)) > 1024 OR length(CAST(payloadDigest AS BLOB)) > 1024
        OR length(CAST(invitationAttemptCount AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM create_bookmark WHERE length(CAST(epoch AS BLOB)) > 1024) AS fits
    ), create_detail AS (${detail})
    SELECT 'create-context' AS kind, NULL AS missionId,
      json_patch(json_object('actorRole', CASE WHEN g.fits = 1 THEN (SELECT role FROM create_access) END,
        'visibility', CASE WHEN g.fits = 1 THEN (SELECT visibility FROM create_access) END,
        'memberJoinedAt', CASE WHEN g.fits = 1 THEN (SELECT joinedAt FROM create_access) END,
        'receiptId', CASE WHEN g.fits = 1 THEN (SELECT id FROM create_receipt) END,
        'receiptCreatorId', CASE WHEN g.fits = 1 THEN (SELECT creatorId FROM create_receipt) END,
        'receiptDigest', CASE WHEN g.fits = 1 THEN (SELECT payloadDigest FROM create_receipt) END,
        'invitationAttempts', CASE WHEN g.fits = 1 THEN (SELECT invitationAttemptCount FROM create_receipt) END,
        'bookmarkAccessRawEpoch', CASE WHEN g.fits = 1 THEN (SELECT epoch FROM create_bookmark) END,
        'bookmarkAccessEpoch', CASE WHEN g.fits = 1 THEN COALESCE((SELECT epoch FROM create_bookmark), 0) END,
        'openCount', CASE WHEN EXISTS(SELECT 1 FROM create_access WHERE isAdmin = 1)
          AND (?10 = 1 OR NOT EXISTS(SELECT 1 FROM create_receipt))
          THEN (SELECT COUNT(*) FROM SpaceMission WHERE spaceId = ?2 AND closedAt IS NULL) ELSE NULL END),
      json_object('authorized', EXISTS(SELECT 1 FROM create_access),
        'isAdmin', COALESCE((SELECT isAdmin FROM create_access), 0),
        'isMember', COALESCE((SELECT isMember FROM create_access), 0),
        'existing', EXISTS(SELECT 1 FROM create_receipt),
        'creatorMatches', EXISTS(SELECT 1 FROM create_receipt WHERE creatorId = ?1),
        'digestMatches', EXISTS(SELECT 1 FROM create_receipt WHERE payloadDigest = ?9),
        'bookmarkAccessExists', EXISTS(SELECT 1 FROM create_bookmark), 'fits', g.fits)) AS data,
      NULL AS personId, NULL AS name, NULL AS image FROM create_guard g
    UNION ALL SELECT 'create-person', NULL, NULL, ?1, a.name, a.image
      FROM create_access a CROSS JOIN create_guard g WHERE a.isAdmin = 1 AND g.fits = 1
    UNION ALL SELECT kind, missionId, data, personId, name, image FROM create_detail`;
}

function values(scope: Scope, includeOpen = false) {
  return [scope.userId, scope.spaceId, scope.input.requestId, 'detail', 0, 0, '', 1,
    scope.input.payloadDigest, includeOpen ? 1 : 0];
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid D1 mission CREATE integer');
  }
}
function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 mission CREATE flag');
}
function text(value: unknown, limit: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.length) || Buffer.byteLength(value, 'utf8') > limit) {
    throw new Error('Invalid D1 mission CREATE text');
  }
}
function nullableText(value: unknown, limit: number) {
  if (value !== null) text(value, limit);
}
function storedDate(value: unknown): Date {
  if (typeof value === 'number') {
    integer(value, -DATE_LIMIT, DATE_LIMIT);
    return d1Date(value);
  }
  text(value, 1024, true);
  const parts = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/.exec(value);
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 mission CREATE timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > calendar.getUTCDate() ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 mission CREATE timestamp');
  }
  return d1Date(value);
}
function flat(data: unknown, keys?: readonly string[]): Flat {
  text(data, D1_SPACE_ROW_BYTES, true);
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid D1 mission CREATE object');
  const entries = Object.entries(value);
  if (entries.length > 32 || (keys && (entries.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))) ||
      entries.some(([, item]) => item !== null && typeof item !== 'string' &&
        (typeof item !== 'number' || !Number.isSafeInteger(item)))) throw new Error('Invalid D1 mission CREATE scalar');
  return value as Flat;
}

async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql()).bind(...values(scope)).all<Row>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 64) {
    throw new Error('Incomplete D1 mission CREATE snapshot');
  }
  const contexts = result.results.filter(row => row.kind === 'create-context');
  if (contexts.length !== 1) throw new Error('Missing D1 mission CREATE context');
  // Only the tiny permission/receipt flags are trusted before error precedence.
  // Every transported field and the complete projection are checked below.
  const context = flat(contexts[0].data);
  return { rows: result.results, context, detail: result.results.filter(row => !row.kind.startsWith('create-')) };
}

/** The source service checks live private authority, stored ADMIN and scoped
 * receipt before new-only week/open validation, including closed/past replays. */
function prepareSnapshot(snapshot: Snapshot, scope: Scope, includeOpen = false): MissionDto | undefined {
  const c = snapshot.context;
  if (c.authorized !== 1) throw notFound();
  if (c.isAdmin !== 1) throw new SpaceApiError('Nicht autorisiert', 403);
  if (c.existing === 1 && (c.creatorMatches !== 1 || c.digestMatches !== 1)) {
    throw new SpaceApiError('Anfrage-ID wurde bereits verwendet', 409);
  }
  if (c.fits !== 1) throw new Error('D1 mission CREATE context exceeds safe byte limits');
  const rowKeys = new Set<string>();
  let transportBytes = 0;
  for (const row of snapshot.rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== columns.length ||
        columns.some(column => !Object.hasOwn(row, column) || (row[column] !== null && typeof row[column] !== 'string'))) {
      throw new Error('Invalid D1 mission CREATE row');
    }
    text(row.kind, 32, true);
    const rowBytes = columns.reduce((bytes, column) => bytes + (row[column] === null ? 4 : Buffer.byteLength(row[column]!, 'utf8')), 0);
    transportBytes += 6 * rowBytes + 4096;
    if (rowBytes > D1_SPACE_ROW_BYTES || transportBytes > D1_SPACE_RESULT_BYTES) throw new Error('Oversized D1 mission CREATE snapshot');
    const key = `${row.kind}:${row.missionId}:${row.personId}:${row.data}`;
    if (rowKeys.has(key)) throw new Error('Duplicate D1 mission CREATE row');
    rowKeys.add(key);
    if (!['create-context', 'create-person', 'context', 'mission', 'participant', 'contribution', 'person'].includes(row.kind)) {
      throw new Error('Unexpected D1 mission CREATE row');
    }
    if (row.kind === 'person' || row.kind === 'create-person') {
      if (row.data !== null || row.missionId !== null) throw new Error('Invalid D1 mission CREATE person row');
      text(row.personId, 1024, true); nullableText(row.name, 256000); nullableText(row.image, 256000);
    } else {
      if (row.personId !== null || row.name !== null || row.image !== null) throw new Error('Invalid D1 mission CREATE data row');
      if (row.kind === 'context' || row.kind === 'create-context') {
        if (row.missionId !== null) throw new Error('Invalid D1 mission CREATE context row');
      } else text(row.missionId, 1024, true);
      flat(row.data);
    }
  }
  flat(snapshot.rows.find(row => row.kind === 'create-context')!.data, contextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'existing', 'creatorMatches', 'digestMatches', 'bookmarkAccessExists', 'fits']) flag(c[key]);
  if (c.actorRole !== 'ADMIN' || c.visibility !== 'PRIVATE') throw new Error('Invalid D1 mission CREATE authority');
  if (c.isMember === 1) storedDate(c.memberJoinedAt);
  else if (c.memberJoinedAt !== null) throw new Error('Invalid D1 mission CREATE membership');
  integer(c.bookmarkAccessEpoch, 0, MAX_VERSION);
  if (c.bookmarkAccessExists === 1) {
    integer(c.bookmarkAccessRawEpoch, 0, MAX_VERSION);
    if (c.bookmarkAccessRawEpoch !== c.bookmarkAccessEpoch) throw new Error('Invalid D1 mission CREATE bookmark fence');
  } else if (c.bookmarkAccessEpoch !== 0 || c.bookmarkAccessRawEpoch !== null) throw new Error('Invalid D1 mission CREATE absent bookmark fence');
  if (includeOpen || c.existing === 0) integer(c.openCount);
  else if (c.openCount !== null) throw new Error('Unexpected D1 mission CREATE replay open count');
  const actors = snapshot.rows.filter(row => row.kind === 'create-person');
  if (actors.length !== 1 || actors[0].personId !== scope.userId) throw new Error('Invalid D1 mission CREATE actor profile');
  const contexts = snapshot.detail.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Invalid D1 mission CREATE reader context');
  const rc = flat(contexts[0].data, readerContextKeys);
  if (rc.authorized !== 1 || rc.isAdmin !== 1 || rc.isMember !== c.isMember || rc.role !== 'ADMIN') {
    throw new Error('Inconsistent D1 mission CREATE reader authority');
  }
  if (rc.invalidState !== 0) throw new SpaceApiError('Mission enthält einen ungültigen Teilnahmestand.', 409);
  if (rc.oversized !== 0) throw new SpaceApiError('Missionsdaten sind zu groß und können nicht sicher geladen werden.', 500);
  if (c.existing === 0) {
    if (c.receiptId !== null || c.receiptCreatorId !== null || c.receiptDigest !== null || c.invitationAttempts !== null ||
        c.creatorMatches !== 0 || c.digestMatches !== 0 || snapshot.detail.length !== 1 || rc.found !== 0 || rc.pageCount !== 0) {
      throw new Error('Unexpected D1 mission CREATE receipt');
    }
    return undefined;
  }
  text(c.receiptId, 1024, true);
  if (c.receiptCreatorId !== scope.userId || c.receiptDigest !== scope.input.payloadDigest) throw new Error('Invalid D1 mission CREATE receipt');
  integer(c.invitationAttempts, 0, MAX_VERSION);
  if (rc.found !== 1 || rc.pageCount !== 1) throw new Error('Incomplete D1 mission CREATE reader');
  const missions = snapshot.detail.filter(row => row.kind === 'mission');
  if (missions.length !== 1 || missions[0].missionId !== c.receiptId) throw new Error('Invalid D1 mission CREATE mission row');
  const m = flat(missions[0].data, missionKeys);
  if (m.id !== c.receiptId || m.spaceId !== scope.spaceId || m.creatorId !== scope.userId) throw new Error('Invalid D1 mission CREATE projection');
  text(m.title, 64000); text(m.prompt, 64000);
  integer(m.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
  if (storedDate(m.createdAt).getTime() !== m.createdAtMs) throw new Error('Invalid D1 mission CREATE date key');
  if (m.closedAt !== null) storedDate(m.closedAt);
  const week = [m.weekStartsOn, m.weekTimezone, m.weekStartsAt, m.weekEndsAt];
  if (!week.every(value => value === null)) {
    text(m.weekStartsOn, 1024, true); text(m.weekTimezone, 1024, true);
    if (!/^\d{4}-\d\d-\d\d$/.test(m.weekStartsOn) || storedDate(m.weekEndsAt) <= storedDate(m.weekStartsAt)) {
      throw new Error('Invalid D1 mission CREATE stored week');
    }
  }
  flag(m.selfExists); flag(m.bookmarkSaved);
  integer(m.epoch, 0, MAX_VERSION - 1); integer(m.reservedSlots, 0, 5);
  integer(m.bookmarkRevision, 0, MAX_VERSION); integer(m.bookmarkAccessEpoch, 0, MAX_VERSION);
  integer(m.insightAttempts); integer(m.buildOnAttempts);
  if (m.bookmarkAccessEpoch !== c.bookmarkAccessEpoch) throw new Error('Invalid D1 mission CREATE global bookmark epoch');
  if (m.selfExists === 0) {
    if (m.epoch !== 0 || m.joinedAt !== null || m.optedOutAt !== null) throw new Error('Invalid D1 mission CREATE absent consent');
  } else {
    if (m.epoch < 1) throw new Error('Invalid D1 mission CREATE consent epoch');
    storedDate(m.joinedAt); if (m.optedOutAt !== null) storedDate(m.optedOutAt);
  }
  const people = new Map<string, Row>();
  for (const row of snapshot.detail.filter(row => row.kind === 'person')) {
    if (people.has(row.personId!)) throw new Error('Duplicate D1 mission CREATE person');
    people.set(row.personId!, row);
  }
  const participantIds = new Set<string>();
  const participants = snapshot.detail.filter(row => row.kind === 'participant');
  const contributions = snapshot.detail.filter(row => row.kind === 'contribution');
  if (participants.length > 5 || contributions.length > 10 || participants.length > m.reservedSlots) throw new Error('Invalid D1 mission CREATE projection count');
  const usedPeople = new Set<string>([scope.userId]);
  for (const row of participants) {
    const p = flat(row.data, ['userId', 'joinedAt']);
    text(p.userId, 1024, true); storedDate(p.joinedAt);
    if (row.missionId !== m.id || participantIds.has(p.userId)) throw new Error('Invalid D1 mission CREATE participant');
    participantIds.add(p.userId); usedPeople.add(p.userId);
  }
  const visible = new Map<string, Flat>();
  for (const row of contributions) {
    const item = flat(row.data, contributionKeys);
    text(item.id, 1024, true); text(item.authorId, 1024, true); text(item.content, 64000);
    integer(item.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
    if (row.missionId !== m.id || visible.has(item.id) || !participantIds.has(item.authorId) ||
        (item.kind !== 'INSIGHT' && item.kind !== 'BUILD_ON') || storedDate(item.createdAt).getTime() !== item.createdAtMs) {
      throw new Error('Invalid D1 mission CREATE contribution');
    }
    if (item.kind === 'INSIGHT') {
      if (item.targetContributionId !== null) throw new Error('Invalid D1 mission CREATE insight target');
    } else text(item.targetContributionId, 1024, true);
    visible.set(item.id, item); usedPeople.add(item.authorId);
  }
  for (const item of visible.values()) if (item.kind === 'BUILD_ON') {
    const target = visible.get(item.targetContributionId as string);
    if (!target || target.kind !== 'INSIGHT' || target.authorId === item.authorId) throw new Error('Invalid D1 mission CREATE visible target');
  }
  if (people.size !== usedPeople.size || [...usedPeople].some(id => !people.has(id))) throw new Error('Incomplete D1 mission CREATE people');
  const creator = people.get(scope.userId)!;
  if (creator.name !== actors[0].name || creator.image !== actors[0].image) throw new Error('Inconsistent D1 mission CREATE creator');
  const item = d1BoundedResponse(projectD1SpaceMissionDetailRows(snapshot.detail, scope.userId));
  if (!item.canManage || item.canJoin || item.participation.active || item.myNextAction !== null || item.ownContributions.length !== 0 ||
      (item.ownBookmark !== null) !== (c.isMember === 1 && m.closedAt === null)) throw new Error('Invalid D1 mission CREATE private DTO');
  return item;
}

function manifest(snapshot: Snapshot) {
  const json = JSON.stringify(snapshot.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  if (Buffer.byteLength(json, 'utf8') > D1_SPACE_ROW_BYTES) throw new Error('D1 mission CREATE manifest exceeds safe byte limits');
  return json;
}

/** Source data cells are flat scalar objects. Compare exact keys and raw
 * scalar types/values, not JSON spelling: SQLite can emit 1.0 for JS's 1.
 * Nullable dates remain raw strings/numbers, never normalized for the fence.
 * Preparation proves distinct expected identities for each context singleton,
 * mission id, participant userId, contribution id and personId. Therefore the
 * bidirectional match plus exact total count also rejects duplicate current
 * multiplicities: one current row cannot satisfy two expected identities. */
function equality() {
  const raw = columns.filter(column => column !== 'data').map(column => `c."${column}" IS e."${column}"`).join(' AND ');
  return `${raw} AND (c.data IS e.data OR (json_type(c.data) = 'object' AND json_type(e.data) = 'object'
    AND (SELECT COUNT(*) FROM json_each(c.data)) = (SELECT COUNT(*) FROM json_each(e.data))
    AND NOT EXISTS(SELECT 1 FROM json_each(c.data) x WHERE NOT EXISTS(SELECT 1 FROM json_each(e.data) y
      WHERE x.key IS y.key AND x.value IS y.value AND (x.type = y.type OR x.type IN ('integer','real') AND y.type IN ('integer','real'))))
    AND NOT EXISTS(SELECT 1 FROM json_each(e.data) y WHERE NOT EXISTS(SELECT 1 FROM json_each(c.data) x
      WHERE x.key IS y.key AND x.value IS y.value AND (x.type = y.type OR x.type IN ('integer','real') AND y.type IN ('integer','real'))))))`;
}
function guardedSnapshot(db: Database, scope: Scope, expected: string, includeOpen = false, final = false) {
  const equal = equality();
  return db.prepare(`WITH current AS (${snapshotSql()}), expected AS (
      SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(?11) j
    ), matched AS (
      SELECT (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
        AND NOT EXISTS(SELECT 1 FROM current c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equal}))
        AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM current c WHERE ${equal})) AS valid
    ), assertion AS (SELECT CASE WHEN valid THEN 1 ELSE ${final ? invariantFailure : snapshotFailure} END AS guarded FROM matched)
    ${final ? 'SELECT c.*, a.guarded FROM assertion a CROSS JOIN current c' : 'SELECT guarded FROM assertion'}`)
    .bind(...values(scope, includeOpen), expected);
}

function row(kind: string, data: Flat | null, missionId: string | null = null): Row {
  return { kind, missionId, data: data === null ? null : JSON.stringify(data), personId: null, name: null, image: null };
}
function newSnapshot(before: Snapshot, scope: Scope, window: Window): Snapshot {
  const now = new Date();
  integer(now.getTime(), -DATE_LIMIT, DATE_LIMIT);
  const createdAt = now.toISOString().replace(/Z$/, '+00:00');
  const id = randomUUID();
  const context: Flat = { ...before.context, existing: 1, creatorMatches: 1, digestMatches: 1,
    receiptId: id, receiptCreatorId: scope.userId, receiptDigest: scope.input.payloadDigest, invitationAttempts: 0, openCount: 1 };
  const readerContext = flat(before.detail[0].data, readerContextKeys);
  const actor = before.rows.find(item => item.kind === 'create-person')!;
  const mission = row('mission', { id, spaceId: scope.spaceId, title: scope.input.title, prompt: scope.input.prompt,
    creatorId: scope.userId, createdAt, createdAtMs: now.getTime(), closedAt: null,
    weekStartsOn: window?.weekStartsOn ?? null, weekTimezone: window?.weekTimezone ?? null,
    weekStartsAt: window?.weekStartsAt.toISOString().replace(/Z$/, '+00:00') ?? null,
    weekEndsAt: window?.weekEndsAt.toISOString().replace(/Z$/, '+00:00') ?? null,
    joinedAt: null, optedOutAt: null, selfExists: 0, epoch: 0, reservedSlots: 0,
    bookmarkSaved: 0, bookmarkRevision: 0, bookmarkAccessEpoch: context.bookmarkAccessEpoch, insightAttempts: 0, buildOnAttempts: 0 }, id);
  const detail = [row('context', { ...readerContext, found: 1, pageCount: 1 }), mission, { ...actor, kind: 'person' }];
  return { rows: [row('create-context', context), actor, ...detail], context, detail };
}

function resolveWindow(input: Input): Window {
  try { return input.week ? resolveMissionWeek(input.week, new Date()) : null; }
  catch (error) { if (error instanceof MissionWeekError) throw new SpaceApiError(error.message, 400); throw error; }
}
function insertMission(db: Database, scope: Scope, after: Snapshot) {
  const m = flat(after.detail.find(item => item.kind === 'mission')!.data, missionKeys);
  // The trusted database clock fences both independently resolved local
  // midnights. A missed fence throws a distinct rollback; it never no-ops.
  return db.prepare(`INSERT INTO SpaceMission (id, spaceId, creatorId, requestId, payloadDigest, title, prompt,
      createdAt, closedAt, weekStartsOn, weekTimezone, weekStartsAt, weekEndsAt, invitationAttemptCount)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11, ?12, 0
    WHERE CASE WHEN ?11 IS NULL AND ?12 IS NULL OR (julianday('now') >= julianday(?11) AND julianday('now') < julianday(?12))
      THEN 1 ELSE ${clockFailure} END = 1`)
    .bind(m.id, scope.spaceId, scope.userId, scope.input.requestId, scope.input.payloadDigest, m.title, m.prompt,
      m.createdAt, m.weekStartsOn, m.weekTimezone, m.weekStartsAt, m.weekEndsAt);
}

type Rollback = 'snapshot' | 'clock' | 'unique' | null;
/** Bounded, cycle-safe cause inspection. Invariant/transport/unknown-commit
 * evidence outranks every nested known rollback marker. Generic malformed
 * JSON is never sufficient because each guard has its own bad-path marker. */
function rollbackKind(error: unknown): Rollback {
  const details: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return null;
      seen.add(current);
      if (typeof current === 'string') { if (current.length > 65536) return null; details.push(current); break; }
      if (typeof current !== 'object') return null;
      const record = current as Record<string, unknown>;
      for (const field of ['message', 'name', 'code']) if (field in record) {
        const value = record[field];
        if (typeof value !== 'string' || value.length > 65536) return null;
        if (field === 'code' && !/^(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT|SQLITE_CONSTRAINT_UNIQUE)$/.test(value)) return null;
        if (field === 'name' && !['Error', 'D1Error', 'D1_ERROR', 'SqliteError'].includes(value)) return null;
        details.push(value);
      }
      current = 'cause' in record ? record.cause : null;
    }
  } catch { return null; }
  if (details.some(value => /D1_SPACE_MISSION_CREATE_WRITE_INVARIANT|foreign[_\s-]*key|not[_\s-]*null|check constraint|\bP2002\b|network|fetch|connection|transport|timeout|timed out|abort|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|unexpected token|invalid response|HTTP\s*\d/i.test(value))) return null;
  const sqlite = details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT(?:_UNIQUE)?)\b/.test(value));
  if (!sqlite) return null;
  const unique = details.filter(value => /UNIQUE constraint failed/i.test(value));
  if (unique.length) {
    const scoped = /UNIQUE constraint failed:\s*SpaceMission\.spaceId\s*,\s*SpaceMission\.requestId\s*(?::|$)/i;
    const oneOpen = /UNIQUE constraint failed:\s*SpaceMission\.spaceId\s*(?::|$)/i;
    // The single-column failure is the provider's partial OneOpen index:
    // SpaceMission has no other unique(spaceId) constraint in either schema.
    return unique.every(value => (value.match(/UNIQUE constraint failed/gi)?.length === 1) &&
      (scoped.test(value) || oneOpen.test(value))) ? 'unique' : null;
  }
  if (details.some(value => /constraint/i.test(value))) return null;
  if (details.some(value => /D1_SPACE_MISSION_CREATE_CLOCK_FENCE/.test(value))) return 'clock';
  if (details.some(value => /D1_SPACE_MISSION_CREATE_SNAPSHOT_CONFLICT/.test(value))) return 'snapshot';
  return null;
}

function sameSnapshot(left: Snapshot, right: Snapshot) {
  const canonical = (snapshot: Snapshot) => snapshot.rows.map(item => JSON.stringify(columns.map(column =>
    column === 'data' && item.data !== null ? Object.entries(flat(item.data)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : item[column]))).sort();
  const a = canonical(left), b = canonical(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function parsedInput(input: Input): Input {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 5 ||
      !['title', 'prompt', 'requestId', 'payloadDigest', 'week'].every(key => Object.hasOwn(input, key)) ||
      typeof input.title !== 'string' || input.title.length < 3 || input.title.length > 100 ||
      typeof input.prompt !== 'string' || input.prompt.length < 10 || input.prompt.length > 2000 ||
      typeof input.requestId !== 'string' || !SPACE_REQUEST_ID_RE.test(input.requestId)) throw new Error('Invalid parsed D1 mission CREATE input');
  if (input.week !== null && (!input.week || typeof input.week !== 'object' || Array.isArray(input.week) ||
      Object.keys(input.week).length !== 2 || typeof input.week.startDate !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(input.week.startDate) ||
      typeof input.week.timezone !== 'string' || !input.week.timezone.length || input.week.timezone.length > 100)) {
    throw new Error('Invalid parsed D1 mission CREATE week');
  }
  const week = input.week === null ? null : { startDate: input.week.startDate, timezone: input.week.timezone };
  const payload = week ? { title: input.title, prompt: input.prompt, week } : { title: input.title, prompt: input.prompt };
  const payloadDigest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (input.payloadDigest !== payloadDigest) throw new Error('Invalid parsed D1 mission CREATE digest');
  return { title: input.title, prompt: input.prompt, requestId: input.requestId, payloadDigest, week };
}

/** Native single-Mission INSERT, with zero-write current receipt replay. No
 * participation, bookmark/access, invitation or notification is materialized. */
export async function createD1SpaceMission(userId: string, spaceId: string, input: Input): Promise<{ item: MissionDto; created: boolean }> {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId) || typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId)) throw notFound();
  const scope: Scope = { userId, spaceId, input: parsedInput(input) };
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  let replayOnly = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const replay = prepareSnapshot(snapshot, scope);
    const created = snapshot.context.existing === 0;
    // Receipt replay never resolves or replaces its stored soft week. New
    // attempts resolve after the live authority, receipt and open-count read.
    const window = created ? resolveWindow(scope.input) : null;
    if (created && (replayOnly || snapshot.context.openCount !== 0)) throw openConflict();
    const after = created ? newSnapshot(snapshot, scope, window) : snapshot;
    const item = created ? prepareSnapshot(after, scope, true) : replay;
    if (!item) throw new Error('Missing prepared D1 mission CREATE response');
    const beforeManifest = manifest(snapshot), afterManifest = created ? manifest(after) : beforeManifest;
    const statements = [guardedSnapshot(db, scope, beforeManifest)];
    if (created) statements.push(insertMission(db, scope, after), db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`));
    statements.push(guardedSnapshot(db, scope, afterManifest, created, true));
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind === null) throw error;
      const current = await readSnapshot(db, scope);
      const currentReplay = prepareSnapshot(current, scope);
      if (kind === 'unique') replayOnly = true;
      if (!currentReplay) {
        // A known clock rollback reevaluates ordinary input immediately. If
        // rollover expired the week, the normal resolver returns its 400.
        resolveWindow(scope.input);
        if (replayOnly || current.context.openCount !== 0) throw openConflict();
      }
      if (kind === 'snapshot' && sameSnapshot(snapshot, current)) throw error;
      if (attempt === 3) throw conflict();
      snapshot = current;
      continue;
    }
    // A successful batch, an unknown commit, or malformed result is never
    // retried. SQL checked the complete prevalidated DTO before commit.
    const final = results[results.length - 1];
    if (results.length !== statements.length || results.some(result => result.success !== true) ||
        !final || !Array.isArray(final.results) || final.results.length !== after.rows.length ||
        final.results.some(value => !value || typeof value !== 'object' ||
          (value as { guarded?: unknown }).guarded !== 1 || Object.keys(value).length !== columns.length + 1 ||
          columns.some(column => !Object.hasOwn(value, column) ||
            ((value as Record<string, unknown>)[column] !== null && typeof (value as Record<string, unknown>)[column] !== 'string')))) {
      throw new Error('Missing committed D1 mission CREATE result');
    }
    const committedRows = final.results.map(value => Object.fromEntries(columns.map(column =>
      [column, (value as Record<string, unknown>)[column]])) as Row);
    if (!sameSnapshot(after, { rows: committedRows, context: after.context, detail: [] })) {
      throw new Error('Unexpected committed D1 mission CREATE projection');
    }
    return { item, created };
  }
  throw conflict();
}
