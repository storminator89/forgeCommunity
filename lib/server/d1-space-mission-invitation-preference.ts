import 'server-only';

import { SpaceApiError } from '@/lib/server/space-api';
import { d1SpaceDatabase } from '@/lib/server/d1-space-reads';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Input = { enabled: boolean; expectedRevision: number };
type Preference = { enabled: boolean; revision: number };
type Scalar = string | number | null;
type Rollback = 'snapshot' | 'setting-create' | null;
const MAX_VERSION = 2147483647;
const SCALAR_BYTES = 1024;
const SNAPSHOT_BYTES = 24576;
const snapshotMarker = 'D1_SPACE_MISSION_INVITATION_PREFERENCE_SNAPSHOT_CONFLICT';
const invariantFailure = "json_extract('[]', 'D1_SPACE_MISSION_INVITATION_PREFERENCE_WRITE_INVARIANT')";
const conflict = () => new SpaceApiError('Einladung wurde geändert. Bitte neu laden.', 409);
const concurrentConflict = () => new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
const snapshotFields = ['actorExists', 'isUser', 'settingExists', 'enabled', 'enabledType',
  'revision', 'revisionType', 'accountEpoch', 'accountEpochType', 'pendingCount',
  'pendingOverflow', 'pendingInvalid', 'noticeCount', 'fits'] as const;
type Snapshot = Record<(typeof snapshotFields)[number], Scalar>;

/** One bounded scalar row, independent of the number of incoming invitations.
 * No Space, mission, membership, participation, consent, key or profile is read.
 * The client revision and desired value scope all lower-priority work: a no-op
 * does not consume accountEpoch, and cleanup counts exist only for a genuine
 * disable. Existing SQL NULL is never COALESCE'd into an absent-row default.
 * Each raw scalar has its own budget so an irrelevant/bad epoch cannot hide a
 * revision mismatch or turn a same-value source success into a projection error. */
const snapshotSql = `WITH preference_actor AS (
    SELECT id FROM User WHERE id = ?1
  ), preference_user AS (
    SELECT id FROM User WHERE id = ?1 AND role = 'USER'
  ), preference_setting AS (
    SELECT enabled, revision, accountEpoch FROM SpaceMissionInvitationSetting
      WHERE userId = ?1 AND EXISTS(SELECT 1 FROM preference_user)
  ), preference_change AS (
    SELECT enabled, revision, accountEpoch FROM preference_setting
      WHERE typeof(revision) = 'integer' AND revision = ?3 AND revision < ${MAX_VERSION}
        AND typeof(enabled) = 'integer' AND enabled IN (0, 1) AND enabled <> ?2
  ), preference_pending AS (
    SELECT id, revision FROM SpaceMissionInvitation WHERE recipientId = ?1 AND state = 'PENDING'
      AND ?2 = 0 AND EXISTS(SELECT 1 FROM preference_change WHERE enabled = 1)
  ), preference_budget AS (
    SELECT NOT EXISTS(SELECT 1 FROM preference_setting
      WHERE typeof(enabled) NOT IN ('integer', 'real', 'text', 'null')
        OR COALESCE(length(CAST(enabled AS BLOB)), 0) > ${SCALAR_BYTES}) AS enabledFits,
      NOT EXISTS(SELECT 1 FROM preference_setting
      WHERE typeof(revision) NOT IN ('integer', 'real', 'text', 'null')
        OR COALESCE(length(CAST(revision AS BLOB)), 0) > ${SCALAR_BYTES}) AS revisionFits,
      NOT EXISTS(SELECT 1 FROM preference_change
      WHERE typeof(accountEpoch) NOT IN ('integer', 'real', 'text', 'null')
        OR COALESCE(length(CAST(accountEpoch AS BLOB)), 0) > ${SCALAR_BYTES}) AS epochFits
  ) SELECT EXISTS(SELECT 1 FROM preference_actor) AS actorExists,
    EXISTS(SELECT 1 FROM preference_user) AS isUser,
    EXISTS(SELECT 1 FROM preference_setting) AS settingExists,
    CASE WHEN b.enabledFits = 1 THEN (SELECT enabled FROM preference_setting) END AS enabled,
    (SELECT typeof(enabled) FROM preference_setting) AS enabledType,
    CASE WHEN b.revisionFits = 1 THEN (SELECT revision FROM preference_setting) END AS revision,
    (SELECT typeof(revision) FROM preference_setting) AS revisionType,
    CASE WHEN b.epochFits = 1 THEN (SELECT accountEpoch FROM preference_change) END AS accountEpoch,
    (SELECT typeof(accountEpoch) FROM preference_change) AS accountEpochType,
    (SELECT COUNT(*) FROM preference_pending) AS pendingCount,
    (SELECT COUNT(*) FROM preference_pending WHERE typeof(revision) IN ('integer', 'real')
      AND revision >= ${MAX_VERSION}) AS pendingOverflow,
    (SELECT COUNT(*) FROM preference_pending WHERE typeof(revision) <> 'integer' OR revision < 0) AS pendingInvalid,
    (SELECT COUNT(*) FROM Notification WHERE type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
      AND targetId IN (SELECT id FROM preference_pending)) AS noticeCount,
    (b.enabledFits AND b.revisionFits AND b.epochFits) AS fits FROM preference_budget b`;

