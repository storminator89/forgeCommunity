import 'server-only';

import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
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
type Scope = { userId: string; spaceId: string; id: string };
type Snapshot = { rows: Row[]; context: Flat; detail: Row[] };
const columns = ['kind', 'missionId', 'data', 'personId', 'name', 'image'] as const;
const contextKeys = ['authorized', 'isAdmin', 'isMember', 'actorRole', 'visibility', 'memberJoinedAt',
  'found', 'invitationAttempts', 'bookmarkAccessExists', 'bookmarkAccessRawEpoch', 'bookmarkAccessEpoch',
  'bookmarkCount', 'noticeCount', 'invitationCount', 'requestCount', 'accessCount', 'fits'] as const;
const cleanupKeys = ['bookmarkCount', 'noticeCount', 'invitationCount', 'requestCount', 'accessCount'] as const;
const readerContextKeys = ['authorized', 'isAdmin', 'isMember', 'role', 'found', 'pageCount', 'invalidState', 'oversized'] as const;
const missionKeys = ['id', 'spaceId', 'title', 'prompt', 'creatorId', 'createdAt', 'createdAtMs', 'closedAt',
  'weekStartsOn', 'weekTimezone', 'weekStartsAt', 'weekEndsAt', 'joinedAt', 'optedOutAt', 'selfExists', 'epoch',
  'reservedSlots', 'bookmarkSaved', 'bookmarkRevision', 'bookmarkAccessEpoch', 'insightAttempts', 'buildOnAttempts'] as const;
const contributionKeys = ['id', 'authorId', 'kind', 'content', 'createdAt', 'createdAtMs', 'targetContributionId'] as const;
const DATE_LIMIT = 8640000000000000;
const notFound = () => new SpaceApiError('Mission nicht gefunden', 404);
const conflict = () => new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
const invariantFailure = "json_extract('[]', 'D1_SPACE_MISSION_CLOSE_WRITE_INVARIANT')";
const snapshotFailure = "json_extract('[]', 'D1_SPACE_MISSION_CLOSE_SNAPSHOT_CONFLICT')";
const scopedNotices = `type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
  AND targetId IN (SELECT id FROM SpaceMissionInvitation WHERE missionId = ?1)`;

/** ?1 actor, ?2 Space, ?3 mission, ?4..8 unchanged detail-reader arguments.
 * The existing reader SQL, including its five-arm records compound, is embedded
 * byte-for-byte. Cleanup sets are counted, never transported or JSON-aggregated.
 * A nonmember ADMIN requires neither creator identity nor a membership row. */
