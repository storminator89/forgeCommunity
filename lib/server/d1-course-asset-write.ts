import 'server-only';

import { Buffer } from 'node:buffer';
import { env } from 'cloudflare:workers';
import { CourseImageError, COURSE_IMAGE_CONTENT_TYPE } from './course-image-policy';
import { createCourseImageIdentity, putCourseImage, type CourseImageRowMetadata } from './course-image-r2';

// HELD preparation only. No active route imports this module. Main retains its
// filesystem/serializable Prisma implementation; this module is native-only.
const COURSE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type D1CourseImageActor = Readonly<{ id: string }>;
export type D1CourseImageUpload = Readonly<{
  id: string; url: string; mimeType: 'image/png'; size: number;
}>;

function checkedInputs(courseId: string, actor: D1CourseImageActor) {
  if (typeof courseId !== 'string' || !COURSE_ID.test(courseId) || !actor ||
      typeof actor.id !== 'string' || !actor.id || Buffer.byteLength(actor.id, 'utf8') > 1024) {
    throw new CourseImageError('IDENTITY_INVALID');
  }
  // Do not retain a mutable caller object over an await.
  return Object.freeze({ courseId, actorId: actor.id });
}

/** Call in the future upload route BEFORE multipart/body processing. The save
 * operation repeats this preflight before decoding, and the decisive INSERT
 * rechecks it again. Session role, a capability header and Chat membership are
 * never substitutes for the current User/Course authority. */
export async function assertCurrentD1CourseImageEditor(courseId: string, actor: D1CourseImageActor): Promise<void> {
  const input = checkedInputs(courseId, actor);
  let row: { canAuthor: number } | null;
  try {
    if (!env.DB) throw new Error('Unavailable database');
    // A fresh handle is required for every preflight, never a retained session.
    row = await env.DB.withSession('first-primary').prepare(`SELECT EXISTS (
      SELECT 1 FROM Course c JOIN User u ON u.id = ?1
      WHERE c.id = ?2 AND (c.instructorId = u.id OR u.role = 'ADMIN')
    ) AS canAuthor`).bind(input.actorId, input.courseId).first<{ canAuthor: number }>();
  } catch {
    // Do not disclose SQL, parameters, provider exceptions or database state.
    throw new CourseImageError('DATABASE_UNAVAILABLE');
  }
  if (!row || (row.canAuthor !== 0 && row.canAuthor !== 1)) throw new CourseImageError('DATABASE_UNAVAILABLE');
  if (row.canAuthor !== 1) throw new CourseImageError('AUTHOR_REQUIRED');
}

// One conditional create, with no UPDATE, REPLACE, interactive transaction or
// application retry. D1/provider internal re-execution cannot overwrite an ID.
// ?1 id, ?2 course, ?3 actor, ?4 storageKey, ?5 MIME, ?6 byteSize, ?7 createdAt.
const insertSql = `INSERT INTO CourseAsset
  (id, courseId, uploaderId, storageKey, contentType, byteSize, createdAt)
  SELECT ?1, c.id, u.id, ?4, ?5, ?6, ?7 FROM Course c JOIN User u ON u.id = ?3
  WHERE c.id = ?2 AND (c.instructorId = u.id OR u.role = 'ADMIN')
    AND NOT EXISTS (SELECT 1 FROM CourseAsset existing WHERE existing.id = ?1 OR existing.storageKey = ?4)`;

// Only fixed-size flags cross the transport, never arbitrary stored strings.
// Query only the generated exact ID, not an inventory, key prefix or filename.
const reconcileSql = `SELECT
  EXISTS (SELECT 1 FROM Course c JOIN User u ON u.id = ?3
    WHERE c.id = ?2 AND (c.instructorId = u.id OR u.role = 'ADMIN')) AS canAuthor,
  EXISTS (SELECT 1 FROM CourseAsset a WHERE a.id = ?1) AS assetExists,
  EXISTS (SELECT 1 FROM CourseAsset a WHERE a.id = ?1
    AND a.courseId = ?2 AND a.uploaderId = ?3 AND a.storageKey = ?4
    AND a.contentType = ?5 AND typeof(a.byteSize) = 'integer' AND a.byteSize = ?6
    AND a.createdAt = ?7) AS exactMatch`;

