import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { SPACE_ID_RE, SPACE_REQUEST_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import type { parseMissionContribution } from '@/lib/server/space-missions';
import {
  d1MissionDetailSql, projectD1SpaceMissionDetailRows, type D1MissionDataRow,
} from '@/lib/server/d1-space-missions';
import {
  D1_SPACE_ROW_BYTES, D1_SPACE_RESULT_BYTES, d1BoundedResponse, d1Date, d1SpaceDatabase,
} from '@/lib/server/d1-space-reads';

type Input = ReturnType<typeof parseMissionContribution>;
type MissionDto = ReturnType<typeof projectD1SpaceMissionDetailRows>;
type Database = ReturnType<typeof d1SpaceDatabase>;
type Scalar = string | number | null;
type Flat = Record<string, Scalar>;
type Row = D1MissionDataRow;
type Snapshot = { rows: Row[]; context: Flat; detail: Row[] };
type Scope = { userId: string; spaceId: string; id: string; epoch: number; input: Input | null;
  contributionId: string; now: string };
type Mutation = { changed: boolean; created: boolean };
const columns = ['kind', 'missionId', 'data', 'personId', 'name', 'image'] as const;
const contextKeys = ['authorized', 'isAdmin', 'isMember', 'actorRole', 'found', 'isClosed',
  'consentExists', 'consentEpoch', 'consentActive', 'receiptExists', 'receiptId', 'receiptDigest',
  'digestMatches', 'receiptVisible', 'targetVisible', 'liveCount', 'lifetimeAttempts', 'ownedExists',
  'ownedEpoch', 'ownedWithdrawnAt', 'ownedActive', 'invalidEpochs', 'projectedOwnCount', 'fits'] as const;
const readerContextKeys = ['authorized', 'isAdmin', 'isMember', 'role', 'found', 'pageCount', 'invalidState', 'oversized'] as const;
const missionKeys = ['id', 'spaceId', 'title', 'prompt', 'creatorId', 'createdAt', 'createdAtMs', 'closedAt',
  'weekStartsOn', 'weekTimezone', 'weekStartsAt', 'weekEndsAt', 'joinedAt', 'optedOutAt', 'selfExists', 'epoch',
  'reservedSlots', 'bookmarkSaved', 'bookmarkRevision', 'bookmarkAccessEpoch', 'insightAttempts', 'buildOnAttempts'] as const;
const contributionKeys = ['id', 'authorId', 'kind', 'content', 'createdAt', 'createdAtMs', 'targetContributionId'] as const;
const contributionColumns = ['id', 'missionId', 'authorId', 'epoch', 'kind', 'content', 'targetContributionId',
  'requestId', 'payloadDigest', 'createdAt', 'hiddenAt', 'withdrawnAt'] as const;
const DATE_LIMIT = 8640000000000000;
const MAX_EPOCH = 2147483646;
const MAX_VERSION = 2147483647;
const notFound = () => new SpaceApiError('Mission nicht gefunden', 404);
const conflict = () => new SpaceApiError('Teilnahme wurde geändert. Bitte neu laden.', 409);
const liveConflict = () => new SpaceApiError('Für diesen Schritt ist bereits ein Beitrag vorhanden', 409);
const invariantFailure = "json_extract('[]', 'D1_SPACE_MISSION_CONTRIBUTION_WRITE_INVARIANT')";
const snapshotFailure = "json_extract('[]', 'D1_SPACE_MISSION_CONTRIBUTION_SNAPSHOT_CONFLICT')";

/** Only these five source-owned references may see the helper-local view.
 * It retains all historical rows for lifetime accounting, changes only the own
 * withdrawal tombstone, or adds one complete row. The actual endguard always
 * runs the genuine original reader without any replacement. */
function hypotheticalReader() {
  const table = /\bSpaceMissionContribution\b/g;
  if ((d1MissionDetailSql.match(table) ?? []).length !== 5) {
    throw new Error('D1 mission contribution reader seam changed');
  }
  return d1MissionDetailSql.replace(table, 'contribution_view');
}
function milliseconds(column: string) {
  return `CASE WHEN typeof(${column}) IN ('integer', 'real') THEN ${column}
    ELSE ROUND((julianday(${column}) - 2440587.5) * 86400000) END`;
}

/** ?1..8 are the unchanged detail-reader binds. ?9 Add, ?10 epoch,
 * ?11 request, ?12 digest, ?13 kind, ?14 content, ?15 target,
 * ?16 stable new id / exact owned withdrawal id, ?17 stable timestamp.
 * The small context is actual BEFORE state, including the actual visible set;
 * hypothetical insertion must never supply a target or receipt's visibility.
 * No history ids, hidden content or JSON aggregate are transported. */
function snapshotSql(hypothetical = true) {
  const view = hypothetical ? `, contribution_view AS (
      SELECT ${contributionColumns.map(column => column === 'withdrawnAt'
        ? `CASE WHEN ?9 = 0 AND c.id = ?16 AND c.authorId = ?1 AND c.epoch = ?10
            AND c.withdrawnAt IS NULL THEN ?17 ELSE c.withdrawnAt END AS withdrawnAt`
        : `c.${column}`).join(', ')}
      FROM SpaceMissionContribution c WHERE c.missionId = (SELECT id FROM contribution_mission)
      UNION ALL SELECT ?16, ?3, ?1, ?10, ?13, ?14, ?15, ?11, ?12, ?17, NULL, NULL
      FROM contribution_mission WHERE ?9 = 1 AND NOT EXISTS(SELECT 1 FROM contribution_receipt)
    )` : '';
  const projectionTable = hypothetical ? 'contribution_view' : 'SpaceMissionContribution';
  return `WITH contribution_actor AS (SELECT id, role FROM User WHERE id = ?1),
    contribution_access AS (
      SELECT s.id, u.role, (u.role = 'ADMIN') AS isAdmin, (member.userId IS NOT NULL) AS isMember
      FROM contribution_actor u JOIN Space s ON s.id = ?2
      LEFT JOIN SpaceMember member ON member.spaceId = s.id AND member.userId = u.id
      WHERE s.visibility = 'PRIVATE' AND (u.role = 'ADMIN' OR member.userId IS NOT NULL)
    ), contribution_mission AS (
      SELECT m.id, m.closedAt FROM SpaceMission m JOIN contribution_access a ON a.id = m.spaceId WHERE m.id = ?3
    ), contribution_consent AS (
      SELECT epoch, optedOutAt FROM SpaceMissionParticipation WHERE missionId = (SELECT id FROM contribution_mission) AND userId = ?1
    ), contribution_receipt AS (
      SELECT id, payloadDigest FROM SpaceMissionContribution
      WHERE ?9 = 1 AND missionId = (SELECT id FROM contribution_mission) AND authorId = ?1 AND requestId = ?11
    ), contribution_owned AS (
      SELECT epoch, withdrawnAt FROM SpaceMissionContribution WHERE ?9 = 0
        AND id = ?16 AND missionId = (SELECT id FROM contribution_mission) AND authorId = ?1 AND epoch = ?10
    ), contribution_eligible AS (
      SELECT p.userId, p.epoch, ROW_NUMBER() OVER (ORDER BY ${milliseconds('p.joinedAt')} ASC, p.userId ASC) AS position
      FROM SpaceMissionParticipation p JOIN contribution_mission m ON m.id = p.missionId
      JOIN User u ON u.id = p.userId AND u.role = 'USER'
      JOIN SpaceMember member ON member.userId = u.id AND member.spaceId = ?2 WHERE p.optedOutAt IS NULL
    ), contribution_before_live AS (
      SELECT c.id, c.authorId, c.kind, c.targetContributionId, ${milliseconds('c.createdAt')} AS createdAtMs
      FROM SpaceMissionContribution c JOIN contribution_eligible p ON p.userId = c.authorId AND p.epoch = c.epoch
      WHERE c.missionId = (SELECT id FROM contribution_mission) AND p.position <= 5 AND c.hiddenAt IS NULL AND c.withdrawnAt IS NULL
    ), contribution_before_ranked AS (
      SELECT c.*, ROW_NUMBER() OVER (ORDER BY c.createdAtMs ASC, c.id ASC) AS position
      FROM contribution_before_live c WHERE c.kind = 'INSIGHT' OR (c.kind = 'BUILD_ON' AND EXISTS(
        SELECT 1 FROM contribution_before_live target WHERE target.id = c.targetContributionId
          AND target.kind = 'INSIGHT' AND target.authorId <> c.authorId))
    ), contribution_before_visible AS (SELECT * FROM contribution_before_ranked WHERE position <= 10),
    contribution_guard AS (
      SELECT NOT EXISTS(SELECT 1 FROM contribution_access WHERE length(CAST(role AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM contribution_consent WHERE length(CAST(epoch AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM contribution_receipt WHERE length(CAST(id AS BLOB)) > 1024 OR length(CAST(payloadDigest AS BLOB)) > 1024)
      AND NOT EXISTS(SELECT 1 FROM contribution_owned WHERE length(CAST(epoch AS BLOB)) > 1024
        OR length(CAST(COALESCE(withdrawnAt, '') AS BLOB)) > 1024) AS fits
    )${view}, contribution_detail AS (${hypothetical ? hypotheticalReader() : d1MissionDetailSql})
    SELECT 'contribution-context' AS kind, NULL AS missionId,
      json_patch(json_patch(json_object('actorRole', (SELECT CASE WHEN length(CAST(role AS BLOB)) <= 1024 THEN role END FROM contribution_access),
        'consentEpoch', (SELECT CASE WHEN length(CAST(epoch AS BLOB)) <= 1024 THEN epoch END FROM contribution_consent),
        'receiptId', (SELECT CASE WHEN length(CAST(id AS BLOB)) <= 1024 THEN id END FROM contribution_receipt),
        'receiptDigest', (SELECT CASE WHEN length(CAST(payloadDigest AS BLOB)) <= 1024 THEN payloadDigest END FROM contribution_receipt),
        'ownedEpoch', (SELECT CASE WHEN length(CAST(epoch AS BLOB)) <= 1024 THEN epoch END FROM contribution_owned),
        'ownedWithdrawnAt', (SELECT CASE WHEN length(CAST(COALESCE(withdrawnAt, '') AS BLOB)) <= 1024 THEN withdrawnAt END FROM contribution_owned)), json_object(
        'authorized', EXISTS(SELECT 1 FROM contribution_access),
        'isAdmin', COALESCE((SELECT isAdmin FROM contribution_access), 0),
        'isMember', COALESCE((SELECT isMember FROM contribution_access), 0),
        'found', EXISTS(SELECT 1 FROM contribution_mission),
        'isClosed', EXISTS(SELECT 1 FROM contribution_mission WHERE closedAt IS NOT NULL),
        'consentExists', EXISTS(SELECT 1 FROM contribution_consent),
        'consentActive', EXISTS(SELECT 1 FROM contribution_consent WHERE optedOutAt IS NULL),
        'receiptExists', EXISTS(SELECT 1 FROM contribution_receipt),
        'digestMatches', EXISTS(SELECT 1 FROM contribution_receipt WHERE payloadDigest = ?12),
        'receiptVisible', EXISTS(SELECT 1 FROM contribution_before_visible WHERE id = (SELECT id FROM contribution_receipt)))), json_object(
        'targetVisible', EXISTS(SELECT 1 FROM contribution_before_visible WHERE ?9 = 1 AND id = ?15 AND kind = 'INSIGHT' AND authorId <> ?1),
        'liveCount', CASE WHEN ?9 = 1 THEN (SELECT COUNT(*) FROM SpaceMissionContribution
          WHERE missionId = (SELECT id FROM contribution_mission) AND authorId = ?1 AND epoch = ?10 AND kind = ?13
            AND hiddenAt IS NULL AND withdrawnAt IS NULL) ELSE 0 END,
        'lifetimeAttempts', CASE WHEN ?9 = 1 THEN (SELECT COUNT(*) FROM SpaceMissionContribution
          WHERE missionId = (SELECT id FROM contribution_mission) AND authorId = ?1 AND kind = ?13) ELSE 0 END,
        'ownedExists', EXISTS(SELECT 1 FROM contribution_owned),
        'ownedActive', EXISTS(SELECT 1 FROM contribution_owned WHERE withdrawnAt IS NULL),
        'invalidEpochs', (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = (SELECT id FROM contribution_mission)
          AND optedOutAt IS NULL AND (typeof(epoch) <> 'integer' OR epoch < 1 OR epoch > 2147483646)),
        'projectedOwnCount', (SELECT COUNT(*) FROM ${projectionTable} c
          JOIN contribution_consent p ON p.epoch = c.epoch AND p.optedOutAt IS NULL
          JOIN contribution_access a ON a.role = 'USER' AND a.isMember = 1
          WHERE c.missionId = (SELECT id FROM contribution_mission) AND c.authorId = ?1 AND c.withdrawnAt IS NULL),
        'fits', g.fits)) AS data, NULL AS personId, NULL AS name, NULL AS image FROM contribution_guard g
    UNION ALL SELECT kind, missionId, data, personId, name, image FROM contribution_detail`;
}
function values(scope: Scope) {
  const input = scope.input;
  return [scope.userId, scope.spaceId, scope.id, 'detail', 0, 0, '', 1, input ? 1 : 0, scope.epoch,
    input?.requestId ?? '', input?.payloadDigest ?? '', input?.kind ?? '', input?.content ?? '',
    input?.targetContributionId ?? null, scope.contributionId, scope.now];
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid D1 mission contribution integer');
  }
}
function flag(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 mission contribution flag');
}
function text(value: unknown, limit: number, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.length) || Buffer.byteLength(value, 'utf8') > limit) {
    throw new Error('Invalid D1 mission contribution text');
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
  if (!parts || parts[0] !== value) throw new Error('Invalid D1 mission contribution timestamp');
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month), 0);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > calendar.getUTCDate() ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('Invalid D1 mission contribution timestamp');
  }
  return d1Date(value);
}
function flat(data: unknown, keys?: readonly string[]): Flat {
  text(data, D1_SPACE_ROW_BYTES, true);
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid D1 mission contribution object');
  const entries = Object.entries(value);
  if (entries.length > 32 || (keys && (entries.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))) ||
      entries.some(([, item]) => item !== null && typeof item !== 'string' &&
        (typeof item !== 'number' || !Number.isSafeInteger(item)))) throw new Error('Invalid D1 mission contribution scalar');
  return value as Flat;
}
async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql()).bind(...values(scope)).all<Row>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length > 34) {
    throw new Error('Incomplete D1 mission contribution snapshot');
  }
  const contexts = result.results.filter(row => row?.kind === 'contribution-context');
  if (contexts.length !== 1) throw new Error('Missing D1 mission contribution context');
  // Reader invalidState, budgets and profiles cannot mask earlier source errors,
  // or prevent an own withdrawal from repairing duplicate live-kind history.
  const context = flat(contexts[0].data);
  return { rows: result.results, context, detail: result.results.filter(row => row?.kind !== 'contribution-context') };
}

