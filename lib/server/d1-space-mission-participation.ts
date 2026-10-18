import 'server-only';

import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import { invitationConflict } from '@/lib/server/space-mission-invitation-state';
import {
  d1MissionDetailSql, projectD1SpaceMissionDetailRows, type D1MissionDataRow,
} from '@/lib/server/d1-space-missions';
import {
  D1_SPACE_ROW_BYTES, D1_SPACE_RESULT_BYTES, d1BoundedResponse, d1Date, d1SpaceDatabase,
} from '@/lib/server/d1-space-reads';

type MissionDto = ReturnType<typeof projectD1SpaceMissionDetailRows>;
type Database = ReturnType<typeof d1SpaceDatabase>;
type Scalar = string | number | null;
type Flat = Record<string, Scalar>;
type Row = D1MissionDataRow;
type Scope = { userId: string; spaceId: string; id: string; epoch: number; join: boolean; now: string };
type Snapshot = { rows: Row[]; context: Flat; detail: Row[] };
type Mutation = { changed: boolean; insert: boolean };
const columns = ['kind', 'missionId', 'data', 'personId', 'name', 'image'] as const;
const contextKeys = ['actorRole', 'visibility', 'memberJoinedAt', 'closedAt', 'invitationAttempts', 'ownEpoch',
  'ownJoinedAt', 'ownOptedOutAt', 'bookmarkSavedAt', 'bookmarkRevision', 'bookmarkAccessEpoch',
  'authorized', 'isAdmin', 'isMember', 'found', 'isClosed', 'selfExists', 'ownActive', 'bookmarkExists',
  'bookmarkAccessExists', 'reservedSlots', 'pendingCount', 'pendingOverflow', 'pendingInvalid', 'noticeCount',
  'futureEpochCount', 'projectedInvalidEpochs', 'fits'] as const;
const readerContextKeys = ['authorized', 'isAdmin', 'isMember', 'role', 'found', 'pageCount', 'invalidState', 'oversized'] as const;
const missionKeys = ['id', 'spaceId', 'title', 'prompt', 'creatorId', 'createdAt', 'createdAtMs', 'closedAt',
  'weekStartsOn', 'weekTimezone', 'weekStartsAt', 'weekEndsAt', 'joinedAt', 'optedOutAt', 'selfExists', 'epoch',
  'reservedSlots', 'bookmarkSaved', 'bookmarkRevision', 'bookmarkAccessEpoch', 'insightAttempts', 'buildOnAttempts'] as const;
const contributionKeys = ['id', 'authorId', 'kind', 'content', 'createdAt', 'createdAtMs', 'targetContributionId'] as const;
const DATE_LIMIT = 8640000000000000;
const MAX_EPOCH = 2147483646;
const notFound = () => new SpaceApiError('Mission nicht gefunden', 404);
const conflict = () => new SpaceApiError('Teilnahme wurde geändert. Bitte neu laden.', 409);
const invariantFailure = "json_extract('[]', 'D1_SPACE_MISSION_PARTICIPATION_WRITE_INVARIANT')";
const snapshotFailure = "json_extract('[]', 'D1_SPACE_MISSION_PARTICIPATION_SNAPSHOT_CONFLICT')";
const ownColumns = 'missionId, userId, epoch, joinedAt, optedOutAt';

/** The only rewrite is seven source-owned table references, inside this helper's
 * hypothetical read. The shared reader and the final actual reader are intact.
 * Restrict the view to this one mission: no unbounded participation transport or
 * historical contribution/profile inventory is needed to discover the After. */
function hypotheticalReader() {
  const table = /\bSpaceMissionParticipation\b/g;
  if ((d1MissionDetailSql.match(table) ?? []).length !== 7) {
    throw new Error('D1 mission participation reader seam changed');
  }
  return d1MissionDetailSql.replace(table, 'participation_view');
}

/** ?1 actor, ?2 Space, ?3 mission, ?4..8 unchanged reader arguments;
 * ?9 join, ?10 expected epoch, ?11 one stable operation timestamp.
 * The raw source context is deliberately independent of reader invalidState and
 * profile budgets. Domain failures are decided from its small flags first.
 * The detail rows already describe the SQL-derived hypothetical After, including
 * a newly exposed sixth participant after a legacy six-to-five leave. */