function values(userId: string, input: Input) {
  return [userId, input.enabled ? 1 : 0, input.expectedRevision];
}
function stableInput(input: Input): Input {
  const keys = ['enabled', 'expectedRevision'] as const;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length ||
      keys.some(key => !Object.hasOwn(input, key))) {
    throw new SpaceApiError('Ungültige Einladungsdaten', 400);
  }
  const { enabled, expectedRevision } = input;
  if (typeof enabled !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > MAX_VERSION) {
    throw new SpaceApiError('Ungültige Einladungsdaten', 400);
  }
  // One operation input for all reads and all retries; never catch up a revision.
  return { enabled, expectedRevision };
}
async function readSnapshot(db: Database, userId: string, input: Input): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql).bind(...values(userId, input)).all<Snapshot>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error('Incomplete D1 invitation preference snapshot');
  }
  const row = result.results[0];
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== snapshotFields.length ||
      snapshotFields.some(field => !Object.hasOwn(row, field) || (row[field] !== null &&
        typeof row[field] !== 'string' && (typeof row[field] !== 'number' || !Number.isFinite(row[field]))) ||
        (typeof row[field] === 'string' && Buffer.byteLength(row[field], 'utf8') > SCALAR_BYTES)) ||
      Buffer.byteLength(JSON.stringify(row), 'utf8') > SNAPSHOT_BYTES) {
    throw new Error('Invalid D1 invitation preference scalar snapshot');
  }
  return row;
}
function flag(value: Scalar) {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 invitation preference flag');
}
function count(value: Scalar): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid D1 invitation preference count');
  }
}
function authorize(snapshot: Snapshot, input: Input): { current: Preference; accountEpoch: number | null } {
  // Raw caller IDs are looked up as supplied. No ID regex or Space scope gate.
  if (snapshot.actorExists !== 1) throw new SpaceApiError('Nicht authentifiziert', 401);
  if (snapshot.isUser !== 1) throw new SpaceApiError('Einladung nicht verfügbar', 404);
  flag(snapshot.settingExists);
  const revision = snapshot.settingExists === 0 ? 0 : snapshot.revision;
  if (revision !== input.expectedRevision || (snapshot.settingExists === 1 && snapshot.revisionType !== 'integer')) {
    throw conflict();
  }
  if (snapshot.settingExists === 0) {
    if (snapshot.enabled !== null || snapshot.enabledType !== null || snapshot.revision !== null || snapshot.revisionType !== null) {
      throw new Error('Invalid D1 absent invitation preference');
    }
  } else if (snapshot.enabledType !== 'integer' || (snapshot.enabled !== 0 && snapshot.enabled !== 1)) {
    throw new Error('Invalid D1 invitation preference enabled value');
  }
  const current = { enabled: snapshot.settingExists === 1 && snapshot.enabled === 1, revision: input.expectedRevision };
  // Same-value writes neither consume nor validate account/pending projections.
  // A missing false/0 remains absent; MAX revision is also a valid no-op.
  if (current.enabled === input.enabled) return { current, accountEpoch: null };
  if (current.revision >= MAX_VERSION) throw conflict();
  // Preserve source conflict ordering before lower-priority projection errors.
  count(snapshot.pendingOverflow);
  if (snapshot.pendingOverflow > 0) throw conflict();
  count(snapshot.pendingInvalid);
  if (snapshot.pendingInvalid > 0) throw new Error('Invalid D1 incoming invitation revision');
  flag(snapshot.fits);
  if (snapshot.fits !== 1) throw new Error('D1 invitation preference projection exceeds safe limits');
  count(snapshot.pendingCount);
  count(snapshot.noticeCount);
  if (input.enabled && (snapshot.pendingCount !== 0 || snapshot.pendingOverflow !== 0 || snapshot.pendingInvalid !== 0 || snapshot.noticeCount !== 0)) {
    throw new Error('Unexpected D1 invitation preference enable cleanup');
  }
  if (snapshot.settingExists === 0) {
    if (snapshot.accountEpoch !== null || snapshot.accountEpochType !== null) throw new Error('Invalid D1 absent invitation account epoch');
    return { current, accountEpoch: 0 };
  }
  // The epoch is preserved, not incremented. In particular MAX is permitted.
  if (snapshot.accountEpochType !== 'integer' || typeof snapshot.accountEpoch !== 'number' ||
      !Number.isSafeInteger(snapshot.accountEpoch) || snapshot.accountEpoch < 0 || snapshot.accountEpoch > MAX_VERSION) {
    throw new Error('Invalid D1 invitation preference account epoch');
  }
  return { current, accountEpoch: snapshot.accountEpoch };
}
function sameSnapshot(left: Snapshot, right: Snapshot) {
  return snapshotFields.every(field => left[field] === right[field]);
}
function firstGuard(db: Database, userId: string, input: Input, snapshot: Snapshot) {
  const same = snapshotFields.map((field, index) => `c.${field} IS ?${index + 4}`).join(' AND ');
  return db.prepare(`WITH current AS (${snapshotSql}) SELECT CASE WHEN EXISTS(
      SELECT 1 FROM current c WHERE ${same}) THEN 1
      ELSE json_extract('[]', '${snapshotMarker}') END AS guarded`)
    .bind(...values(userId, input), ...snapshotFields.map(field => snapshot[field]));
}
const pendingSql = "SELECT id FROM SpaceMissionInvitation WHERE recipientId = ?1 AND state = 'PENDING'";
const noticeWhere = `type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION' AND targetId IN (${pendingSql})`;
const afterSettingSql = `EXISTS(SELECT 1 FROM User WHERE id = ?1 AND role = 'USER')
  AND EXISTS(SELECT 1 FROM SpaceMissionInvitationSetting WHERE userId = ?1
    AND enabled IS ?2 AND typeof(enabled) = 'integer'
    AND revision IS ?3 AND typeof(revision) = 'integer'
    AND accountEpoch IS ?4 AND typeof(accountEpoch) = 'integer')`;