/** Preserve the source's exact domain order, including sticky UNIQUE fallback.
 * A matching receipt is scoped across all epochs and must still be visible.
 * Withdrawal is owned historical-epoch access only, including ADMIN nonmembers. */
function authorize(snapshot: Snapshot, scope: Scope, replayOnly: boolean): Mutation {
  const c = snapshot.context;
  if (c.authorized !== 1) throw notFound();
  if (c.found !== 1) throw notFound();
  if (scope.input) {
    if (c.actorRole !== 'USER' || c.isMember !== 1) throw notFound();
    if (c.consentExists !== 1 || c.consentActive !== 1 || c.consentEpoch !== scope.epoch) throw conflict();
    if (c.receiptExists === 1) {
      if (c.digestMatches !== 1) throw new SpaceApiError('Anfrage-ID wurde bereits verwendet', 409);
      if (c.receiptVisible !== 1) throw notFound();
      return { changed: false, created: false };
    }
    if (c.isClosed === 1) throw new SpaceApiError('Mission ist geschlossen', 409);
    if (scope.input.kind === 'BUILD_ON' && c.targetVisible !== 1) throw notFound();
    if (replayOnly || (typeof c.liveCount === 'number' && c.liveCount > 0)) throw liveConflict();
    if (typeof c.lifetimeAttempts === 'number' && c.lifetimeAttempts >= 5) {
      throw new SpaceApiError('Beitragslimit für diesen Schritt erreicht', 409);
    }
    return { changed: true, created: true };
  }
  if (c.ownedExists !== 1 || c.ownedEpoch !== scope.epoch) throw notFound();
  return { changed: c.ownedActive === 1, created: false };
}
function validateContext(snapshot: Snapshot, scope: Scope) {
  const c = snapshot.context;
  const rows = snapshot.rows.filter(row => row.kind === 'contribution-context');
  if (rows.length !== 1) throw new Error('Invalid D1 mission contribution context count');
  flat(rows[0].data, contextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'isClosed', 'consentExists', 'consentActive',
    'receiptExists', 'digestMatches', 'receiptVisible', 'targetVisible', 'ownedExists', 'ownedActive', 'fits']) flag(c[key]);
  if (c.fits !== 1) throw new Error('D1 mission contribution context exceeds safe byte limits');
  if (c.authorized !== 1 || c.found !== 1 || (c.actorRole === 'ADMIN') !== (c.isAdmin === 1)) {
    throw new Error('Invalid D1 mission contribution authority');
  }
  text(c.actorRole, 1024, true);
  for (const key of ['liveCount', 'lifetimeAttempts', 'invalidEpochs', 'projectedOwnCount']) integer(c[key]);
  if (c.consentExists === 1) integer(c.consentEpoch, 1, MAX_EPOCH);
  else if (c.consentEpoch !== null || c.consentActive !== 0) throw new Error('Invalid D1 mission contribution absent consent');
  if (c.receiptExists === 1) {
    text(c.receiptId, 1024, true); text(c.receiptDigest, 1024, true);
    if (!scope.input || c.receiptDigest !== scope.input.payloadDigest || c.digestMatches !== 1 || c.receiptVisible !== 1) {
      throw new Error('Invalid D1 mission contribution receipt');
    }
  } else if (c.receiptId !== null || c.receiptDigest !== null || c.digestMatches !== 0 || c.receiptVisible !== 0) {
    throw new Error('Invalid D1 mission contribution absent receipt');
  }
  if (c.ownedExists === 1) {
    if (scope.input || c.ownedEpoch !== scope.epoch) throw new Error('Invalid D1 mission contribution owned scope');
    if (c.ownedWithdrawnAt !== null) storedDate(c.ownedWithdrawnAt);
    if ((c.ownedWithdrawnAt === null) !== (c.ownedActive === 1)) throw new Error('Invalid D1 mission contribution tombstone');
  } else if (c.ownedEpoch !== null || c.ownedWithdrawnAt !== null || c.ownedActive !== 0) {
    throw new Error('Invalid D1 mission contribution absent owned row');
  }
  if (!scope.input && (c.liveCount !== 0 || c.lifetimeAttempts !== 0 || c.targetVisible !== 0)) {
    throw new Error('Unexpected D1 mission withdrawal Add context');
  }
}
function afterSnapshot(before: Snapshot, scope: Scope, mutation: Mutation): Snapshot {
  const context: Flat = { ...before.context };
  if (mutation.changed) {
    if (scope.input) Object.assign(context, { receiptExists: 1, receiptId: scope.contributionId,
      receiptDigest: scope.input.payloadDigest, digestMatches: 1, receiptVisible: 1,
      liveCount: (context.liveCount as number) + 1, lifetimeAttempts: (context.lifetimeAttempts as number) + 1 });
    else Object.assign(context, { ownedWithdrawnAt: scope.now, ownedActive: 0 });
  }
  const rows = before.rows.map(row => row.kind === 'contribution-context' ? { ...row, data: JSON.stringify(context) } : row);
  return { rows, context, detail: rows.filter(row => row.kind !== 'contribution-context') };
}