function snapshotSql(hypothetical = true) {
  const replay = 'EXISTS(SELECT 1 FROM participation_current WHERE epoch = ?10 + 1 AND optedOutAt IS NULL)';
  const view = hypothetical ? `, participation_view AS (
      SELECT ${ownColumns} FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId <> ?1
        AND EXISTS(SELECT 1 FROM participation_mission)
      UNION ALL SELECT ?3, ?1,
        CASE WHEN ?9 = 1 AND NOT (${replay}) THEN ?10 + 1 ELSE (SELECT epoch FROM participation_current) END,
        CASE WHEN ?9 = 1 AND NOT (${replay}) THEN ?11 ELSE (SELECT joinedAt FROM participation_current) END,
        CASE WHEN ?9 = 1 THEN NULL WHEN (SELECT optedOutAt FROM participation_current) IS NULL
          THEN ?11 ELSE (SELECT optedOutAt FROM participation_current) END
      FROM participation_mission WHERE ?9 = 1 OR EXISTS(SELECT 1 FROM participation_current)
    )` : '';
  const projectionTable = hypothetical ? 'participation_view' : 'SpaceMissionParticipation';
  return `WITH participation_actor AS (SELECT id, role FROM User WHERE id = ?1),
    participation_access AS (
      SELECT s.id, s.visibility, u.role, (u.role = 'ADMIN') AS isAdmin,
        (member.userId IS NOT NULL) AS isMember, member.joinedAt
      FROM participation_actor u JOIN Space s ON s.id = ?2
      LEFT JOIN SpaceMember member ON member.spaceId = s.id AND member.userId = u.id
      WHERE s.visibility = 'PRIVATE' AND (u.role = 'ADMIN' OR member.userId IS NOT NULL)
    ), participation_mission AS (
      SELECT m.id, m.closedAt, m.invitationAttemptCount FROM SpaceMission m
      JOIN participation_access a ON a.id = m.spaceId WHERE m.id = ?3
    ), participation_current AS (
      SELECT epoch, joinedAt, optedOutAt FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId = ?1
        AND EXISTS(SELECT 1 FROM participation_mission)
    ), participation_bookmark AS (
      SELECT savedAt, revision FROM SpaceMissionBookmarkSetting WHERE missionId = ?3 AND userId = ?1
        AND EXISTS(SELECT 1 FROM participation_mission)
    ), participation_bookmark_access AS (
      SELECT epoch FROM SpaceMissionBookmarkAccess WHERE userId = ?1 AND EXISTS(SELECT 1 FROM participation_mission)
    ), participation_pending AS (
      SELECT id, revision FROM SpaceMissionInvitation WHERE missionId = (SELECT id FROM participation_mission)
        AND state = 'PENDING' AND ((?9 = 1 AND recipientId = ?1) OR (?9 = 0 AND senderId = ?1))
    ), participation_guard AS (
      SELECT NOT EXISTS(SELECT 1 FROM participation_access WHERE length(CAST(role AS BLOB)) > 1024
        OR length(CAST(visibility AS BLOB)) > 1024 OR length(CAST(COALESCE(joinedAt, '') AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM participation_mission WHERE length(CAST(COALESCE(closedAt, '') AS BLOB)) > 1024
        OR length(CAST(invitationAttemptCount AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM participation_current WHERE length(CAST(epoch AS BLOB)) > 1024
        OR length(CAST(joinedAt AS BLOB)) > 1024 OR length(CAST(COALESCE(optedOutAt, '') AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM participation_bookmark WHERE length(CAST(revision AS BLOB)) > 1024
        OR length(CAST(COALESCE(savedAt, '') AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM participation_bookmark_access WHERE length(CAST(epoch AS BLOB)) > 1024) AS fits
    )${view}, participation_detail AS (${hypothetical ? hypotheticalReader() : d1MissionDetailSql})
    SELECT 'participation-context' AS kind, NULL AS missionId,
      json_patch(json_patch(json_object(
        'actorRole', (SELECT CASE WHEN length(CAST(role AS BLOB)) <= 1024 THEN role END FROM participation_access),
        'visibility', (SELECT CASE WHEN length(CAST(visibility AS BLOB)) <= 1024 THEN visibility END FROM participation_access),
        'memberJoinedAt', CASE WHEN g.fits = 1 THEN (SELECT joinedAt FROM participation_access) END,
        'closedAt', CASE WHEN g.fits = 1 THEN (SELECT closedAt FROM participation_mission) END,
        'invitationAttempts', CASE WHEN g.fits = 1 THEN (SELECT invitationAttemptCount FROM participation_mission) END,
        'ownEpoch', (SELECT CASE WHEN length(CAST(epoch AS BLOB)) <= 1024 THEN epoch END FROM participation_current),
        'ownJoinedAt', CASE WHEN g.fits = 1 THEN (SELECT joinedAt FROM participation_current) END,
        'ownOptedOutAt', CASE WHEN g.fits = 1 THEN (SELECT optedOutAt FROM participation_current) END,
        'bookmarkSavedAt', CASE WHEN g.fits = 1 THEN (SELECT savedAt FROM participation_bookmark) END,
        'bookmarkRevision', CASE WHEN g.fits = 1 THEN (SELECT revision FROM participation_bookmark) END,
        'bookmarkAccessEpoch', CASE WHEN g.fits = 1 THEN CASE WHEN EXISTS(SELECT 1 FROM participation_bookmark_access)
          THEN (SELECT epoch FROM participation_bookmark_access) ELSE 0 END END), json_object(
        'authorized', EXISTS(SELECT 1 FROM participation_access),
        'isAdmin', COALESCE((SELECT isAdmin FROM participation_access), 0),
        'isMember', COALESCE((SELECT isMember FROM participation_access), 0),
        'found', EXISTS(SELECT 1 FROM participation_mission),
        'isClosed', EXISTS(SELECT 1 FROM participation_mission WHERE closedAt IS NOT NULL),
        'selfExists', EXISTS(SELECT 1 FROM participation_current),
        'ownActive', EXISTS(SELECT 1 FROM participation_current WHERE optedOutAt IS NULL),
        'bookmarkExists', EXISTS(SELECT 1 FROM participation_bookmark),
        'bookmarkAccessExists', EXISTS(SELECT 1 FROM participation_bookmark_access))), json_object(
        'reservedSlots', (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = (SELECT id FROM participation_mission) AND optedOutAt IS NULL),
        'pendingCount', (SELECT COUNT(*) FROM participation_pending),
        'pendingOverflow', (SELECT COUNT(*) FROM participation_pending WHERE typeof(revision) IN ('integer', 'real') AND revision >= 2147483647),
        'pendingInvalid', (SELECT COUNT(*) FROM participation_pending WHERE typeof(revision) <> 'integer' OR revision < 0),
        'noticeCount', (SELECT COUNT(*) FROM Notification WHERE type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
          AND targetId IN (SELECT id FROM participation_pending)),
        'futureEpochCount', (SELECT COUNT(*) FROM SpaceMissionContribution WHERE missionId = (SELECT id FROM participation_mission)
          AND authorId = ?1 AND epoch = ?10 + 1),
        'projectedInvalidEpochs', (SELECT COUNT(*) FROM ${projectionTable} WHERE missionId = (SELECT id FROM participation_mission)
          AND optedOutAt IS NULL AND (typeof(epoch) <> 'integer' OR epoch < 1 OR epoch > 2147483646)),
        'fits', g.fits)) AS data, NULL AS personId, NULL AS name, NULL AS image FROM participation_guard g
    UNION ALL SELECT kind, missionId, data, personId, name, image FROM participation_detail`;
}
function values(scope: Scope) {
  return [scope.userId, scope.spaceId, scope.id, 'detail', 0, 0, '', 1, scope.join ? 1 : 0, scope.epoch, scope.now];
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid D1 mission participation integer');
  }
}
function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 mission participation flag');
}
function text(value: unknown, limit: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.length) || Buffer.byteLength(value, 'utf8') > limit) {
    throw new Error('Invalid D1 mission participation text');
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
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 mission participation timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > calendar.getUTCDate() ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 mission participation timestamp');
  }
  return d1Date(value);
}
function flat(data: unknown, keys?: readonly string[]): Flat {
  text(data, D1_SPACE_ROW_BYTES, true);
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid D1 mission participation object');
  const entries = Object.entries(value);
  if (entries.length > 32 || (keys && (entries.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))) ||
      entries.some(([, item]) => item !== null && typeof item !== 'string' &&
        (typeof item !== 'number' || !Number.isSafeInteger(item)))) throw new Error('Invalid D1 mission participation scalar');
  return value as Flat;
}
async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql()).bind(...values(scope)).all<Row>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 34) {
    throw new Error('Incomplete D1 mission participation snapshot');
  }
  const contexts = result.results.filter(row => row?.kind === 'participation-context');
  if (contexts.length !== 1) throw new Error('Missing D1 mission participation context');
  // Do not validate a profile, reader invalidState, or full projection yet.
  const context = flat(contexts[0].data);
  return { rows: result.results, context, detail: result.results.filter(row => row?.kind !== 'participation-context') };
}

