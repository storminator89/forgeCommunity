import 'server-only';

import { randomUUID } from 'node:crypto';
import { SpaceApiError } from '@/lib/server/space-api';
import { d1SpaceDatabase } from '@/lib/server/d1-space-reads';
import type { MissionInvitationAcknowledgment, SendMissionInvitation } from '@/types/space-mission-invitations';

export type D1MissionInvitationSendInput = SendMissionInvitation & { payloadDigest: string };
/** The existing candidate MAC's twelve semantic fields. Its version string is
 * the thirteenth array element; the facade alone owns that array and its MAC. */
export type D1MissionInvitationSelectionTuple = {
  missionId: string; senderId: string; recipientId: string; senderEpoch: number;
  senderAccessEpoch: number; senderAccountEpoch: number; recipientAccessEpoch: number;
  recipientAccountEpoch: number; recipientSettingRevision: number; recipientEpoch: number;
  validUntil: string; nonce: string;
};
export type D1MissionInvitationVerifierFactory = () =>
  (tuple: D1MissionInvitationSelectionTuple, now: Date) => boolean;

type Database = ReturnType<typeof d1SpaceDatabase>;
type Statement = ReturnType<Database['prepare']>;
type Scalar = string | number | null;
type Flat = Record<string, Scalar>;
type Scope = { userId: string; spaceId: string; missionId: string; input: D1MissionInvitationSendInput };
type Setting = { exists: boolean; enabled: number; revision: number; accountEpoch: number };
type Access = { exists: boolean; epoch: number };
type Fences = { senderSetting: Setting; senderAccess: Access; recipientSetting: Setting; recipientAccess: Access;
  recipientConsentExists: boolean; recipientActive: boolean; recipientEpoch: number };
type Rollback = 'snapshot' | 'clock' | 'request-create' | 'setting-create' | 'access-create' | 'invitation-create' | null;
const MAX_VERSION = 2147483647;
const DATE_LIMIT = 8640000000000000;
const SCALAR_BYTES = 1024;
const SNAPSHOT_BYTES = 65536;
const CANDIDATE_LIFETIME = 300000;
const INVITATION_LIFETIME = 604800000;
const snapshotMarker = 'D1_SPACE_MISSION_INVITATION_SEND_SNAPSHOT_CONFLICT';
const clockMarker = 'D1_SPACE_MISSION_INVITATION_SEND_CLOCK_CONFLICT';
const invariantMarker = 'D1_SPACE_MISSION_INVITATION_SEND_WRITE_INVARIANT';
const snapshotFailure = `json_extract('[]', '${snapshotMarker}')`;
const clockFailure = `json_extract('[]', '${clockMarker}')`;
const invariantFailure = `json_extract('[]', '${invariantMarker}')`;
const conflict = () => new SpaceApiError('Einladung wurde geändert. Bitte neu laden.', 409);
const concurrentConflict = () => new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);

const aFields = ['actorExists', 'isUser', 'scopeExists', 'missionClosed', 'consentExists', 'consentActive',
  'senderEpoch', 'senderEpochType', 'senderEpochFits', 'accessExists', 'accessEpoch', 'accessType', 'accessFits',
  'receiptExists', 'digestMatches', 'requestCount', 'attemptCount', 'attemptType', 'attemptFits',
  'settingExists', 'enabled', 'enabledType', 'enabledFits', 'revision', 'revisionType', 'revisionFits',
  'accountEpoch', 'accountEpochType', 'accountEpochFits'] as const;
const bFields = ['aMatches', 'targetExists', 'settingExists', 'enabled', 'enabledType', 'enabledFits',
  'revision', 'revisionType', 'revisionFits', 'accountEpoch', 'accountEpochType', 'accountEpochFits',
  'accessExists', 'accessEpoch', 'accessType', 'accessFits', 'consentExists', 'consentActive',
  'consentEpoch', 'consentEpochType', 'consentEpochFits', 'consentDateValid', 'priorExists'] as const;
const cFields = ['priorMatches', 'pendingCount', 'expiredCount', 'revokedCount', 'validCount',
  'cleanupOverflow', 'cleanupInvalidRevision', 'corruptCount', 'noticeCount', 'activeCount',
  'previousBoundaryMs', 'nextBoundaryMs', 'cleanupAtMs'] as const;
type A = Record<(typeof aFields)[number] | 'observedNowMs', Scalar>;
type B = Record<(typeof bFields)[number] | 'signatureAtMs', Scalar>;
type C = Record<(typeof cFields)[number] | 'observedNowMs', Scalar>;
type AckPlan = { kind: 'ack'; a: A };
type WritePlan = { kind: 'write'; a: A; b: B; c: C | null; fences: Fences | null;
  signatureAtMs: number | null; window: -1 | 0 | 1 | null; untilMs: number | null; deliver: boolean };
type Plan = AckPlan | WritePlan;

// Every SELECT has the same nine leading binds: actor, Space, mission, target,
// request, server digest, client sender consent/access fences, cleanup time.
// The ninth bind is NULL for a new plan. Revalidation binds its already chosen
// cleanup time. SQL's live clock remains separately available in every case.
const sqlClock = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)";
const clockCte = `send_clock AS (SELECT ${sqlClock} AS observedNowMs,
  CASE WHEN ?9 IS NULL THEN ${sqlClock} ELSE ?9 END AS cleanupAtMs)`;
function fits(expression: string) {
  return `(typeof(${expression}) IN ('integer', 'real', 'text', 'null')
    AND COALESCE(length(CAST(${expression} AS BLOB)), 0) <= ${SCALAR_BYTES})`;
}
function raw(expression: string) { return `CASE WHEN ${fits(expression)} THEN ${expression} END`; }
function rawColumns(table: string, column: string, name: string) {
  const value = `(SELECT ${column} FROM ${table})`;
  // typeof on a scalar subquery would conflate an absent row with SQL NULL.
  return `${raw(value)} AS ${name}, (SELECT typeof(${column}) FROM ${table}) AS ${name}Type,
    ${fits(value)} AS ${name}Fits`;
}
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
function versionValid(expression: string) {
  return `(typeof(${expression}) = 'integer' AND ${expression} BETWEEN 0 AND ${MAX_VERSION})`;
}
function sameSql(alias: string, fields: readonly string[], offset: number) {
  return fields.map((field, index) => `${alias}.${field} IS ?${offset + index}`).join(' AND ');
}
const aOffset = 10;
const bOffset = aOffset + aFields.length;
const cOffset = bOffset + bFields.length;
const aSame = sameSql('a', aFields, aOffset);
const bSame = sameSql('b', bFields, bOffset);