/** Validate only the complete SQL-derived After. Every current person, target,
 * own-row metadata, lifetime count, bookmark/global epoch and next action is
 * reprojected by the reader; nothing is patched into a stale DTO. */
function prepareAfter(snapshot: Snapshot, scope: Scope): MissionDto {
  validateContext(snapshot, scope);
  const c = snapshot.context;
  let transportBytes = 0;
  for (const row of snapshot.rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== columns.length ||
        columns.some(column => !Object.hasOwn(row, column) || (row[column] !== null && typeof row[column] !== 'string'))) {
      throw new Error('Invalid D1 mission contribution row');
    }
    text(row.kind, 32, true);
    const rowBytes = columns.reduce((bytes, column) => bytes + (row[column] === null ? 4 : Buffer.byteLength(row[column]!, 'utf8')), 0);
    transportBytes += 6 * rowBytes + 4096;
    if (rowBytes > D1_SPACE_ROW_BYTES || transportBytes > D1_SPACE_RESULT_BYTES) throw new Error('Oversized D1 mission contribution snapshot');
    if (!['contribution-context', 'context', 'mission', 'participant', 'contribution', 'own', 'person'].includes(row.kind)) {
      throw new Error('Unexpected D1 mission contribution row');
    }
    if (row.kind === 'person') {
      if (row.data !== null || row.missionId !== null) throw new Error('Invalid D1 mission contribution person row');
      text(row.personId, 1024, true); nullableText(row.name, 256000); nullableText(row.image, 256000);
    } else {
      if (row.personId !== null || row.name !== null || row.image !== null) throw new Error('Invalid D1 mission contribution data row');
      if (row.kind === 'context' || row.kind === 'contribution-context') {
        if (row.missionId !== null) throw new Error('Invalid D1 mission contribution context row');
      } else if (row.missionId !== scope.id) throw new Error('Unscoped D1 mission contribution data row');
      flat(row.data);
    }
  }
  const contexts = snapshot.detail.filter(row => row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Invalid D1 mission contribution reader context');
  const rc = flat(contexts[0].data, readerContextKeys);
  for (const key of ['authorized', 'isAdmin', 'isMember', 'found', 'pageCount', 'invalidState', 'oversized']) flag(rc[key]);
  if (rc.authorized !== 1 || rc.isAdmin !== c.isAdmin || rc.isMember !== c.isMember || rc.role !== c.actorRole ||
      rc.found !== 1 || rc.pageCount !== 1) throw new Error('Inconsistent D1 mission contribution reader authority');
  if (rc.invalidState !== 0 || c.invalidEpochs !== 0) throw new SpaceApiError('Mission enthält einen ungültigen Teilnahmestand.', 409);
  if (rc.oversized !== 0) throw new SpaceApiError('Missionsdaten sind zu groß und können nicht sicher geladen werden.', 500);
  const missions = snapshot.detail.filter(row => row.kind === 'mission');
  if (missions.length !== 1) throw new Error('Invalid D1 mission contribution mission count');
  const m = flat(missions[0].data, missionKeys);
  if (m.id !== scope.id || m.spaceId !== scope.spaceId || (m.closedAt !== null) !== (c.isClosed === 1)) {
    throw new Error('Invalid D1 mission contribution projection');
  }
  text(m.title, 64000); text(m.prompt, 64000);
  if (m.creatorId !== null) text(m.creatorId, 1024, true);
  integer(m.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
  if (storedDate(m.createdAt).getTime() !== m.createdAtMs) throw new Error('Invalid D1 mission contribution date key');
  if (m.closedAt !== null) storedDate(m.closedAt);
  const week = [m.weekStartsOn, m.weekTimezone, m.weekStartsAt, m.weekEndsAt];
  if (!week.every(value => value === null)) {
    text(m.weekStartsOn, 1024, true); text(m.weekTimezone, 1024, true);
    if (!/^\d{4}-\d\d-\d\d$/.test(m.weekStartsOn) || storedDate(m.weekEndsAt) <= storedDate(m.weekStartsAt)) {
      throw new Error('Invalid D1 mission contribution stored week');
    }
    storedDate(`${m.weekStartsOn}T00:00:00Z`);
  }
  flag(m.selfExists); flag(m.bookmarkSaved);
  integer(m.epoch, 0, MAX_EPOCH); integer(m.reservedSlots, 0, 5);
  integer(m.bookmarkRevision, 0, MAX_VERSION); integer(m.bookmarkAccessEpoch, 0, MAX_VERSION);
  integer(m.insightAttempts); integer(m.buildOnAttempts);
  if (m.selfExists !== c.consentExists || m.epoch !== (c.consentExists === 1 ? c.consentEpoch : 0)) {
    throw new Error('Inconsistent D1 mission contribution consent');
  }
  if (m.selfExists === 1) {
    if (m.epoch < 1) throw new Error('Invalid D1 mission contribution consent epoch');
    storedDate(m.joinedAt); if (m.optedOutAt !== null) storedDate(m.optedOutAt);
    if ((m.optedOutAt === null) !== (c.consentActive === 1)) throw new Error('Invalid D1 mission contribution consent state');
  } else if (m.joinedAt !== null || m.optedOutAt !== null) throw new Error('Invalid D1 mission contribution absent consent dates');
  if (scope.input && (scope.input.kind === 'INSIGHT' ? m.insightAttempts : m.buildOnAttempts) !== c.lifetimeAttempts) {
    throw new Error('Inconsistent D1 mission contribution lifetime count');
  }
  const people = new Map<string, Row>();
  for (const row of snapshot.detail.filter(row => row.kind === 'person')) {
    if (people.has(row.personId!)) throw new Error('Duplicate D1 mission contribution person');
    people.set(row.personId!, row);
  }
  const participantIds = new Set<string>();
  const participants = snapshot.detail.filter(row => row.kind === 'participant');
  const contributions = snapshot.detail.filter(row => row.kind === 'contribution');
  const ownRows = snapshot.detail.filter(row => row.kind === 'own');
  integer(c.projectedOwnCount);
  if (c.projectedOwnCount > 10 || ownRows.length !== c.projectedOwnCount) {
    throw new Error('Incomplete D1 mission contribution own metadata');
  }
  if (participants.length > 5 || contributions.length > 10 || ownRows.length > 10 || participants.length > m.reservedSlots) {
    throw new Error('Invalid D1 mission contribution projection count');
  }
  const usedPeople = new Set<string>(m.creatorId === null ? [] : [m.creatorId as string]);
  for (const row of participants) {
    const p = flat(row.data, ['userId', 'joinedAt']);
    text(p.userId, 1024, true); storedDate(p.joinedAt);
    if (participantIds.has(p.userId)) throw new Error('Duplicate D1 mission contribution participant');
    participantIds.add(p.userId); usedPeople.add(p.userId);
    if (p.userId === scope.userId && (p.joinedAt !== m.joinedAt || c.consentActive !== 1)) {
      throw new Error('Invalid D1 mission contribution own participant');
    }
  }
  const active = c.consentExists === 1 && c.consentActive === 1 && c.isMember === 1 && c.actorRole === 'USER';
  if (participantIds.has(scope.userId) !== active) throw new Error('Incomplete D1 mission contribution own participant');
  const visible = new Map<string, Flat>();
  const kinds = new Set<string>();
  for (const row of contributions) {
    const item = flat(row.data, contributionKeys);
    text(item.id, 1024, true); text(item.authorId, 1024, true); text(item.content, 64000);
    integer(item.createdAtMs, -DATE_LIMIT, DATE_LIMIT);
    if (visible.has(item.id) || !participantIds.has(item.authorId) ||
        (item.kind !== 'INSIGHT' && item.kind !== 'BUILD_ON') || storedDate(item.createdAt).getTime() !== item.createdAtMs) {
      throw new Error('Invalid D1 mission contribution visible row');
    }
    const key = JSON.stringify([item.authorId, item.kind]);
    if (kinds.has(key)) throw new Error('Duplicate D1 mission contribution visible kind');
    kinds.add(key);
    if (item.kind === 'INSIGHT') {
      if (item.targetContributionId !== null) throw new Error('Invalid D1 mission contribution insight target');
    } else text(item.targetContributionId, 1024, true);
    visible.set(item.id, item); usedPeople.add(item.authorId);
  }
  for (const item of visible.values()) if (item.kind === 'BUILD_ON') {
    text(item.targetContributionId, 1024, true);
    const target = visible.get(item.targetContributionId);
    if (!target || target.kind !== 'INSIGHT' || target.authorId === item.authorId) throw new Error('Invalid D1 mission contribution visible target');
  }
  const ownIds = new Set<string>();
  for (const row of ownRows) {
    const own = flat(row.data, ['id', 'kind', 'createdAtMs', 'hidden', 'targetContributionId']);
    text(own.id, 1024, true); integer(own.createdAtMs, -DATE_LIMIT, DATE_LIMIT); flag(own.hidden);
    if (!active || ownIds.has(own.id) || (own.kind !== 'INSIGHT' && own.kind !== 'BUILD_ON')) throw new Error('Invalid D1 mission contribution own row');
    if (own.kind === 'INSIGHT') {
      if (own.targetContributionId !== null) throw new Error('Invalid D1 mission contribution own insight');
    } else text(own.targetContributionId, 1024, true);
    const shown = visible.get(own.id);
    if (shown && (shown.authorId !== scope.userId || shown.kind !== own.kind || shown.createdAtMs !== own.createdAtMs ||
        shown.targetContributionId !== own.targetContributionId || own.hidden !== 0)) throw new Error('Inconsistent D1 mission contribution own row');
    ownIds.add(own.id);
  }
  for (const [id, item] of visible) if (item.authorId === scope.userId && !ownIds.has(id)) {
    throw new Error('Missing D1 mission contribution own row');
  }
  if (people.size !== usedPeople.size || [...usedPeople].some(id => !people.has(id))) throw new Error('Incomplete D1 mission contribution people');
  const item = d1BoundedResponse(projectD1SpaceMissionDetailRows(snapshot.detail, scope.userId));
  if (item.participation.active !== active || item.canManage !== (c.isAdmin === 1) ||
      (item.ownBookmark !== null) !== (c.isMember === 1 && c.isClosed === 0) ||
      (!active && (item.myNextAction !== null || item.ownContributions.length !== 0))) throw new Error('Invalid D1 mission contribution private DTO');
  if (scope.input && !visible.has(c.receiptId as string)) throw new Error('Missing D1 mission contribution visible receipt');
  return item;
}
function manifest(snapshot: Snapshot) {
  const json = JSON.stringify(snapshot.rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
  if (Buffer.byteLength(json, 'utf8') >= D1_SPACE_ROW_BYTES) throw new Error('D1 mission contribution manifest exceeds safe byte limits');
  return json;
}

/** Validated singleton/row identities plus exact counts and both directions
 * prove multiplicity. Flat scalar equality preserves raw NULL and numeric zero;
 * JSON key order / SQLite's spelling of integral real numbers are immaterial. */
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
      SELECT ${columns.map(column => `json_extract(j.value, '$.${column}') AS "${column}"`).join(', ')} FROM json_each(?18) j
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

type Rollback = 'snapshot' | 'unique' | null;
/** Only our named SQL-qualified first guard, or these exact source-owned
 * UNIQUE column lists, can fall back. Transport/unknown commit, invariant, CAS,
 * global UUID, FK and every other constraint outrank nested known markers. */
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
  if (details.some(value => /D1_SPACE_MISSION_CONTRIBUTION_WRITE_INVARIANT|foreign[_\s-]*key|not[_\s-]*null|check constraint|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|unexpected token|invalid response|HTTP\s*\d|SQLITE_BUSY/i.test(value))) return null;
  const sqlite = details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT(?:_UNIQUE)?)\b/.test(value));
  if (!sqlite) return null;
  const unique = details.filter(value => /UNIQUE constraint failed/i.test(value));
  if (unique.length) {
    const scoped = /UNIQUE constraint failed:\s*SpaceMissionContribution\.missionId\s*,\s*SpaceMissionContribution\.authorId\s*,\s*(?:SpaceMissionContribution\.requestId|SpaceMissionContribution\.epoch\s*,\s*SpaceMissionContribution\.kind)(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i;
    for (const value of details) {
      if (/UNIQUE constraint failed/i.test(value) &&
          ((value.match(/UNIQUE constraint failed/gi)?.length !== 1) || !scoped.test(value))) return null;
      const rest = value.replace(scoped, '').replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, '');
      if (/constraint|\bunique\b/i.test(rest)) return null;
    }
    return 'unique';
  }
  if (details.some(value => /constraint|\bunique\b/i.test(value))) return null;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b[^\n]*\bD1_SPACE_MISSION_CONTRIBUTION_SNAPSHOT_CONFLICT\b|\bD1_SPACE_MISSION_CONTRIBUTION_SNAPSHOT_CONFLICT\b[^\n]*\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) ? 'snapshot' : null;
}
function parsedInput(input: Input): Input {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 6 ||
      !['kind', 'content', 'epoch', 'requestId', 'payloadDigest', 'targetContributionId'].every(key => Object.hasOwn(input, key)) ||
      (input.kind !== 'INSIGHT' && input.kind !== 'BUILD_ON') || typeof input.content !== 'string' ||
      input.content.length < 10 || input.content.length > 2000 || !Number.isSafeInteger(input.epoch) || input.epoch < 1 || input.epoch > MAX_EPOCH ||
      typeof input.requestId !== 'string' || !SPACE_REQUEST_ID_RE.test(input.requestId) ||
      (input.kind === 'INSIGHT' ? input.targetContributionId !== null : typeof input.targetContributionId !== 'string' || !SPACE_ID_RE.test(input.targetContributionId))) {
    throw new Error('Invalid parsed D1 mission contribution input');
  }
  const { kind, content, epoch, requestId, targetContributionId } = input;
  const payloadDigest = createHash('sha256').update(JSON.stringify({ kind, content, epoch, targetContributionId })).digest('hex');
  if (input.payloadDigest !== payloadDigest) throw new Error('Invalid parsed D1 mission contribution digest');
  return { kind, content, epoch, requestId, payloadDigest, targetContributionId };
}
function validScope(spaceId: string, id: string, userId: string) {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId) || typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId) ||
      typeof id !== 'string' || !SPACE_ID_RE.test(id)) throw notFound();
}
function operationTime() {
  const now = new Date();
  integer(now.getTime(), -DATE_LIMIT, DATE_LIMIT);
  return now.toISOString().replace(/Z$/, '+00:00');
}

