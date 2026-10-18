import 'server-only';

import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import { d1MissionDetailSql, projectD1SpaceMissionDetailRows, type D1MissionDataRow } from '@/lib/server/d1-space-missions';
import { D1_SPACE_ROW_BYTES, D1_SPACE_RESULT_BYTES, d1BoundedResponse, d1Date, d1SpaceDatabase } from '@/lib/server/d1-space-reads';
import type { DecideMissionInvitation, MissionInvitationDecisionResult } from '@/types/space-mission-invitations';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Statement = ReturnType<Database['prepare']>;
type Mission = ReturnType<typeof projectD1SpaceMissionDetailRows>;
type Scalar = string | number | null;
type Flat = Record<string, Scalar>;
type Row = D1MissionDataRow;
type Scope = { userId: string; spaceId: string; missionId: string; invitationId: string;
  input: DecideMissionInvitation; joinedAt: string; readableIds: number };
type Snapshot = { rows: Row[]; context: Flat; detail: Row[] };
type Plan = { snapshot: Snapshot; kind: 'replay' | 'invalid' | 'valid'; item: Mission | null;
  responseError: unknown; detailManifest: string | null; manifest: string | null };
type Setting = { exists: boolean; enabled: number; revision: number; accountEpoch: number };
type Access = { exists: boolean; epoch: number };
type Rollback = 'snapshot' | 'setting-create' | 'access-create' | 'participation-create' |
  'mission' | 'join' | 'full' | 'overflow' | 'response' | null;
const MAX_VERSION = 2147483647;
const MAX_EPOCH = 2147483646;
const DATE_LIMIT = 8640000000000000;
const SCALAR_BYTES = 1024;
const columns = ['kind', 'missionId', 'data', 'personId', 'name', 'image'] as const;
const sourceColumns = ['senderId', 'createdAt', 'expiresAt', 'senderEpoch', 'senderAccessEpoch',
  'senderAccountEpoch', 'recipientAccessEpoch', 'recipientAccountEpoch', 'recipientSettingRevision', 'recipientEpoch'] as const;
const ownColumns = 'missionId, userId, epoch, joinedAt, optedOutAt';
/** Numbered-slot trimming is deliberate: detail/scope bind positions are shared,
 * while smaller statements need only their actual highest numbered slot. */
function prepare(db: Database, sql: string, bound: Scalar[]): Statement {
  const slots = [...sql.matchAll(/\?(\d+)/g)].map(match => Number(match[1]));
  const highest = slots.length ? Math.max(...slots) : 0;
  if (Buffer.byteLength(sql, 'utf8') > 100000 || highest > 100 || bound.length < highest ||
      /\?(?!\d)/.test(sql) || bound.some(value => value !== null && typeof value !== 'string' &&
        (typeof value !== 'number' || !Number.isSafeInteger(value))) ||
      bound.some(value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= D1_SPACE_ROW_BYTES)) {
    throw new Error('D1 invitation decision SQL/bind manifest changed');
  }
  return db.prepare(sql).bind(...bound.slice(0, highest));
}
const snapshotMarker = 'D1_SPACE_MISSION_INVITATION_DECISION_SNAPSHOT_CONFLICT';
const invariantMarker = 'D1_SPACE_MISSION_INVITATION_DECISION_WRITE_INVARIANT';
const domainMarkers = {
  mission: 'D1_SPACE_MISSION_INVITATION_DECISION_MISSION_UNAVAILABLE',
  join: 'D1_SPACE_MISSION_INVITATION_DECISION_JOIN_CONFLICT',
  full: 'D1_SPACE_MISSION_INVITATION_DECISION_FULL',
  overflow: 'D1_SPACE_MISSION_INVITATION_DECISION_REVISION_OVERFLOW',
  response: 'D1_SPACE_MISSION_INVITATION_DECISION_RESPONSE_UNREADY',
} as const;
const failure = (marker: string) => `json_extract('[]', '${marker}')`;
const invariantFailure = failure(invariantMarker);
const conflict = () => new SpaceApiError('Einladung wurde geändert. Bitte neu laden.', 409);
const unavailable = () => new SpaceApiError('Einladung nicht verfügbar', 404);
const missionUnavailable = () => new SpaceApiError('Mission nicht gefunden', 404);
const joinConflict = () => new SpaceApiError('Teilnahme wurde geändert. Bitte neu laden.', 409);
const sqlClock = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)";
function versionValid(expression: string) {
  return `(typeof(${expression}) = 'integer' AND ${expression} BETWEEN 0 AND ${MAX_VERSION})`;
}
function fits(expression: string) {
  return `(typeof(${expression}) IN ('integer', 'real', 'text', 'null')
    AND COALESCE(length(CAST(${expression} AS BLOB)), 0) <= ${SCALAR_BYTES})`;
}
function raw(expression: string) { return `CASE WHEN ${fits(expression)} THEN ${expression} END`; }

function timezoneBytes(expression: string) {
  return `(CASE WHEN substr(${expression}, -1) = 'Z' THEN 1
    WHEN substr(${expression}, -6) GLOB '[+-][0-2][0-9]:[0-5][0-9]' THEN 6 ELSE 0 END)`;
}
function storedDateMs(expression: string) {
  const timezone = timezoneBytes(expression);
  const body = `substr(${expression}, 1, length(${expression}) - ${timezone})`;
  // V8 ReadMilliseconds truncates after three digits, whereas SQLite's date
  // parser rounds. Normalize a text seconds-fraction before julianday. Parse
  // its timezone-free body and subtract the validated ISO offset ourselves:
  // SQLite's offset parser has a narrower hour domain than V8's 00..23.
  const normalized = `(CASE WHEN typeof(${expression}) = 'text' AND substr(${body}, 20, 1) = '.'
    THEN substr(${body}, 1, 19) || '.' || substr(substr(${body}, 21) || '000', 1, 3)
    ELSE ${body} END)`;
  const offset = `(CASE WHEN ${timezone} = 6 THEN
    (CASE WHEN substr(${expression}, -6, 1) = '-' THEN -1 ELSE 1 END) *
      (CAST(substr(${expression}, -5, 2) AS INTEGER) * 60 + CAST(substr(${expression}, -2, 2) AS INTEGER)) * 60000
    ELSE 0 END)`;
  return `(CASE WHEN typeof(${expression}) IN ('integer', 'real') THEN CAST(${expression} AS INTEGER)
    ELSE CAST(ROUND((julianday(${normalized}) - 2440587.5) * 86400000) AS INTEGER) - ${offset} END)`;
}
function dateValid(expression: string) {
  // adapter-d1's stored DateTime recognizer accepts variable fractions and
  // ISO minutes/seconds with Z/offset. d1Date additionally normalizes T/space
  // UTC seconds. Reject relative/Julian/NUL text before accepting julianday.
  // Every individual GLOB pattern is <=41 bytes (D1's pattern cap is 50).
  const timezone = timezoneBytes(expression);
  const body = `substr(${expression}, 1, length(${expression}) - ${timezone})`;
  return `(typeof(${expression}) IN ('integer', 'real', 'text')
    AND (typeof(${expression}) <> 'text' OR (instr(${expression}, char(0)) = 0
      AND substr(${expression}, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
      AND substr(${expression}, 11, 1) IN (' ', 'T')
      AND (${timezone} = 0 OR substr(${expression}, 11, 1) = 'T')
      AND (${timezone} <> 6 OR CAST(substr(${expression}, -5, 2) AS INTEGER) BETWEEN 0 AND 23)
      AND (CAST(substr(${body}, 12, 2) AS INTEGER) BETWEEN 0 AND 23
        OR (substr(${body}, 12, 2) = '24' AND substr(${body}, 15, 2) = '00'
          AND (length(${body}) = 16 OR (substr(${body}, 18, 2) = '00'
            AND (length(${body}) = 19 OR (substr(${body}, 20, 1) = '.'
              AND substr(${body}, 21) NOT GLOB '*[1-9]*'))))))
      AND ((substr(${body}, 12, 8) GLOB '[0-2][0-9]:[0-5][0-9]:[0-5][0-9]'
        AND (length(${body}) = 19 OR (length(${body}) >= 21 AND substr(${body}, 20, 1) = '.'
          AND substr(${body}, 21) NOT GLOB '*[^0-9]*')))
        OR (length(${body}) = 16 AND substr(${expression}, 11, 1) = 'T' AND ${timezone} > 0
          AND substr(${body}, 12, 5) GLOB '[0-2][0-9]:[0-5][0-9]'))))
    AND ${storedDateMs(expression)} BETWEEN -${DATE_LIMIT} AND ${DATE_LIMIT})`;
}

