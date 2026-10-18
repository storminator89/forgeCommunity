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
type Scope = { userId: string; spaceId: string; id: string; contributionId: string; hidden: boolean; now: string };
type Snapshot = { rows: Row[]; context: Flat; detail: Row[] };
const columns = ['kind', 'missionId', 'data', 'personId', 'name', 'image'] as const;
const contextKeys = ['authorized', 'isAdmin', 'isMember', 'actorRole', 'found', 'targetExists',
  'targetAuthorId', 'targetEpoch', 'targetKind', 'targetHiddenAt', 'targetHidden', 'targetWithdrawnNull', 'rival', 'fits'] as const;
const readerContextKeys = ['authorized', 'isAdmin', 'isMember', 'role', 'found', 'pageCount', 'invalidState', 'oversized'] as const;
const missionKeys = ['id', 'spaceId', 'title', 'prompt', 'creatorId', 'createdAt', 'createdAtMs', 'closedAt',
  'weekStartsOn', 'weekTimezone', 'weekStartsAt', 'weekEndsAt', 'joinedAt', 'optedOutAt', 'selfExists', 'epoch',
  'reservedSlots', 'bookmarkSaved', 'bookmarkRevision', 'bookmarkAccessEpoch', 'insightAttempts', 'buildOnAttempts'] as const;
const contributionKeys = ['id', 'authorId', 'kind', 'content', 'createdAt', 'createdAtMs', 'targetContributionId'] as const;
const contributionColumns = ['id', 'missionId', 'authorId', 'epoch', 'kind', 'content', 'targetContributionId',
  'requestId', 'payloadDigest', 'createdAt', 'hiddenAt', 'withdrawnAt'] as const;
const DATE_LIMIT = 8640000000000000;
const notFound = () => new SpaceApiError('Mission nicht gefunden', 404);
const conflict = () => new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
const liveConflict = () => new SpaceApiError('Ein neuerer Beitrag belegt diesen Schritt bereits', 409);
const invariantFailure = "json_extract('[]', 'D1_SPACE_MISSION_MODERATION_WRITE_INVARIANT')";
const snapshotFailure = "json_extract('[]', 'D1_SPACE_MISSION_MODERATION_SNAPSHOT_CONFLICT')";

/** The five source-owned references, and no other reader logic, see the local
 * view. Every historical column/row is retained; only the scoped hiddenAt can
 * change. The actual endguard always uses the genuine original reader. */
function hypotheticalReader() {
  const table = /\bSpaceMissionContribution\b/g;
  if ((d1MissionDetailSql.match(table) ?? []).length !== 5) {
    throw new Error('D1 mission moderation reader seam changed');
  }
  return d1MissionDetailSql.replace(table, 'moderation_contribution_view');
}

/** ?1..8 are the unchanged detail-reader arguments; ?9 target, ?10 desired
 * hidden flag, ?11 stable operation time. Context is small actual BEFORE state,
 * even when detail is the complete SQL-derived hypothetical After. Raw rivalry
 * deliberately ignores consent, membership, role, epoch currency and visibility.
 * Nullable fields stay in the base JSON object; patches contain nonnull flags. */
