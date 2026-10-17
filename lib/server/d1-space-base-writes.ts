import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SpaceSummary } from '@/lib/server/space-access';
import { parseSpaceInput, SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import { d1BoundedResponse, d1Date, d1ProjectionBudgetCtes, d1SpaceDatabase,
  d1TextBytes, type D1StoredDate } from '@/lib/server/d1-space-reads';

type Database = ReturnType<typeof d1SpaceDatabase>;
type Metadata = {
  id: string; name: string; description: string; visibility: SpaceSummary['visibility'];
  createdAt: D1StoredDate; updatedAt: D1StoredDate;
};
type Snapshot = Metadata & { actorExists: number; canManage: number; spaceExists: number; fits: number };
type SummaryRow = Metadata & {
  guarded: number; memberCount: number; discussionCount: number; isMember: number; canManage: number;
};
type Prepared = { raw: Metadata; isoCreatedAt: string; isoUpdatedAt: string };

const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const metadataFields = ['id', 'name', 'description', 'visibility', 'createdAt', 'updatedAt'] as const;
const snapshotFields = ['actorExists', 'canManage', 'spaceExists', 'fits', ...metadataFields] as const;
const publicSnapshotSql = `WITH actor AS (
    SELECT "id", "role" FROM "User" WHERE "id" = ?1
  ), readable AS (
    SELECT s."id", s."name", s."description", s."visibility", s."createdAt", s."updatedAt"
    FROM actor a JOIN "Space" s ON s."id" = ?2 WHERE s."visibility" = 'PUBLIC'
  ), ${d1ProjectionBudgetCtes(`SELECT ${d1TextBytes(...metadataFields.map(field => `s."${field}"`))} AS bytes FROM readable s`)}
  SELECT EXISTS(SELECT 1 FROM actor) AS actorExists,
    EXISTS(SELECT 1 FROM actor WHERE "role" = 'ADMIN') AS canManage,
    EXISTS(SELECT 1 FROM readable) AS spaceExists, b.fits,
    ${metadataFields.map(field => `CASE WHEN b.fits = 1 THEN s."${field}" ELSE NULL END AS "${field}"`).join(', ')}
  FROM (SELECT 1) seed LEFT JOIN readable s ON 1 CROSS JOIN projection_budget b`;

async function readPublicSnapshot(db: Database, userId: string, spaceId: string) {
  const row = await db.prepare(publicSnapshotSql).bind(userId, spaceId).first<Snapshot>();
  if (!row) throw new Error('Missing D1 Space membership snapshot');
  return row;
}

function prepareMetadata(raw: Metadata): Prepared {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.description !== 'string' ||
      (raw.visibility !== 'PUBLIC' && raw.visibility !== 'PRIVATE')) throw new Error('Invalid D1 Space metadata');
  if ((typeof raw.createdAt !== 'string' && typeof raw.createdAt !== 'number') ||
      (typeof raw.updatedAt !== 'string' && typeof raw.updatedAt !== 'number')) throw new Error('Invalid D1 Space dates');
  const isoCreatedAt = d1Date(raw.createdAt).toISOString();
  const isoUpdatedAt = d1Date(raw.updatedAt).toISOString();
  // Prove the complete response fits BEFORE any mutation. Final SQL bounds both
  // fresh counts to safe integers; false is the longest boolean serialization.
  d1BoundedResponse({ id: raw.id, name: raw.name, description: raw.description, visibility: raw.visibility,
    createdAt: isoCreatedAt, updatedAt: isoUpdatedAt, memberCount: MAX_COUNT, discussionCount: MAX_COUNT,
    isMember: false, canManage: false, canWrite: false });
  return { raw, isoCreatedAt, isoUpdatedAt };
}

function validatePublicSnapshot(snapshot: Snapshot) {
  if (snapshot.actorExists !== 1 || snapshot.spaceExists !== 1) throw new SpaceApiError('Space nicht gefunden', 404);
  if (snapshot.fits !== 1) throw new Error('D1 Space membership projection exceeds safe byte limits');
  if (snapshot.visibility !== 'PUBLIC' || (snapshot.canManage !== 0 && snapshot.canManage !== 1)) {
    throw new Error('Invalid D1 Space membership authority');
  }
  return prepareMetadata(snapshot);
}