type ReconciledRow = { canAuthor: number; assetExists: number; exactMatch: number };
type Acknowledgement = 'inserted' | 'not-inserted' | 'unknown';

function isFlag(value: unknown): value is 0 | 1 { return value === 0 || value === 1; }

async function insertAndReconcile(asset: CourseImageRowMetadata, actorId: string): Promise<D1CourseImageUpload> {
  const createdAt = new Date().toISOString().replace(/Z$/, '+00:00');
  const values = [asset.id, asset.courseId, actorId, asset.storageKey, asset.contentType, asset.byteSize, createdAt];
  let acknowledgement: Acknowledgement = 'unknown';
  try {
    if (!env.DB) throw new Error('Unavailable database');
    const result = await env.DB.withSession('first-primary').prepare(insertSql).bind(...values).run();
    if (result.success && result.meta?.changes === 1) acknowledgement = 'inserted';
    else if (result.success && result.meta?.changes === 0) acknowledgement = 'not-inserted';
  } catch {
    // The write may have committed. Never repeat it, delete the object, or
    // conclude that a later negative read proves an in-flight write cannot win.
  }

  let row: ReconciledRow | null;
  try {
    if (!env.DB) throw new Error('Unavailable database');
    // Fresh first-primary, including after a rejected/lost write response. A
    // positive exact match can reconcile that operation. Absence cannot prove
    // that a timed-out write will never subsequently commit.
    row = await env.DB.withSession('first-primary').prepare(reconcileSql).bind(...values).first<ReconciledRow>();
  } catch {
    throw new CourseImageError('UPLOAD_UNCERTAIN');
  }
  if (!row || !isFlag(row.canAuthor) || !isFlag(row.assetExists) || !isFlag(row.exactMatch) ||
      (row.exactMatch === 1 && row.assetExists !== 1)) throw new CourseImageError('UPLOAD_UNCERTAIN');
  if (row.exactMatch === 1) {
    // A committed object/row grants no continuing authority after revocation.
    if (row.canAuthor !== 1) throw new CourseImageError('AUTHOR_REQUIRED');
    return Object.freeze({
      id: asset.id, url: `/api/courses/${asset.courseId}/assets/${asset.id}`,
      mimeType: COURSE_IMAGE_CONTENT_TYPE, size: asset.byteSize,
    });
  }
  if (row.assetExists === 1) throw new CourseImageError('UPLOAD_REJECTED');
  if (acknowledgement === 'not-inserted') {
    if (row.canAuthor !== 1) throw new CourseImageError('AUTHOR_REQUIRED');
    throw new CourseImageError('UPLOAD_REJECTED');
  }
  throw new CourseImageError('UPLOAD_UNCERTAIN');
}

/** Future route contract: same origin and authenticated session, fresh editor
 * preflight BEFORE consuming the body, bounded deadline/body admission, exact
 * one file and no extra multipart fields, rate limit, finally-release. This
 * module does not activate those ingress controls or make the route safe.
 *
 * This operation is called once. It creates a new immutable identity, rechecks
 * current editor authority before decoding, conditionally creates private R2
 * bytes, then conditionally inserts the corresponding D1 row. R2 and D1 are
 * NOT atomic. No cleanup, broad GC, R2-miss filesystem fallback or browser-level
 * upload-idempotency claim is supplied. A retry needs a fresh user decision,
 * not a transparent repeated POST. Unregistered objects remain private.
 */
export async function saveD1CourseImage(
  courseId: string, actor: D1CourseImageActor, file: File,
): Promise<D1CourseImageUpload> {
  const input = checkedInputs(courseId, actor);
  await assertCurrentD1CourseImageEditor(input.courseId, { id: input.actorId });
  const identity = createCourseImageIdentity(input.courseId);
  const stored = await putCourseImage(identity, file);
  if (stored.state === 'not-created') throw new CourseImageError('UPLOAD_REJECTED');
  if (stored.state !== 'created') throw new CourseImageError('UPLOAD_UNCERTAIN');
  return insertAndReconcile(stored.asset, input.actorId);
}