const authorityCtes = `${clockCte},
  send_actor AS (SELECT id, role FROM User WHERE id = ?1),
  send_scope AS (
    SELECT m.id, m.closedAt, m.invitationAttemptCount
    FROM send_actor u JOIN SpaceMember member ON member.userId = u.id AND member.spaceId = ?2
    JOIN Space s ON s.id = member.spaceId AND s.visibility = 'PRIVATE'
    JOIN SpaceMission m ON m.spaceId = s.id AND m.id = ?3 WHERE u.role = 'USER'
  ), send_consent AS (
    SELECT epoch, optedOutAt FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId = ?1
      AND EXISTS(SELECT 1 FROM send_scope WHERE closedAt IS NULL)
  ), send_access AS (
    SELECT epoch FROM SpaceMissionInvitationAccess WHERE missionId = ?3 AND userId = ?1
      AND EXISTS(SELECT 1 FROM send_consent WHERE optedOutAt IS NULL)
  ), send_own_ready AS (
    SELECT 1 FROM send_consent WHERE optedOutAt IS NULL AND typeof(epoch) = 'integer' AND epoch = ?7
      AND (NOT EXISTS(SELECT 1 FROM send_access) AND ?8 = 0
        OR EXISTS(SELECT 1 FROM send_access WHERE typeof(epoch) = 'integer' AND epoch = ?8))
  ), send_receipt AS (
    SELECT payloadDigest FROM SpaceMissionInvitationRequest WHERE missionId = ?3 AND senderId = ?1 AND requestId = ?5
      AND EXISTS(SELECT 1 FROM send_own_ready)
  ), send_request_count AS (
    SELECT COUNT(*) AS amount FROM SpaceMissionInvitationRequest WHERE missionId = ?3 AND senderId = ?1
      AND EXISTS(SELECT 1 FROM send_own_ready) AND NOT EXISTS(SELECT 1 FROM send_receipt)
  ), send_fresh AS (
    SELECT 1 FROM send_scope WHERE closedAt IS NULL AND EXISTS(SELECT 1 FROM send_own_ready)
      AND NOT EXISTS(SELECT 1 FROM send_receipt) AND (SELECT amount FROM send_request_count) < 4
      AND typeof(invitationAttemptCount) = 'integer' AND invitationAttemptCount BETWEEN 0 AND 19
  ), send_sender_setting AS (
    SELECT enabled, revision, accountEpoch FROM SpaceMissionInvitationSetting WHERE userId = ?1
      AND EXISTS(SELECT 1 FROM send_fresh)
  ), send_a AS (
    SELECT EXISTS(SELECT 1 FROM send_actor) AS actorExists,
      EXISTS(SELECT 1 FROM send_actor WHERE role = 'USER') AS isUser,
      EXISTS(SELECT 1 FROM send_scope) AS scopeExists,
      EXISTS(SELECT 1 FROM send_scope WHERE closedAt IS NOT NULL) AS missionClosed,
      EXISTS(SELECT 1 FROM send_consent) AS consentExists,
      EXISTS(SELECT 1 FROM send_consent WHERE optedOutAt IS NULL) AS consentActive,
      ${rawColumns('send_consent', 'epoch', 'senderEpoch')},
      EXISTS(SELECT 1 FROM send_access) AS accessExists,
      ${rawColumns('send_access', 'epoch', 'accessEpoch').replaceAll('accessEpochType', 'accessType').replaceAll('accessEpochFits', 'accessFits')},
      EXISTS(SELECT 1 FROM send_receipt) AS receiptExists,
      EXISTS(SELECT 1 FROM send_receipt WHERE typeof(payloadDigest) = 'text' AND payloadDigest IS ?6) AS digestMatches,
      (SELECT amount FROM send_request_count) AS requestCount,
      ${rawColumns('send_scope', 'invitationAttemptCount', 'attemptCount').replaceAll('attemptCountType', 'attemptType').replaceAll('attemptCountFits', 'attemptFits')},
      EXISTS(SELECT 1 FROM send_sender_setting) AS settingExists,
      ${rawColumns('send_sender_setting', 'enabled', 'enabled')},
      ${rawColumns('send_sender_setting', 'revision', 'revision')},
      ${rawColumns('send_sender_setting', 'accountEpoch', 'accountEpoch')},
      (SELECT observedNowMs FROM send_clock) AS observedNowMs
  )`;

const targetCtes = `${authorityCtes}, send_a_stable AS (SELECT 1 FROM send_a a WHERE ${aSame}),
  send_target AS (
    SELECT id FROM User WHERE id = ?4 AND id <> ?1 AND role = 'USER'
      AND EXISTS(SELECT 1 FROM send_a_stable) AND EXISTS(SELECT 1 FROM send_fresh)
      AND EXISTS(SELECT 1 FROM SpaceMember WHERE spaceId = ?2 AND userId = ?4)
  ), send_recipient_setting AS (
    SELECT enabled, revision, accountEpoch FROM SpaceMissionInvitationSetting
      WHERE userId = ?4 AND EXISTS(SELECT 1 FROM send_target)
  ), send_recipient_access AS (
    SELECT epoch FROM SpaceMissionInvitationAccess WHERE missionId = ?3 AND userId = ?4
      AND EXISTS(SELECT 1 FROM send_target)
  ), send_recipient_consent AS (
    SELECT epoch, optedOutAt FROM SpaceMissionParticipation WHERE missionId = ?3 AND userId = ?4
      AND EXISTS(SELECT 1 FROM send_target)
  ), send_b AS (
    SELECT EXISTS(SELECT 1 FROM send_a_stable) AS aMatches,
      EXISTS(SELECT 1 FROM send_target) AS targetExists,
      EXISTS(SELECT 1 FROM send_recipient_setting) AS settingExists,
      ${rawColumns('send_recipient_setting', 'enabled', 'enabled')},
      ${rawColumns('send_recipient_setting', 'revision', 'revision')},
      ${rawColumns('send_recipient_setting', 'accountEpoch', 'accountEpoch')},
      EXISTS(SELECT 1 FROM send_recipient_access) AS accessExists,
      ${rawColumns('send_recipient_access', 'epoch', 'accessEpoch').replaceAll('accessEpochType', 'accessType').replaceAll('accessEpochFits', 'accessFits')},
      EXISTS(SELECT 1 FROM send_recipient_consent) AS consentExists,
      EXISTS(SELECT 1 FROM send_recipient_consent WHERE optedOutAt IS NULL) AS consentActive,
      ${rawColumns('send_recipient_consent', 'epoch', 'consentEpoch')},
      NOT EXISTS(SELECT 1 FROM send_recipient_consent WHERE optedOutAt IS NOT NULL
        AND NOT COALESCE(${dateValid('optedOutAt')}, 0)) AS consentDateValid,
      EXISTS(SELECT 1 FROM SpaceMissionInvitation WHERE missionId = ?3 AND recipientId = ?4
        AND EXISTS(SELECT 1 FROM send_target)) AS priorExists,
      (SELECT observedNowMs FROM send_clock) AS signatureAtMs
  )`;

/** Full source validity, independent of projection, revision and capacity.
 * These relations never have LIMIT, a row-ID manifest, an IN bind list, or a
 * revision/type predicate that silently turns a valid row into a cleanup row.
 * Materializing the current four default fences does not change this result:
 * absent defaults are used only when the entire row is absent. */
