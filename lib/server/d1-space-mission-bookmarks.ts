import 'server-only';

import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import { d1SpaceDatabase } from '@/lib/server/d1-space-reads';
import type { OwnBookmark, parseMissionBookmark } from '@/lib/server/space-mission-bookmarks';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Input = ReturnType<typeof parseMissionBookmark>;
type Scalar = string | number | null;
type Scope = { userId: string; spaceId: string | null; missionId: string | null };
const snapshotFields = ['actorExists', 'authorized', 'accessExists', 'accessEpoch', 'accessEpochType',
  'settingExists', 'settingRevision', 'settingRevisionType', 'fits'] as const;
type Snapshot = Record<(typeof snapshotFields)[number], Scalar>;
type Rollback = 'snapshot' | 'access-create' | 'setting-create' | null;
// Kept local to avoid a runtime cycle through the public bookmark facade.
const MAX_VERSION = 2147483647;
const SCALAR_BYTES = 1024;
const SNAPSHOT_BYTES = 4096;
const snapshotMarker = 'D1_SPACE_MISSION_BOOKMARK_SNAPSHOT_CONFLICT';
const invariantFailure = "json_extract('[]', 'D1_SPACE_MISSION_BOOKMARK_WRITE_INVARIANT')";
const notAuthenticated = () => new SpaceApiError('Nicht authentifiziert', 401);
const notFound = () => new SpaceApiError('Mission nicht gefunden', 404);
const conflict = () => new SpaceApiError('Merker wurde geändert. Bitte neu laden.', 409);
const concurrentConflict = () => new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);

/** A single bounded scalar row; no role/profile, mission text, consent, week or
 * participation projection. An absent row is distinct from a present SQL NULL.
 * savedAt is deliberately not read: every accepted PUT overwrites that value,
 * so a legacy date must not become an additional authorization/version gate. */
const snapshotSql = `WITH bookmark_actor AS (
    SELECT id FROM User WHERE id = ?1
  ), bookmark_scope AS (
    SELECT m.id FROM bookmark_actor a
    JOIN SpaceMember member ON member.userId = a.id AND member.spaceId = ?2
    JOIN Space s ON s.id = member.spaceId AND s.visibility = 'PRIVATE'
    JOIN SpaceMission m ON m.spaceId = s.id AND m.id = ?3 AND m.closedAt IS NULL
  ), bookmark_access AS (
    SELECT epoch FROM SpaceMissionBookmarkAccess WHERE userId = ?1
      AND EXISTS(SELECT 1 FROM bookmark_scope)
  ), bookmark_setting AS (
    SELECT revision FROM SpaceMissionBookmarkSetting WHERE missionId = ?3 AND userId = ?1
      AND EXISTS(SELECT 1 FROM bookmark_scope)
  ), bookmark_budget AS (
    SELECT NOT EXISTS(SELECT 1 FROM bookmark_access WHERE typeof(epoch) NOT IN ('integer', 'real', 'text', 'null')
      OR COALESCE(length(CAST(epoch AS BLOB)), 0) > ${SCALAR_BYTES})
    AND NOT EXISTS(SELECT 1 FROM bookmark_setting WHERE typeof(revision) NOT IN ('integer', 'real', 'text', 'null')
      OR COALESCE(length(CAST(revision AS BLOB)), 0) > ${SCALAR_BYTES}) AS fits
  ) SELECT EXISTS(SELECT 1 FROM bookmark_actor) AS actorExists,
    EXISTS(SELECT 1 FROM bookmark_scope) AS authorized,
    EXISTS(SELECT 1 FROM bookmark_access) AS accessExists,
    CASE WHEN b.fits = 1 THEN (SELECT epoch FROM bookmark_access) END AS accessEpoch,
    (SELECT typeof(epoch) FROM bookmark_access) AS accessEpochType,
    EXISTS(SELECT 1 FROM bookmark_setting) AS settingExists,
    CASE WHEN b.fits = 1 THEN (SELECT revision FROM bookmark_setting) END AS settingRevision,
    (SELECT typeof(revision) FROM bookmark_setting) AS settingRevisionType, b.fits
    FROM bookmark_budget b`;