function publicSnapshotGuard(db: Database, userId: string, spaceId: string, snapshot: Snapshot) {
  // Raw stored values, not ISO-normalized dates, are the equality readset.
  const same = snapshotFields.map((field, index) => `s."${field}" IS ?${index + 3}`).join(' AND ');
  return db.prepare(`WITH state AS (${publicSnapshotSql}) SELECT CASE WHEN EXISTS
    (SELECT 1 FROM state s WHERE ${same}) THEN 1
    ELSE json('D1_SPACE_BASE_SNAPSHOT_CONFLICT') END AS guarded`)
    .bind(userId, spaceId, ...snapshotFields.map(field => snapshot[field]));
}

/** The final response row and all mutation postconditions are evaluated BEFORE
 * the same native batch commits. A zero-row/malformed final state throws SQL,
 * rather than leaving a committed write followed by a JS projection failure. */
function finalSummary(db: Database, userId: string, prepared: Prepared, joined: boolean, admin: boolean,
  createdAt: string | null = null) {
  const raw = prepared.raw;
  return db.prepare(`WITH summary AS (
    SELECT s."id", s."name", s."description", s."visibility", s."createdAt", s."updatedAt",
      (SELECT COUNT(*) FROM "SpaceMember" m WHERE m."spaceId" = s."id") AS memberCount,
      (SELECT COUNT(*) FROM "SpaceDiscussion" d WHERE d."spaceId" = s."id" AND d."hiddenAt" IS NULL) AS discussionCount,
      EXISTS(SELECT 1 FROM "SpaceMember" m WHERE m."spaceId" = s."id" AND m."userId" = a."id") AS isMember,
      (a."role" = 'ADMIN') AS canManage
    FROM "User" a JOIN "Space" s ON s."id" = ?2 WHERE a."id" = ?1
  ) SELECT CASE WHEN s."id" IS ?2 AND s."name" IS ?3 AND s."description" IS ?4
      AND s."visibility" IS ?5 AND s."createdAt" IS ?6 AND s."updatedAt" IS ?7
      AND s.isMember IS ?8 AND s.canManage IS ?9
      AND typeof(s.memberCount) = 'integer' AND s.memberCount BETWEEN 0 AND ${MAX_COUNT}
      AND typeof(s.discussionCount) = 'integer' AND s.discussionCount BETWEEN 0 AND ${MAX_COUNT}
      AND (?10 IS NULL OR (s.memberCount = 1 AND s.discussionCount = 0 AND EXISTS (
        SELECT 1 FROM "SpaceMember" m WHERE m."spaceId" = ?2 AND m."userId" = ?1 AND m."joinedAt" IS ?10)))
      THEN 1 ELSE json_extract('[]', 'D1_SPACE_BASE_WRITE_INVARIANT') END AS guarded,
    s."id", s."name", s."description", s."visibility", s."createdAt", s."updatedAt",
    s.memberCount, s.discussionCount, s.isMember, s.canManage
    FROM (SELECT 1) seed LEFT JOIN summary s ON 1`)
    .bind(userId, raw.id, raw.name, raw.description, raw.visibility, raw.createdAt, raw.updatedAt,
      joined ? 1 : 0, admin ? 1 : 0, createdAt);
}

function committedSummary(row: SummaryRow | undefined, prepared: Prepared): SpaceSummary {
  if (!row || row.guarded !== 1) throw new Error('Missing committed D1 Space summary');
  // Date parsing/serialization and the maximum-size response were validated
  // before the batch. Final SQL proves metadata parity and safe fresh counts.
  return { id: row.id, name: row.name, description: row.description, visibility: row.visibility,
    createdAt: prepared.isoCreatedAt, updatedAt: prepared.isoUpdatedAt,
    memberCount: row.memberCount, discussionCount: row.discussionCount,
    isMember: row.isMember === 1, canManage: row.canManage === 1, canWrite: row.isMember === 1 };
}

function snapshotFailure(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : '';
    if (/D1_SPACE_BASE_SNAPSHOT_CONFLICT|malformed JSON/i.test(message)) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}