function pendingCtes(gate: string) {
  return `send_pending_raw AS (
    SELECT i.id, i.revision, i.senderId, i.createdAt, i.expiresAt,
      i.senderEpoch AS capturedSenderEpoch, i.senderAccessEpoch AS capturedSenderAccess,
      i.senderAccountEpoch AS capturedSenderAccount, i.recipientAccessEpoch AS capturedRecipientAccess,
      i.recipientAccountEpoch AS capturedRecipientAccount, i.recipientSettingRevision AS capturedRecipientRevision,
      i.recipientEpoch AS capturedRecipientEpoch,
      m.id AS liveMissionId, m.closedAt, s.visibility, sender.role AS senderRole, recipient.role AS recipientRole,
      EXISTS(SELECT 1 FROM SpaceMember WHERE spaceId = m.spaceId AND userId = i.senderId) AS senderMember,
      EXISTS(SELECT 1 FROM SpaceMember WHERE spaceId = m.spaceId AND userId = i.recipientId) AS recipientMember,
      rs.userId AS recipientSettingId, rs.enabled AS recipientEnabled, rs.revision AS recipientRevision,
      rs.accountEpoch AS recipientAccount,
      CASE WHEN ss.userId IS NULL THEN 0 ELSE ss.accountEpoch END AS senderAccount,
      CASE WHEN sa.userId IS NULL THEN 0 ELSE sa.epoch END AS senderAccess,
      CASE WHEN ra.userId IS NULL THEN 0 ELSE ra.epoch END AS recipientAccess,
      sc.userId AS senderConsentId, sc.epoch AS senderConsentEpoch, sc.optedOutAt AS senderOptedOutAt,
      rc.userId AS recipientConsentId, rc.optedOutAt AS recipientOptedOutAt,
      CASE WHEN rc.userId IS NULL THEN 0 ELSE rc.epoch END AS recipientConsentEpoch,
      ${storedDateMs('i.createdAt')} AS createdMs, ${storedDateMs('i.expiresAt')} AS expiresMs
    FROM SpaceMissionInvitation i
    LEFT JOIN SpaceMission m ON m.id = i.missionId LEFT JOIN Space s ON s.id = m.spaceId
    LEFT JOIN User sender ON sender.id = i.senderId LEFT JOIN User recipient ON recipient.id = i.recipientId
    LEFT JOIN SpaceMissionInvitationSetting ss ON ss.userId = i.senderId
    LEFT JOIN SpaceMissionInvitationSetting rs ON rs.userId = i.recipientId
    LEFT JOIN SpaceMissionInvitationAccess sa ON sa.missionId = i.missionId AND sa.userId = i.senderId
    LEFT JOIN SpaceMissionInvitationAccess ra ON ra.missionId = i.missionId AND ra.userId = i.recipientId
    LEFT JOIN SpaceMissionParticipation sc ON sc.missionId = i.missionId AND sc.userId = i.senderId
    LEFT JOIN SpaceMissionParticipation rc ON rc.missionId = i.missionId AND rc.userId = i.recipientId
    WHERE i.recipientId = ?4 AND i.state = 'PENDING' AND (${gate})
  ), send_pending_evaluated AS (
    SELECT p.*, (p.expiresAt IS NOT NULL AND p.expiresMs <= clock.cleanupAtMs) AS expired,
      COALESCE(p.createdAt IS NOT NULL AND p.expiresAt IS NOT NULL AND p.expiresMs > clock.cleanupAtMs
        AND p.liveMissionId IS NOT NULL AND p.closedAt IS NULL AND p.visibility = 'PRIVATE'
        AND p.senderId IS NOT NULL AND p.senderId <> '' AND p.senderRole = 'USER' AND p.recipientRole = 'USER'
        AND p.senderMember = 1 AND p.recipientMember = 1 AND p.recipientSettingId IS NOT NULL
        AND p.recipientEnabled = 1 AND p.recipientRevision = p.capturedRecipientRevision
        AND p.recipientAccount = p.capturedRecipientAccount AND p.senderAccount = p.capturedSenderAccount
        AND p.senderAccess = p.capturedSenderAccess AND p.recipientAccess = p.capturedRecipientAccess
        AND p.senderConsentId IS NOT NULL AND p.senderOptedOutAt IS NULL
        AND p.senderConsentEpoch = p.capturedSenderEpoch
        AND (p.recipientConsentId IS NULL OR p.recipientOptedOutAt IS NOT NULL)
        AND p.recipientConsentEpoch = p.capturedRecipientEpoch, 0) AS valid,
      CASE
        WHEN p.expiresAt IS NOT NULL AND NOT COALESCE(${dateValid('p.expiresAt')}, 0) THEN 1
        WHEN p.expiresAt IS NOT NULL AND p.expiresMs <= clock.cleanupAtMs THEN 0
        WHEN p.createdAt IS NOT NULL AND NOT COALESCE(${dateValid('p.createdAt')}, 0) THEN 1
        WHEN p.senderOptedOutAt IS NOT NULL AND NOT COALESCE(${dateValid('p.senderOptedOutAt')}, 0) THEN 1
        WHEN p.recipientOptedOutAt IS NOT NULL AND NOT COALESCE(${dateValid('p.recipientOptedOutAt')}, 0) THEN 1
        WHEN p.recipientSettingId IS NOT NULL AND
          (typeof(p.recipientEnabled) <> 'integer' OR p.recipientEnabled NOT IN (0, 1)
            OR NOT ${versionValid('p.recipientRevision')} OR NOT ${versionValid('p.recipientAccount')}) THEN 1
        WHEN NOT ${versionValid('p.senderAccount')} OR NOT ${versionValid('p.senderAccess')}
          OR NOT ${versionValid('p.recipientAccess')} OR NOT ${versionValid('p.recipientConsentEpoch')} THEN 1
        WHEN p.senderConsentId IS NOT NULL AND NOT ${versionValid('p.senderConsentEpoch')} THEN 1
        WHEN p.capturedSenderEpoch IS NOT NULL AND NOT ${versionValid('p.capturedSenderEpoch')} THEN 1
        WHEN p.capturedSenderAccess IS NOT NULL AND NOT ${versionValid('p.capturedSenderAccess')} THEN 1
        WHEN p.capturedSenderAccount IS NOT NULL AND NOT ${versionValid('p.capturedSenderAccount')} THEN 1
        WHEN p.capturedRecipientAccess IS NOT NULL AND NOT ${versionValid('p.capturedRecipientAccess')} THEN 1
        WHEN p.capturedRecipientAccount IS NOT NULL AND NOT ${versionValid('p.capturedRecipientAccount')} THEN 1
        WHEN p.capturedRecipientRevision IS NOT NULL AND NOT ${versionValid('p.capturedRecipientRevision')} THEN 1
        WHEN p.capturedRecipientEpoch IS NOT NULL AND NOT ${versionValid('p.capturedRecipientEpoch')} THEN 1
        ELSE 0 END AS corrupt
    FROM send_pending_raw p CROSS JOIN send_clock clock
  ), send_pending AS MATERIALIZED (
    SELECT id, revision, expiresMs, corrupt, valid,
      CASE WHEN expired = 1 THEN 'EXPIRED' WHEN valid = 1 THEN NULL ELSE 'REVOKED' END AS terminalState
    FROM send_pending_evaluated
  )`;
}
const pendingStats = `(SELECT COUNT(*) FROM send_pending) AS pendingCount,
  (SELECT COUNT(*) FROM send_pending WHERE terminalState = 'EXPIRED') AS expiredCount,
  (SELECT COUNT(*) FROM send_pending WHERE terminalState = 'REVOKED') AS revokedCount,
  (SELECT COUNT(*) FROM send_pending WHERE valid = 1) AS validCount,
  (SELECT COUNT(*) FROM send_pending WHERE terminalState IS NOT NULL
    AND typeof(revision) IN ('integer', 'real') AND revision >= ${MAX_VERSION}) AS cleanupOverflow,
  (SELECT COUNT(*) FROM send_pending WHERE terminalState IS NOT NULL
    AND (typeof(revision) <> 'integer' OR revision < 0)) AS cleanupInvalidRevision,
  (SELECT COUNT(*) FROM send_pending WHERE corrupt = 1) AS corruptCount,
  (SELECT COUNT(*) FROM Notification WHERE type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
    AND targetId IN (SELECT id FROM send_pending WHERE terminalState IS NOT NULL)) AS noticeCount,
  (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = ?3 AND optedOutAt IS NULL) AS activeCount,
  (SELECT MAX(expiresMs) FROM send_pending WHERE expiresMs <= (SELECT cleanupAtMs FROM send_clock)) AS previousBoundaryMs,
  (SELECT MIN(expiresMs) FROM send_pending WHERE expiresMs > (SELECT cleanupAtMs FROM send_clock)) AS nextBoundaryMs,
  (SELECT cleanupAtMs FROM send_clock) AS cleanupAtMs,
  (SELECT observedNowMs FROM send_clock) AS observedNowMs`;
