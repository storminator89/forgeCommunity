import 'server-only';

import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import { d1SpaceDatabase } from '@/lib/server/d1-space-reads';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Statement = ReturnType<Database['prepare']>;
type Scalar = string | number | null;
type Scope = { actorId: string; spaceId: string; userId: string };
type Added = { spaceId: string; userId: string; alreadyMember: boolean };
type Removed = { spaceId: string; userId: string; removed: true };
type Rollback = 'snapshot' | 'member-create' | 'invitation-create' | 'bookmark-create' | null;
const MAX_VERSION = 2147483647;
const SCALAR_BYTES = 1024;
const SNAPSHOT_BYTES = 24576;
const snapshotMarker = 'D1_SPACE_PRIVATE_MEMBERS_SNAPSHOT_CONFLICT';
const invariantFailure = "json_extract('[]', 'D1_SPACE_PRIVATE_MEMBERS_WRITE_INVARIANT')";
const concurrentConflict = () => new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
const invitationConflict = () => new SpaceApiError('Einladung wurde geändert. Bitte neu laden.', 409);
const bookmarkConflict = () => new SpaceApiError('Merker wurde geändert. Bitte neu laden.', 409);
const addFields = ['isAdmin', 'scopeExists', 'targetExists', 'memberExists'] as const;
const removeFields = ['isAdmin', 'scopeExists', 'targetExists', 'memberExists', 'openCount', 'openId',
  'invitationExists', 'invitationEpoch', 'invitationType', 'pendingCount', 'pendingOverflow', 'pendingInvalid',
  'noticeCount', 'bookmarkExists', 'bookmarkEpoch', 'bookmarkType', 'bookmarkCount', 'activeParticipationCount', 'fits'] as const;
type AddSnapshot = Record<(typeof addFields)[number], Scalar>;
type RemoveSnapshot = Record<(typeof removeFields)[number], Scalar>;

// ADMIN is read from the current stored account, independently of membership.
// Every lower-priority value is scoped behind ADMIN and a PRIVATE Space.
const scopeCtes = `member_actor AS (SELECT id FROM User WHERE id = ?1 AND role = 'ADMIN'),
  member_scope AS (SELECT id FROM Space WHERE id = ?2 AND visibility = 'PRIVATE'
    AND EXISTS(SELECT 1 FROM member_actor)),
  member_target AS (SELECT id FROM User WHERE id = ?3 AND EXISTS(SELECT 1 FROM member_scope))`;

const addSnapshotSql = `WITH ${scopeCtes},
  member_membership AS (SELECT 1 FROM SpaceMember WHERE spaceId = ?2 AND userId = ?3
    AND EXISTS(SELECT 1 FROM member_scope))
  SELECT EXISTS(SELECT 1 FROM member_actor) AS isAdmin,
    EXISTS(SELECT 1 FROM member_scope) AS scopeExists, EXISTS(SELECT 1 FROM member_target) AS targetExists,
    EXISTS(SELECT 1 FROM member_membership) AS memberExists`;

/** One scalar row. Counts bound transport, never the cleanup set. A missing
 * target deliberately skips the open-mission lookup and both access fences,
 * matching the source helpers' early return. A living target with >1 open
 * missions fails closed; no arbitrary mission is selected, even without the
 * provider migration's one-open partial index. SQL NULL alone means open. */