async function storedAdmin(db: Database, userId: string) {
  const row = await db.prepare(`SELECT EXISTS(SELECT 1 FROM "User" WHERE "id" = ?1 AND "role" = 'ADMIN') AS authorized`)
    .bind(userId).first<{ authorized: number }>();
  if (!row) throw new Error('Missing D1 Space creator authority');
  return row.authorized === 1;
}

/** No request receipt exists for CREATE: this never retries an ambiguous result
 * or merges separately successful requests by name/payload. */
export async function createD1Space(userId: string, input: ReturnType<typeof parseSpaceInput>) {
  const db = d1SpaceDatabase();
  if (!await storedAdmin(db, userId)) throw new SpaceApiError('Nicht autorisiert', 403);
  if (!SPACE_ID_RE.test(userId)) throw new Error('Created Space would not be readable by its creator');
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  const raw: Metadata = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
  const prepared = prepareMetadata(raw);
  try {
    const result = await db.batch([
      db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM "User" WHERE "id" = ?1 AND "role" = 'ADMIN')
        THEN 1 ELSE json('D1_SPACE_BASE_SNAPSHOT_CONFLICT') END AS guarded`).bind(userId),
      db.prepare(`INSERT INTO "Space" ("id", "name", "description", "visibility", "createdAt", "updatedAt")
        VALUES (?, ?, ?, ?, ?, ?)`).bind(raw.id, raw.name, raw.description, raw.visibility, now, now),
      db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1
        ELSE json_extract('[]', 'D1_SPACE_BASE_WRITE_INVARIANT') END AS guarded`),
      db.prepare(`INSERT INTO "SpaceMember" ("spaceId", "userId", "joinedAt")
        SELECT "id", ?2, ?3 FROM "Space" WHERE "id" = ?1`).bind(raw.id, userId, now),
      db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1
        ELSE json_extract('[]', 'D1_SPACE_BASE_WRITE_INVARIANT') END AS guarded`),
      finalSummary(db, userId, prepared, true, true, now),
    ]);
    return committedSummary(result[result.length - 1].results[0] as SummaryRow | undefined, prepared);
  } catch (error) {
    // Only a throwing SQL guard proves a rolled-back authorization failure.
    // Unknown network/commit errors never trigger a second CREATE.
    if (snapshotFailure(error) && !await storedAdmin(db, userId)) throw new SpaceApiError('Nicht autorisiert', 403);
    throw error;
  }
}

/** PUBLIC-only own membership is a desired set operation, never a toggle. */
export async function setD1PublicSpaceMembership(userId: string, spaceId: string, join: boolean) {
  if (!SPACE_ID_RE.test(userId)) throw new SpaceApiError('Space nicht gefunden', 404);
  const db = d1SpaceDatabase();
  let snapshot = await readPublicSnapshot(db, userId, spaceId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const prepared = validatePublicSnapshot(snapshot);
    const now = new Date().toISOString().replace(/Z$/, '+00:00');
    try {
      const mutation = join
        ? db.prepare(`INSERT INTO "SpaceMember" ("spaceId", "userId", "joinedAt") VALUES (?, ?, ?)
            ON CONFLICT("spaceId", "userId") DO NOTHING`).bind(spaceId, userId, now)
        : db.prepare('DELETE FROM "SpaceMember" WHERE "spaceId" = ? AND "userId" = ?').bind(spaceId, userId);
      const result = await db.batch([
        publicSnapshotGuard(db, userId, spaceId, snapshot),
        mutation,
        finalSummary(db, userId, prepared, join, snapshot.canManage === 1),
      ]);
      return committedSummary(result[result.length - 1].results[0] as SummaryRow | undefined, prepared);
    } catch (error) {
      if (!snapshotFailure(error)) throw error;
      const current = await readPublicSnapshot(db, userId, spaceId);
      validatePublicSnapshot(current);
      // Generic provider errors are not enough: only changed guarded state can
      // identify a rolled-back race. Same-state failures stay infrastructure500.
      if (snapshotFields.every(field => current[field] === snapshot[field])) throw error;
      snapshot = current;
    }
  }
  throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