/** The date recognizer above is a local, unchanged copy of the reviewed Send
 * recognizer. In particular zero is an absolute numeric date, fractions are
 * truncated/padded like V8, offsets up to 23 hours are explicit, and hour 24
 * requires an entirely zero original remainder. No shared date code changes. */
const pendingCtes = `decision_clock AS (SELECT COALESCE(?10, ${sqlClock}) AS initialNowMs),
  decision_actor AS (SELECT id, role FROM User WHERE id = ?1),
  decision_scope AS (
    SELECT m.id, m.closedAt FROM decision_actor u
    JOIN SpaceMember member ON member.userId = u.id AND member.spaceId = ?2
    JOIN Space s ON s.id = member.spaceId AND s.visibility = 'PRIVATE'
    JOIN SpaceMission m ON m.spaceId = s.id AND m.id = ?3 WHERE u.role = 'USER'
  ), decision_invitation AS (
    SELECT i.* FROM SpaceMissionInvitation i WHERE i.id = ?9 AND i.missionId = ?3 AND i.recipientId = ?1
      AND EXISTS(SELECT 1 FROM decision_scope WHERE closedAt IS NULL)
  ), decision_pending AS (
    SELECT i.*, ${storedDateMs('i.expiresAt')} AS expiresMs,
      ${dateValid('i.expiresAt')} AS expiresValid
    FROM decision_invitation i WHERE i.state = 'PENDING' AND i.revision = ?11
  ), decision_sender AS (
    SELECT u.id, u.role FROM User u JOIN decision_pending p ON p.senderId = u.id
  ), decision_sender_setting AS (
    SELECT s.enabled, s.revision, s.accountEpoch FROM SpaceMissionInvitationSetting s
      WHERE s.userId = (SELECT senderId FROM decision_pending)
  ), decision_recipient_setting AS (
    SELECT s.enabled, s.revision, s.accountEpoch FROM SpaceMissionInvitationSetting s
      WHERE s.userId = ?1 AND EXISTS(SELECT 1 FROM decision_pending)
  ), decision_sender_access AS (
    SELECT a.epoch FROM SpaceMissionInvitationAccess a
      WHERE a.missionId = ?3 AND a.userId = (SELECT senderId FROM decision_pending)
  ), decision_recipient_access AS (
    SELECT a.epoch FROM SpaceMissionInvitationAccess a
      WHERE a.missionId = ?3 AND a.userId = ?1 AND EXISTS(SELECT 1 FROM decision_pending)
  ), decision_sender_consent AS (
    SELECT p.epoch, p.joinedAt, p.optedOutAt FROM SpaceMissionParticipation p
      WHERE p.missionId = ?3 AND p.userId = (SELECT senderId FROM decision_pending)
  ), decision_own_consent AS (
    SELECT p.epoch, p.joinedAt, p.optedOutAt FROM SpaceMissionParticipation p
      WHERE p.missionId = ?3 AND p.userId = ?1 AND EXISTS(SELECT 1 FROM decision_pending)
  ), decision_validity AS (
    SELECT p.expiresAt IS NOT NULL AND p.expiresValid AND p.expiresMs <= clock.initialNowMs AS expired,
      COALESCE(p.createdAt IS NOT NULL AND p.expiresAt IS NOT NULL AND p.expiresValid
        AND p.expiresMs > clock.initialNowMs AND p.senderId IS NOT NULL AND p.senderId <> ''
        AND EXISTS(SELECT 1 FROM decision_sender WHERE role = 'USER')
        AND EXISTS(SELECT 1 FROM SpaceMember WHERE spaceId = ?2 AND userId = p.senderId)
        AND EXISTS(SELECT 1 FROM decision_recipient_setting r WHERE r.enabled = 1 AND typeof(r.enabled) = 'integer'
          AND r.revision IS p.recipientSettingRevision AND r.accountEpoch IS p.recipientAccountEpoch)
        AND CASE WHEN EXISTS(SELECT 1 FROM decision_sender_setting)
          THEN (SELECT accountEpoch FROM decision_sender_setting) IS p.senderAccountEpoch ELSE p.senderAccountEpoch IS 0 END
        AND CASE WHEN EXISTS(SELECT 1 FROM decision_sender_access)
          THEN (SELECT epoch FROM decision_sender_access) IS p.senderAccessEpoch ELSE p.senderAccessEpoch IS 0 END
        AND CASE WHEN EXISTS(SELECT 1 FROM decision_recipient_access)
          THEN (SELECT epoch FROM decision_recipient_access) IS p.recipientAccessEpoch ELSE p.recipientAccessEpoch IS 0 END
        AND EXISTS(SELECT 1 FROM decision_sender_consent c WHERE c.optedOutAt IS NULL AND c.epoch IS p.senderEpoch)
        AND CASE WHEN EXISTS(SELECT 1 FROM decision_own_consent)
          THEN EXISTS(SELECT 1 FROM decision_own_consent c WHERE c.optedOutAt IS NOT NULL AND c.epoch IS p.recipientEpoch)
          ELSE p.recipientEpoch IS 0 END
        AND ${sourceColumns.filter(column => !['senderId', 'createdAt', 'expiresAt'].includes(column))
          .map(column => versionValid(`p.${column}`)).join(' AND ')}, 0) AS effectiveValid
    FROM decision_pending p CROSS JOIN decision_clock clock
  )`;

type Definition = readonly [string, string];
const definitions: Definition[] = [
  ['actorExists', 'EXISTS(SELECT 1 FROM decision_actor)'],
  ['isUser', "EXISTS(SELECT 1 FROM decision_actor WHERE role = 'USER')"],
  ['scopeExists', 'EXISTS(SELECT 1 FROM decision_scope)'],
  ['missionClosed', 'EXISTS(SELECT 1 FROM decision_scope WHERE closedAt IS NOT NULL)'],
  ['invitationExists', 'EXISTS(SELECT 1 FROM decision_invitation)'],
  ['state', '(SELECT state FROM decision_invitation)'],
  ['revision', '(SELECT revision FROM decision_invitation)'],
  ['revisionType', '(SELECT typeof(revision) FROM decision_invitation)'],
  ...sourceColumns.map(column => [column, `(SELECT ${column} FROM decision_pending)`] as const),
  ['senderExists', 'EXISTS(SELECT 1 FROM decision_sender)'],
  ['senderIsUser', "EXISTS(SELECT 1 FROM decision_sender WHERE role = 'USER')"],
  ['senderMember', 'EXISTS(SELECT 1 FROM SpaceMember WHERE spaceId = ?2 AND userId = (SELECT senderId FROM decision_pending))'],
  ...(['sender', 'recipient'] as const).flatMap(person => [
    [`${person}SettingExists`, `EXISTS(SELECT 1 FROM decision_${person}_setting)`] as const,
    ...(['enabled', 'revision', 'accountEpoch'] as const).flatMap(column => [
      [`${person}SettingRow${column[0].toUpperCase()}${column.slice(1)}`, `(SELECT ${column} FROM decision_${person}_setting)`] as const,
      [`${person}SettingRow${column[0].toUpperCase()}${column.slice(1)}Type`, `(SELECT typeof(${column}) FROM decision_${person}_setting)`] as const,
    ]),
    [`${person}AccessExists`, `EXISTS(SELECT 1 FROM decision_${person}_access)`] as const,
    [`${person}Access`, `(SELECT epoch FROM decision_${person}_access)`] as const,
    [`${person}AccessType`, `(SELECT typeof(epoch) FROM decision_${person}_access)`] as const,
  ]),
  ...(['sender', 'own'] as const).flatMap(person => [
    [`${person}ConsentExists`, `EXISTS(SELECT 1 FROM decision_${person}_consent)`] as const,
    [`${person}Active`, `EXISTS(SELECT 1 FROM decision_${person}_consent WHERE optedOutAt IS NULL)`] as const,
    ...(['epoch', 'joinedAt', 'optedOutAt'] as const).map(column =>
      [`${person}Consent${column[0].toUpperCase()}${column.slice(1)}`, `(SELECT ${column} FROM decision_${person}_consent)`] as const),
    [`${person}ConsentEpochType`, `(SELECT typeof(epoch) FROM decision_${person}_consent)`] as const,
  ]),
  ['rawCapacity', '(SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = ?3 AND optedOutAt IS NULL AND EXISTS(SELECT 1 FROM decision_pending))'],
  ['noticeCount', "(SELECT COUNT(*) FROM Notification WHERE type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION' AND targetId = ?9 AND EXISTS(SELECT 1 FROM decision_pending))"],
  ['expiresValid', 'COALESCE((SELECT expiresValid FROM decision_pending), 0)'],
  ['expiresMs', '(SELECT expiresMs FROM decision_pending)'],
  ['expired', 'COALESCE((SELECT expired FROM decision_validity), 0)'],
  ['effectiveValid', 'COALESCE((SELECT effectiveValid FROM decision_validity), 0)'],
  ['initialNowMs', '(SELECT initialNowMs FROM decision_clock)'],
];
const contextKeys = [...definitions.map(([key]) => key), 'fits'];
function contextSql() {
  const chunks: string[] = [];
  for (let index = 0; index < definitions.length; index += 15) {
    const entries = definitions.slice(index, index + 15);
    chunks.push(entries.map(([key, expression]) => `'$.${key}', ${raw(expression)}`).join(', '));
  }
  // json_set preserves explicit NULL keys; json_patch would delete them.
  const object = chunks.reduce((left, right) => `json_set(${left}, ${right})`, "'{}'");
  const safe = definitions.map(([, expression]) => fits(expression)).join(' AND ');
  return `json_set(${object}, '$.fits', (${safe}))`;
}
const contextCte = `decision_context AS (SELECT ${contextSql()} AS data)`;
const projectionGate = `EXISTS(SELECT 1 FROM decision_invitation i WHERE
  (i.state = CASE WHEN ?12 = 1 THEN 'ACCEPTED' ELSE 'DECLINED' END AND i.revision = ?11 + 1)
  OR (i.state = 'PENDING' AND i.revision = ?11 AND EXISTS(SELECT 1 FROM decision_validity WHERE effectiveValid = 1)))`;