/** At most four atomic batches: normal writes have four statements, replays
 * two. One initial and up to four authorized fresh snapshot reads yield a
 * conservative total of 21 SQL statements, including the final failed attempt.
 * Each batch changes at most one Contribution row, without audit/notifications.
 * UUID/time are stable: hypothetical values cannot manufacture retry evidence. */
async function run(scope: Scope): Promise<{ item: MissionDto; created: boolean }> {
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  let replayOnly = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const mutation = authorize(snapshot, scope, replayOnly);
    // The actual before may be invalid or oversized; only the small context and
    // complete counterfactual After have to validate before their exact fences.
    validateContext(snapshot, scope);
    const after = afterSnapshot(snapshot, scope, mutation);
    const item = prepareAfter(after, scope);
    const beforeManifest = manifest(snapshot), afterManifest = mutation.changed ? manifest(after) : beforeManifest;
    const statements = [guardedSnapshot(db, scope, beforeManifest)];
    if (mutation.changed) {
      if (scope.input) {
        const input = scope.input;
        statements.push(db.prepare(`INSERT INTO SpaceMissionContribution (${contributionColumns.join(', ')})
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL)`)
          .bind(scope.contributionId, scope.id, scope.userId, scope.epoch, input.kind, input.content,
            input.targetContributionId, input.requestId, input.payloadDigest, scope.now));
      } else statements.push(db.prepare(`UPDATE SpaceMissionContribution SET withdrawnAt = ?5
          WHERE id = ?1 AND missionId = ?2 AND authorId = ?3 AND epoch = ?4 AND withdrawnAt IS NULL`)
        .bind(scope.contributionId, scope.id, scope.userId, scope.epoch, scope.now));
      statements.push(db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`));
    }
    statements.push(guardedSnapshot(db, scope, afterManifest, true));
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind === null || (kind === 'unique' && !scope.input)) throw error;
      if (kind === 'unique') replayOnly = true;
      const fresh = await readSnapshot(db, scope);
      const freshMutation = authorize(fresh, scope, replayOnly);
      validateContext(fresh, scope);
      prepareAfter(afterSnapshot(fresh, scope, freshMutation), scope);
      // Also required for exact UNIQUE: its fallback cannot hide an unknown or
      // unchanged failure. Sticky replayOnly survives every subsequent retry.
      if (sameSnapshot(snapshot, fresh)) throw error;
      if (attempt === 3) throw conflict();
      snapshot = fresh;
      continue;
    }
    // Deliberately outside the catch: success/malformed results/unknown commit
    // never submit a second write batch. The actual endguard fenced the DTO.
    const final = results[results.length - 1];
    if (results.length !== statements.length || results.some(result => result.success !== true) ||
        !final || !Array.isArray(final.results) || final.results.length !== after.rows.length ||
        final.results.some(value => !value || typeof value !== 'object' ||
          (value as { guarded?: unknown }).guarded !== 1 || Object.keys(value).length !== columns.length + 1 ||
          columns.some(column => !Object.hasOwn(value, column) ||
            ((value as Record<string, unknown>)[column] !== null && typeof (value as Record<string, unknown>)[column] !== 'string')))) {
      throw new Error('Missing committed D1 mission contribution result');
    }
    const committedRows = final.results.map(value => Object.fromEntries(columns.map(column =>
      [column, (value as Record<string, unknown>)[column]])) as Row);
    if (!sameSnapshot(after, { rows: committedRows, context: after.context, detail: [] })) {
      throw new Error('Unexpected committed D1 mission contribution projection');
    }
    return { item, created: mutation.created };
  }
  throw conflict();
}
export async function contributeD1SpaceMission(spaceId: string, id: string, userId: string, input: Input): Promise<{ item: MissionDto; created: boolean }> {
  validScope(spaceId, id, userId);
  const parsed = parsedInput(input);
  return run({ userId, spaceId, id, epoch: parsed.epoch, input: parsed, contributionId: randomUUID(), now: operationTime() });
}
export async function withdrawD1SpaceMissionContribution(spaceId: string, id: string, contributionId: string, userId: string, epoch: number): Promise<MissionDto> {
  validScope(spaceId, id, userId);
  if (typeof contributionId !== 'string' || !SPACE_ID_RE.test(contributionId)) throw notFound();
  if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > MAX_EPOCH) throw new SpaceApiError('Ungültiger Teilnahmestand', 400);
  return (await run({ userId, spaceId, id, epoch, input: null, contributionId, now: operationTime() })).item;
}