const removeSnapshotSql = `WITH ${scopeCtes},
  member_membership AS (SELECT 1 FROM SpaceMember WHERE spaceId = ?2 AND userId = ?3
    AND EXISTS(SELECT 1 FROM member_scope)),
  member_open AS (SELECT id FROM SpaceMission WHERE spaceId = ?2 AND closedAt IS NULL
    AND EXISTS(SELECT 1 FROM member_target)),
  member_one_open AS (SELECT id FROM member_open WHERE (SELECT COUNT(*) FROM member_open) = 1),
  member_invitation_access AS (SELECT epoch FROM SpaceMissionInvitationAccess WHERE userId = ?3
    AND missionId = (SELECT id FROM member_one_open)),
  member_pending AS (SELECT id, revision FROM SpaceMissionInvitation
    WHERE missionId = (SELECT id FROM member_one_open) AND state = 'PENDING' AND (senderId = ?3 OR recipientId = ?3)),
  member_bookmark_access AS (SELECT epoch FROM SpaceMissionBookmarkAccess WHERE userId = ?3
    AND EXISTS(SELECT 1 FROM member_target)),
  member_budget AS (
    SELECT NOT EXISTS(SELECT 1 FROM member_one_open WHERE typeof(id) <> 'text'
      OR length(CAST(id AS BLOB)) > ${SCALAR_BYTES})
    AND NOT EXISTS(SELECT 1 FROM member_invitation_access WHERE typeof(epoch) NOT IN ('integer','real','text','null')
      OR COALESCE(length(CAST(epoch AS BLOB)), 0) > ${SCALAR_BYTES})
    AND NOT EXISTS(SELECT 1 FROM member_bookmark_access WHERE typeof(epoch) NOT IN ('integer','real','text','null')
      OR COALESCE(length(CAST(epoch AS BLOB)), 0) > ${SCALAR_BYTES}) AS fits
  ) SELECT EXISTS(SELECT 1 FROM member_actor) AS isAdmin,
    EXISTS(SELECT 1 FROM member_scope) AS scopeExists, EXISTS(SELECT 1 FROM member_target) AS targetExists,
    EXISTS(SELECT 1 FROM member_membership) AS memberExists, (SELECT COUNT(*) FROM member_open) AS openCount,
    CASE WHEN b.fits = 1 THEN (SELECT id FROM member_one_open) END AS openId,
    EXISTS(SELECT 1 FROM member_invitation_access) AS invitationExists,
    CASE WHEN NOT EXISTS(SELECT 1 FROM member_invitation_access WHERE typeof(epoch) NOT IN ('integer','real','text','null')
      OR COALESCE(length(CAST(epoch AS BLOB)), 0) > ${SCALAR_BYTES})
      THEN (SELECT epoch FROM member_invitation_access) END AS invitationEpoch,
    (SELECT typeof(epoch) FROM member_invitation_access) AS invitationType,
    (SELECT COUNT(*) FROM member_pending) AS pendingCount,
    (SELECT COUNT(*) FROM member_pending WHERE typeof(revision) IN ('integer','real') AND revision >= ${MAX_VERSION}) AS pendingOverflow,
    (SELECT COUNT(*) FROM member_pending WHERE typeof(revision) <> 'integer' OR revision < 0) AS pendingInvalid,
    (SELECT COUNT(*) FROM Notification WHERE type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
      AND targetId IN (SELECT id FROM member_pending)) AS noticeCount,
    EXISTS(SELECT 1 FROM member_bookmark_access) AS bookmarkExists,
    CASE WHEN NOT EXISTS(SELECT 1 FROM member_bookmark_access WHERE typeof(epoch) NOT IN ('integer','real','text','null')
      OR COALESCE(length(CAST(epoch AS BLOB)), 0) > ${SCALAR_BYTES})
      THEN (SELECT epoch FROM member_bookmark_access) END AS bookmarkEpoch,
    (SELECT typeof(epoch) FROM member_bookmark_access) AS bookmarkType,
    (SELECT COUNT(*) FROM SpaceMissionBookmarkSetting WHERE userId = ?3
      AND missionId IN (SELECT id FROM SpaceMission WHERE spaceId = (SELECT id FROM member_scope))) AS bookmarkCount,
    (SELECT COUNT(*) FROM SpaceMissionParticipation WHERE userId = ?3 AND optedOutAt IS NULL
      AND missionId IN (SELECT id FROM SpaceMission WHERE spaceId = (SELECT id FROM member_scope))) AS activeParticipationCount,
    b.fits FROM member_budget b`;