const willJoin = `?12 = 1 AND EXISTS(SELECT 1 FROM decision_validity WHERE effectiveValid = 1)`;
function hypotheticalReader() {
  const table = /\bSpaceMissionParticipation\b/g;
  if ((d1MissionDetailSql.match(table) ?? []).length !== 7) throw new Error('D1 invitation decision reader seam changed');
  return d1MissionDetailSql.replace(table, 'decision_participation_view');
}
/** The original reader's eight binds remain unchanged. ?9 Invitation,
 * ?10 frozen INITIAL clock, ?11 expectedRevision, ?12 ACCEPT, ?13 stable
 * joinedAt, ?14 old privateMissionAccess ID-format gate. */
function snapshotSql(projection = true) {
  const view = projection ? `, decision_participation_view AS (
    SELECT ${ownColumns} FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId <> ?1 AND ${projectionGate}
    UNION ALL SELECT ?3, ?1,
      CASE WHEN ${willJoin} THEN (SELECT recipientEpoch FROM decision_pending) + 1 ELSE c.epoch END,
      CASE WHEN ${willJoin} THEN ?13 ELSE c.joinedAt END,
      CASE WHEN ${willJoin} THEN NULL ELSE c.optedOutAt END
    FROM (SELECT 1) seed LEFT JOIN decision_own_consent c ON 1 = 1
    WHERE ${projectionGate} AND (${willJoin} OR c.epoch IS NOT NULL)
    UNION ALL SELECT ${ownColumns} FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId = ?1
      AND NOT EXISTS(SELECT 1 FROM decision_pending) AND ${projectionGate}
  ), decision_detail AS (${hypotheticalReader()})` : '';
  return `WITH ${pendingCtes}, ${contextCte}${view}
    SELECT 'decision-context' AS kind, NULL AS missionId, data, NULL AS personId, NULL AS name, NULL AS image FROM decision_context
    ${projection ? `UNION ALL SELECT kind, missionId, data, personId, name, image FROM decision_detail WHERE ${projectionGate} AND ?14 = 1` : ''}`;
}
function values(scope: Scope, initial: Scalar = null): Scalar[] {
  // Preserve all eight original-reader parameters verbatim.
  return [scope.userId, scope.spaceId, scope.missionId, 'detail', 0, 0, '', 1, scope.invitationId,
    initial, scope.input.expectedRevision, scope.input.decision === 'ACCEPT' ? 1 : 0, scope.joinedAt, scope.readableIds];
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid D1 invitation decision integer');
  }
}
function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 invitation decision flag');
}
function text(value: unknown, limit: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || nonempty && !value.length || Buffer.byteLength(value, 'utf8') > limit) {
    throw new Error('Invalid D1 invitation decision text');
  }
}
function storedDate(value: unknown): Date {
  if (typeof value === 'number') integer(value, -DATE_LIMIT, DATE_LIMIT);
  else {
    text(value, 1024, true);
    if (!/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?$/.test(value) || value.includes('\0')) {
      throw new Error('Invalid D1 invitation decision date');
    }
  }
  return d1Date(value);
}
function flat(data: unknown, keys?: readonly string[]): Flat {
  text(data, D1_SPACE_ROW_BYTES, true);
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid D1 invitation decision object');
  const entries = Object.entries(value);
  if (entries.length > 100 || keys && (entries.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) ||
      entries.some(([, item]) => item !== null && typeof item !== 'string' &&
        (typeof item !== 'number' || !Number.isSafeInteger(item)))) throw new Error('Invalid D1 invitation decision scalar');
  return value as Flat;
}
async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await prepare(db, snapshotSql(), [...values(scope)]).all<Row>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 34) {
    throw new Error('Incomplete D1 invitation decision snapshot');
  }
  const contexts = result.results.filter(row => row?.kind === 'decision-context');
  if (contexts.length !== 1) throw new Error('Missing D1 invitation decision context');
  if (Object.keys(contexts[0]).length !== columns.length || columns.some(column => !Object.hasOwn(contexts[0], column)) ||
      contexts[0].missionId !== null || contexts[0].personId !== null || contexts[0].name !== null || contexts[0].image !== null) {
    throw new Error('Invalid D1 invitation decision context row');
  }
  const context = flat(contexts[0].data, contextKeys);
  return { rows: result.results, context, detail: result.results.filter(row => row?.kind !== 'decision-context') };
}
function authorize(snapshot: Snapshot, scope: Scope): Plan['kind'] {
  const c = snapshot.context;
  // The old scopedMission deliberately looks up the raw authenticated caller ID.
  // The narrower privateMissionAccess format gate belongs to Join/full reading,
  // and must never precede a targeted invalid-pending settlement.
  if (c.actorExists !== 1) throw new SpaceApiError('Nicht authentifiziert', 401);
  if (c.isUser !== 1 || c.scopeExists !== 1) throw unavailable();
  if (c.missionClosed === 1) throw new SpaceApiError('Mission ist geschlossen', 409, 'MISSION_CLOSED');
  if (c.invitationExists !== 1) throw unavailable();
  const state = scope.input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
  if (c.state === state && c.revision === scope.input.expectedRevision + 1 && c.revisionType === 'integer') {
    if (scope.readableIds !== 1) throw missionUnavailable();
    return 'replay';
  }
  if (c.state !== 'PENDING' || c.revision !== scope.input.expectedRevision || c.revisionType !== 'integer') throw conflict();
  for (const key of ['actorExists', 'isUser', 'scopeExists', 'missionClosed', 'invitationExists', 'expired', 'effectiveValid', 'fits']) flag(c[key]);
  if (c.fits !== 1) throw new Error('D1 invitation decision context exceeds safe byte limits');
  integer(c.initialNowMs, -DATE_LIMIT, DATE_LIMIT);
  integer(c.revision, 1, MAX_VERSION);
  integer(c.noticeCount); integer(c.rawCapacity);
  if (c.effectiveValid !== 1) {
    // Settlement itself increments the invitation, even when it is invalid.
    if (c.revision >= MAX_VERSION) throw conflict();
    return 'invalid';
  }
  return 'valid';
}
function setting(c: Flat, person: 'sender' | 'recipient'): Setting {
  const prefix = `${person}SettingRow`;
  flag(c[`${person}SettingExists`]);
  if (c[`${person}SettingExists`] === 0) {
    for (const column of ['Enabled', 'Revision', 'AccountEpoch']) {
      if (c[`${prefix}${column}`] !== null || c[`${prefix}${column}Type`] !== null) {
        throw new Error('Invalid D1 absent invitation decision setting');
      }
    }
    return { exists: false, enabled: 0, revision: 0, accountEpoch: 0 };
  }
  if (c[`${prefix}EnabledType`] !== 'integer' || ![0, 1].includes(c[`${prefix}Enabled`] as number)) {
    throw new Error('Invalid D1 invitation decision setting enabled value');
  }
  for (const column of ['Revision', 'AccountEpoch']) {
    if (c[`${prefix}${column}Type`] !== 'integer') throw new Error('Invalid D1 invitation decision setting version');
    integer(c[`${prefix}${column}`], 0, MAX_VERSION);
  }
  return { exists: true, enabled: c[`${prefix}Enabled`] as number,
    revision: c[`${prefix}Revision`] as number, accountEpoch: c[`${prefix}AccountEpoch`] as number };
}
function access(c: Flat, person: 'sender' | 'recipient'): Access {
  flag(c[`${person}AccessExists`]);
  if (c[`${person}AccessExists`] === 0) {
    if (c[`${person}Access`] !== null || c[`${person}AccessType`] !== null) throw new Error('Invalid D1 absent invitation decision access');
    return { exists: false, epoch: 0 };
  }
  if (c[`${person}AccessType`] !== 'integer') throw new Error('Invalid D1 invitation decision access type');
  integer(c[`${person}Access`], 0, MAX_VERSION);
  return { exists: true, epoch: c[`${person}Access`] as number };
}