function snapshotSql(hypothetical = true) {
  const view = hypothetical ? `, moderation_contribution_view AS (
      SELECT ${contributionColumns.map(column => column === 'hiddenAt'
        ? `CASE WHEN c.id = ?9 AND c.missionId = (SELECT id FROM moderation_mission)
            THEN CASE WHEN ?10 = 1 THEN COALESCE(c.hiddenAt, ?11) ELSE NULL END
            ELSE c.hiddenAt END AS hiddenAt`
        : `c.${column}`).join(', ')} FROM SpaceMissionContribution c
      WHERE c.missionId = (SELECT id FROM moderation_mission)
    )` : '';
  return `WITH moderation_actor AS (SELECT id, role FROM User WHERE id = ?1),
    moderation_access AS (
      SELECT s.id, u.role, (u.role = 'ADMIN') AS isAdmin, (member.userId IS NOT NULL) AS isMember
      FROM moderation_actor u JOIN Space s ON s.id = ?2
      LEFT JOIN SpaceMember member ON member.spaceId = s.id AND member.userId = u.id
      WHERE s.visibility = 'PRIVATE' AND (u.role = 'ADMIN' OR member.userId IS NOT NULL)
    ), moderation_mission AS (
      SELECT m.id FROM SpaceMission m JOIN moderation_access a ON a.id = m.spaceId AND a.isAdmin = 1 WHERE m.id = ?3
    ), moderation_target AS (
      SELECT authorId, epoch, kind, hiddenAt, withdrawnAt IS NULL AS withdrawnNull
      FROM SpaceMissionContribution WHERE id = ?9 AND missionId = (SELECT id FROM moderation_mission)
    ), moderation_guard AS (
      SELECT NOT EXISTS(SELECT 1 FROM moderation_access WHERE length(CAST(role AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM moderation_target WHERE length(CAST(authorId AS BLOB)) > 1024
        OR length(CAST(epoch AS BLOB)) > 1024 OR length(CAST(kind AS BLOB)) > 1024
        OR length(CAST(COALESCE(hiddenAt, '') AS BLOB)) > 1024) AS fits
    )${view}, moderation_detail AS (${hypothetical ? hypotheticalReader() : d1MissionDetailSql})
    SELECT 'moderation-context' AS kind, NULL AS missionId,
      json_patch(json_object(
        'actorRole', CASE WHEN g.fits = 1 THEN (SELECT role FROM moderation_access) END,
        'targetAuthorId', CASE WHEN g.fits = 1 THEN (SELECT authorId FROM moderation_target) END,
        'targetEpoch', CASE WHEN g.fits = 1 THEN (SELECT epoch FROM moderation_target) END,
        'targetKind', CASE WHEN g.fits = 1 THEN (SELECT kind FROM moderation_target) END,
        'targetHiddenAt', CASE WHEN g.fits = 1 THEN (SELECT hiddenAt FROM moderation_target) END), json_object(
        'authorized', EXISTS(SELECT 1 FROM moderation_access),
        'isAdmin', COALESCE((SELECT isAdmin FROM moderation_access), 0),
        'isMember', COALESCE((SELECT isMember FROM moderation_access), 0),
        'found', EXISTS(SELECT 1 FROM moderation_mission),
        'targetExists', EXISTS(SELECT 1 FROM moderation_target),
        'targetHidden', EXISTS(SELECT 1 FROM moderation_target WHERE hiddenAt IS NOT NULL),
        'targetWithdrawnNull', EXISTS(SELECT 1 FROM moderation_target WHERE withdrawnNull = 1),
        'rival', EXISTS(SELECT 1 FROM SpaceMissionContribution rival JOIN moderation_target target
          ON rival.authorId IS target.authorId AND rival.epoch IS target.epoch AND rival.kind IS target.kind
          WHERE rival.missionId = (SELECT id FROM moderation_mission) AND rival.id <> ?9
            AND rival.hiddenAt IS NULL AND rival.withdrawnAt IS NULL),
        'fits', g.fits)) AS data, NULL AS personId, NULL AS name, NULL AS image FROM moderation_guard g
    UNION ALL SELECT kind, missionId, data, personId, name, image FROM moderation_detail`;
}
function values(scope: Scope) {
  return [scope.userId, scope.spaceId, scope.id, 'detail', 0, 0, '', 1,
    scope.contributionId, scope.hidden ? 1 : 0, scope.now];
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid D1 mission moderation integer');
  }
}
function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 mission moderation flag');
}
function text(value: unknown, limit: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.length) || Buffer.byteLength(value, 'utf8') > limit) {
    throw new Error('Invalid D1 mission moderation text');
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
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 mission moderation timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > calendar.getUTCDate() ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 mission moderation timestamp');
  }
  return d1Date(value);
}
function flat(data: unknown, keys?: readonly string[]): Flat {
  text(data, D1_SPACE_ROW_BYTES, true);
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid D1 mission moderation object');
  const entries = Object.entries(value);
  if (entries.length > 32 || (keys && (entries.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))) ||
      entries.some(([, item]) => item !== null && typeof item !== 'string' &&
        (typeof item !== 'number' || !Number.isSafeInteger(item)))) throw new Error('Invalid D1 mission moderation scalar');
  return value as Flat;
}
async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql()).bind(...values(scope)).all<Row>();
  // A readable non-ADMIN can have ten own rows; source authority errors must
  // precede validating those details. Authorized ADMIN snapshots have <=24 rows.
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 34) {
    throw new Error('Incomplete D1 mission moderation snapshot');
  }
  const contexts = result.results.filter(row => row?.kind === 'moderation-context');
  if (contexts.length !== 1) throw new Error('Missing D1 mission moderation context');
  const context = flat(contexts[0].data);
  return { rows: result.results, context, detail: result.results.filter(row => row?.kind !== 'moderation-context') };
}