const cleanupCtes = `${targetCtes}, send_prior_stable AS (
    SELECT 1 FROM send_b b WHERE ${bSame} AND b.aMatches = 1 AND b.targetExists = 1
  ), ${pendingCtes('EXISTS(SELECT 1 FROM send_prior_stable)')}, send_c AS (
    SELECT EXISTS(SELECT 1 FROM send_prior_stable) AS priorMatches, ${pendingStats}
  )`;
const aSql = `WITH ${authorityCtes} SELECT * FROM send_a`;
const bSql = `WITH ${targetCtes} SELECT * FROM send_b`;
const cSql = `WITH ${cleanupCtes} SELECT * FROM send_c`;
const writePendingCtes = `${clockCte}, ${pendingCtes('1')}`;
const cleanupIds = 'SELECT id FROM send_pending WHERE terminalState IS NOT NULL';
const cleanupNoticeWhere = `type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION' AND targetId IN (${cleanupIds})`;

function scopeValues(scope: Scope, cleanupAtMs: Scalar = null): Scalar[] {
  const { userId, spaceId, missionId, input } = scope;
  return [userId, spaceId, missionId, input.recipientId, input.requestId, input.payloadDigest,
    input.senderEpoch, input.senderAccessEpoch, cleanupAtMs];
}
function snapshotValues(scope: Scope, a?: A, b?: B, c?: C): Scalar[] {
  return [...scopeValues(scope, c?.cleanupAtMs ?? null),
    ...(a ? aFields.map(field => a[field]) : []), ...(b ? bFields.map(field => b[field]) : []),
    ...(c ? cFields.map(field => c[field]) : [])];
}
function prepare(db: Database, sql: string, values: Scalar[]): Statement {
  // Numbered SQLite slots include gaps. Never pass extra slots to a statement.
  const maximum = Math.max(0, ...Array.from(sql.matchAll(/\?(\d+)\b/g), match => Number(match[1])));
  if (maximum > 100 || maximum > values.length) throw new Error('Invalid D1 invitation send bind manifest');
  return db.prepare(sql).bind(...values.slice(0, maximum));
}
async function readStage<T extends Flat>(db: Database, sql: string, values: Scalar[], fields: readonly string[]): Promise<T> {
  const result = await prepare(db, sql, values).all<T>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error('Incomplete D1 invitation send scalar snapshot');
  }
  const row = result.results[0];
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== fields.length ||
      fields.some(field => !Object.hasOwn(row, field) || (row[field] !== null && typeof row[field] !== 'string' &&
        (typeof row[field] !== 'number' || !Number.isFinite(row[field]))) ||
        (typeof row[field] === 'string' && Buffer.byteLength(row[field], 'utf8') > SCALAR_BYTES)) ||
      Buffer.byteLength(JSON.stringify(row), 'utf8') > SNAPSHOT_BYTES) {
    throw new Error('Invalid D1 invitation send scalar snapshot');
  }
  return row;
}
function flag(value: Scalar): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 invitation send flag');
}
function count(value: Scalar): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid D1 invitation send count');
  }
}
function dateMs(value: Scalar): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > DATE_LIMIT) {
    throw new Error('Invalid D1 invitation send timestamp');
  }
}
function checkedVersion(value: Scalar, type: Scalar, bounded: Scalar): number {
  if (bounded !== 1 || type !== 'integer' || typeof value !== 'number' || !Number.isSafeInteger(value) ||
      value < 0 || value > MAX_VERSION) throw new Error('Invalid D1 invitation send version');
  return value;
}
function authorize(a: A, input: D1MissionInvitationSendInput): 'ack' | 'fresh' {
  // No caller-ID regex, ADMIN bonus, week gate, receiving-consent gate or clock.
  if (a.actorExists !== 1) throw new SpaceApiError('Nicht authentifiziert', 401);
  if (a.isUser !== 1 || a.scopeExists !== 1) throw new SpaceApiError('Einladung nicht verfügbar', 404);
  if (a.missionClosed === 1) throw new SpaceApiError('Mission ist geschlossen', 409, 'MISSION_CLOSED');
  if (a.consentExists !== 1 || a.consentActive !== 1) throw new SpaceApiError('Einladung nicht verfügbar', 404);
  if (a.senderEpoch !== input.senderEpoch || a.senderEpochType !== 'integer' || a.senderEpochFits !== 1) throw conflict();
  flag(a.accessExists);
  if (a.accessExists === 0 ? input.senderAccessEpoch !== 0 : a.accessEpoch !== input.senderAccessEpoch ||
      a.accessType !== 'integer' || a.accessFits !== 1) throw conflict();
  flag(a.receiptExists);
  if (a.receiptExists === 1) {
    if (a.digestMatches !== 1) throw new SpaceApiError('Anfrage-ID wurde bereits verwendet', 409);
    return 'ack';
  }
  count(a.requestCount);
  if (a.requestCount >= 4) return 'ack';
  // This scalar is deliberately decoded only after the sender receipt cap.
  count(a.attemptCount);
  if (a.attemptType !== 'integer' || a.attemptFits !== 1) throw new Error('Invalid D1 invitation attempt counter');
  if (a.attemptCount >= 20) return 'ack';
  return 'fresh';
}
function setting(row: A | B): Setting {
  flag(row.settingExists);
  if (row.settingExists === 0) {
    if (row.enabled !== null || row.enabledType !== null || row.enabledFits !== 1 ||
        row.revision !== null || row.revisionType !== null || row.revisionFits !== 1 ||
        row.accountEpoch !== null || row.accountEpochType !== null || row.accountEpochFits !== 1) {
      throw new Error('Invalid D1 absent invitation setting');
    }
    return { exists: false, enabled: 0, revision: 0, accountEpoch: 0 };
  }
  if (row.enabledFits !== 1 || row.enabledType !== 'integer' || (row.enabled !== 0 && row.enabled !== 1)) {
    throw new Error('Invalid D1 invitation enabled fence');
  }
  return { exists: true, enabled: row.enabled,
    revision: checkedVersion(row.revision, row.revisionType, row.revisionFits),
    accountEpoch: checkedVersion(row.accountEpoch, row.accountEpochType, row.accountEpochFits) };
}
function access(row: A | B): Access {
  flag(row.accessExists);
  if (row.accessExists === 0 && (row.accessEpoch !== null || row.accessType !== null || row.accessFits !== 1)) {
    throw new Error('Invalid D1 absent invitation access fence');
  }
  return { exists: row.accessExists === 1, epoch: row.accessExists === 0 ? 0 :
    checkedVersion(row.accessEpoch, row.accessType, row.accessFits) };
}
function selectionWindow(untilMs: number, nowMs: number): -1 | 0 | 1 {
  return untilMs <= nowMs ? -1 : untilMs > nowMs + CANDIDATE_LIFETIME ? 1 : 0;
}
function validateCleanup(c: C) {
  flag(c.priorMatches);
  for (const field of ['pendingCount', 'expiredCount', 'revokedCount', 'validCount', 'cleanupOverflow',
    'cleanupInvalidRevision', 'corruptCount', 'noticeCount', 'activeCount'] as const) count(c[field]);
  // Only rows being terminalized consume a revision; valid MAX rows remain.
  if ((c.cleanupOverflow as number) > 0) throw conflict();
  if (c.cleanupInvalidRevision !== 0 || c.corruptCount !== 0) throw new Error('Invalid D1 incoming invitation source data');
  dateMs(c.cleanupAtMs); dateMs(c.observedNowMs);
  if (c.previousBoundaryMs !== null) dateMs(c.previousBoundaryMs);
  if (c.nextBoundaryMs !== null) dateMs(c.nextBoundaryMs);
  if ((c.expiredCount as number) + (c.revokedCount as number) + (c.validCount as number) !== c.pendingCount) {
    throw new Error('Inconsistent D1 incoming invitation classification');
  }
}
async function readPlan(db: Database, scope: Scope, factory: D1MissionInvitationVerifierFactory,
  replayOnly = false): Promise<Plan> {
  const a = await readStage<A>(db, aSql, scopeValues(scope), [...aFields, 'observedNowMs']);
  dateMs(a.observedNowMs);
  const authority = authorize(a, scope.input);
  // A request-key collision permanently switches this operation to receipt
  // replay. A later cap ACK cannot disguise a disappeared receipt.
  if (replayOnly && (a.receiptExists !== 1 || a.digestMatches !== 1)) throw concurrentConflict();
  if (authority === 'ack') return { kind: 'ack', a };
  // The trusted, DB-free closure obtains the existing key only here: after
  // current sender authority/replay/caps, before every target-dependent path.
  // Its throw happens before any mutation, so counter/receipt remain absent.
  const verify = factory();
  const b = await readStage<B>(db, bSql, snapshotValues(scope, a), [...bFields, 'signatureAtMs']);
  flag(b.aMatches); flag(b.targetExists);
  const plan: WritePlan = { kind: 'write', a, b, c: null, fences: null,
    signatureAtMs: null, window: null, untilMs: null, deliver: false };
  if (b.targetExists === 0) return plan;
  const senderSetting = setting(a), recipientSetting = setting(b);
  const senderAccess = access(a), recipientAccess = access(b);
  flag(b.consentExists); flag(b.consentActive); flag(b.consentDateValid);
  if (b.consentDateValid !== 1) throw new Error('Invalid D1 recipient consent timestamp');
  if (b.consentExists === 0 && (b.consentActive !== 0 || b.consentEpoch !== null ||
      b.consentEpochType !== null || b.consentEpochFits !== 1)) throw new Error('Invalid D1 absent recipient consent');
  const recipientEpoch = b.consentExists === 0 ? 0 : checkedVersion(b.consentEpoch, b.consentEpochType, b.consentEpochFits);
  const fences: Fences = { senderSetting, senderAccess, recipientSetting, recipientAccess,
    recipientConsentExists: b.consentExists === 1, recipientActive: b.consentActive === 1, recipientEpoch };
  dateMs(b.signatureAtMs);
  const untilMs = new Date(scope.input.selection.validUntil).getTime();
  dateMs(untilMs);
  const valid = verify({ missionId: scope.missionId, senderId: scope.userId, recipientId: scope.input.recipientId,
    senderEpoch: scope.input.senderEpoch, senderAccessEpoch: senderAccess.epoch, senderAccountEpoch: senderSetting.accountEpoch,
    recipientAccessEpoch: recipientAccess.epoch, recipientAccountEpoch: recipientSetting.accountEpoch,
    recipientSettingRevision: recipientSetting.revision, recipientEpoch,
    validUntil: scope.input.selection.validUntil, nonce: scope.input.selection.nonce }, new Date(b.signatureAtMs));
  plan.fences = fences; plan.signatureAtMs = b.signatureAtMs; plan.untilMs = untilMs;
  plan.window = selectionWindow(untilMs, b.signatureAtMs);
  if (recipientSetting.enabled !== 1 || fences.recipientActive) {
    plan.window = null;
    return plan;
  }
  if (!valid) {
    // In-window false means the existing verifier actually rejected the MAC.
    // Outside the window it short-circuits before MAC; only that distinction
    // can make passage of time relevant. A prior invitation masks it as well.
    if (plan.window === 0 || b.priorExists === 1) plan.window = null;
    return plan;
  }
  flag(b.priorExists);
  if (b.priorExists === 1) { plan.window = null; return plan; }
  const c = await readStage<C>(db, cSql, snapshotValues(scope, a, b), [...cFields, 'observedNowMs']);
  validateCleanup(c);
  plan.c = c;
  plan.deliver = c.priorMatches === 1 && (c.validCount as number) < 10 && (c.activeCount as number) < 5;
  return plan;
}