function settingGuard(db: Database, userId: string, item: Preference, accountEpoch: number, final: boolean) {
  return db.prepare(`SELECT CASE WHEN changes() = 1 AND ${afterSettingSql}
      THEN 1 ELSE ${invariantFailure} END AS guarded${final ? ', ?2 AS enabled, ?3 AS revision' : ''}`)
    .bind(userId, item.enabled ? 1 : 0, item.revision, accountEpoch);
}
function noticeGuard(db: Database, userId: string, noticeCount: Scalar) {
  // This assertion runs while PENDING rows still identify the exact notices.
  return db.prepare(`SELECT CASE WHEN changes() IS ?2 AND NOT EXISTS(
      SELECT 1 FROM Notification WHERE ${noticeWhere}) THEN 1 ELSE ${invariantFailure} END AS guarded`)
    .bind(userId, noticeCount);
}
function finalDisableGuard(db: Database, userId: string, item: Preference, accountEpoch: number, pendingCount: Scalar) {
  return db.prepare(`SELECT CASE WHEN changes() IS ?5 AND NOT EXISTS(${pendingSql})
      AND ${afterSettingSql} THEN 1 ELSE ${invariantFailure} END AS guarded,
      ?2 AS enabled, ?3 AS revision`)
    .bind(userId, 0, item.revision, accountEpoch, pendingCount);
}