/** Exact source error order. SQL NULL, never JavaScript truthiness, represents
 * active consent and an open mission. A leave needs no learner/member gate. */
function authorize(snapshot: Snapshot, scope: Scope): Mutation {
  const c = snapshot.context;
  if (c.authorized !== 1) throw notFound();
  if (c.found !== 1) throw notFound();
  let changed: boolean;
  if (scope.join) {
    if (c.actorRole !== 'USER' || c.isMember !== 1) throw notFound();
    const replay = c.selfExists === 1 && c.ownEpoch === scope.epoch + 1 && c.ownActive === 1;
    if (replay) changed = false;
    else {
      if (c.isClosed === 1) throw new SpaceApiError('Mission ist geschlossen', 409, 'MISSION_CLOSED');
      if ((c.selfExists === 1 ? c.ownEpoch : 0) !== scope.epoch || c.ownActive === 1 || scope.epoch >= MAX_EPOCH) throw conflict();
      if (typeof c.reservedSlots !== 'number' || c.reservedSlots >= 5) {
        throw new SpaceApiError('Mission hat bereits fünf Teilnehmende', 409, 'MISSION_FULL');
      }
      changed = true;
    }
  } else {
    if (c.selfExists !== 1 || c.ownEpoch !== scope.epoch) throw conflict();
    changed = c.ownActive === 1;
  }
  if (typeof c.pendingOverflow === 'number' && c.pendingOverflow > 0) throw invitationConflict();
  if (c.pendingInvalid !== 0) throw new Error('Invalid D1 mission participation invitation revision');
  return { changed, insert: scope.join && changed && c.selfExists === 0 };
}
function validateContext(snapshot: Snapshot, scope: Scope) {
  const c = snapshot.context;
  const contextRows = snapshot.rows.filter(row => row.kind === 'participation-context');
  if (contextRows.length !== 1) throw new Error('Invalid D1 mission participation context count');
  flat(contextRows[0].data, contextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'isClosed', 'selfExists', 'ownActive',
    'bookmarkExists', 'bookmarkAccessExists', 'fits']) flag(c[key]);
  if (c.fits !== 1) throw new Error('D1 mission participation context exceeds safe byte limits');
  if (c.authorized !== 1 || c.found !== 1 || c.visibility !== 'PRIVATE' ||
      (c.actorRole === 'ADMIN') !== (c.isAdmin === 1)) throw new Error('Invalid D1 mission participation authority');
  text(c.actorRole, 1024, true);
  if (c.isMember === 1) storedDate(c.memberJoinedAt);
  else if (c.memberJoinedAt !== null) throw new Error('Invalid D1 mission participation membership');
  if (c.closedAt !== null) storedDate(c.closedAt);
  if ((c.closedAt !== null) !== (c.isClosed === 1)) throw new Error('Invalid D1 mission participation close state');
  for (const key of ['invitationAttempts', 'reservedSlots', 'pendingCount', 'pendingOverflow', 'pendingInvalid',
    'noticeCount', 'futureEpochCount', 'projectedInvalidEpochs']) integer(c[key]);
  if (c.selfExists === 1) {
    integer(c.ownEpoch, 1, MAX_EPOCH); storedDate(c.ownJoinedAt);
    if (c.ownOptedOutAt !== null) storedDate(c.ownOptedOutAt);
    if ((c.ownOptedOutAt === null) !== (c.ownActive === 1)) throw new Error('Invalid D1 mission participation consent');
  } else if (c.ownEpoch !== null || c.ownJoinedAt !== null || c.ownOptedOutAt !== null || c.ownActive !== 0) {
    throw new Error('Invalid D1 mission participation absent consent');
  }
  if (c.bookmarkExists === 1) {
    integer(c.bookmarkRevision);
    if (c.bookmarkSavedAt !== null) storedDate(c.bookmarkSavedAt);
  } else if (c.bookmarkSavedAt !== null || c.bookmarkRevision !== null) throw new Error('Invalid D1 mission participation bookmark');
  integer(c.bookmarkAccessEpoch);
  if (c.bookmarkAccessExists === 0 && c.bookmarkAccessEpoch !== 0) throw new Error('Invalid D1 mission participation bookmark fence');
  // A new epoch has never carried any contribution, even hidden/withdrawn ones.
  // The same count remains in the actual final guard, so triggers/races roll back.
  if (scope.join && c.ownEpoch !== scope.epoch + 1 && c.futureEpochCount !== 0) {
    throw new Error('Unexpected D1 mission participation future-epoch contributions');
  }
}
function afterSnapshot(before: Snapshot, scope: Scope, mutation: Mutation): Snapshot {
  const context: Flat = { ...before.context, pendingCount: 0, pendingOverflow: 0, pendingInvalid: 0, noticeCount: 0 };
  if (mutation.changed) {
    if (scope.join) Object.assign(context, { selfExists: 1, ownEpoch: scope.epoch + 1, ownJoinedAt: scope.now,
      ownOptedOutAt: null, ownActive: 1, reservedSlots: (context.reservedSlots as number) + 1 });
    else Object.assign(context, { ownOptedOutAt: scope.now, ownActive: 0, reservedSlots: (context.reservedSlots as number) - 1 });
  }
  const rows = before.rows.map(row => row.kind === 'participation-context' ? { ...row, data: JSON.stringify(context) } : row);
  return { rows, context, detail: rows.filter(row => row.kind !== 'participation-context') };
}