type Bindings = { values: Scalar[]; add: (value: Scalar) => string };
function bindings(values: Scalar[] = []): Bindings {
  return { values, add(value: Scalar) { this.values.push(value); return `?${this.values.length}`; } };
}
function clockCondition(plan: WritePlan, bind: Bindings, now = sqlClock) {
  const conditions: string[] = [];
  if (plan.untilMs !== null && plan.window !== null) {
    const until = bind.add(plan.untilMs);
    conditions.push(plan.window === -1 ? `${now} >= ${until}` : plan.window === 1
      ? `${now} < ${until} - ${CANDIDATE_LIFETIME}`
      : `${now} >= ${until} - ${CANDIDATE_LIFETIME} AND ${now} < ${until}`);
  }
  if (plan.c) {
    if (plan.c.previousBoundaryMs !== null) conditions.push(`${now} >= ${bind.add(plan.c.previousBoundaryMs)}`);
    if (plan.c.nextBoundaryMs !== null) conditions.push(`${now} < ${bind.add(plan.c.nextBoundaryMs)}`);
  }
  return conditions.length ? conditions.map(value => `(${value})`).join(' AND ') : '1';
}
function firstGuard(db: Database, scope: Scope, plan: WritePlan) {
  const bind = bindings(snapshotValues(scope, plan.a, plan.b, plan.c ?? undefined));
  const same = `EXISTS(SELECT 1 FROM send_a a WHERE ${aSame})
    AND EXISTS(SELECT 1 FROM send_b b WHERE ${bSame})${plan.c
      ? ` AND EXISTS(SELECT 1 FROM send_c c WHERE ${sameSql('c', cFields, cOffset)})` : ''}`;
  const temporal = clockCondition(plan, bind);
  return prepare(db, `WITH ${plan.c ? cleanupCtes : targetCtes}
    SELECT CASE WHEN NOT (${same}) THEN ${snapshotFailure}
      WHEN NOT (${temporal}) THEN ${clockFailure} ELSE 1 END AS guarded`, bind.values);
}
function receiptPredicate(scope: Scope, bind: Bindings, plan: WritePlan) {
  const user = bind.add(scope.userId), space = bind.add(scope.spaceId), mission = bind.add(scope.missionId);
  const request = bind.add(scope.input.requestId), digest = bind.add(scope.input.payloadDigest);
  const attempt = bind.add((plan.a.attemptCount as number) + 1), epoch = bind.add(scope.input.senderEpoch);
  const accessEpoch = bind.add(scope.input.senderAccessEpoch);
  return `EXISTS(SELECT 1 FROM User WHERE id = ${user} AND role = 'USER')
    AND EXISTS(SELECT 1 FROM SpaceMember WHERE spaceId = ${space} AND userId = ${user})
    AND EXISTS(SELECT 1 FROM Space s JOIN SpaceMission m ON m.spaceId = s.id
      WHERE s.id = ${space} AND s.visibility = 'PRIVATE' AND m.id = ${mission} AND m.closedAt IS NULL
        AND typeof(m.invitationAttemptCount) = 'integer' AND m.invitationAttemptCount IS ${attempt})
    AND EXISTS(SELECT 1 FROM SpaceMissionParticipation WHERE missionId = ${mission} AND userId = ${user}
      AND optedOutAt IS NULL AND typeof(epoch) = 'integer' AND epoch IS ${epoch})
    AND (NOT EXISTS(SELECT 1 FROM SpaceMissionInvitationAccess WHERE missionId = ${mission} AND userId = ${user})
        AND ${accessEpoch} = 0 OR EXISTS(SELECT 1 FROM SpaceMissionInvitationAccess WHERE missionId = ${mission}
          AND userId = ${user} AND typeof(epoch) = 'integer' AND epoch IS ${accessEpoch}))
    AND EXISTS(SELECT 1 FROM SpaceMissionInvitationRequest WHERE missionId = ${mission} AND senderId = ${user}
      AND requestId = ${request} AND typeof(payloadDigest) = 'text' AND payloadDigest IS ${digest})`;
}
function settingPredicate(userId: string, setting: Setting, bind: Bindings) {
  return `EXISTS(SELECT 1 FROM SpaceMissionInvitationSetting WHERE userId = ${bind.add(userId)}
    AND typeof(enabled) = 'integer' AND enabled IS ${bind.add(setting.enabled)}
    AND typeof(revision) = 'integer' AND revision IS ${bind.add(setting.revision)}
    AND typeof(accountEpoch) = 'integer' AND accountEpoch IS ${bind.add(setting.accountEpoch)})`;
}
function accessPredicate(missionId: string, userId: string, access: Access, bind: Bindings) {
  return `EXISTS(SELECT 1 FROM SpaceMissionInvitationAccess WHERE missionId = ${bind.add(missionId)}
    AND userId = ${bind.add(userId)} AND typeof(epoch) = 'integer' AND epoch IS ${bind.add(access.epoch)})`;
}
function fullPredicate(scope: Scope, plan: WritePlan, bind: Bindings) {
  const receipt = receiptPredicate(scope, bind, plan), f = plan.fences;
  if (!f) return receipt;
  const recipient = bind.add(scope.input.recipientId), space = bind.add(scope.spaceId), mission = bind.add(scope.missionId);
  const consent = f.recipientConsentExists
    ? `EXISTS(SELECT 1 FROM SpaceMissionParticipation WHERE missionId = ${mission} AND userId = ${recipient}
        AND typeof(epoch) = 'integer' AND epoch IS ${bind.add(f.recipientEpoch)}
        AND optedOutAt IS ${f.recipientActive ? 'NULL' : 'NOT NULL'})`
    : `NOT EXISTS(SELECT 1 FROM SpaceMissionParticipation WHERE missionId = ${mission} AND userId = ${recipient})`;
  return `(${receipt}) AND EXISTS(SELECT 1 FROM User WHERE id = ${recipient} AND role = 'USER')
    AND EXISTS(SELECT 1 FROM SpaceMember WHERE spaceId = ${space} AND userId = ${recipient}) AND ${consent}
    AND ${settingPredicate(scope.userId, f.senderSetting, bind)}
    AND ${accessPredicate(scope.missionId, scope.userId, f.senderAccess, bind)}
    AND ${settingPredicate(scope.input.recipientId, f.recipientSetting, bind)}
    AND ${accessPredicate(scope.missionId, scope.input.recipientId, f.recipientAccess, bind)}`;
}
function settingWrite(db: Database, userId: string, value: Setting) {
  return value.exists
    ? db.prepare(`UPDATE SpaceMissionInvitationSetting SET revision = revision WHERE userId = ?1
        AND enabled IS ?2 AND typeof(enabled) = 'integer' AND revision IS ?3 AND typeof(revision) = 'integer'
        AND accountEpoch IS ?4 AND typeof(accountEpoch) = 'integer'`)
      .bind(userId, value.enabled, value.revision, value.accountEpoch)
    : db.prepare(`INSERT INTO SpaceMissionInvitationSetting (userId, enabled, revision, accountEpoch) VALUES (?1, 0, 0, 0)`).bind(userId);
}
function accessWrite(db: Database, missionId: string, userId: string, value: Access) {
  return value.exists
    ? db.prepare(`UPDATE SpaceMissionInvitationAccess SET epoch = epoch WHERE missionId = ?1 AND userId = ?2
        AND epoch IS ?3 AND typeof(epoch) = 'integer'`).bind(missionId, userId, value.epoch)
    : db.prepare(`INSERT INTO SpaceMissionInvitationAccess (missionId, userId, epoch) VALUES (?1, ?2, 0)`).bind(missionId, userId);
}
function ackColumns(scope: Scope, bind: Bindings) { return `, ${bind.add(scope.input.requestId)} AS requestId, 1 AS processed`; }
function invariantGuard(db: Database, scope: Scope, plan: WritePlan,
  options: { changes?: number; extra?: (bind: Bindings) => string; final?: boolean; ctes?: string } = {}) {
  const bind = bindings(options.ctes ? scopeValues(scope, plan.c?.cleanupAtMs ?? null) : []);
  const invariant = [options.changes === undefined ? '1' : `changes() IS ${bind.add(options.changes)}`,
    fullPredicate(scope, plan, bind), options.extra ? options.extra(bind) : '1'].join(' AND ');
  const columns = options.final ? ackColumns(scope, bind) : '';
  return prepare(db, `${options.ctes ? `WITH ${options.ctes} ` : ''}SELECT CASE
    WHEN ${invariant} THEN 1 ELSE ${invariantFailure} END AS guarded${columns}`, bind.values);
}
function invitationPredicate(scope: Scope, plan: WritePlan, invitationId: string, bind: Bindings) {
  const f = plan.fences;
  if (!f || plan.signatureAtMs === null) throw new Error('Missing D1 invitation creation fences');
  return `EXISTS(SELECT 1 FROM SpaceMissionInvitation WHERE id = ${bind.add(invitationId)}
    AND missionId = ${bind.add(scope.missionId)} AND recipientId = ${bind.add(scope.input.recipientId)}
    AND senderId = ${bind.add(scope.userId)} AND state = 'PENDING' AND typeof(revision) = 'integer' AND revision = 1
    AND typeof(createdAt) = 'integer' AND createdAt IS ${bind.add(plan.signatureAtMs)}
    AND typeof(expiresAt) = 'integer' AND expiresAt IS ${bind.add(plan.signatureAtMs + INVITATION_LIFETIME)}
    AND typeof(senderEpoch) = 'integer' AND senderEpoch IS ${bind.add(scope.input.senderEpoch)}
    AND typeof(senderAccessEpoch) = 'integer' AND senderAccessEpoch IS ${bind.add(f.senderAccess.epoch)}
    AND typeof(senderAccountEpoch) = 'integer' AND senderAccountEpoch IS ${bind.add(f.senderSetting.accountEpoch)}
    AND typeof(recipientAccessEpoch) = 'integer' AND recipientAccessEpoch IS ${bind.add(f.recipientAccess.epoch)}
    AND typeof(recipientAccountEpoch) = 'integer' AND recipientAccountEpoch IS ${bind.add(f.recipientSetting.accountEpoch)}
    AND typeof(recipientSettingRevision) = 'integer' AND recipientSettingRevision IS ${bind.add(f.recipientSetting.revision)}
    AND typeof(recipientEpoch) = 'integer' AND recipientEpoch IS ${bind.add(f.recipientEpoch)})`;
}
function batchStatements(db: Database, scope: Scope, plan: WritePlan, invitationId: string, noticeId: string) {
  const attempt = plan.a.attemptCount as number;
  const statements: Statement[] = [firstGuard(db, scope, plan),
    db.prepare(`UPDATE SpaceMission SET invitationAttemptCount = invitationAttemptCount + 1
      WHERE id = ?1 AND spaceId = ?2 AND closedAt IS NULL AND typeof(invitationAttemptCount) = 'integer'
        AND invitationAttemptCount IS ?3`).bind(scope.missionId, scope.spaceId, attempt)];
  const counter = bindings();
  const counterPredicate = `changes() = 1 AND EXISTS(SELECT 1 FROM SpaceMission WHERE id = ${counter.add(scope.missionId)}
    AND spaceId = ${counter.add(scope.spaceId)} AND closedAt IS NULL AND typeof(invitationAttemptCount) = 'integer'
    AND invitationAttemptCount IS ${counter.add(attempt + 1)})`;
  statements.push(prepare(db, `SELECT CASE WHEN ${counterPredicate} THEN 1 ELSE ${invariantFailure} END AS guarded`, counter.values),
    db.prepare(`INSERT INTO SpaceMissionInvitationRequest (missionId, senderId, requestId, payloadDigest)
      VALUES (?1, ?2, ?3, ?4)`).bind(scope.missionId, scope.userId, scope.input.requestId, scope.input.payloadDigest),
    // At this point the four optional fences have not yet been materialized.
    invariantGuard(db, scope, { ...plan, fences: null }, { changes: 1, final: !plan.fences }));
  const f = plan.fences;
  if (!f) return statements;
  statements.push(settingWrite(db, scope.userId, f.senderSetting),
    accessWrite(db, scope.missionId, scope.userId, f.senderAccess),
    settingWrite(db, scope.input.recipientId, f.recipientSetting),
    accessWrite(db, scope.missionId, scope.input.recipientId, f.recipientAccess),
    // Full exact postconditions prove all four materializations/no-op CASes.
    // MAX is permitted: none of these operations increments a fence version.
    invariantGuard(db, scope, plan, { changes: 1, final: !plan.c }));
  if (!plan.c) return statements;
  const cleanupCount = (plan.c.expiredCount as number) + (plan.c.revokedCount as number);
  statements.push(prepare(db, `WITH ${writePendingCtes} DELETE FROM Notification WHERE ${cleanupNoticeWhere}`,
    scopeValues(scope, plan.c.cleanupAtMs)),
    invariantGuard(db, scope, plan, { changes: plan.c.noticeCount as number, ctes: writePendingCtes,
      extra: () => `NOT EXISTS(SELECT 1 FROM Notification WHERE ${cleanupNoticeWhere})` }),
    prepare(db, `WITH ${writePendingCtes} UPDATE SpaceMissionInvitation
      SET state = CASE WHEN ${storedDateMs('expiresAt')} <= ?9 THEN 'EXPIRED' ELSE 'REVOKED' END,
        revision = revision + 1, senderId = NULL, createdAt = NULL, expiresAt = NULL, senderEpoch = NULL,
        senderAccessEpoch = NULL, senderAccountEpoch = NULL, recipientAccessEpoch = NULL,
        recipientAccountEpoch = NULL, recipientSettingRevision = NULL, recipientEpoch = NULL
      WHERE id IN (${cleanupIds})`, scopeValues(scope, plan.c.cleanupAtMs)),
    invariantGuard(db, scope, plan, { changes: cleanupCount, ctes: writePendingCtes, final: !plan.deliver,
      extra: bind => `NOT EXISTS(SELECT 1 FROM send_pending WHERE terminalState IS NOT NULL OR corrupt <> 0)
        AND (SELECT COUNT(*) FROM send_pending WHERE valid = 1) IS ${bind.add(plan.c!.validCount)}` }));
  if (!plan.deliver) return statements;
  if (plan.signatureAtMs === null) throw new Error('Missing D1 invitation timestamp');
  const createdAt = plan.signatureAtMs;
  statements.push(db.prepare(`INSERT INTO SpaceMissionInvitation
      (id, missionId, recipientId, senderId, state, revision, createdAt, expiresAt, senderEpoch,
       senderAccessEpoch, senderAccountEpoch, recipientAccessEpoch, recipientAccountEpoch, recipientSettingRevision, recipientEpoch)
      VALUES (?1, ?2, ?3, ?4, 'PENDING', 1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`)
    .bind(invitationId, scope.missionId, scope.input.recipientId, scope.userId, createdAt, createdAt + INVITATION_LIFETIME,
      scope.input.senderEpoch, f.senderAccess.epoch, f.senderSetting.accountEpoch, f.recipientAccess.epoch,
      f.recipientSetting.accountEpoch, f.recipientSetting.revision, f.recipientEpoch),
    invariantGuard(db, scope, plan, { changes: 1,
      extra: bind => invitationPredicate(scope, plan, invitationId, bind) }),
    db.prepare(`INSERT INTO Notification (id, userId, type, content, targetType, targetId, isRead, createdAt)
      VALUES (?1, ?2, 'SYSTEM', 'Du hast eine Einladung zu einer Space-Mission.', 'SPACE_MISSION_INVITATION', ?3, 0, ${sqlClock})`)
      .bind(noticeId, scope.input.recipientId, invitationId),
    invariantGuard(db, scope, plan, { changes: 1, final: true, ctes: writePendingCtes,
      extra: bind => `${invitationPredicate(scope, plan, invitationId, bind)}
        AND EXISTS(SELECT 1 FROM Notification WHERE id = ${bind.add(noticeId)} AND userId = ${bind.add(scope.input.recipientId)}
          AND type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION' AND targetId = ${bind.add(invitationId)}
          AND content = 'Du hast eine Einladung zu einer Space-Mission.' AND typeof(isRead) = 'integer' AND isRead = 0
          AND ${dateValid('createdAt')})
        AND (SELECT COUNT(*) FROM Notification WHERE type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
          AND targetId = ${bind.add(invitationId)}) = 1
        AND NOT EXISTS(SELECT 1 FROM send_pending WHERE terminalState IS NOT NULL OR corrupt <> 0)
        AND (SELECT COUNT(*) FROM send_pending WHERE valid = 1) IS ${bind.add((plan.c!.validCount as number) + 1)}
        AND (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE missionId = ?3 AND optedOutAt IS NULL) IS ${bind.add(plan.c!.activeCount)}` }));
  return statements;
}