/** Only a qualified SQL rollback from our first snapshot guard or the exact
 * applicable first Setting.userId UNIQUE may replay. All invariant, unrelated
 * constraint and uncertain transport/commit evidence anywhere in the bounded
 * cause chain takes precedence. In particular a successful/malformed response
 * is never rollback evidence, and a later opted-out read cannot prove commit. */
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
  if (details.some(value => /D1_[A-Z0-9_]*INVARIANT|\binvariant\b|foreign[_\s-]*key|not[_\s-]*null|check constraint|primary[_\s-]*key|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|cancel|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|\bRPC\b|\bHTTP\b|\bTLS\b|\bSSL\b|\bDNS\b|disconnect|broken pipe|unexpected token|invalid response|syntax error|no such (?:table|column|function)|datatype mismatch|out of memory/i.test(value))) return null;
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? [])
    .some(marker => marker !== 'D1_ERROR' && marker !== snapshotMarker))) return null;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? [])
    .some(code => !['SQLITE_ERROR', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(code)))) return null;
  if (!details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT(?:_UNIQUE)?)\b/.test(value))) return null;
  const setting = /UNIQUE constraint failed:\s*SpaceMissionInvitationSetting\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i;
  if (details.some(value => /UNIQUE constraint failed/i.test(value))) {
    if (details.some(value => value.includes(snapshotMarker))) return null;
    for (const value of details) {
      if (/UNIQUE constraint failed/i.test(value) &&
          ((value.match(/UNIQUE constraint failed/gi)?.length !== 1) || !setting.test(value))) return null;
      const rest = value.replace(setting, '').replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, '');
      if (/constraint|\bunique\b/i.test(rest)) return null;
    }
    return 'setting-create';
  }
  if (details.some(value => /constraint|\bunique\b/i.test(value))) return null;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b[^\n]*\bD1_SPACE_MISSION_INVITATION_PREFERENCE_SNAPSHOT_CONFLICT\b|\bD1_SPACE_MISSION_INVITATION_PREFERENCE_SNAPSHOT_CONFLICT\b[^\n]*\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) ? 'snapshot' : null;
}
function committedResult(results: Awaited<ReturnType<Database['batch']>>, item: Preference, disabling: boolean) {
  const length = disabling ? 7 : 3;
  const guards = disabling ? [0, 2, 4, 6] : [0, 2];
  if (!Array.isArray(results) || results.length !== length || results.some((result, index) =>
      result.success !== true || !Array.isArray(result.results) || (guards.includes(index)
        ? result.results.length !== 1 || !result.results[0] || typeof result.results[0] !== 'object' ||
          Array.isArray(result.results[0]) || (result.results[0] as { guarded?: unknown }).guarded !== 1 ||
          (index !== length - 1 && Object.keys(result.results[0] as object).length !== 1)
        : result.results.length !== 0))) {
    throw new Error('Missing committed D1 invitation preference result');
  }
  const row = results[length - 1].results[0] as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || !['guarded', 'enabled', 'revision'].every(key => Object.hasOwn(row, key)) ||
      row.enabled !== (item.enabled ? 1 : 0) || row.revision !== item.revision) {
    throw new Error('Unexpected committed D1 invitation preference response');
  }
}