/** Validate the entire SQL-derived After before any batch is submitted. In
 * particular this is not a DTO delta: profiles, lifetime attempts, visibility,
 * cross-person BUILD_ON targets, people, own rows and progress come from SQL. */
function prepareAfter(snapshot: Snapshot, scope: Scope): MissionDto {
  validateContext(snapshot, scope);
  const c = snapshot.context;
  let transportBytes = 0;
  for (const row of snapshot.rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== columns.length ||
        columns.some(column => !Object.hasOwn(row, column) || (row[column] !== null && typeof row[column] !== 'string'))) {
      throw new Error('Invalid D1 mission participation row');
    }
    text(row.kind, 32, true);
    const rowBytes = columns.reduce((bytes, column) => bytes + (row[column] === null ? 4 : Buffer.byteLength(row[column]!, 'utf8')), 0);
    transportBytes += 6 * rowBytes + 4096;
    if (rowBytes > D1_SPACE_ROW_BYTES || transportBytes > D1_SPACE_RESULT_BYTES) throw new Error('Oversized D1 mission participation snapshot');
    if (!['participation-context', 'context', 'mission', 'participant', 'contribution', 'own', 'person'].includes(row.kind)) {
      throw new Error('Unexpected D1 mission participation row');
    }
    if (row.kind === 'person') {
      if (row.data !== null || row.missionId !== null) throw new Error('Invalid D1 mission participation person row');
      text(row.personId, 1024, true); nullableText(row.name, 256000); nullableText(row.image, 256000);
    } else {
      if (row.personId !== null || row.name !== null || row.image !== null) throw new Error('Invalid D1 mission participation data row');
      if (row.kind === 'context' || row.kind === 'participation-context') {
        if (row.missionId !== null) throw new Error('Invalid D1 mission participation context row');
      } else if (row.missionId !== scope.id) throw new Error('Unscoped D1 mission participation data row');
      flat(row.data);
    }
  }
  const contexts = snapshot.detail.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Invalid D1 mission participation reader context');
  const rc = flat(contexts[0].data, readerContextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'pageCount', 'invalidState', 'oversized']) flag(rc[key]);
  if (rc.authorized !== 1 || rc.isAdmin !== c.isAdmin || rc.isMember !== c.isMember || rc.role !== c.actorRole ||
      rc.found !== 1 || rc.pageCount !== 1) throw new Error('Inconsistent D1 mission participation reader authority');
  if (rc.invalidState !== 0 || c.projectedInvalidEpochs !== 0) throw new SpaceApiError('Mission enthält einen ungültigen Teilnahmestand.', 409);
  if (rc.oversized !== 0) throw new SpaceApiError('Missionsdaten sind zu groß und können nicht sicher geladen werden.', 500);
  const missions = snapshot.detail.filter(row => row.kind === 'mission');
  if (missions.length !== 1) throw new Error('Invalid D1 mission participation mission count');
  const m = flat(missions[0].data, missionKeys);
  if (m.id !== scope.id || m.spaceId !== scope.spaceId || m.closedAt !== c.closedAt) throw new Error('Invalid D1 mission participation projection');
  text(m.title, 64000); text(m.prompt, 64000);
  if (m.creatorId !== null) text(m.creatorId, 1024, true);
  integer(m.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
  if (storedDate(m.createdAt).getTime() !== m.createdAtMs) throw new Error('Invalid D1 mission participation date key');
  if (m.closedAt !== null) storedDate(m.closedAt);
  const week = [m.weekStartsOn, m.weekTimezone, m.weekStartsAt, m.weekEndsAt];
  if (!week.every(value => value === null)) {
    text(m.weekStartsOn, 1024, true); text(m.weekTimezone, 1024, true);
    if (!/^\d{4}-\d\d-\d\d$/.test(m.weekStartsOn) || storedDate(m.weekEndsAt) <= storedDate(m.weekStartsAt)) {
      throw new Error('Invalid D1 mission participation stored week');
    }
    storedDate(`${m.weekStartsOn}T00:00:00Z`);
  }
  flag(m.selfExists); flag(m.bookmarkSaved);
  integer(m.epoch); integer(m.reservedSlots, 0, 5);
  integer(m.bookmarkRevision); integer(m.bookmarkAccessEpoch); integer(m.insightAttempts); integer(m.buildOnAttempts);
  if (m.selfExists !== c.selfExists || m.epoch !== (c.selfExists === 1 ? c.ownEpoch : 0) ||
      m.joinedAt !== c.ownJoinedAt || m.optedOutAt !== c.ownOptedOutAt || m.reservedSlots !== c.reservedSlots ||
      m.bookmarkSaved !== (c.bookmarkSavedAt === null ? 0 : 1) || m.bookmarkRevision !== (c.bookmarkRevision ?? 0) ||
      m.bookmarkAccessEpoch !== c.bookmarkAccessEpoch) throw new Error('Inconsistent D1 mission participation source projection');
  const people = new Map<string, Row>();
  for (const row of snapshot.detail.filter(row => row.kind === 'person')) {
    if (people.has(row.personId!)) throw new Error('Duplicate D1 mission participation person');
    people.set(row.personId!, row);
  }
  const participantIds = new Set<string>();
  const participants = snapshot.detail.filter(row => row.kind === 'participant');
  const contributions = snapshot.detail.filter(row => row.kind === 'contribution');
  const ownRows = snapshot.detail.filter(row => row.kind === 'own');
  if (participants.length > 5 || contributions.length > 10 || ownRows.length > 10 || participants.length > m.reservedSlots) {
    throw new Error('Invalid D1 mission participation projection count');
  }
  const usedPeople = new Set<string>(m.creatorId === null ? [] : [m.creatorId as string]);
  for (const row of participants) {
    const p = flat(row.data, ['userId', 'joinedAt']);
    text(p.userId, 1024, true); storedDate(p.joinedAt);
    if (participantIds.has(p.userId)) throw new Error('Duplicate D1 mission participation participant');
    participantIds.add(p.userId); usedPeople.add(p.userId);
    if (p.userId === scope.userId && (p.joinedAt !== c.ownJoinedAt || c.ownActive !== 1)) throw new Error('Invalid D1 mission participation own participant');
  }
  const active = c.selfExists === 1 && c.ownActive === 1 && c.isMember === 1 && c.actorRole === 'USER';
  if (participantIds.has(scope.userId) !== active) throw new Error('Incomplete D1 mission participation own participant');
  const visible = new Map<string, Flat>();
  const kinds = new Set<string>();
  for (const row of contributions) {
    const item = flat(row.data, contributionKeys);
    text(item.id, 1024, true); text(item.authorId, 1024, true); text(item.content, 64000);
    integer(item.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
    if (visible.has(item.id) || !participantIds.has(item.authorId) ||
        (item.kind !== 'INSIGHT' && item.kind !== 'BUILD_ON') || storedDate(item.createdAt).getTime() !== item.createdAtMs) {
      throw new Error('Invalid D1 mission participation contribution');
    }
    const key = JSON.stringify([item.authorId, item.kind]);
    if (kinds.has(key)) throw new Error('Duplicate D1 mission participation visible kind');
    kinds.add(key);
    if (item.kind === 'INSIGHT') {
      if (item.targetContributionId !== null) throw new Error('Invalid D1 mission participation insight target');
    } else text(item.targetContributionId, 1024, true);
    visible.set(item.id, item); usedPeople.add(item.authorId);
  }
  for (const item of visible.values()) if (item.kind === 'BUILD_ON') {
    const target = visible.get(item.targetContributionId as string);
    if (!target || target.kind !== 'INSIGHT' || target.authorId === item.authorId) throw new Error('Invalid D1 mission participation visible target');
  }
  const ownIds = new Set<string>();
  for (const row of ownRows) {
    const own = flat(row.data, ['id', 'kind', 'createdAtMs', 'hidden', 'targetContributionId']);
    text(own.id, 1024, true); integer(own.createdAtMs, -DATE_LIMIT, DATE_LIMIT); flag(own.hidden);
    if (!active || ownIds.has(own.id) || (own.kind !== 'INSIGHT' && own.kind !== 'BUILD_ON')) throw new Error('Invalid D1 mission participation own contribution');
    if (own.kind === 'INSIGHT') {
      if (own.targetContributionId !== null) throw new Error('Invalid D1 mission participation own insight');
    } else text(own.targetContributionId, 1024, true);
    const shown = visible.get(own.id);
    if (shown && (shown.authorId !== scope.userId || shown.kind !== own.kind || shown.createdAtMs !== own.createdAtMs ||
      shown.targetContributionId !== own.targetContributionId || own.hidden !== 0)) throw new Error('Inconsistent D1 mission participation own contribution');
    ownIds.add(own.id);
  }
  for (const [id, item] of visible) if (item.authorId === scope.userId && !ownIds.has(id)) {
    throw new Error('Missing D1 mission participation own contribution');
  }
  if (people.size !== usedPeople.size || [...usedPeople].some(id => !people.has(id))) throw new Error('Incomplete D1 mission participation people');
  const item = d1BoundedResponse(projectD1SpaceMissionDetailRows(snapshot.detail, scope.userId));
  if (item.participation.active !== active || item.canManage !== (c.isAdmin === 1) ||
      (item.ownBookmark !== null) !== (c.isMember === 1 && c.isClosed === 0) ||
      (!active && (item.myNextAction !== null || item.ownContributions.length !== 0))) throw new Error('Invalid D1 mission participation private DTO');
  return item;
}
function manifest(snapshot: Snapshot) {
  const json = JSON.stringify(snapshot.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  if (Buffer.byteLength(json, 'utf8') >= D1_SPACE_ROW_BYTES) throw new Error('D1 mission participation manifest exceeds safe byte limits');
  return json;
}

/** Exact flat scalar comparison, including raw NULL/zero dates and all keys.
 * Row identities are validated before submission. Count plus both directions
 * therefore proves multiplicity as well as the complete current projection. */
function equality() {
  const raw = columns.filter(column => column !== 'data').map(column => `c."${column}" IS e."${column}"`).join(' AND ');
  return `${raw} AND (c.data IS e.data OR (json_type(c.data) = 'object' AND json_type(e.data) = 'object'
    AND (SELECT COUNT(*) FROM json_each(c.data)) = (SELECT COUNT(*) FROM json_each(e.data))
    AND NOT EXISTS(SELECT 1 FROM json_each(c.data) x WHERE NOT EXISTS(SELECT 1 FROM json_each(e.data) y
      WHERE x.key IS y.key AND x.value IS y.value AND (x.type = y.type OR x.type IN ('integer','real') AND y.type IN ('integer','real'))))
    AND NOT EXISTS(SELECT 1 FROM json_each(e.data) y WHERE NOT EXISTS(SELECT 1 FROM json_each(c.data) x
      WHERE x.key IS y.key AND x.value IS y.value AND (x.type = y.type OR x.type IN ('integer','real') AND y.type IN ('integer','real'))))))`;
}
function guardedSnapshot(db: Database, scope: Scope, expected: string, final = false) {
  const equal = equality();
  return db.prepare(`WITH current AS (${snapshotSql(!final)}), expected AS (
      SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(?12) j
    ), matched AS (
      SELECT (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
        AND NOT EXISTS(SELECT 1 FROM current c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equal}))
        AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM current c WHERE ${equal})) AS valid
    ), assertion AS (SELECT CASE WHEN valid THEN 1 ELSE ${final ? invariantFailure : snapshotFailure} END AS guarded FROM matched)
    ${final ? 'SELECT c.*, a.guarded FROM assertion a CROSS JOIN current c' : 'SELECT guarded FROM assertion'}`)
    .bind(...values(scope), expected);
}
function sameSnapshot(left: Snapshot, right: Snapshot) {
  const canonical = (snapshot: Snapshot) => snapshot.rows.map(item => JSON.stringify(columns.map(column =>
    column === 'data' && item.data !== null ? Object.entries(flat(item.data)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : item[column]))).sort();
  const a = canonical(left), b = canonical(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function pendingWhere(join: boolean) {
  return `missionId = ?1 AND ${join ? 'recipientId' : 'senderId'} = ?2 AND state = 'PENDING'`;
}
function scopedNotices(join: boolean) {
  return `type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
    AND targetId IN (SELECT id FROM SpaceMissionInvitation WHERE ${pendingWhere(join)})`;
}

/** Only a named, SQL-qualified first-preguard rollback may retry. Inspect every
 * bounded cause; transport/commit uncertainty and all other invariant/constraint
 * failures take precedence over a marker elsewhere in the cause chain. */
function isSnapshotRollback(error: unknown) {
  const details: string[] = [];
  const seen = new Set<unknown>();
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
  if (details.some(value => /D1_SPACE_MISSION_PARTICIPATION_WRITE_INVARIANT|constraint|\bunique\b|foreign[_\s-]*key|not[_\s-]*null|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|unexpected token|invalid response|HTTP\s*\d|SQLITE_BUSY/i.test(value))) return false;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) &&
    details.some(value => /\bD1_SPACE_MISSION_PARTICIPATION_SNAPSHOT_CONFLICT\b/.test(value));
}

/** Normal self-join/leave only. Invitation acceptance keeps its original
 * transaction-local core. Every success, including duplicate/no-op replay,
 * settles the current direction's entire pending set, expired/invalid included.
 * Each atomic batch has 8 statements when consent changes, 6 on replay; at most
 * four attempts and five snapshot reads submit <=37 statements. Cleanup work
 * may grow and time out; it is never chunked into partial committed outcomes. */
export async function setD1MissionParticipation(spaceId: string, id: string, userId: string, epoch: number, join: boolean): Promise<MissionDto> {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId) || typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId) ||
      typeof id !== 'string' || !SPACE_ID_RE.test(id)) throw notFound();
  if (!Number.isSafeInteger(epoch) || epoch < (join ? 0 : 1) || epoch > MAX_EPOCH) {
    throw new SpaceApiError('Ungültiger Teilnahmestand', 400);
  }
  const now = new Date();
  integer(now.getTime(), -DATE_LIMIT, DATE_LIMIT);
  // Stable across retries: a changed hypothetical timestamp cannot manufacture
  // the "fresh snapshot actually changed" evidence needed for another attempt.
  const scope = { userId, spaceId, id, epoch, join, now: now.toISOString().replace(/Z$/, '+00:00') };
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  for (let attempt = 0; attempt < 4; attempt++) {
    const mutation = authorize(snapshot, scope);
    validateContext(snapshot, scope);
    const after = afterSnapshot(snapshot, scope, mutation);
    const item = prepareAfter(after, scope);
    const statements = [guardedSnapshot(db, scope, manifest(snapshot))];
    if (mutation.changed) {
      if (mutation.insert) statements.push(db.prepare(`INSERT INTO SpaceMissionParticipation (${ownColumns}) VALUES (?1, ?2, ?3, ?4, NULL)`)
        .bind(id, userId, epoch + 1, scope.now));
      else if (join) statements.push(db.prepare(`UPDATE SpaceMissionParticipation SET epoch = ?3, joinedAt = ?4, optedOutAt = NULL
        WHERE missionId = ?1 AND userId = ?2 AND epoch = ?5 AND joinedAt IS ?6 AND optedOutAt IS ?7 AND optedOutAt IS NOT NULL`)
        .bind(id, userId, epoch + 1, scope.now, snapshot.context.ownEpoch, snapshot.context.ownJoinedAt, snapshot.context.ownOptedOutAt));
      else statements.push(db.prepare(`UPDATE SpaceMissionParticipation SET optedOutAt = ?3
        WHERE missionId = ?1 AND userId = ?2 AND epoch = ?4 AND joinedAt IS ?5 AND optedOutAt IS NULL`)
        .bind(id, userId, scope.now, epoch, snapshot.context.ownJoinedAt));
      statements.push(db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`));
    }
    const pending = pendingWhere(join), notices = scopedNotices(join);
    statements.push(
      db.prepare(`DELETE FROM Notification WHERE ${notices}`).bind(id, userId),
      // Force this check before scrubbing sender/source identity; outgoing IDs
      // cannot be recovered with the predicate after the settlement update.
      db.prepare(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM Notification WHERE ${notices})
        THEN 1 ELSE ${invariantFailure} END AS guarded`).bind(id, userId),
      db.prepare(`UPDATE SpaceMissionInvitation SET state = 'REVOKED', revision = revision + 1,
        senderId = NULL, createdAt = NULL, expiresAt = NULL, senderEpoch = NULL, senderAccessEpoch = NULL,
        senderAccountEpoch = NULL, recipientAccessEpoch = NULL, recipientAccountEpoch = NULL,
        recipientSettingRevision = NULL, recipientEpoch = NULL
        WHERE ${pending} AND typeof(revision) = 'integer' AND revision >= 0 AND revision < 2147483647`).bind(id, userId),
      db.prepare(`SELECT CASE WHEN changes() = ?3 AND NOT EXISTS(SELECT 1 FROM SpaceMissionInvitation WHERE ${pending})
        THEN 1 ELSE ${invariantFailure} END AS guarded`).bind(id, userId, snapshot.context.pendingCount),
      guardedSnapshot(db, scope, manifest(after), true));
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      if (!isSnapshotRollback(error)) throw error;
      const fresh = await readSnapshot(db, scope);
      const nextMutation = authorize(fresh, scope);
      validateContext(fresh, scope);
      prepareAfter(afterSnapshot(fresh, scope, nextMutation), scope);
      if (sameSnapshot(snapshot, fresh)) throw error;
      if (attempt === 3) throw conflict();
      snapshot = fresh;
      continue;
    }
    // Everything below is deliberately outside the retry catch. Missing/malformed
    // results or unknown commit outcomes must never cause a second write batch.
    const final = results[results.length - 1];
    if (results.length !== statements.length || results.some(result => result.success !== true) ||
        !final || !Array.isArray(final.results) || final.results.length !== after.rows.length ||
        final.results.some(value => !value || typeof value !== 'object' ||
          (value as { guarded?: unknown }).guarded !== 1 || Object.keys(value).length !== columns.length + 1 ||
          columns.some(column => !Object.hasOwn(value, column) ||
            ((value as Record<string, unknown>)[column] !== null && typeof (value as Record<string, unknown>)[column] !== 'string')))) {
      throw new Error('Missing committed D1 mission participation result');
    }
    const committedRows = final.results.map(value => Object.fromEntries(columns.map(column =>
      [column, (value as Record<string, unknown>)[column]])) as Row);
    if (!sameSnapshot(after, { rows: committedRows, context: after.context, detail: [] })) {
      throw new Error('Unexpected committed D1 mission participation projection');
    }
    return item;
  }
  throw conflict();
}