/** Exact source domain order. There is no creator, author, USER, membership,
 * consent, current-epoch, week, closed-state, target-visibility or quota gate.
 * Same-state unhide and withdrawn unhide do not acquire a rivalry gate. */
function authorize(snapshot: Snapshot, scope: Scope): boolean {
  const c = snapshot.context;
  if (c.authorized !== 1) throw notFound();
  if (c.isAdmin !== 1) throw new SpaceApiError('Nicht autorisiert', 403);
  if (c.found !== 1) throw notFound();
  if (c.targetExists !== 1) throw notFound();
  const changed = (c.targetHidden === 1) !== scope.hidden;
  if (changed && !scope.hidden && c.targetWithdrawnNull === 1 && c.rival === 1) throw liveConflict();
  return changed;
}
function validateContext(snapshot: Snapshot) {
  const c = snapshot.context;
  const contexts = snapshot.rows.filter(row => row.kind === 'moderation-context');
  if (contexts.length !== 1) throw new Error('Invalid D1 mission moderation context count');
  flat(contexts[0].data, contextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'targetExists', 'targetHidden', 'targetWithdrawnNull', 'rival', 'fits']) flag(c[key]);
  if (c.fits !== 1) throw new Error('D1 mission moderation context exceeds safe byte limits');
  if (c.authorized !== 1 || c.isAdmin !== 1 || c.actorRole !== 'ADMIN' || c.found !== 1 || c.targetExists !== 1) {
    throw new Error('Invalid D1 mission moderation authority');
  }
  // These are raw CAS/rival metadata, not current-participation eligibility.
  // In particular a hidden numeric zero is present and is never normalized.
  for (const key of ['targetAuthorId', 'targetEpoch', 'targetKind', 'targetHiddenAt']) {
    if (typeof c[key] === 'string') text(c[key], 1024);
  }
  if ((c.targetHiddenAt !== null) !== (c.targetHidden === 1)) throw new Error('Invalid D1 mission moderation raw hidden state');
}
function afterSnapshot(before: Snapshot, scope: Scope, changed: boolean): Snapshot {
  const context: Flat = { ...before.context };
  if (changed) Object.assign(context, { targetHiddenAt: scope.hidden ? scope.now : null, targetHidden: scope.hidden ? 1 : 0 });
  const rows = before.rows.map(row => row.kind === 'moderation-context' ? { ...row, data: JSON.stringify(context) } : row);
  return { rows, context, detail: rows.filter(row => row.kind !== 'moderation-context') };
}

/** Only the full safe After is validated. Hiding can repair legacy duplicate
 * live-kind rows, so invalid BEFORE reader state/profiles cannot mask domain
 * errors. The unchanged projector re-evaluates all current privacy and people. */