function snapshotSql() {
  return `WITH close_actor AS (SELECT id, role FROM User WHERE id = ?1),
    close_access AS (
      SELECT s.id, s.visibility, u.role, (u.role = 'ADMIN') AS isAdmin,
        (member.userId IS NOT NULL) AS isMember, member.joinedAt
      FROM close_actor u JOIN Space s ON s.id = ?2
      LEFT JOIN SpaceMember member ON member.spaceId = s.id AND member.userId = u.id
      WHERE s.visibility = 'PRIVATE' AND (u.role = 'ADMIN' OR member.userId IS NOT NULL)
    ), close_mission AS (
      SELECT m.id, m.invitationAttemptCount FROM SpaceMission m JOIN close_access a
        ON a.id = m.spaceId AND a.isAdmin = 1 WHERE m.id = ?3
    ), close_bookmark AS (
      SELECT b.epoch FROM SpaceMissionBookmarkAccess b WHERE b.userId = ?1
        AND EXISTS(SELECT 1 FROM close_mission)
    ), close_guard AS (
      SELECT NOT EXISTS(SELECT 1 FROM close_access WHERE length(CAST(role AS BLOB)) > 1024
        OR length(CAST(visibility AS BLOB)) > 1024 OR length(CAST(COALESCE(joinedAt, '') AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM close_mission WHERE length(CAST(invitationAttemptCount AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM close_bookmark WHERE length(CAST(epoch AS BLOB)) > 1024) AS fits
    ), close_detail AS (${d1MissionDetailSql})
    SELECT 'close-context' AS kind, NULL AS missionId,
      json_patch(json_object('actorRole', CASE WHEN g.fits = 1 THEN (SELECT role FROM close_access) END,
        'visibility', CASE WHEN g.fits = 1 THEN (SELECT visibility FROM close_access) END,
        'memberJoinedAt', CASE WHEN g.fits = 1 THEN (SELECT joinedAt FROM close_access) END,
        'invitationAttempts', CASE WHEN g.fits = 1 THEN (SELECT invitationAttemptCount FROM close_mission) END,
        'bookmarkAccessRawEpoch', CASE WHEN g.fits = 1 THEN (SELECT epoch FROM close_bookmark) END),
      json_object('authorized', EXISTS(SELECT 1 FROM close_access),
        'isAdmin', COALESCE((SELECT isAdmin FROM close_access), 0),
        'isMember', COALESCE((SELECT isMember FROM close_access), 0),
        'found', EXISTS(SELECT 1 FROM close_mission),
        'bookmarkAccessExists', EXISTS(SELECT 1 FROM close_bookmark),
        'bookmarkAccessEpoch', CASE WHEN g.fits = 1 THEN COALESCE((SELECT epoch FROM close_bookmark), 0) ELSE 0 END,
        'bookmarkCount', (SELECT COUNT(*) FROM SpaceMissionBookmarkSetting WHERE missionId = (SELECT id FROM close_mission)),
        'noticeCount', (SELECT COUNT(*) FROM Notification WHERE type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
          AND targetId IN (SELECT id FROM SpaceMissionInvitation WHERE missionId = (SELECT id FROM close_mission))),
        'invitationCount', (SELECT COUNT(*) FROM SpaceMissionInvitation WHERE missionId = (SELECT id FROM close_mission)),
        'requestCount', (SELECT COUNT(*) FROM SpaceMissionInvitationRequest WHERE missionId = (SELECT id FROM close_mission)),
        'accessCount', (SELECT COUNT(*) FROM SpaceMissionInvitationAccess WHERE missionId = (SELECT id FROM close_mission)),
        'fits', g.fits)) AS data, NULL AS personId, NULL AS name, NULL AS image FROM close_guard g
    UNION ALL SELECT kind, missionId, data, personId, name, image FROM close_detail`;
}
function values(scope: Scope) {
  return [scope.userId, scope.spaceId, scope.id, 'detail', 0, 0, '', 1];
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid D1 mission CLOSE integer');
  }
}
function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 mission CLOSE flag');
}
function text(value: unknown, limit: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.length) || Buffer.byteLength(value, 'utf8') > limit) {
    throw new Error('Invalid D1 mission CLOSE text');
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
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 mission CLOSE timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > calendar.getUTCDate() ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 mission CLOSE timestamp');
  }
  return d1Date(value);
}
function flat(data: unknown, keys?: readonly string[]): Flat {
  text(data, D1_SPACE_ROW_BYTES, true);
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid D1 mission CLOSE object');
  const entries = Object.entries(value);
  if (entries.length > 32 || (keys && (entries.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))) ||
      entries.some(([, item]) => item !== null && typeof item !== 'string' &&
        (typeof item !== 'number' || !Number.isSafeInteger(item)))) throw new Error('Invalid D1 mission CLOSE scalar');
  return value as Flat;
}
async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql()).bind(...values(scope)).all<Row>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 64) {
    throw new Error('Incomplete D1 mission CLOSE snapshot');
  }
  const contexts = result.results.filter(row => row?.kind === 'close-context');
  if (contexts.length !== 1) throw new Error('Missing D1 mission CLOSE context');
  // Only small current-authority flags are trusted before source error order.
  const context = flat(contexts[0].data);
  return { rows: result.results, context, detail: result.results.filter(row => row?.kind !== 'close-context') };
}

/** Source precedence: private readable Space, current ADMIN, scoped Mission.
 * Complete projection validation is independent of the CREATE receipt/actor
 * restrictions: a foreign creator or NULL/deleted creator is legitimate. */