/** A bounded, deny-first examination of actual SQL rollback evidence. An
 * invariant, unrelated constraint or uncertain transport/commit anywhere in
 * the cause chain always defeats a matching rollback/UNIQUE elsewhere. */
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
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? [])
    .some(marker => !['D1_ERROR', snapshotMarker, clockMarker].includes(marker)))) return null;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? [])
    .some(code => !['SQLITE_ERROR', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(code)))) return null;
  if (!details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT(?:_UNIQUE)?)\b/.test(value))) return null;
  const uniquePatterns: [Exclude<Rollback, 'snapshot' | 'clock' | null>, RegExp][] = [
    ['request-create', /UNIQUE constraint failed:\s*SpaceMissionInvitationRequest\.missionId\s*,\s*SpaceMissionInvitationRequest\.senderId\s*,\s*SpaceMissionInvitationRequest\.requestId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i],
    ['setting-create', /UNIQUE constraint failed:\s*SpaceMissionInvitationSetting\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i],
    ['access-create', /UNIQUE constraint failed:\s*SpaceMissionInvitationAccess\.missionId\s*,\s*SpaceMissionInvitationAccess\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i],
    ['invitation-create', /UNIQUE constraint failed:\s*SpaceMissionInvitation\.missionId\s*,\s*SpaceMissionInvitation\.recipientId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i],
  ];
  if (details.some(value => /UNIQUE constraint failed/i.test(value))) {
    if (details.some(value => value.includes(snapshotMarker) || value.includes(clockMarker))) return null;
    let matched: Rollback = null;
    for (const value of details) {
      if (!/UNIQUE constraint failed/i.test(value)) {
        if (/constraint|\bunique\b/i.test(value.replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, ''))) return null;
        continue;
      }
      if ((value.match(/UNIQUE constraint failed/gi)?.length ?? 0) !== 1) return null;
      const found = uniquePatterns.find(([, pattern]) => pattern.test(value));
      if (!found || (matched !== null && matched !== found[0])) return null;
      if (/constraint|\bunique\b/i.test(value.replace(found[1], '').replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, ''))) return null;
      matched = found[0];
    }
    return matched;
  }
  if (details.some(value => /constraint|\bunique\b/i.test(value))) return null;
  const snapshot = details.some(value => value.includes(snapshotMarker)), clock = details.some(value => value.includes(clockMarker));
  if (snapshot === clock) return null;
  const marker = snapshot ? snapshotMarker : clockMarker;
  return details.some(value => new RegExp(`\\b(?:D1_ERROR|SQLITE_ERROR)\\b[^\\n]*\\b${marker}\\b|\\b${marker}\\b[^\\n]*\\b(?:D1_ERROR|SQLITE_ERROR)\\b`).test(value))
    ? snapshot ? 'snapshot' : 'clock' : null;
}
function equalFields(left: Flat, right: Flat, fields: readonly string[]) { return fields.every(field => left[field] === right[field]); }
function clockCompatible(plan: WritePlan, now: number) {
  return (plan.untilMs === null || plan.window === null || selectionWindow(plan.untilMs, now) === plan.window)
    && (!plan.c || (plan.c.previousBoundaryMs === null || now >= (plan.c.previousBoundaryMs as number))
      && (plan.c.nextBoundaryMs === null || now < (plan.c.nextBoundaryMs as number)));
}
function clockChanged(old: WritePlan, fresh: Plan) {
  const times = [fresh.a.observedNowMs];
  if (fresh.kind === 'write') times.push(fresh.b.signatureAtMs, ...(fresh.c ? [fresh.c.observedNowMs] : []));
  return times.some(value => typeof value === 'number' && !clockCompatible(old, value));
}
function snapshotChanged(old: WritePlan, fresh: Plan) {
  if (!equalFields(old.a, fresh.a, aFields)) return true;
  if (fresh.kind !== 'write') return false;
  if (!equalFields(old.b, fresh.b, bFields)) return true;
  if (!old.c || !fresh.c) return Boolean(old.c) !== Boolean(fresh.c);
  // Generated clocks/IDs never establish a changed database snapshot. If the
  // old cleanup interval still holds, all remaining scalar differences are DB
  // differences. Across a boundary, only clock-independent counts prove it.
  const fields = clockCompatible(old, fresh.c.observedNowMs as number)
    ? cFields.filter(field => field !== 'cleanupAtMs') : ['priorMatches', 'pendingCount', 'activeCount'];
  return !equalFields(old.c, fresh.c, fields);
}
function applicable(kind: Rollback, old: WritePlan, fresh: Plan) {
  if (kind === 'snapshot') return snapshotChanged(old, fresh);
  if (kind === 'clock') return clockChanged(old, fresh);
  if (kind === 'request-create') return old.a.receiptExists === 0 && fresh.a.receiptExists === 1
    && fresh.a.digestMatches === 1 && snapshotChanged(old, fresh);
  if (fresh.kind !== 'write' || !snapshotChanged(old, fresh)) return false;
  if (kind === 'invitation-create') return old.deliver && fresh.b.targetExists === 1 && fresh.b.priorExists === 1;
  if (!old.fences || !fresh.fences) return false;
  if (kind === 'setting-create') return !old.fences.senderSetting.exists && fresh.fences.senderSetting.exists
    || !old.fences.recipientSetting.exists && fresh.fences.recipientSetting.exists;
  if (kind === 'access-create') return !old.fences.senderAccess.exists && fresh.fences.senderAccess.exists
    || !old.fences.recipientAccess.exists && fresh.fences.recipientAccess.exists;
  return false;
}
function mayRevalidate(kind: Rollback, plan: WritePlan) {
  if (kind === 'snapshot') return true;
  if (kind === 'clock') return plan.window !== null || plan.c !== null;
  if (kind === 'request-create') return plan.a.receiptExists === 0;
  if (kind === 'invitation-create') return plan.deliver;
  if (kind === 'setting-create') return Boolean(plan.fences &&
    (!plan.fences.senderSetting.exists || !plan.fences.recipientSetting.exists));
  if (kind === 'access-create') return Boolean(plan.fences &&
    (!plan.fences.senderAccess.exists || !plan.fences.recipientAccess.exists));
  return false;
}
function committedResult(results: Awaited<ReturnType<Database['batch']>>, scope: Scope, plan: WritePlan) {
  const length = plan.deliver ? 18 : plan.c ? 14 : plan.fences ? 10 : 5;
  const guards = [0, 2, 4, ...(plan.fences ? [9] : []), ...(plan.c ? [11, 13] : []), ...(plan.deliver ? [15, 17] : [])];
  if (!Array.isArray(results) || results.length !== length || results.some((result, index) => {
    if (result.success !== true || !Array.isArray(result.results)) return true;
    if (!guards.includes(index)) return result.results.length !== 0;
    const row = result.results[0] as Record<string, unknown> | undefined;
    return result.results.length !== 1 || !row || typeof row !== 'object' || Array.isArray(row) || row.guarded !== 1 ||
      Object.keys(row).length !== (index === length - 1 ? 3 : 1) || (index === length - 1 &&
        (!Object.hasOwn(row, 'requestId') || !Object.hasOwn(row, 'processed') || row.requestId !== scope.input.requestId || row.processed !== 1));
  })) throw new Error('Missing committed D1 invitation send acknowledgment');
}