/** Validate the complete SQL-derived After, rather than synthesizing a DTO
 * delta or assuming an unused epoch has no contributions. The reader's own
 * invalidState hardening and this 1.5MB manifest ceiling intentionally retain
 * the established native fail-closed boundary for corrupt/oversized legacy
 * rows; this is not a claim of parity for every malformed legacy database. */
function prepareMission(snapshot: Snapshot, scope: Scope): Mission {
  if (scope.readableIds !== 1) throw missionUnavailable();
  let transportBytes = 0;
  for (const row of snapshot.rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== columns.length ||
        columns.some(column => !Object.hasOwn(row, column) || row[column] !== null && typeof row[column] !== 'string')) {
      throw new Error('Invalid D1 invitation decision row');
    }
    text(row.kind, 32, true);
    const rowBytes = columns.reduce((sum, column) => sum + (row[column] === null ? 4 : Buffer.byteLength(row[column]!, 'utf8')), 0);
    transportBytes += 6 * rowBytes + 4096;
    if (rowBytes > D1_SPACE_ROW_BYTES || transportBytes > D1_SPACE_RESULT_BYTES) throw new Error('Oversized D1 invitation decision snapshot');
    if (!['decision-context', 'context', 'mission', 'participant', 'contribution', 'own', 'person'].includes(row.kind)) throw new Error('Unexpected D1 invitation decision row');
    if (row.kind === 'person') {
      if (row.data !== null || row.missionId !== null) throw new Error('Invalid D1 invitation decision person row');
      text(row.personId, 1024, true);
      if (row.name !== null) text(row.name, 256000);
      if (row.image !== null) text(row.image, 256000);
    } else {
      if (row.personId !== null || row.name !== null || row.image !== null) throw new Error('Invalid D1 invitation decision data row');
      if (row.kind === 'context' || row.kind === 'decision-context') {
        if (row.missionId !== null) throw new Error('Invalid D1 invitation decision context identity');
      } else if (row.missionId !== scope.missionId) throw new Error('Invalid D1 invitation decision mission identity');
    }
  }
  const contexts = snapshot.detail.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Invalid D1 invitation decision reader context');
  const rc = flat(contexts[0].data, ['authorized', 'isAdmin', 'isMember', 'role', 'found', 'pageCount', 'invalidState', 'oversized']);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'pageCount', 'invalidState', 'oversized']) flag(rc[key]);
  if (rc.authorized !== 1 || rc.isAdmin !== 0 || rc.isMember !== 1 || rc.role !== 'USER' || rc.found !== 1 || rc.pageCount !== 1) {
    throw new Error('Inconsistent D1 invitation decision reader authority');
  }
  if (rc.invalidState !== 0) throw new SpaceApiError('Mission enthält einen ungültigen Teilnahmestand.', 409);
  if (rc.oversized !== 0) throw new SpaceApiError('Missionsdaten sind zu groß und können nicht sicher geladen werden.', 500);
  const missions = snapshot.detail.filter(row => row.kind === 'mission');
  if (missions.length !== 1) throw new Error('Invalid D1 invitation decision mission count');
  const m = flat(missions[0].data, ['id', 'spaceId', 'title', 'prompt', 'creatorId', 'createdAt', 'createdAtMs', 'closedAt',
    'weekStartsOn', 'weekTimezone', 'weekStartsAt', 'weekEndsAt', 'joinedAt', 'optedOutAt', 'selfExists', 'epoch',
    'reservedSlots', 'bookmarkSaved', 'bookmarkRevision', 'bookmarkAccessEpoch', 'insightAttempts', 'buildOnAttempts']);
  if (m.id !== scope.missionId || m.spaceId !== scope.spaceId || m.closedAt !== null) throw new Error('Invalid D1 invitation decision mission projection');
  text(m.title, 64000); text(m.prompt, 64000);
  if (m.creatorId !== null) text(m.creatorId, 1024, true);
  integer(m.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
  storedDate(m.createdAt);
  const week = [m.weekStartsOn, m.weekTimezone, m.weekStartsAt, m.weekEndsAt];
  if (!week.every(value => value === null)) {
    text(m.weekStartsOn, 1024, true); text(m.weekTimezone, 1024, true);
    if (!/^\d{4}-\d\d-\d\d$/.test(m.weekStartsOn) || storedDate(m.weekEndsAt) <= storedDate(m.weekStartsAt)) {
      throw new Error('Invalid D1 invitation decision stored week');
    }
    storedDate(`${m.weekStartsOn}T00:00:00Z`);
  }
  flag(m.selfExists); flag(m.bookmarkSaved);
  integer(m.epoch); integer(m.reservedSlots, 0, 5);
  integer(m.bookmarkRevision); integer(m.bookmarkAccessEpoch); integer(m.insightAttempts); integer(m.buildOnAttempts);
  if (m.selfExists === 1) {
    integer(m.epoch, 1, MAX_EPOCH); storedDate(m.joinedAt);
    if (m.optedOutAt !== null) storedDate(m.optedOutAt);
  } else if (m.epoch !== 0 || m.joinedAt !== null || m.optedOutAt !== null) throw new Error('Invalid D1 invitation decision absent participation');
  const c = snapshot.context;
  if (c.state === 'PENDING' && c.effectiveValid === 1) {
    const accepting = scope.input.decision === 'ACCEPT';
    const expectedEpoch = accepting ? (c.recipientEpoch as number) + 1 : c.ownConsentExists === 1 ? c.ownConsentEpoch : 0;
    if (m.selfExists !== (accepting ? 1 : c.ownConsentExists) || m.epoch !== expectedEpoch ||
        m.joinedAt !== (accepting ? scope.joinedAt : c.ownConsentJoinedAt) ||
        m.optedOutAt !== (accepting ? null : c.ownConsentOptedOutAt) ||
        m.reservedSlots !== (c.rawCapacity as number) + (accepting ? 1 : 0)) throw new Error('Inconsistent D1 invitation decision After participation');
  }
  const people = new Map<string, Row>();
  for (const row of snapshot.detail.filter(row => row.kind === 'person')) {
    if (people.has(row.personId!)) throw new Error('Duplicate D1 invitation decision person');
    people.set(row.personId!, row);
  }
  const participants = snapshot.detail.filter(row => row.kind === 'participant');
  const contributions = snapshot.detail.filter(row => row.kind === 'contribution');
  const ownRows = snapshot.detail.filter(row => row.kind === 'own');
  if (participants.length > 5 || contributions.length > 10 || ownRows.length > 10 || people.size > 6 || participants.length > m.reservedSlots) {
    throw new Error('Invalid D1 invitation decision projection count');
  }
  const usedPeople = new Set<string>(m.creatorId === null ? [] : [m.creatorId as string]);
  const participantIds = new Set<string>();
  for (const row of participants) {
    const p = flat(row.data, ['userId', 'joinedAt']);
    text(p.userId, 1024, true); storedDate(p.joinedAt);
    if (participantIds.has(p.userId)) throw new Error('Duplicate D1 invitation decision participant');
    participantIds.add(p.userId); usedPeople.add(p.userId);
    if (p.userId === scope.userId && (p.joinedAt !== m.joinedAt || m.optedOutAt !== null)) throw new Error('Invalid D1 invitation decision own participant');
  }
  const active = m.selfExists === 1 && m.optedOutAt === null;
  if (participantIds.has(scope.userId) !== active) throw new Error('Incomplete D1 invitation decision own participant');
  const visible = new Map<string, Flat>(), kinds = new Set<string>();
  for (const row of contributions) {
    const item = flat(row.data, ['id', 'authorId', 'kind', 'content', 'createdAt', 'createdAtMs', 'targetContributionId']);
    text(item.id, 1024, true); text(item.authorId, 1024, true); text(item.content, 64000);
    integer(item.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
    if (visible.has(item.id) || !participantIds.has(item.authorId) ||
        item.kind !== 'INSIGHT' && item.kind !== 'BUILD_ON') {
      throw new Error('Invalid D1 invitation decision visible contribution');
    }
    storedDate(item.createdAt);
    const key = JSON.stringify([item.authorId, item.kind]);
    if (kinds.has(key)) throw new Error('Duplicate D1 invitation decision contribution kind');
    kinds.add(key);
    if (item.kind === 'INSIGHT') {
      if (item.targetContributionId !== null) throw new Error('Invalid D1 invitation decision insight target');
    } else text(item.targetContributionId, 1024, true);
    visible.set(item.id, item); usedPeople.add(item.authorId);
  }
  for (const item of visible.values()) if (item.kind === 'BUILD_ON') {
    const target = visible.get(item.targetContributionId as string);
    if (!target || target.kind !== 'INSIGHT' || target.authorId === item.authorId) throw new Error('Invalid D1 invitation decision visible target');
  }
  const ownIds = new Set<string>();
  for (const row of ownRows) {
    const own = flat(row.data, ['id', 'kind', 'createdAtMs', 'hidden', 'targetContributionId']);
    text(own.id, 1024, true); integer(own.createdAtMs, -DATE_LIMIT, DATE_LIMIT); flag(own.hidden);
    if (!active || ownIds.has(own.id) || own.kind !== 'INSIGHT' && own.kind !== 'BUILD_ON') throw new Error('Invalid D1 invitation decision own contribution');
    if (own.kind === 'INSIGHT') {
      if (own.targetContributionId !== null) throw new Error('Invalid D1 invitation decision own insight');
    } else text(own.targetContributionId, 1024, true);
    const shown = visible.get(own.id);
    if (shown && (shown.authorId !== scope.userId || shown.kind !== own.kind || shown.createdAtMs !== own.createdAtMs ||
        shown.targetContributionId !== own.targetContributionId || own.hidden !== 0)) throw new Error('Inconsistent D1 invitation decision own contribution');
    ownIds.add(own.id);
  }
  for (const [id, item] of visible) if (item.authorId === scope.userId && !ownIds.has(id)) throw new Error('Missing D1 invitation decision own contribution');
  if (people.size !== usedPeople.size || [...usedPeople].some(id => !people.has(id))) throw new Error('Incomplete D1 invitation decision people');
  const item = d1BoundedResponse(projectD1SpaceMissionDetailRows(snapshot.detail, scope.userId));
  if (item.participation.active !== active || item.canManage !== false || item.ownBookmark === null ||
      !active && (item.myNextAction !== null || item.ownContributions.length !== 0)) throw new Error('Invalid D1 invitation decision private DTO');
  return item;
}
function manifest(rows: Row[]) {
  const result = JSON.stringify(rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  if (Buffer.byteLength(result, 'utf8') >= D1_SPACE_ROW_BYTES) throw new Error('D1 invitation decision manifest exceeds safe byte limits');
  return result;
}
function plan(snapshot: Snapshot, scope: Scope): Plan {
  const kind = authorize(snapshot, scope);
  const result: Plan = { snapshot, kind, item: null, responseError: null, detailManifest: null, manifest: null };
  if (kind === 'invalid') return result;
  // Fences are needed even on late expiry, but projection readiness is not.
  if (kind === 'valid') {
    setting(snapshot.context, 'sender'); setting(snapshot.context, 'recipient');
    access(snapshot.context, 'sender'); access(snapshot.context, 'recipient');
  }
  try {
    result.item = prepareMission(snapshot, scope);
    result.detailManifest = manifest(snapshot.detail);
    result.manifest = manifest(snapshot.rows);
  } catch (error) { result.responseError = error; }
  if (kind === 'replay' && result.responseError !== null) throw result.responseError;
  return result;
}

function equality(left = 'c', right = 'e') {
  const rawColumns = columns.filter(column => column !== 'data').map(column => `${left}."${column}" IS ${right}."${column}"`).join(' AND ');
  return `${rawColumns} AND ${objectEquality(`${left}.data`, `${right}.data`)}`;
}
function objectEquality(left: string, right: string) {
  return `(${left} IS ${right} OR (json_type(${left}) = 'object' AND json_type(${right}) = 'object'
    AND (SELECT COUNT(*) FROM json_each(${left})) = (SELECT COUNT(*) FROM json_each(${right}))
    AND NOT EXISTS(SELECT 1 FROM json_each(${left}) x WHERE NOT EXISTS(SELECT 1 FROM json_each(${right}) y
      WHERE x.key IS y.key AND x.value IS y.value AND (x.type = y.type OR x.type IN ('integer','real') AND y.type IN ('integer','real'))))
    AND NOT EXISTS(SELECT 1 FROM json_each(${right}) y WHERE NOT EXISTS(SELECT 1 FROM json_each(${left}) x
      WHERE x.key IS y.key AND x.value IS y.value AND (x.type = y.type OR x.type IN ('integer','real') AND y.type IN ('integer','real'))))))`;
}
function expectedCte(parameter: string) {
  return `expected AS (SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(${parameter}) j)`;
}
function rowsEquality(current = 'current') {
  const equal = equality();
  return `(SELECT COUNT(*) FROM ${current}) = (SELECT COUNT(*) FROM expected)
    AND NOT EXISTS(SELECT 1 FROM ${current} c WHERE NOT EXISTS(SELECT 1 FROM expected e WHERE ${equal}))
    AND NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM ${current} c WHERE ${equal}))`;
}
function bindings(scope: Scope, snapshot: Snapshot) {
  const bound = values(scope, snapshot.context.initialNowMs);
  return { values: bound, add(value: Scalar) { bound.push(value); return `?${bound.length}`; } };
}
function firstGuard(db: Database, scope: Scope, p: Plan) {
  const c = p.snapshot.context;
  const rows = p.manifest !== null ? p.manifest : manifest([{
    kind: 'decision-context', missionId: null, data: JSON.stringify(c), personId: null, name: null, image: null,
  }]);
  return prepare(db, `WITH current AS (${snapshotSql(p.manifest !== null)}), ${expectedCte('?15')}
    SELECT CASE WHEN ${rowsEquality()} THEN 1 ELSE ${failure(snapshotMarker)} END AS guarded`, [...values(scope, c.initialNowMs), rows]);
}
function afterFences(c: Flat): Flat {
  const after = { ...c };
  for (const person of ['sender', 'recipient'] as const) {
    const item = setting(c, person), fence = access(c, person);
    Object.assign(after, { [`${person}SettingExists`]: 1, [`${person}SettingRowEnabled`]: item.enabled,
      [`${person}SettingRowEnabledType`]: 'integer', [`${person}SettingRowRevision`]: item.revision,
      [`${person}SettingRowRevisionType`]: 'integer', [`${person}SettingRowAccountEpoch`]: item.accountEpoch,
      [`${person}SettingRowAccountEpochType`]: 'integer', [`${person}AccessExists`]: 1,
      [`${person}Access`]: fence.epoch, [`${person}AccessType`]: 'integer' });
  }
  return after;
}
function settingWrite(db: Database, userId: string, item: Setting): Statement {
  if (!item.exists) return prepare(db, `INSERT INTO SpaceMissionInvitationSetting (userId, enabled, revision, accountEpoch)
    VALUES (?1, 0, 0, 0)`, [userId]);
  return prepare(db, `UPDATE SpaceMissionInvitationSetting SET revision = CASE WHEN
      typeof(enabled) = 'integer' AND enabled IS ?2 AND typeof(revision) = 'integer' AND revision IS ?3
      AND typeof(accountEpoch) = 'integer' AND accountEpoch IS ?4 THEN revision ELSE ${invariantFailure} END
    WHERE userId = ?1`, [userId, item.enabled, item.revision, item.accountEpoch]);
}
function accessWrite(db: Database, missionId: string, userId: string, item: Access): Statement {
  if (!item.exists) return prepare(db, `INSERT INTO SpaceMissionInvitationAccess (missionId, userId, epoch) VALUES (?1, ?2, 0)`, [missionId, userId]);
  return prepare(db, `UPDATE SpaceMissionInvitationAccess SET epoch = CASE WHEN typeof(epoch) = 'integer' AND epoch IS ?3
      THEN epoch ELSE ${invariantFailure} END WHERE missionId = ?1 AND userId = ?2`, [missionId, userId, item.epoch]);
}
function fencesGuard(db: Database, scope: Scope, p: Plan) {
  return prepare(db, `WITH current AS (${snapshotSql(false)})
    SELECT CASE WHEN changes() = 1 AND EXISTS(SELECT 1 FROM current c WHERE ${objectEquality('c.data', '?15')})
      THEN 1 ELSE ${invariantFailure} END AS guarded`, [...values(scope, p.snapshot.context.initialNowMs), JSON.stringify(afterFences(p.snapshot.context))]);
}
function sourcePredicate(scope: Scope, p: Plan, bind: ReturnType<typeof bindings>, staged = false) {
  const c = p.snapshot.context;
  return `id = ?9 AND missionId = ?3 AND recipientId = ?1 AND state = 'PENDING' AND typeof(revision) = 'integer'
    AND ${staged ? `(revision = ?11 OR revision = ?11 + 1)` : 'revision = ?11'}
    AND ${sourceColumns.map(column => `${column} IS ${bind.add(c[column])}`).join(' AND ')}`;
}
function sampler(db: Database, scope: Scope, p: Plan) {
  const bind = bindings(scope, p.snapshot);
  const where = sourcePredicate(scope, p, bind);
  const ready = bind.add(p.responseError === null && p.item !== null && p.detailManifest !== null ? 1 : 0);
  const expired = `${storedDateMs('expiresAt')} <= ${sqlClock}`;
  // CASE's first successful branch owns the one fresh sample. Revision N is
  // the expired latch; N+1 is a batch-internal live stage. Every source field
  // stays intact until notices are removed. Never resample after that delete.
  return prepare(db, `UPDATE SpaceMissionInvitation SET revision = CASE
      WHEN ${expired} THEN CASE WHEN revision >= ${MAX_VERSION} THEN ${failure(domainMarkers.overflow)} ELSE revision END
      WHEN ?12 = 1 AND ?14 <> 1 THEN ${failure(domainMarkers.mission)}
      WHEN ?12 = 1 AND (
        COALESCE((SELECT epoch FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId = ?1), 0) IS NOT recipientEpoch
        OR EXISTS(SELECT 1 FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId = ?1 AND optedOutAt IS NULL)
        OR recipientEpoch >= ${MAX_EPOCH}) THEN ${failure(domainMarkers.join)}
      WHEN ?12 = 1 AND (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = ?3 AND optedOutAt IS NULL) >= 5
        THEN ${failure(domainMarkers.full)}
      WHEN revision >= ${MAX_VERSION} THEN ${failure(domainMarkers.overflow)}
      WHEN ${ready} <> 1 THEN ${failure(domainMarkers.response)}
      ELSE revision + 1 END WHERE ${where}`, [...bind.values]);
}
function samplerGuard(db: Database, scope: Scope, p: Plan) {
  const bind = bindings(scope, p.snapshot);
  const where = sourcePredicate(scope, p, bind, true);
  return prepare(db, `SELECT CASE WHEN changes() = 1 AND EXISTS(SELECT 1 FROM SpaceMissionInvitation WHERE ${where})
    THEN 1 ELSE ${invariantFailure} END AS guarded`, [...bind.values]);
}
function liveStage() {
  return `EXISTS(SELECT 1 FROM SpaceMissionInvitation WHERE id = ?9 AND missionId = ?3 AND recipientId = ?1
    AND state = 'PENDING' AND typeof(revision) = 'integer' AND revision = ?11 + 1)`;
}
function participationWrite(db: Database, scope: Scope, p: Plan) {
  const c = p.snapshot.context, bind = bindings(scope, p.snapshot);
  const next = bind.add((c.recipientEpoch as number) + 1);
  if (c.ownConsentExists === 0) return prepare(db, `INSERT INTO SpaceMissionParticipation (${ownColumns})
      SELECT ?3, ?1, ${next}, ?13, NULL WHERE ${liveStage()}`, [...bind.values]);
  const epoch = bind.add(c.ownConsentEpoch), joined = bind.add(c.ownConsentJoinedAt), opted = bind.add(c.ownConsentOptedOutAt);
  return prepare(db, `UPDATE SpaceMissionParticipation SET epoch = ${next}, joinedAt = ?13, optedOutAt = NULL
    WHERE missionId = ?3 AND userId = ?1 AND typeof(epoch) = 'integer' AND epoch IS ${epoch}
      AND joinedAt IS ${joined} AND optedOutAt IS ${opted} AND optedOutAt IS NOT NULL AND ${liveStage()}`, [...bind.values]);
}
function ownPredicate(scope: Scope, p: Plan, bind: ReturnType<typeof bindings>, live: boolean) {
  const c = p.snapshot.context;
  if (!live && c.ownConsentExists === 0) return 'NOT EXISTS(SELECT 1 FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId = ?1)';
  const epoch = bind.add(live ? (c.recipientEpoch as number) + 1 : c.ownConsentEpoch);
  const joined = live ? '?13' : bind.add(c.ownConsentJoinedAt);
  const opted = live ? 'NULL' : bind.add(c.ownConsentOptedOutAt);
  return `EXISTS(SELECT 1 FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId = ?1
    AND typeof(epoch) IS ${bind.add(live ? 'integer' : c.ownConsentEpochType)} AND epoch IS ${epoch}
    AND joinedAt IS ${joined} AND optedOutAt IS ${opted})`;
}
function participationGuard(db: Database, scope: Scope, p: Plan) {
  const bind = bindings(scope, p.snapshot);
  const live = ownPredicate(scope, p, bind, true), expired = ownPredicate(scope, p, bind, false);
  return prepare(db, `SELECT CASE WHEN CASE WHEN ${liveStage()} THEN changes() = 1 AND ${live}
      ELSE changes() = 0 AND ${expired} END THEN 1 ELSE ${invariantFailure} END AS guarded`, [...bind.values]);
}
const noticeWhere = "type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION' AND targetId = ?9";
function notices(db: Database, scope: Scope, p: Plan): Statement[] {
  return [prepare(db, `DELETE FROM Notification WHERE ${noticeWhere}`, [...values(scope, p.snapshot.context.initialNowMs).slice(0, 9)]),
    prepare(db, `SELECT CASE WHEN changes() IS ?15 AND NOT EXISTS(SELECT 1 FROM Notification WHERE ${noticeWhere})
      THEN 1 ELSE ${invariantFailure} END AS guarded`, [...values(scope, p.snapshot.context.initialNowMs), p.snapshot.context.noticeCount])];
}
function terminalWrite(db: Database, scope: Scope, p: Plan) {
  const bind = bindings(scope, p.snapshot);
  const where = sourcePredicate(scope, p, bind, p.kind === 'valid');
  const state = p.kind === 'invalid' ? `'${p.snapshot.context.expired === 1 ? 'EXPIRED' : 'REVOKED'}'` :
    "CASE WHEN revision = ?11 THEN 'EXPIRED' WHEN ?12 = 1 THEN 'ACCEPTED' ELSE 'DECLINED' END";
  return prepare(db, `UPDATE SpaceMissionInvitation SET state = ${state}, revision = ?11 + 1,
    ${sourceColumns.map(column => `${column} = NULL`).join(', ')} WHERE ${where} AND revision <= ${MAX_VERSION}`, [...bind.values]);
}
function terminalPredicate(p: Plan, scope: Scope) {
  const states = p.kind === 'invalid' ? `'${p.snapshot.context.expired === 1 ? 'EXPIRED' : 'REVOKED'}'` :
    `'EXPIRED', '${scope.input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED'}'`;
  return `id = ?9 AND missionId = ?3 AND recipientId = ?1 AND typeof(revision) = 'integer' AND revision = ?11 + 1
    AND state IN (${states}) AND ${sourceColumns.map(column => `${column} IS NULL`).join(' AND ')}`;
}
function terminalGuard(db: Database, scope: Scope, p: Plan) {
  return prepare(db, `SELECT CASE WHEN changes() = 1 AND EXISTS(SELECT 1 FROM SpaceMissionInvitation WHERE ${terminalPredicate(p, scope)})
    THEN 1 ELSE ${invariantFailure} END AS guarded`, [...values(scope, p.snapshot.context.initialNowMs).slice(0, 11)]);
}

function preservedFences(scope: Scope, p: Plan, bind: ReturnType<typeof bindings>) {
  const c = p.kind === 'valid' ? afterFences(p.snapshot.context) : p.snapshot.context;
  const clauses: string[] = [];
  for (const person of ['sender', 'recipient'] as const) {
    const user = person === 'recipient' ? '?1' : bind.add(c.senderId);
    const settingKey = `${person}SettingRow`;
    const settingWhere = `userId IS ${user}`;
    clauses.push(c[`${person}SettingExists`] === 0 ? `NOT EXISTS(SELECT 1 FROM SpaceMissionInvitationSetting WHERE ${settingWhere})` :
      `EXISTS(SELECT 1 FROM SpaceMissionInvitationSetting WHERE ${settingWhere} AND ${(['enabled', 'revision', 'accountEpoch'] as const)
        .map(column => {
          const key = `${settingKey}${column[0].toUpperCase()}${column.slice(1)}`;
          return `${column} IS ${bind.add(c[key])} AND typeof(${column}) IS ${bind.add(c[`${key}Type`])}`;
        }).join(' AND ')})`);
    const accessWhere = `missionId = ?3 AND userId IS ${user}`;
    clauses.push(c[`${person}AccessExists`] === 0 ? `NOT EXISTS(SELECT 1 FROM SpaceMissionInvitationAccess WHERE ${accessWhere})` :
      `EXISTS(SELECT 1 FROM SpaceMissionInvitationAccess WHERE ${accessWhere}
        AND epoch IS ${bind.add(c[`${person}Access`])} AND typeof(epoch) IS ${bind.add(c[`${person}AccessType`])})`);
  }
  return clauses.join(' AND ');
}
function finalGuard(db: Database, scope: Scope, p: Plan) {
  const bind = bindings(scope, p.snapshot), c = p.snapshot.context;
  const target = scope.input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
  const terminal = terminalPredicate(p, scope);
  const expectedState = p.kind === 'invalid' ? `'${c.expired === 1 ? 'EXPIRED' : 'REVOKED'}'` : `'EXPIRED', '${target}'`;
  const authority = `EXISTS(SELECT 1 FROM User u JOIN SpaceMember member ON member.userId = u.id AND member.spaceId = ?2
    JOIN Space s ON s.id = member.spaceId AND s.visibility = 'PRIVATE'
    JOIN SpaceMission m ON m.spaceId = s.id AND m.id = ?3 AND m.closedAt IS NULL WHERE u.id = ?1 AND u.role = 'USER')`;
  const fences = preservedFences(scope, p, bind);
  const unchangedOwn = ownPredicate(scope, p, bind, false);
  const joinedOwn = p.kind === 'valid' && scope.input.decision === 'ACCEPT' ? ownPredicate(scope, p, bind, true) : unchangedOwn;
  const capacity = bind.add(c.rawCapacity);
  const participation = p.kind === 'valid' && scope.input.decision === 'ACCEPT' ?
    `CASE WHEN (SELECT outcome FROM decision_end) = 'ACCEPTED' THEN ${joinedOwn}
      AND (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = ?3 AND optedOutAt IS NULL) = ${capacity} + 1
      ELSE ${unchangedOwn} AND (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = ?3 AND optedOutAt IS NULL) = ${capacity} END` :
    `${unchangedOwn} AND (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = ?3 AND optedOutAt IS NULL) = ${capacity}`;
  const projection = p.kind === 'valid';
  const expected = projection ? bind.add(p.detailManifest ?? '[]') : null;
  const ctes = `decision_end AS (SELECT (SELECT state FROM SpaceMissionInvitation WHERE ${terminal}) AS outcome)
    ${projection ? `, current AS (${d1MissionDetailSql}), ${expectedCte(expected!)}` : ''}`;
  const valid = `changes() = 1 AND ${authority} AND EXISTS(SELECT 1 FROM decision_end WHERE outcome IN (${expectedState}))
    AND ${fences} AND (${participation}) AND NOT EXISTS(SELECT 1 FROM Notification WHERE ${noticeWhere})
    ${projection ? `AND CASE WHEN (SELECT outcome FROM decision_end) = '${target}' THEN ?14 = 1 AND (${rowsEquality()}) ELSE 1 END` : ''}`;
  // The unconditional decision-result row is essential. A missing terminal or
  // empty actual projection must still evaluate the aborting final assertion;
  // a join against an absent result must never let staged PENDING commit.
  return prepare(db, `WITH ${ctes}, assertion AS (
      SELECT CASE WHEN ${valid} THEN 1 ELSE ${invariantFailure} END AS guarded)
    SELECT a.guarded, e.outcome, 'decision-result' AS kind, NULL AS missionId,
      NULL AS data, NULL AS personId, NULL AS name, NULL AS image FROM assertion a CROSS JOIN decision_end e
    ${projection ? `UNION ALL SELECT a.guarded, e.outcome, c.kind, c.missionId, c.data, c.personId, c.name, c.image
      FROM assertion a CROSS JOIN decision_end e CROSS JOIN current c WHERE e.outcome = '${target}'` : ''}`, [...bind.values]);
}
function statements(db: Database, scope: Scope, p: Plan): Statement[] {
  const list = [firstGuard(db, scope, p)];
  if (p.kind === 'valid') {
    const c = p.snapshot.context;
    text(c.senderId, SCALAR_BYTES, true);
    // Preserve the source's order exactly; no increments or max-version ban.
    list.push(settingWrite(db, c.senderId, setting(c, 'sender')),
      settingWrite(db, scope.userId, setting(c, 'recipient')),
      accessWrite(db, scope.missionId, c.senderId, access(c, 'sender')),
      accessWrite(db, scope.missionId, scope.userId, access(c, 'recipient')),
      fencesGuard(db, scope, p), sampler(db, scope, p), samplerGuard(db, scope, p));
    if (scope.input.decision === 'ACCEPT') list.push(participationWrite(db, scope, p), participationGuard(db, scope, p));
  }
  list.push(...notices(db, scope, p), terminalWrite(db, scope, p));
  if (p.kind === 'valid') list.push(terminalGuard(db, scope, p));
  list.push(finalGuard(db, scope, p));
  const expectedLength = p.kind === 'invalid' ? 5 : scope.input.decision === 'ACCEPT' ? 15 : 13;
  if (list.length !== expectedLength) throw new Error('D1 invitation decision statement bound changed');
  return list;
}

/** Deny-first, bounded evidence parsing. Only this helper's SQL-qualified first
 * preguard, exact applicable create-unique failures, or its named domain CASE
 * errors are recognized. All invariant/CAS/FK/check/transport/commit evidence
 * dominates a friendly marker anywhere else in the cause chain. */
function rollbackKind(error: unknown): Rollback {
  const details: string[] = [], seen = new Set<unknown>();
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
  if (details.some(value => /D1_[A-Z0-9_]*INVARIANT|\binvariant\b|foreign[_\s-]*key|not[_\s-]*null|check constraint|primary[_\s-]*key|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|cancel|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|\bRPC\b|\bHTTP\b|\bTLS\b|\bSSL\b|\bDNS\b|disconnect|broken pipe|unexpected token|invalid response|syntax error|no such (?:table|column|function)|datatype mismatch|out of memory/i.test(value))) return null;
  const allowed = ['D1_ERROR', snapshotMarker, ...Object.values(domainMarkers)];
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? []).some(marker => !allowed.includes(marker)))) return null;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? []).some(code =>
    !['SQLITE_ERROR', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(code)))) return null;
  if (!details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT(?:_UNIQUE)?)\b/.test(value))) return null;
  const uniquePatterns: [Rollback, RegExp][] = [
    ['setting-create', /UNIQUE constraint failed:\s*SpaceMissionInvitationSetting\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i],
    ['access-create', /UNIQUE constraint failed:\s*SpaceMissionInvitationAccess\.missionId\s*,\s*SpaceMissionInvitationAccess\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i],
    ['participation-create', /UNIQUE constraint failed:\s*SpaceMissionParticipation\.missionId\s*,\s*SpaceMissionParticipation\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i],
  ];
  if (details.some(value => /UNIQUE constraint failed/i.test(value))) {
    if (details.some(value => allowed.slice(1).some(marker => value.includes(marker)))) return null;
    let matched: Rollback = null;
    for (const value of details) {
      if (!/UNIQUE constraint failed/i.test(value)) {
        if (/constraint|\bunique\b/i.test(value.replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, ''))) return null;
        continue;
      }
      if ((value.match(/UNIQUE constraint failed/gi)?.length ?? 0) !== 1) return null;
      const found = uniquePatterns.find(([, pattern]) => pattern.test(value));
      if (!found || matched !== null && matched !== found[0]) return null;
      if (/constraint|\bunique\b/i.test(value.replace(found[1], '').replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, ''))) return null;
      matched = found[0];
    }
    return matched;
  }
  if (details.some(value => /constraint|\bunique\b/i.test(value))) return null;
  const matches = (['snapshot', ...(Object.keys(domainMarkers) as (keyof typeof domainMarkers)[])] as const).filter(kind => {
    const marker = kind === 'snapshot' ? snapshotMarker : domainMarkers[kind];
    return details.some(value => new RegExp(`\\b(?:D1_ERROR|SQLITE_ERROR)\\b[^\\n]*\\b${marker}\\b|\\b${marker}\\b[^\\n]*\\b(?:D1_ERROR|SQLITE_ERROR)\\b`).test(value));
  });
  return matches.length === 1 ? matches[0] : null;
}
function domainError(kind: Rollback, p: Plan): never {
  if (kind === 'mission') throw missionUnavailable();
  if (kind === 'join') throw joinConflict();
  if (kind === 'full') throw new SpaceApiError('Mission hat bereits fünf Teilnehmende', 409, 'MISSION_FULL');
  if (kind === 'overflow') throw conflict();
  if (kind === 'response' && p.responseError !== null) throw p.responseError;
  throw new Error('Unrecognized D1 invitation decision domain rollback');
}
function canonicalRows(rows: Row[]) {
  return rows.map(row => JSON.stringify(columns.map(column => column === 'data' && row.data !== null ?
    Object.entries(flat(row.data)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : row[column]))).sort();
}
function sameRows(left: Row[], right: Row[]) {
  const a = canonicalRows(left), b = canonicalRows(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function changedSnapshot(old: Plan, fresh: Plan) {
  const ignored = new Set(['initialNowMs', 'expired', 'effectiveValid']);
  if (contextKeys.some(key => !ignored.has(key) && old.snapshot.context[key] !== fresh.snapshot.context[key])) return true;
  // Pure passage of time may suppress the whole projection. It must never be
  // mistaken for changed database evidence. The generated joinedAt is stable.
  return old.snapshot.context.effectiveValid === 1 && fresh.snapshot.context.effectiveValid === 1 &&
    !sameRows(old.snapshot.detail, fresh.snapshot.detail);
}
function retryApplicable(kind: Rollback, p: Plan, scope: Scope) {
  if (kind === 'snapshot') return true;
  if (p.kind !== 'valid') return false;
  const c = p.snapshot.context;
  if (kind === 'setting-create') return c.senderSettingExists === 0 || c.recipientSettingExists === 0;
  if (kind === 'access-create') return c.senderAccessExists === 0 || c.recipientAccessExists === 0;
  return kind === 'participation-create' && scope.input.decision === 'ACCEPT' && c.ownConsentExists === 0;
}
function retryChanged(kind: Rollback, old: Plan, fresh: Plan) {
  if (!changedSnapshot(old, fresh)) return false;
  const before = old.snapshot.context, after = fresh.snapshot.context;
  if (kind === 'setting-create') return before.senderSettingExists === 0 && after.senderSettingExists === 1 ||
    before.recipientSettingExists === 0 && after.recipientSettingExists === 1;
  if (kind === 'access-create') return before.senderAccessExists === 0 && after.senderAccessExists === 1 ||
    before.recipientAccessExists === 0 && after.recipientAccessExists === 1;
  if (kind === 'participation-create') return before.ownConsentExists === 0 && after.ownConsentExists === 1;
  return kind === 'snapshot';
}

function committedResult(results: Awaited<ReturnType<Database['batch']>>, batch: Statement[], scope: Scope, p: Plan): Mission | null {
  const valid = p.kind === 'valid', accept = scope.input.decision === 'ACCEPT';
  const guardPositions = valid ? accept ? [0, 5, 7, 9, 11, 13] : [0, 5, 7, 9, 11] : [0, 2];
  const finalIndex = batch.length - 1;
  if (!Array.isArray(results) || results.length !== batch.length || results.some((result, index) => {
    if (!result || result.success !== true || !Array.isArray(result.results)) return true;
    if (index === finalIndex) return false;
    if (!guardPositions.includes(index)) return result.results.length !== 0;
    const row = result.results[0];
    return result.results.length !== 1 || !row || typeof row !== 'object' || Array.isArray(row) ||
      Object.keys(row).length !== 1 || (row as { guarded?: unknown }).guarded !== 1;
  })) throw new Error('Missing committed D1 invitation decision results');
  const final = results[finalIndex].results;
  const expectedKeys = ['guarded', 'outcome', ...columns];
  if (final.length < 1 || final.length > 34 || final.some(value => !value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== expectedKeys.length || expectedKeys.some(key => !Object.hasOwn(value, key)) ||
      (value as { guarded?: unknown }).guarded !== 1 ||
      columns.some(column => (value as Record<string, unknown>)[column] !== null &&
        typeof (value as Record<string, unknown>)[column] !== 'string'))) {
    throw new Error('Missing committed D1 invitation decision projection');
  }
  const records = final as Record<string, unknown>[];
  const headers = records.filter(row => row.kind === 'decision-result');
  if (headers.length !== 1 || columns.filter(column => column !== 'kind').some(column => headers[0][column] !== null) ||
      records.some(row => row.outcome !== headers[0].outcome)) throw new Error('Invalid committed D1 invitation decision outcome');
  const outcome = headers[0].outcome;
  const target = accept ? 'ACCEPTED' : 'DECLINED';
  if (outcome !== target) {
    const expected = p.kind === 'invalid' && p.snapshot.context.expired !== 1 ? 'REVOKED' : 'EXPIRED';
    if (outcome !== expected || records.length !== 1) throw new Error('Unexpected committed D1 invitation decision unavailable outcome');
    return null;
  }
  if (!valid || p.responseError !== null || p.item === null || p.detailManifest === null) throw new Error('Unexpected committed D1 invitation decision success');
  const detail = records.filter(row => row.kind !== 'decision-result').map(row => Object.fromEntries(columns.map(column => [column, row[column]])) as Row);
  if (!sameRows(detail, p.snapshot.detail)) throw new Error('Unexpected committed D1 invitation decision reader rows');
  // Pure projection at response time preserves the reader's current soft-window
  // clock, rather than returning a preflight DTO whose week boundary may pass.
  return prepareMission({ ...p.snapshot, detail, rows: [p.snapshot.rows.find(row => row.kind === 'decision-context')!, ...detail] }, scope);
}

/** Native bounded Accept/Decline, with no adapter interactive transaction.
 * Replay is one primary read and no writes. Initial invalid is five statements;
 * a valid ACCEPT is fifteen and DECLINE thirteen. At most TWO batches and TWO
 * coherent snapshot reads give <=32 helper statements, <=34 including the
 * route's existing two-statement source-auth bound (also below the conservative
 * approved 41/50 ceilings). There are no loops over invitations or historical
 * rows, no new receipts, no post-commit reads, and no unknown-commit readback.
 * The complete final assertion forbids any transient staged PENDING commit. */
export async function decideD1MissionInvitation(spaceId: string, missionId: string, invitationId: string, userId: string,
  input: DecideMissionInvitation): Promise<MissionInvitationDecisionResult<Mission>> {
  const now = new Date();
  integer(now.getTime(), -DATE_LIMIT, DATE_LIMIT);
  const scope: Scope = { userId, spaceId, missionId, invitationId,
    input: { decision: input.decision, expectedRevision: input.expectedRevision },
    joinedAt: now.toISOString().replace(/Z$/, '+00:00'),
    readableIds: SPACE_ID_RE.test(userId) && SPACE_ID_RE.test(spaceId) ? 1 : 0 };
  const db = d1SpaceDatabase();
  let current = plan(await readSnapshot(db, scope), scope);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (current.kind === 'replay') {
      if (current.item === null) throw new Error('Missing D1 invitation decision replay projection');
      return { invitation: { id: invitationId, state: scope.input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED',
        revision: scope.input.expectedRevision + 1 }, mission: current.item };
    }
    const batch = statements(db, scope, current);
    let result: Awaited<ReturnType<Database['batch']>>;
    try { result = await db.batch(batch); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind && ['mission', 'join', 'full', 'overflow', 'response'].includes(kind)) domainError(kind, current);
      if (!retryApplicable(kind, current, scope)) throw error;
      if (attempt >= 1) throw conflict();
      const fresh = plan(await readSnapshot(db, scope), scope);
      if (!retryChanged(kind, current, fresh)) throw error;
      current = fresh;
      continue;
    }
    // Successful/malformed responses are deliberately outside the retry catch.
    // A committed latch must be decoded and committed before mapping to404.
    const mission = committedResult(result, batch, scope, current);
    if (mission === null) throw unavailable();
    return { invitation: { id: invitationId, state: scope.input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED',
      revision: scope.input.expectedRevision + 1 }, mission };
  }
  throw conflict();
}