function prepareSnapshot(snapshot: Snapshot, scope: Scope): MissionDto {
  const c = snapshot.context;
  if (c.authorized !== 1) throw notFound();
  if (c.isAdmin !== 1) throw new SpaceApiError('Nicht autorisiert', 403);
  if (c.found !== 1) throw notFound();
  if (c.fits !== 1) throw new Error('D1 mission CLOSE context exceeds safe byte limits');
  let transportBytes = 0;
  for (const row of snapshot.rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== columns.length ||
        columns.some(column => !Object.hasOwn(row, column) || (row[column] !== null && typeof row[column] !== 'string'))) {
      throw new Error('Invalid D1 mission CLOSE row');
    }
    text(row.kind, 32, true);
    const rowBytes = columns.reduce((bytes, column) => bytes + (row[column] === null ? 4 : Buffer.byteLength(row[column]!, 'utf8')), 0);
    transportBytes += 6 * rowBytes + 4096;
    if (rowBytes > D1_SPACE_ROW_BYTES || transportBytes > D1_SPACE_RESULT_BYTES) throw new Error('Oversized D1 mission CLOSE snapshot');
    if (!['close-context', 'context', 'mission', 'participant', 'contribution', 'person'].includes(row.kind)) {
      throw new Error('Unexpected D1 mission CLOSE row');
    }
    if (row.kind === 'person') {
      if (row.data !== null || row.missionId !== null) throw new Error('Invalid D1 mission CLOSE person row');
      text(row.personId, 1024, true); nullableText(row.name, 256000); nullableText(row.image, 256000);
    } else {
      if (row.personId !== null || row.name !== null || row.image !== null) throw new Error('Invalid D1 mission CLOSE data row');
      if (row.kind === 'context' || row.kind === 'close-context') {
        if (row.missionId !== null) throw new Error('Invalid D1 mission CLOSE context row');
      } else if (row.missionId !== scope.id) throw new Error('Unscoped D1 mission CLOSE data row');
      flat(row.data);
    }
  }
  const closeContexts = snapshot.rows.filter(row => row.kind === 'close-context');
  if (closeContexts.length !== 1) throw new Error('Invalid D1 mission CLOSE context count');
  flat(closeContexts[0].data, contextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'bookmarkAccessExists', 'fits']) flag(c[key]);
  if (c.actorRole !== 'ADMIN' || c.visibility !== 'PRIVATE') throw new Error('Invalid D1 mission CLOSE authority');
  if (c.isMember === 1) storedDate(c.memberJoinedAt);
  else if (c.memberJoinedAt !== null) throw new Error('Invalid D1 mission CLOSE membership');
  integer(c.invitationAttempts);
  for (const key of cleanupKeys) integer(c[key]);
  integer(c.bookmarkAccessEpoch);
  if (c.bookmarkAccessExists === 1) {
    integer(c.bookmarkAccessRawEpoch);
    if (c.bookmarkAccessRawEpoch !== c.bookmarkAccessEpoch) throw new Error('Invalid D1 mission CLOSE bookmark fence');
  } else if (c.bookmarkAccessEpoch !== 0 || c.bookmarkAccessRawEpoch !== null) throw new Error('Invalid D1 mission CLOSE absent bookmark fence');
  const contexts = snapshot.detail.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Invalid D1 mission CLOSE reader context');
  const rc = flat(contexts[0].data, readerContextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'pageCount', 'invalidState', 'oversized']) flag(rc[key]);
  if (rc.authorized !== 1 || rc.isAdmin !== 1 || rc.isMember !== c.isMember || rc.role !== 'ADMIN' || rc.found !== 1 || rc.pageCount !== 1) {
    throw new Error('Inconsistent D1 mission CLOSE reader authority');
  }
  if (rc.invalidState !== 0) throw new SpaceApiError('Mission enthält einen ungültigen Teilnahmestand.', 409);
  if (rc.oversized !== 0) throw new SpaceApiError('Missionsdaten sind zu groß und können nicht sicher geladen werden.', 500);
  const missions = snapshot.detail.filter(row => row.kind === 'mission');
  if (missions.length !== 1) throw new Error('Invalid D1 mission CLOSE mission count');
  const m = flat(missions[0].data, missionKeys);
  if (m.id !== scope.id || m.spaceId !== scope.spaceId) throw new Error('Invalid D1 mission CLOSE projection');
  text(m.title, 64000); text(m.prompt, 64000);
  if (m.creatorId !== null) text(m.creatorId, 1024, true);
  integer(m.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
  if (storedDate(m.createdAt).getTime() !== m.createdAtMs) throw new Error('Invalid D1 mission CLOSE date key');
  if (m.closedAt !== null) storedDate(m.closedAt);
  const week = [m.weekStartsOn, m.weekTimezone, m.weekStartsAt, m.weekEndsAt];
  if (!week.every(value => value === null)) {
    text(m.weekStartsOn, 1024, true); text(m.weekTimezone, 1024, true);
    if (!/^\d{4}-\d\d-\d\d$/.test(m.weekStartsOn) || storedDate(m.weekEndsAt) <= storedDate(m.weekStartsAt)) {
      throw new Error('Invalid D1 mission CLOSE stored week');
    }
    storedDate(`${m.weekStartsOn}T00:00:00Z`);
  }
  flag(m.selfExists); flag(m.bookmarkSaved);
  integer(m.epoch); integer(m.reservedSlots, 0, 5);
  integer(m.bookmarkRevision); integer(m.bookmarkAccessEpoch);
  integer(m.insightAttempts); integer(m.buildOnAttempts);
  if (m.bookmarkAccessEpoch !== c.bookmarkAccessEpoch) throw new Error('Invalid D1 mission CLOSE global bookmark epoch');
  if (m.selfExists === 0) {
    if (m.epoch !== 0 || m.joinedAt !== null || m.optedOutAt !== null) throw new Error('Invalid D1 mission CLOSE absent consent');
  } else {
    if (m.epoch < 1) throw new Error('Invalid D1 mission CLOSE consent epoch');
    storedDate(m.joinedAt); if (m.optedOutAt !== null) storedDate(m.optedOutAt);
  }
  const people = new Map<string, Row>();
  for (const row of snapshot.detail.filter(row => row.kind === 'person')) {
    if (people.has(row.personId!)) throw new Error('Duplicate D1 mission CLOSE person');
    people.set(row.personId!, row);
  }
  const participantIds = new Set<string>();
  const participants = snapshot.detail.filter(row => row.kind === 'participant');
  const contributions = snapshot.detail.filter(row => row.kind === 'contribution');
  if (participants.length > 5 || contributions.length > 10 || participants.length > m.reservedSlots) throw new Error('Invalid D1 mission CLOSE projection count');
  const usedPeople = new Set<string>(m.creatorId === null ? [] : [m.creatorId as string]);
  for (const row of participants) {
    const p = flat(row.data, ['userId', 'joinedAt']);
    text(p.userId, 1024, true); storedDate(p.joinedAt);
    if (participantIds.has(p.userId) || p.userId === scope.userId) throw new Error('Invalid D1 mission CLOSE participant');
    participantIds.add(p.userId); usedPeople.add(p.userId);
  }
  const visible = new Map<string, Flat>();
  for (const row of contributions) {
    const item = flat(row.data, contributionKeys);
    text(item.id, 1024, true); text(item.authorId, 1024, true); text(item.content, 64000);
    integer(item.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
    if (visible.has(item.id) || !participantIds.has(item.authorId) ||
        (item.kind !== 'INSIGHT' && item.kind !== 'BUILD_ON') || storedDate(item.createdAt).getTime() !== item.createdAtMs) {
      throw new Error('Invalid D1 mission CLOSE contribution');
    }
    if (item.kind === 'INSIGHT') {
      if (item.targetContributionId !== null) throw new Error('Invalid D1 mission CLOSE insight target');
    } else text(item.targetContributionId, 1024, true);
    visible.set(item.id, item); usedPeople.add(item.authorId);
  }
  for (const item of visible.values()) if (item.kind === 'BUILD_ON') {
    const target = visible.get(item.targetContributionId as string);
    if (!target || target.kind !== 'INSIGHT' || target.authorId === item.authorId) throw new Error('Invalid D1 mission CLOSE visible target');
  }
  if (people.size !== usedPeople.size || [...usedPeople].some(id => !people.has(id))) throw new Error('Incomplete D1 mission CLOSE people');
  const item = d1BoundedResponse(projectD1SpaceMissionDetailRows(snapshot.detail, scope.userId));
  if (!item.canManage || item.canJoin || item.participation.active || item.myNextAction !== null || item.ownContributions.length !== 0 ||
      (item.ownBookmark !== null) !== (c.isMember === 1 && m.closedAt === null)) throw new Error('Invalid D1 mission CLOSE private DTO');
  return item;
}
function manifest(snapshot: Snapshot) {
  const json = JSON.stringify(snapshot.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  if (Buffer.byteLength(json, 'utf8') > D1_SPACE_ROW_BYTES) throw new Error('D1 mission CLOSE manifest exceeds safe byte limits');
  return json;
}

/** Flat JSON cells are compared by exact keys, raw scalar types and values.
 * Numeric 1/1.0 are semantically equal; nullable raw dates are never normalized.
 * Preparation proves unique identities for both contexts, the mission,
 * participant userIds, contribution ids and personIds. Exact count and both
 * directions reject changed rows, omissions and duplicate multiplicities. */
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
  return db.prepare(`WITH current AS (${snapshotSql()}), expected AS (
      SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(?9) j
    ), matched AS (
      SELECT (SELECT COUNT(*) FROM current) = (SELECT COUNT(*) FROM expected)
        AND NOT EXISTS(SELECT 1 FROM current c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equal}))
        AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM current c WHERE ${equal})) AS valid
    ), assertion AS (SELECT CASE WHEN valid THEN 1 ELSE ${final ? invariantFailure : snapshotFailure} END AS guarded FROM matched)
    ${final ? 'SELECT c.*, a.guarded FROM assertion a CROSS JOIN current c' : 'SELECT guarded FROM assertion'}`)
    .bind(...values(scope), expected);
}
function afterSnapshot(before: Snapshot): Snapshot {
  const context = { ...before.context, ...Object.fromEntries(cleanupKeys.map(key => [key, 0])) };
  const mission = flat(before.detail.find(row => row.kind === 'mission')!.data, missionKeys);
  const now = new Date();
  integer(now.getTime(), -DATE_LIMIT, DATE_LIMIT);
  // Zero milliseconds is an existing close timestamp. Only SQL NULL is absent.
  const closedAt = mission.closedAt === null ? now.toISOString().replace(/Z$/, '+00:00') : mission.closedAt;
  const rows = before.rows.map(row => row.kind === 'close-context' ? { ...row, data: JSON.stringify(context) }
    : row.kind === 'mission' ? { ...row, data: JSON.stringify({ ...mission, closedAt, bookmarkSaved: 0, bookmarkRevision: 0 }) } : row);
  return { rows, context, detail: rows.filter(row => row.kind !== 'close-context') };
}
function sameSnapshot(left: Snapshot, right: Snapshot) {
  const canonical = (snapshot: Snapshot) => snapshot.rows.map(item => JSON.stringify(columns.map(column =>
    column === 'data' && item.data !== null ? Object.entries(flat(item.data)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : item[column]))).sort();
  const a = canonical(left), b = canonical(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Inspect the entire bounded, cycle-safe cause chain. Only an SQL-qualified
 * specifically named first guard is replayable. Any invariant, constraint,
 * transport or unknown-commit evidence anywhere takes precedence. */
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
  if (details.some(value => /D1_SPACE_MISSION_CLOSE_WRITE_INVARIANT|constraint|foreign[_\s-]*key|not[_\s-]*null|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|unexpected token|invalid response|HTTP\s*\d|SQLITE_BUSY/i.test(value))) return false;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) &&
    details.some(value => /\bD1_SPACE_MISSION_CLOSE_SNAPSHOT_CONFLICT\b/.test(value));
}

/** Native atomic, irreversible close and exact mission-scoped private cleanup.
 * Every attempt is 10 statements when open, 8 when already closed. At most
 * four batches plus initial/fresh reads submit <=45 statements, even counting
 * every failed batch statement. This is a submission bound, not a claim about
 * provider runtime accounting. Cleanup work can grow and time out; fail closed. */
export async function closeD1SpaceMission(userId: string, spaceId: string, id: string): Promise<MissionDto> {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId) || typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId) ||
      typeof id !== 'string' || !SPACE_ID_RE.test(id)) throw notFound();
  const scope = { userId, spaceId, id };
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  for (let attempt = 0; attempt < 4; attempt++) {
    prepareSnapshot(snapshot, scope);
    const before = flat(snapshot.detail.find(row => row.kind === 'mission')!.data, missionKeys);
    const after = afterSnapshot(snapshot);
    const item = prepareSnapshot(after, scope);
    const afterMission = flat(after.detail.find(row => row.kind === 'mission')!.data, missionKeys);
    const statements = [guardedSnapshot(db, scope, manifest(snapshot))];
    if (before.closedAt === null) statements.push(
      db.prepare('UPDATE SpaceMission SET closedAt = ?3 WHERE id = ?1 AND spaceId = ?2 AND closedAt IS NULL')
        .bind(id, spaceId, afterMission.closedAt),
      db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`));
    // All settings include unsaved revision tombstones. Invitations include all
    // states and all recipients. No revision/MAX_VERSION settlement gate exists.
    statements.push(
      db.prepare('DELETE FROM SpaceMissionBookmarkSetting WHERE missionId = ?1').bind(id),
      db.prepare(`DELETE FROM Notification WHERE ${scopedNotices}`).bind(id),
      // This assertion must execute while the invitation identity set exists.
      // After deletion its subquery would become vacuously empty.
      db.prepare(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM Notification WHERE ${scopedNotices})
        THEN 1 ELSE ${invariantFailure} END AS guarded`).bind(id),
      db.prepare('DELETE FROM SpaceMissionInvitation WHERE missionId = ?1').bind(id),
      db.prepare('DELETE FROM SpaceMissionInvitationRequest WHERE missionId = ?1').bind(id),
      db.prepare('DELETE FROM SpaceMissionInvitationAccess WHERE missionId = ?1').bind(id),
      guardedSnapshot(db, scope, manifest(after), true));
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      if (!isSnapshotRollback(error)) throw error;
      const fresh = await readSnapshot(db, scope);
      prepareSnapshot(fresh, scope);
      if (sameSnapshot(snapshot, fresh)) throw error;
      if (attempt === 3) throw conflict();
      snapshot = fresh;
      continue;
    }
    // Successful or unknown-commit outcomes and malformed results never replay.
    // The final SQL guard proved the full prevalidated response before commit.
    const final = results[results.length - 1];
    if (results.length !== statements.length || results.some(result => result.success !== true) ||
        !final || !Array.isArray(final.results) || final.results.length !== after.rows.length ||
        final.results.some(value => !value || typeof value !== 'object' ||
          (value as { guarded?: unknown }).guarded !== 1 || Object.keys(value).length !== columns.length + 1 ||
          columns.some(column => !Object.hasOwn(value, column) ||
            ((value as Record<string, unknown>)[column] !== null && typeof (value as Record<string, unknown>)[column] !== 'string')))) {
      throw new Error('Missing committed D1 mission CLOSE result');
    }
    const committedRows = final.results.map(value => Object.fromEntries(columns.map(column =>
      [column, (value as Record<string, unknown>)[column]])) as Row);
    if (!sameSnapshot(after, { rows: committedRows, context: after.context, detail: [] })) {
      throw new Error('Unexpected committed D1 mission CLOSE projection');
    }
    return item;
  }
  throw conflict();
}