function values(scope: Scope) { return [scope.actorId, scope.spaceId, scope.userId]; }
function integer(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid D1 private member integer');
  }
}
function flag(value: unknown) {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 private member flag');
}
async function readAddSnapshot(db: Database, scope: Scope): Promise<AddSnapshot> {
  const result = await db.prepare(addSnapshotSql).bind(...values(scope)).all<AddSnapshot>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error('Incomplete D1 private member ADD snapshot');
  }
  const row = result.results[0];
  validateRow(row, addFields);
  return row;
}
async function readRemoveSnapshot(db: Database, scope: Scope): Promise<RemoveSnapshot> {
  const result = await db.prepare(removeSnapshotSql).bind(...values(scope)).all<RemoveSnapshot>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error('Incomplete D1 private member REMOVE snapshot');
  }
  const row = result.results[0];
  validateRow(row, removeFields);
  return row;
}
function validateRow(row: Record<string, Scalar>, fields: readonly string[]) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== fields.length ||
      fields.some(field => !Object.hasOwn(row, field) || (row[field] !== null && typeof row[field] !== 'string' &&
        (typeof row[field] !== 'number' || !Number.isFinite(row[field]))) ||
        (typeof row[field] === 'string' && Buffer.byteLength(row[field], 'utf8') > SCALAR_BYTES)) ||
      Buffer.byteLength(JSON.stringify(row), 'utf8') > SNAPSHOT_BYTES) {
    throw new Error('Invalid D1 private member scalar snapshot');
  }
}
function authorizeScope(snapshot: AddSnapshot | RemoveSnapshot, scope: Scope) {
  // Preserve the POST/DELETE source precedence, including a deleted actor.
  if (snapshot.isAdmin !== 1) throw new SpaceApiError('Nicht autorisiert', 403);
  if (!SPACE_ID_RE.test(scope.actorId) || snapshot.scopeExists !== 1) throw new SpaceApiError('Space nicht gefunden', 404);
}
function authorizeAdd(snapshot: AddSnapshot, scope: Scope) {
  authorizeScope(snapshot, scope);
  if (snapshot.targetExists !== 1) throw new SpaceApiError('Mitglied nicht gefunden', 404);
  for (const key of addFields) flag(snapshot[key]);
}
function accessEpoch(exists: Scalar, epoch: Scalar, type: Scalar, invitation: boolean) {
  flag(exists);
  if (exists === 0) {
    if (epoch !== null || type !== null) throw new Error('Invalid D1 private member absent fence');
    return 0;
  }
  if ((type === 'integer' || type === 'real') && typeof epoch === 'number' && epoch >= MAX_VERSION) {
    throw invitation ? invitationConflict() : bookmarkConflict();
  }
  if (type !== 'integer') throw new Error('Invalid D1 private member fence type');
  integer(epoch);
  return epoch;
}
function authorizeRemove(snapshot: RemoveSnapshot, scope: Scope) {
  authorizeScope(snapshot, scope);
  for (const key of ['isAdmin', 'scopeExists', 'targetExists', 'memberExists'] as const) flag(snapshot[key]);
  integer(snapshot.openCount);
  if (snapshot.openCount > 1) throw new Error('Ambiguous D1 private member open mission');
  // Full, pre-mutation overflow order: invitation access, pending revisions,
  // then the global bookmark access. Corrupt versions never become absent 0.
  const invitationEpoch = accessEpoch(snapshot.invitationExists, snapshot.invitationEpoch, snapshot.invitationType, true);
  integer(snapshot.pendingOverflow);
  if (snapshot.pendingOverflow > 0) throw invitationConflict();
  integer(snapshot.pendingInvalid);
  if (snapshot.pendingInvalid > 0) throw new Error('Invalid D1 private member pending revision');
  const bookmarkEpoch = accessEpoch(snapshot.bookmarkExists, snapshot.bookmarkEpoch, snapshot.bookmarkType, false);
  for (const key of ['pendingCount', 'noticeCount', 'bookmarkCount', 'activeParticipationCount'] as const) integer(snapshot[key]);
  flag(snapshot.fits);
  if (snapshot.fits !== 1 || (snapshot.openCount === 0 ? snapshot.openId !== null :
      typeof snapshot.openId !== 'string' || snapshot.openId.length === 0) ||
      (snapshot.targetExists === 0 && (snapshot.openCount !== 0 || snapshot.bookmarkExists !== 0)) ||
      (snapshot.openCount === 0 && (snapshot.invitationExists !== 0 || snapshot.pendingCount !== 0 || snapshot.noticeCount !== 0))) {
    throw new Error('Invalid D1 private member REMOVE raw state');
  }
  return { invitationEpoch, bookmarkEpoch };
}
function addGuard(db: Database, scope: Scope, snapshot: AddSnapshot, final = false, createdAt: string | null = null) {
  const same = addFields.map((key, index) => `c.${key} IS ?${index + 4}`).join(' AND ');
  // Existing membership is wholly write-free. Its joinedAt is neither read nor
  // validated: even legacy values must not add a new barrier to the source 200.
  // Only a newly inserted pair needs the exact new timestamp postcondition.
  const inserted = createdAt === null ? '' : ` AND EXISTS(SELECT 1 FROM SpaceMember
    WHERE spaceId = ?2 AND userId = ?3 AND joinedAt IS ?8 AND typeof(joinedAt) = 'text')`;
  return db.prepare(`WITH current AS (${addSnapshotSql}) SELECT CASE WHEN EXISTS(
      SELECT 1 FROM current c WHERE ${same})${inserted} THEN 1
      ELSE ${final ? invariantFailure : `json_extract('[]', '${snapshotMarker}')`} END AS guarded`)
    .bind(...values(scope), ...addFields.map(key => snapshot[key]), ...(createdAt === null ? [] : [createdAt]));
}
function removeGuard(db: Database, scope: Scope, snapshot: RemoveSnapshot, final = false) {
  const same = removeFields.map((key, index) => `c.${key} IS ?${index + 4}`).join(' AND ');
  return db.prepare(`WITH current AS (${removeSnapshotSql}) SELECT CASE WHEN EXISTS(
      SELECT 1 FROM current c WHERE ${same}) THEN 1
      ELSE ${final ? invariantFailure : `json_extract('[]', '${snapshotMarker}')`} END AS guarded`)
    .bind(...values(scope), ...removeFields.map(key => snapshot[key]));
}
function changedGuard(db: Database) {
  return db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`);
}
function sameSnapshot<T extends AddSnapshot | RemoveSnapshot>(left: T, right: T, fields: readonly (keyof T)[]) {
  return fields.every(field => left[field] === right[field]);
}

/** Only a qualified SQL rollback from our first guard, or an applicable exact
 * first-create UNIQUE, may replay. Inspect the whole bounded cause chain first:
 * CAS/end invariants, arbitrary constraints and any uncertain commit/transport
 * evidence take precedence over a nested marker. Never infer DELETE success
 * from a later read: an ordinary repeated DELETE must advance its fences again. */
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
  const member = /UNIQUE constraint failed:\s*SpaceMember\.spaceId\s*,\s*SpaceMember\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i;
  const invitation = /UNIQUE constraint failed:\s*SpaceMissionInvitationAccess\.missionId\s*,\s*SpaceMissionInvitationAccess\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i;
  const bookmark = /UNIQUE constraint failed:\s*SpaceMissionBookmarkAccess\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i;
  if (details.some(value => /UNIQUE constraint failed/i.test(value))) {
    let kind: Rollback = null;
    if (details.some(value => value.includes(snapshotMarker))) return null;
    for (const value of details) {
      const candidate = member.test(value) ? 'member-create' : invitation.test(value) ? 'invitation-create' :
        bookmark.test(value) ? 'bookmark-create' : null;
      if (/UNIQUE constraint failed/i.test(value)) {
        if ((value.match(/UNIQUE constraint failed/gi)?.length !== 1) || candidate === null || (kind !== null && candidate !== kind)) return null;
        kind = candidate;
      }
      const rest = value.replace(member, '').replace(invitation, '').replace(bookmark, '').replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, '');
      if (/constraint|\bunique\b/i.test(rest)) return null;
    }
    return kind;
  }
  if (details.some(value => /constraint|\bunique\b/i.test(value))) return null;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b[^\n]*\bD1_SPACE_PRIVATE_MEMBERS_SNAPSHOT_CONFLICT\b|\bD1_SPACE_PRIVATE_MEMBERS_SNAPSHOT_CONFLICT\b[^\n]*\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) ? 'snapshot' : null;
}
function committedGuards(results: Awaited<ReturnType<Database['batch']>>, count: number, guards: readonly number[]) {
  // Outside every retry catch: a malformed/success result is never rollback
  // evidence. Every assertion has already executed before the native commit.
  if (!Array.isArray(results) || results.length !== count || results.some((result, index) =>
      result.success !== true || !Array.isArray(result.results) || (guards.includes(index)
        ? result.results.length !== 1 || !result.results[0] || typeof result.results[0] !== 'object' ||
          Array.isArray(result.results[0]) || Object.keys(result.results[0] as object).length !== 1 ||
          (result.results[0] as { guarded?: unknown }).guarded !== 1
        : result.results.length !== 0))) {
    throw new Error('Missing committed D1 private member result');
  }
}

/** Existing membership is a guarded, entirely write-free 200. Creation alone
 * writes the pair with one stable server timestamp; no revocation fence or
 * tombstone is reset on re-add. At most four batches of four statements plus
 * initial/four fresh reads submit <=21 helper statements. */
export async function addD1PrivateSpaceMember(actorId: string, spaceId: string, userId: string): Promise<Added> {
  const db = d1SpaceDatabase(), scope = { actorId, spaceId, userId };
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  let snapshot = await readAddSnapshot(db, scope);
  for (let attempt = 0; attempt < 4; attempt++) {
    authorizeAdd(snapshot, scope);
    const existing = snapshot.memberExists === 1;
    const after: AddSnapshot = { ...snapshot, memberExists: 1 };
    const statements = [addGuard(db, scope, snapshot)];
    if (!existing) statements.push(db.prepare(`INSERT INTO SpaceMember (spaceId, userId, joinedAt) VALUES (?1, ?2, ?3)`)
      .bind(spaceId, userId, now), changedGuard(db));
    statements.push(addGuard(db, scope, after, true, existing ? null : now));
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind !== 'snapshot' && !(kind === 'member-create' && !existing)) throw error;
      const fresh = await readAddSnapshot(db, scope);
      authorizeAdd(fresh, scope);
      if (sameSnapshot(snapshot, fresh, addFields) || (kind === 'member-create' && fresh.memberExists !== 1)) throw error;
      if (attempt === 3) throw concurrentConflict();
      snapshot = fresh;
      continue;
    }
    committedGuards(results, statements.length, existing ? [0, 1] : [0, 2, 3]);
    return { spaceId, userId, alreadyMember: existing };
  }
  throw concurrentConflict();
}

const pendingPredicate = `missionId = ?1 AND state = 'PENDING' AND (senderId = ?2 OR recipientId = ?2)`;
const noticesPredicate = `type = 'SYSTEM' AND targetType = 'SPACE_MISSION_INVITATION'
  AND targetId IN (SELECT id FROM SpaceMissionInvitation WHERE ${pendingPredicate})`;

/** Native atomic member revocation, including living nonmembers and repeated
 * DELETEs. All affected pending invitations/settings/participations are handled
 * set-wise, with no quota LIMIT, ID transport, iteration or commit chunks.
 * Counts are decision facts, not identity fingerprints: native transaction
 * serialization and the no-remainder assertions cover the entire current set.
 * Three batches of <=13 statements + initial/three fresh reads submit <=43
 * helper statements. This excludes pre-helper authentication and makes no
 * claim about provider cost/runtime: an oversized cleanup can time out and
 * must fail closed. A known exhausted rollback maps to the existing generic
 * concurrent-change 409; uncertain outcomes are never retried. */
export async function removeD1PrivateSpaceMember(actorId: string, spaceId: string, userId: string): Promise<Removed> {
  const db = d1SpaceDatabase(), scope = { actorId, spaceId, userId };
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  let snapshot = await readRemoveSnapshot(db, scope);
  for (let attempt = 0; attempt < 3; attempt++) {
    const epochs = authorizeRemove(snapshot, scope);
    // Copy the guarded mission identity before creating statements; the final
    // guard verifies that it is still the sole open mission before commit.
    const openId = snapshot.openId as string | null;
    const invitation = snapshot.targetExists === 1 && snapshot.openCount === 1;
    const bookmark = snapshot.targetExists === 1;
    const after: RemoveSnapshot = { ...snapshot, memberExists: 0, pendingCount: 0, pendingOverflow: 0, pendingInvalid: 0,
      noticeCount: 0, bookmarkCount: bookmark ? 0 : snapshot.bookmarkCount, activeParticipationCount: 0,
      ...(invitation ? { invitationExists: 1, invitationEpoch: epochs.invitationEpoch + 1, invitationType: 'integer' } : {}),
      ...(bookmark ? { bookmarkExists: 1, bookmarkEpoch: epochs.bookmarkEpoch + 1, bookmarkType: 'integer' } : {}) };
    const statements: Statement[] = [removeGuard(db, scope, snapshot)];
    const guards = [0];
    if (invitation) {
      statements.push(snapshot.invitationExists === 0
        ? db.prepare(`INSERT INTO SpaceMissionInvitationAccess (missionId, userId, epoch) VALUES (?1, ?2, 1)`).bind(openId, userId)
        : db.prepare(`UPDATE SpaceMissionInvitationAccess SET epoch = ?3
            WHERE missionId = ?1 AND userId = ?2 AND epoch = ?4 AND typeof(epoch) = 'integer'`)
          .bind(openId, userId, epochs.invitationEpoch + 1, epochs.invitationEpoch), changedGuard(db));
      guards.push(statements.length - 1);
      statements.push(db.prepare(`DELETE FROM Notification WHERE ${noticesPredicate}`).bind(openId, userId));
      // Source IDs and sender identity still exist here. No recipient/userId,
      // isRead, expiry, eligibility or normal invitation-cap filter is applied.
      statements.push(db.prepare(`SELECT CASE WHEN changes() = ?3 AND NOT EXISTS(
          SELECT 1 FROM Notification WHERE ${noticesPredicate}) THEN 1 ELSE ${invariantFailure} END AS guarded`)
        .bind(openId, userId, snapshot.noticeCount));
      guards.push(statements.length - 1);
      statements.push(db.prepare(`UPDATE SpaceMissionInvitation SET state = 'REVOKED', revision = revision + 1,
          senderId = NULL, createdAt = NULL, expiresAt = NULL, senderEpoch = NULL, senderAccessEpoch = NULL,
          senderAccountEpoch = NULL, recipientAccessEpoch = NULL, recipientAccountEpoch = NULL,
          recipientSettingRevision = NULL, recipientEpoch = NULL WHERE ${pendingPredicate}`).bind(openId, userId));
      statements.push(db.prepare(`SELECT CASE WHEN changes() = ?3 AND NOT EXISTS(
          SELECT 1 FROM SpaceMissionInvitation WHERE ${pendingPredicate}) THEN 1 ELSE ${invariantFailure} END AS guarded`)
        .bind(openId, userId, snapshot.pendingCount));
      guards.push(statements.length - 1);
    }
    if (bookmark) {
      statements.push(snapshot.bookmarkExists === 0
        ? db.prepare(`INSERT INTO SpaceMissionBookmarkAccess (userId, epoch) VALUES (?1, 1)`).bind(userId)
        : db.prepare(`UPDATE SpaceMissionBookmarkAccess SET epoch = ?2
            WHERE userId = ?1 AND epoch = ?3 AND typeof(epoch) = 'integer'`)
          .bind(userId, epochs.bookmarkEpoch + 1, epochs.bookmarkEpoch), changedGuard(db));
      guards.push(statements.length - 1);
      // Include closed missions and saved-false tombstones. The source returns
      // before bookmark cleanup for a missing account, preserving even orphans.
      statements.push(db.prepare(`DELETE FROM SpaceMissionBookmarkSetting WHERE userId = ?2
          AND missionId IN (SELECT id FROM SpaceMission WHERE spaceId = ?1)`).bind(spaceId, userId));
    }
    // Every optedOutAt that is already non-NULL, including numeric zero, stays
    // unchanged; epochs/joinedAt and contribution content are never written.
    statements.push(db.prepare(`UPDATE SpaceMissionParticipation SET optedOutAt = ?3 WHERE userId = ?2 AND optedOutAt IS NULL
        AND missionId IN (SELECT id FROM SpaceMission WHERE spaceId = ?1)`).bind(spaceId, userId, now));
    statements.push(db.prepare(`DELETE FROM SpaceMember WHERE spaceId = ?1 AND userId = ?2`).bind(spaceId, userId));
    statements.push(removeGuard(db, scope, after, true));
    guards.push(statements.length - 1);
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind !== 'snapshot' && !(kind === 'invitation-create' && invitation && snapshot.invitationExists === 0) &&
          !(kind === 'bookmark-create' && bookmark && snapshot.bookmarkExists === 0)) throw error;
      const fresh = await readRemoveSnapshot(db, scope);
      authorizeRemove(fresh, scope);
      if (sameSnapshot(snapshot, fresh, removeFields) ||
          (kind === 'invitation-create' && (fresh.openId !== openId || fresh.invitationExists !== 1)) ||
          (kind === 'bookmark-create' && fresh.bookmarkExists !== 1)) throw error;
      if (attempt === 2) throw concurrentConflict();
      snapshot = fresh;
      continue;
    }
    committedGuards(results, statements.length, guards);
    return { spaceId, userId, removed: true };
  }
  throw concurrentConflict();
}