/** Native send: three scalar stages at most, no target profile transport, one
 * atomic batch of 5/10/14/18 statements, and at most two batch submissions.
 * A qualified failure may use one final fresh three-stage revalidation before
 * returning conflict: 2*18 + 3*3 = 45 helper statements, <=47 with route auth.
 *
 * Time is an explicit part of each plan. B chooses the signature/created time;
 * C chooses the cleanup time. Cleanup uses that SAME bound time in its CASE.
 * The first SQL preguard preserves decision-relevant sampling classifications
 * rather than requiring raw clock equality. There is no second selection or
 * cleanup eligibility clock at commit: after that coherent sampling point,
 * cleanup and delivery use the bound decisions even if wall time advances.
 *
 * Only qualified SQL rollback evidence can lead to a fresh plan. No timeout,
 * network/unknown-commit error, invariant failure or malformed success result
 * is retried, read back as success, or fed to legacy invitationTransaction. */
export async function sendD1MissionInvitation(spaceId: string, missionId: string, userId: string,
  provided: D1MissionInvitationSendInput, verifierFactory: D1MissionInvitationVerifierFactory): Promise<MissionInvitationAcknowledgment> {
  // Facade parsing owns canonical input/digest validation; copy exactly once.
  const input: D1MissionInvitationSendInput = { ...provided, selection: { ...provided.selection } };
  const scope: Scope = { spaceId, missionId, userId, input };
  const acknowledgment = { requestId: input.requestId, processed: true } as const;
  const db = d1SpaceDatabase();
  let plan = await readPlan(db, scope, verifierFactory), replayOnly = false;
  if (plan.kind === 'ack') return acknowledgment;
  // Operation IDs are stable across a qualified retry and never prove that a
  // snapshot changed. Neither key nor target is consulted for an early ACK.
  const invitationId = randomUUID(), noticeId = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    const statements = batchStatements(db, scope, plan, invitationId, noticeId);
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind === null || !mayRevalidate(kind, plan)) throw error;
      if (kind === 'request-create') replayOnly = true;
      const fresh = await readPlan(db, scope, verifierFactory, replayOnly);
      if (!applicable(kind, plan, fresh)) throw error;
      if (fresh.kind === 'ack') return acknowledgment;
      if (attempt === 1) throw concurrentConflict();
      plan = fresh;
      continue;
    }
    // Deliberately outside catch: a malformed/missing committed response is
    // uncertain success, never evidence of SQL rollback or permission to retry.
    committedResult(results, scope, plan);
    return acknowledgment;
  }
  throw concurrentConflict();
}