/** Native atomic preference CAS. Same-value is a single entirely read-only
 * snapshot. A toggle is one batch (3 statements enabling, 7 disabling), never
 * a row loop or ID list. Up to four batches and five reads submit <=33 helper
 * statements; the route's existing source-auth bound of two makes <=35. These
 * are source bounds, not a claim about measured D1 billing or execution cost.
 * The largest bind list is the first guard's 3 scope + 14 scalar values = 17.
 * Its expanded SQL is 3238 UTF-8 bytes (preflight 2708); every other statement
 * is <=591 bytes. Only three bounded raw scalars can be projected; even the
 * conservative 3*6*1024 escaped bytes +4096 overhead =22528 fits the 24576 cap.
 * No postcommit read, write replay on unknown outcome, or cleanup success is
 * inferred before every throwing assertion has completed in that same batch. */
export async function setD1InvitationPreference(userId: string, provided: Input): Promise<Preference> {
  const input = stableInput(provided);
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, userId, input);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { current, accountEpoch } = authorize(snapshot, input);
    if (current.enabled === input.enabled) return current;
    if (accountEpoch === null) throw new Error('Missing D1 invitation preference write epoch');
    const item = { enabled: input.enabled, revision: input.expectedRevision + 1 };
    const setting = snapshot.settingExists === 0
      ? db.prepare(`INSERT INTO SpaceMissionInvitationSetting (userId, enabled, revision, accountEpoch)
          VALUES (?1, 1, 1, 0)`).bind(userId)
      : db.prepare(`UPDATE SpaceMissionInvitationSetting SET enabled = ?2, revision = ?4
          WHERE userId = ?1 AND enabled IS ?5 AND typeof(enabled) = 'integer'
            AND revision IS ?3 AND typeof(revision) = 'integer'
            AND accountEpoch IS ?6 AND typeof(accountEpoch) = 'integer'`)
        .bind(userId, input.enabled ? 1 : 0, input.expectedRevision, item.revision, current.enabled ? 1 : 0, accountEpoch);
    const statements = [firstGuard(db, userId, input, snapshot), setting,
      settingGuard(db, userId, item, accountEpoch, input.enabled)];
    if (!input.enabled) statements.push(
      db.prepare(`DELETE FROM Notification WHERE ${noticeWhere}`).bind(userId),
      noticeGuard(db, userId, snapshot.noticeCount),
      db.prepare(`UPDATE SpaceMissionInvitation SET state = 'REVOKED', revision = revision + 1,
          senderId = NULL, createdAt = NULL, expiresAt = NULL, senderEpoch = NULL,
          senderAccessEpoch = NULL, senderAccountEpoch = NULL, recipientAccessEpoch = NULL,
          recipientAccountEpoch = NULL, recipientSettingRevision = NULL, recipientEpoch = NULL
          WHERE recipientId = ?1 AND state = 'PENDING'`).bind(userId),
      finalDisableGuard(db, userId, item, accountEpoch, snapshot.pendingCount));
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind === null || (kind === 'setting-create' && snapshot.settingExists !== 0)) throw error;
      const fresh = await readSnapshot(db, userId, input);
      authorize(fresh, input);
      if (sameSnapshot(snapshot, fresh) || (kind === 'setting-create' && fresh.settingExists !== 1)) throw error;
      if (attempt === 3) throw concurrentConflict();
      snapshot = fresh;
      continue;
    }
    // Decoding is deliberately outside the retry catch, including malformed
    // success results. The native batch already asserted the exact final state.
    committedResult(results, item, !input.enabled);
    return item;
  }
  throw concurrentConflict();
}