function prepareAfter(snapshot: Snapshot, scope: Scope): MissionDto {
  validateContext(snapshot);
  const c = snapshot.context;
  let transportBytes = 0;
  for (const row of snapshot.rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== columns.length ||
        columns.some(column => !Object.hasOwn(row, column) || (row[column] !== null && typeof row[column] !== 'string'))) {
      throw new Error('Invalid D1 mission moderation row');
    }
    text(row.kind, 32, true);
    const rowBytes = columns.reduce((bytes, column) => bytes + (row[column] === null ? 4 : Buffer.byteLength(row[column]!, 'utf8')), 0);
    transportBytes += 6 * rowBytes + 4096;
    if (rowBytes > D1_SPACE_ROW_BYTES || transportBytes > D1_SPACE_RESULT_BYTES) throw new Error('Oversized D1 mission moderation snapshot');
    if (!['moderation-context', 'context', 'mission', 'participant', 'contribution', 'person'].includes(row.kind)) {
      throw new Error('Unexpected D1 mission moderation row');
    }
    if (row.kind === 'person') {
      if (row.data !== null || row.missionId !== null) throw new Error('Invalid D1 mission moderation person row');
      text(row.personId, 1024, true); nullableText(row.name, 256000); nullableText(row.image, 256000);
    } else {
      if (row.personId !== null || row.name !== null || row.image !== null) throw new Error('Invalid D1 mission moderation data row');
      if (row.kind === 'context' || row.kind === 'moderation-context') {
        if (row.missionId !== null) throw new Error('Invalid D1 mission moderation context row');
      } else if (row.missionId !== scope.id) throw new Error('Unscoped D1 mission moderation data row');
      flat(row.data);
    }
  }
  const contexts = snapshot.detail.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Invalid D1 mission moderation reader context');
  const rc = flat(contexts[0].data, readerContextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'pageCount', 'invalidState', 'oversized']) flag(rc[key]);
  if (rc.authorized !== 1 || rc.isAdmin !== 1 || rc.isMember !== c.isMember || rc.role !== 'ADMIN' || rc.found !== 1 || rc.pageCount !== 1) {
    throw new Error('Inconsistent D1 mission moderation reader authority');
  }
  if (rc.invalidState !== 0) throw new SpaceApiError('Mission enthält einen ungültigen Teilnahmestand.', 409);
  if (rc.oversized !== 0) throw new SpaceApiError('Missionsdaten sind zu groß und können nicht sicher geladen werden.', 500);
  const missions = snapshot.detail.filter(row => row.kind === 'mission');
  if (missions.length !== 1) throw new Error('Invalid D1 mission moderation mission count');
  const m = flat(missions[0].data, missionKeys);
  if (m.id !== scope.id || m.spaceId !== scope.spaceId) throw new Error('Invalid D1 mission moderation projection');
  text(m.title, 64000); text(m.prompt, 64000);
  if (m.creatorId !== null) text(m.creatorId, 1024, true);
  integer(m.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
  if (storedDate(m.createdAt).getTime() !== m.createdAtMs) throw new Error('Invalid D1 mission moderation date key');
  if (m.closedAt !== null) storedDate(m.closedAt);
  const week = [m.weekStartsOn, m.weekTimezone, m.weekStartsAt, m.weekEndsAt];
  if (!week.every(value => value === null)) {
    text(m.weekStartsOn, 1024, true); text(m.weekTimezone, 1024, true);
    if (!/^\d{4}-\d\d-\d\d$/.test(m.weekStartsOn) || storedDate(m.weekEndsAt) <= storedDate(m.weekStartsAt)) {
      throw new Error('Invalid D1 mission moderation stored week');
    }
    storedDate(`${m.weekStartsOn}T00:00:00Z`);
  }
  flag(m.selfExists); flag(m.bookmarkSaved);
  integer(m.epoch); integer(m.reservedSlots, 0, 5);
  integer(m.bookmarkRevision); integer(m.bookmarkAccessEpoch);
  integer(m.insightAttempts); integer(m.buildOnAttempts);
  if (m.selfExists === 0) {
    if (m.epoch !== 0 || m.joinedAt !== null || m.optedOutAt !== null) throw new Error('Invalid D1 mission moderation absent consent');
  } else {
    if (m.epoch < 1) throw new Error('Invalid D1 mission moderation consent epoch');
    storedDate(m.joinedAt); if (m.optedOutAt !== null) storedDate(m.optedOutAt);
  }
  const people = new Map<string, Row>();
  for (const row of snapshot.detail.filter(row => row.kind === 'person')) {
    if (people.has(row.personId!)) throw new Error('Duplicate D1 mission moderation person');
    people.set(row.personId!, row);
  }
  const participantIds = new Set<string>();
  const participants = snapshot.detail.filter(row => row.kind === 'participant');
  const contributions = snapshot.detail.filter(row => row.kind === 'contribution');
  if (snapshot.rows.length > 24 || participants.length > 5 || contributions.length > 10 || participants.length > m.reservedSlots) {
    throw new Error('Invalid D1 mission moderation projection count');
  }
  const usedPeople = new Set<string>(m.creatorId === null ? [] : [m.creatorId as string]);
  for (const row of participants) {
    const p = flat(row.data, ['userId', 'joinedAt']);
    text(p.userId, 1024, true); storedDate(p.joinedAt);
    if (participantIds.has(p.userId) || p.userId === scope.userId) throw new Error('Invalid D1 mission moderation participant');
    participantIds.add(p.userId); usedPeople.add(p.userId);
  }
  const visible = new Map<string, Flat>();
  const kinds = new Set<string>();
  for (const row of contributions) {
    const item = flat(row.data, contributionKeys);
    text(item.id, 1024, true); text(item.authorId, 1024, true); text(item.content, 64000);
    integer(item.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
    if (visible.has(item.id) || !participantIds.has(item.authorId) ||
        (item.kind !== 'INSIGHT' && item.kind !== 'BUILD_ON') || storedDate(item.createdAt).getTime() !== item.createdAtMs) {
      throw new Error('Invalid D1 mission moderation contribution');
    }
    const key = JSON.stringify([item.authorId, item.kind]);
    if (kinds.has(key)) throw new Error('Duplicate D1 mission moderation visible kind');
    kinds.add(key);
    if (item.kind === 'INSIGHT') {
      if (item.targetContributionId !== null) throw new Error('Invalid D1 mission moderation insight target');
    } else text(item.targetContributionId, 1024, true);
    visible.set(item.id, item); usedPeople.add(item.authorId);
  }
  for (const item of visible.values()) if (item.kind === 'BUILD_ON') {
    text(item.targetContributionId, 1024, true);
    const target = visible.get(item.targetContributionId);
    if (!target || target.kind !== 'INSIGHT' || target.authorId === item.authorId) throw new Error('Invalid D1 mission moderation visible target');
  }
  if (people.size !== usedPeople.size || [...usedPeople].some(id => !people.has(id))) throw new Error('Incomplete D1 mission moderation people');
  const item = d1BoundedResponse(projectD1SpaceMissionDetailRows(snapshot.detail, scope.userId));
  if (!item.canManage || item.canJoin || item.participation.active || item.myNextAction !== null || item.ownContributions.length !== 0 ||
      (item.ownBookmark !== null) !== (c.isMember === 1 && m.closedAt === null)) throw new Error('Invalid D1 mission moderation private DTO');
  return item;
}
function manifest(snapshot: Snapshot) {
  const json = JSON.stringify(snapshot.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  if (Buffer.byteLength(json, 'utf8') >= D1_SPACE_ROW_BYTES) throw new Error('D1 mission moderation manifest exceeds safe byte limits');
  return json;
}

/** Unique validated row identities, counts and bidirectional flat comparison
 * preserve duplicate multiplicity, NULL and raw zero. Integral numeric SQLite
 * spellings and JSON key order are the only equivalences. */
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

type Rollback = 'snapshot' | 'live-kind' | null;
/** Inspect the entire bounded cycle-safe cause chain. Only a specifically
 * named SQL-qualified first preguard can retry. Exact raw live-kind UNIQUE is
 * terminal 409, never retry/replay-only. Invariants, transport, unknown commit,
 * CAS, FK, UUID and every other constraint take precedence over nested markers. */
function rollbackKind(error: unknown): Rollback {
  const details: string[] = [];
  const seen = new Set<unknown>();
  let current = error, total = 0;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return null;
      seen.add(current);
      if (typeof current === 'string') {
        if (current.length > 65536 || (total += current.length) > 262144) return null;
        details.push(current); break;
      }
      if (typeof current !== 'object') return null;
      const record = current as Record<string, unknown>;
      for (const field of ['message', 'name', 'code']) if (field in record) {
        const value = record[field];
        if (typeof value !== 'string' || value.length > 65536 || (total += value.length) > 262144) return null;
        if (field === 'code' && !/^(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT|SQLITE_CONSTRAINT_UNIQUE)$/.test(value)) return null;
        if (field === 'name' && !['Error', 'D1Error', 'D1_ERROR', 'SqliteError'].includes(value)) return null;
        details.push(value);
      }
      current = 'cause' in record ? record.cause : null;
    }
  } catch { return null; }
  if (details.some(value => /D1_SPACE_MISSION_MODERATION_WRITE_INVARIANT|foreign[_\s-]*key|not[_\s-]*null|check constraint|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|unexpected token|invalid response|HTTP\s*\d|SQLITE_BUSY/i.test(value))) return null;
  if (!details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT(?:_UNIQUE)?)\b/.test(value))) return null;
  const unique = details.filter(value => /UNIQUE constraint failed/i.test(value));
  if (unique.length) {
    const scoped = /UNIQUE constraint failed:\s*SpaceMissionContribution\.missionId\s*,\s*SpaceMissionContribution\.authorId\s*,\s*SpaceMissionContribution\.epoch\s*,\s*SpaceMissionContribution\.kind(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i;
    if (details.some(value => /D1_SPACE_MISSION_MODERATION_SNAPSHOT_CONFLICT/.test(value))) return null;
    for (const value of details) {
      if (/UNIQUE constraint failed/i.test(value) &&
          ((value.match(/UNIQUE constraint failed/gi)?.length !== 1) || !scoped.test(value))) return null;
      const rest = value.replace(scoped, '').replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, '');
      if (/constraint|\bunique\b/i.test(rest)) return null;
    }
    return 'live-kind';
  }
  if (details.some(value => /constraint|\bunique\b/i.test(value))) return null;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b[^\n]*\bD1_SPACE_MISSION_MODERATION_SNAPSHOT_CONFLICT\b|\bD1_SPACE_MISSION_MODERATION_SNAPSHOT_CONFLICT\b[^\n]*\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) ? 'snapshot' : null;
}