function values(scope: Scope) {
  return [scope.userId, scope.spaceId, scope.missionId];
}
async function readSnapshot(db: Database, scope: Scope): Promise<Snapshot> {
  const result = await db.prepare(snapshotSql).bind(...values(scope)).all<Snapshot>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error('Incomplete D1 mission bookmark snapshot');
  }
  const row = result.results[0];
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== snapshotFields.length ||
      snapshotFields.some(field => !Object.hasOwn(row, field) || (row[field] !== null &&
        (typeof row[field] !== 'string' && (typeof row[field] !== 'number' || !Number.isFinite(row[field])))) ||
        (typeof row[field] === 'string' && Buffer.byteLength(row[field], 'utf8') > SCALAR_BYTES)) ||
      Buffer.byteLength(JSON.stringify(row), 'utf8') > SNAPSHOT_BYTES) {
    throw new Error('Invalid D1 mission bookmark scalar snapshot');
  }
  return row;
}
function authorizeScope(snapshot: Snapshot) {
  // A deleted/invalid caller is 401 even when its requested mission is absent.
  if (snapshot.actorExists !== 1) throw notAuthenticated();
  // Actual membership is required for ADMIN as well. Only SQL NULL is open.
  if (snapshot.authorized !== 1) throw notFound();
}
function parsedInput(input: Input): Input {
  const keys = ['saved', 'expectedRevision', 'accessEpoch'] as const;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length ||
      keys.some(key => !Object.hasOwn(input, key)) || typeof input.saved !== 'boolean' ||
      ![input.expectedRevision, input.accessEpoch].every(value => typeof value === 'number' &&
        Number.isSafeInteger(value) && value >= 0 && value <= MAX_VERSION)) {
    throw new SpaceApiError('Ungültige Merkerdaten', 400);
  }
  // Copy once: neither caller mutation nor a retry may adjust client versions.
  return { saved: input.saved, expectedRevision: input.expectedRevision, accessEpoch: input.accessEpoch };
}
function authorize(snapshot: Snapshot, input: Input) {
  authorizeScope(snapshot);
  const epoch = snapshot.accessExists === 0 ? 0 : snapshot.accessEpoch;
  if (epoch !== input.accessEpoch || (snapshot.accessExists === 1 && snapshot.accessEpochType !== 'integer')) throw conflict();
  if (input.expectedRevision >= MAX_VERSION || (input.expectedRevision === 0
    ? snapshot.settingExists !== 0
    : snapshot.settingExists !== 1 || snapshot.settingRevisionType !== 'integer' ||
      snapshot.settingRevision !== input.expectedRevision)) throw conflict();
  // Validate all raw bind values before the first mutation. Present NULL,
  // text/real/BLOB revisions, and an existing revision-zero row never mean absent.
  for (const field of ['actorExists', 'authorized', 'accessExists', 'settingExists', 'fits'] as const) {
    if (snapshot[field] !== 0 && snapshot[field] !== 1) throw new Error('Invalid D1 mission bookmark flag');
  }
  if (snapshot.fits !== 1 || (snapshot.accessExists === 0 &&
      (snapshot.accessEpoch !== null || snapshot.accessEpochType !== null)) ||
      (snapshot.settingExists === 0 && (snapshot.settingRevision !== null || snapshot.settingRevisionType !== null))) {
    throw new Error('Invalid D1 mission bookmark raw state');
  }
}
function sameSnapshot(left: Snapshot, right: Snapshot) {
  return snapshotFields.every(field => left[field] === right[field]);
}
function firstGuard(db: Database, scope: Scope, snapshot: Snapshot) {
  const same = snapshotFields.map((field, index) => `c.${field} IS ?${index + 4}`).join(' AND ');
  return db.prepare(`WITH current AS (${snapshotSql}) SELECT CASE WHEN EXISTS(
      SELECT 1 FROM current c WHERE ${same}) THEN 1
      ELSE json_extract('[]', '${snapshotMarker}') END AS guarded`)
    .bind(...values(scope), ...snapshotFields.map(field => snapshot[field]));
}
function changedGuard(db: Database) {
  return db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${invariantFailure} END AS guarded`);
}
/** The actual actor, membership, PRIVATE/open mission, raw integer fence and
 * exact final savedAt/revision are asserted in the write batch before commit.
 * A missing setting still yields one throwing row, never a vacuous zero rows. */
function finalGuard(db: Database, scope: Scope, item: OwnBookmark, savedAt: string | null) {
  return db.prepare(`WITH current AS (${snapshotSql}), final_setting AS (
      SELECT savedAt FROM SpaceMissionBookmarkSetting WHERE missionId = ?3 AND userId = ?1
    ) SELECT CASE WHEN c.actorExists = 1 AND c.authorized = 1 AND c.fits = 1
      AND c.accessExists = 1 AND c.accessEpochType = 'integer' AND c.accessEpoch IS ?4
      AND c.settingExists = 1 AND c.settingRevisionType = 'integer' AND c.settingRevision IS ?5
      AND f.savedAt IS ?6 AND typeof(f.savedAt) = ?7 THEN 1 ELSE ${invariantFailure} END AS guarded,
      CASE WHEN f.savedAt IS NULL THEN 0 ELSE 1 END AS saved,
      c.settingRevision AS revision, c.accessEpoch AS accessEpoch
    FROM current c LEFT JOIN final_setting f ON 1`)
    .bind(...values(scope), item.accessEpoch, item.revision, savedAt, savedAt === null ? 'null' : 'text');
}

/** A SQL error from this atomic D1.batch proves rollback, unlike a transport
 * error or an unsuccessful/malformed result. Inspect the full bounded cause
 * chain first: all invariant/transport/commit/CAS/FK evidence has precedence.
 * Only the named first guard or the exact own first-create UNIQUE can retry. */
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
  // Other guards/codes cannot lend this marker their retry authorization.
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? [])
    .some(marker => marker !== 'D1_ERROR' && marker !== snapshotMarker))) return null;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? [])
    .some(code => !['SQLITE_ERROR', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(code)))) return null;
  const sql = details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT(?:_UNIQUE)?)\b/.test(value));
  if (!sql) return null;
  const access = /UNIQUE constraint failed:\s*SpaceMissionBookmarkAccess\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i;
  const setting = /UNIQUE constraint failed:\s*SpaceMissionBookmarkSetting\.missionId\s*,\s*SpaceMissionBookmarkSetting\.userId(?=\s*(?::\s*SQLITE_CONSTRAINT(?:_UNIQUE)?\b|$))/i;
  const unique = details.filter(value => /UNIQUE constraint failed/i.test(value));
  if (unique.length) {
    let kind: Rollback = null;
    if (details.some(value => value.includes(snapshotMarker))) return null;
    for (const value of details) {
      const candidate = access.test(value) ? 'access-create' : setting.test(value) ? 'setting-create' : null;
      if (/UNIQUE constraint failed/i.test(value)) {
        if ((value.match(/UNIQUE constraint failed/gi)?.length !== 1) || candidate === null || (kind !== null && candidate !== kind)) return null;
        kind = candidate;
      }
      const rest = value.replace(access, '').replace(setting, '').replace(/\bSQLITE_CONSTRAINT(?:_UNIQUE)?\b/g, '');
      if (/constraint|\bunique\b/i.test(rest)) return null;
    }
    return kind;
  }
  if (details.some(value => /constraint|\bunique\b/i.test(value))) return null;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b[^\n]*\bD1_SPACE_MISSION_BOOKMARK_SNAPSHOT_CONFLICT\b|\bD1_SPACE_MISSION_BOOKMARK_SNAPSHOT_CONFLICT\b[^\n]*\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) ? 'snapshot' : null;
}

/** Native atomic desired-set PUT. Every accepted call increments revision,
 * including an identical saved value; false writes a NULL tombstone. Access
 * epochs may equal MAX_VERSION here because PUT never increments that fence.
 * Four six-statement batches plus at most five reads submit <=29 statements.
 * There is no postcommit read and no replay after any uncertain commit. */
export async function setD1MissionBookmark(spaceId: string, missionId: string, userId: string, provided: Input): Promise<OwnBookmark> {
  if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId)) throw notAuthenticated();
  // Keep live-account error ordering even for malformed mission/Space IDs.
  const scope: Scope = { userId,
    spaceId: typeof spaceId === 'string' && SPACE_ID_RE.test(spaceId) ? spaceId : null,
    missionId: typeof missionId === 'string' && SPACE_ID_RE.test(missionId) ? missionId : null };
  const db = d1SpaceDatabase();
  let snapshot = await readSnapshot(db, scope);
  authorizeScope(snapshot);
  const input = parsedInput(provided);
  const savedAt = input.saved ? new Date().toISOString().replace(/Z$/, '+00:00') : null;
  const item: OwnBookmark = { saved: input.saved, revision: input.expectedRevision + 1, accessEpoch: input.accessEpoch };
  if (Buffer.byteLength(JSON.stringify(item), 'utf8') > 128) throw new Error('Oversized D1 mission bookmark response');
  for (let attempt = 0; attempt < 4; attempt++) {
    authorize(snapshot, input);
    const access = snapshot.accessExists === 0
      ? db.prepare('INSERT INTO SpaceMissionBookmarkAccess (userId, epoch) VALUES (?1, 0)').bind(userId)
      : db.prepare(`UPDATE SpaceMissionBookmarkAccess SET epoch = ?2
          WHERE userId = ?1 AND epoch = ?2 AND typeof(epoch) = 'integer'`).bind(userId, input.accessEpoch);
    const setting = input.expectedRevision === 0
      ? db.prepare(`INSERT INTO SpaceMissionBookmarkSetting (missionId, userId, savedAt, revision)
          VALUES (?1, ?2, ?3, 1)`).bind(missionId, userId, savedAt)
      : db.prepare(`UPDATE SpaceMissionBookmarkSetting SET savedAt = ?3, revision = ?4
          WHERE missionId = ?1 AND userId = ?2 AND revision = ?5 AND typeof(revision) = 'integer'`)
        .bind(missionId, userId, savedAt, item.revision, input.expectedRevision);
    const statements = [firstGuard(db, scope, snapshot), access, changedGuard(db), setting,
      changedGuard(db), finalGuard(db, scope, item, savedAt)];
    let results: Awaited<ReturnType<Database['batch']>>;
    try { results = await db.batch(statements); }
    catch (error) {
      const kind = rollbackKind(error);
      if (kind === null || (kind === 'access-create' && snapshot.accessExists !== 0) ||
          (kind === 'setting-create' && (input.expectedRevision !== 0 || snapshot.settingExists !== 0))) throw error;
      const fresh = await readSnapshot(db, scope);
      authorize(fresh, input);
      // A same-state error is infrastructure failure, even for exact UNIQUE.
      // Another mission can materialize Access(0) while these versions remain
      // valid. An own-setting race instead becomes the normal stale 409 above.
      if (sameSnapshot(snapshot, fresh)) throw error;
      if (kind === 'access-create' && fresh.accessExists !== 1) throw error;
      if (kind === 'setting-create' && fresh.settingExists !== 1) throw error;
      if (attempt === 3) throw kind === 'snapshot' ? concurrentConflict() : conflict();
      snapshot = fresh;
      continue;
    }
    // Deliberately outside catch: malformed/success/unknown-commit outcomes
    // never submit another write. SQL already asserted all state precommit.
    if (!Array.isArray(results) || results.length !== 6 || results.some(result => result.success !== true ||
        !Array.isArray(result.results)) || results[1].results.length !== 0 || results[3].results.length !== 0 ||
        [0, 2, 4].some(index => results[index].results.length !== 1 ||
          !results[index].results[0] || typeof results[index].results[0] !== 'object' ||
          Object.keys(results[index].results[0] as object).length !== 1 ||
          (results[index].results[0] as { guarded?: unknown }).guarded !== 1)) {
      throw new Error('Missing committed D1 mission bookmark result');
    }
    const row = results[5].results[0] as Record<string, unknown> | undefined;
    if (results[5].results.length !== 1 || !row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).length !== 4 || !['guarded', 'saved', 'revision', 'accessEpoch'].every(key => Object.hasOwn(row, key)) ||
        row.guarded !== 1 || row.saved !== (item.saved ? 1 : 0) || row.revision !== item.revision || row.accessEpoch !== item.accessEpoch) {
      throw new Error('Unexpected committed D1 mission bookmark response');
    }
    return item;
  }
  throw concurrentConflict();
}