/** Four statements for a real change, two for write-free same-state replay.
 * At most four batches plus initial/up to four fresh reads conservatively
 * submit <=21 statements. Time is stable across retries; a winner's existing
 * hidden timestamp survives a newly observed same-state replay. No foreign
 * BUILD_ON row, withdrawal, receipt, quota, revision or other resource is written. */
export async function moderateD1SpaceMissionContribution(
  spaceId: string, id: string, contributionId: string, userId: string, hidden: boolean,
): Promise<MissionDto> {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId) || typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId) ||
      typeof id !== 'string' || !SPACE_ID_RE.test(id) || typeof contributionId !== 'string' || !SPACE_ID_RE.test(contributionId)) throw notFound();
  if (typeof hidden !== 'boolean') throw new Error('Invalid parsed D1 mission moderation input');
  const now = new Date();
  integer(now.getTime(), -DATE_LIMIT, DATE_LIMIT);
  const scope: Scope = { userId, spaceId, id, contributionId, hidden, now: now.toISOString().replace(/Z$/, '+00:00') };
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  for (let attempt = 0; attempt < 4; attempt++) {
    const changed = authorize(snapshot, scope);
    validateContext(snapshot);
    const after = afterSnapshot(snapshot, scope, changed);
    const item = prepareAfter(after, scope);
    const beforeManifest = manifest(snapshot), afterManifest = changed ? manifest(after) : beforeManifest;
    const statements = [guardedSnapshot(db, scope, beforeManifest)];
    if (changed) statements.push(
      db.prepare(`UPDATE SpaceMissionContribution SET hiddenAt = ?3
        WHERE id = ?1 AND missionId = ?2 AND hiddenAt IS ?4 AND authorId IS ?5 AND epoch IS ?6 AND kind IS ?7
          AND (withdrawnAt IS NULL) = ?8`)
        .bind(contributionId, id, hidden ? scope.now : null, snapshot.context.targetHiddenAt,
          snapshot.context.targetAuthorId, snapshot.context.targetEpoch, snapshot.context.targetKind, snapshot.context.targetWithdrawnNull),
      db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`));
    statements.push(guardedSnapshot(db, scope, afterManifest, true));
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind === 'live-kind') throw liveConflict();
      if (kind !== 'snapshot') throw error;
      const fresh = await readSnapshot(db, scope);
      const freshChanged = authorize(fresh, scope);
      validateContext(fresh);
      prepareAfter(afterSnapshot(fresh, scope, freshChanged), scope);
      if (sameSnapshot(snapshot, fresh)) throw error;
      if (attempt === 3) throw conflict();
      snapshot = fresh;
      continue;
    }
    // Success/result validation is deliberately outside the retry catch. The
    // genuine actual endguard already proved this complete response precommit.
    const final = results[results.length - 1];
    if (results.length !== statements.length || results.some(result => result.success !== true) ||
        !final || !Array.isArray(final.results) || final.results.length !== after.rows.length ||
        final.results.some(value => !value || typeof value !== 'object' ||
          (value as { guarded?: unknown }).guarded !== 1 || Object.keys(value).length !== columns.length + 1 ||
          columns.some(column => !Object.hasOwn(value, column) ||
            ((value as Record<string, unknown>)[column] !== null && typeof (value as Record<string, unknown>)[column] !== 'string')))) {
      throw new Error('Missing committed D1 mission moderation result');
    }
    const committedRows = final.results.map(value => Object.fromEntries(columns.map(column =>
      [column, (value as Record<string, unknown>)[column]])) as Row);
    if (!sameSnapshot(after, { rows: committedRows, context: after.context, detail: [] })) {
      throw new Error('Unexpected committed D1 mission moderation projection');
    }
    return item;
  }
  throw conflict();
}
