import 'server-only';

import type { Headers as WorkerHeaders } from '@cloudflare/workers-types';
import { env } from 'cloudflare:workers';
import { assertCanonicalCourseImageBytes, normalizeCourseImage } from './course-image-codec';
import {
  CourseImageError, COURSE_IMAGE_CONTENT_TYPE, COURSE_IMAGE_MAX_BYTES, courseImagePrivateHeaders,
} from './course-image-policy';

// HELD: no existing route or adapter imports this module. Main keeps FS/Prisma.
const KEY_PREFIX = 'private-course-assets/';
const OBJECT_SCOPE = 'private-course-image-v1';
const COURSE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ASSET_ID = new RegExp(`^${UUID_V4}$`);
const STORAGE_KEY = new RegExp(`^${UUID_V4}\\.png$`);
const METADATA_KEYS = ['scope', 'courseId', 'assetId', 'format'];

export type CourseImageIdentity = Readonly<{ courseId: string; assetId: string; storageKey: string }>;

/** These must be fields from the independently authorized CourseAsset row,
 * not values reconstructed from an upload URL or an R2 object path. */
export type CourseImageRowMetadata = Readonly<{
  id: string; courseId: string; storageKey: string; contentType: string; byteSize: number;
}>;

export type CourseImageCreateResult =
  | Readonly<{ state: 'created'; asset: CourseImageRowMetadata }>
  | Readonly<{ state: 'not-created'; asset: CourseImageRowMetadata }>
  | Readonly<{ state: 'unknown'; asset: CourseImageRowMetadata }>;

function snapshotIdentity(value: CourseImageIdentity): CourseImageIdentity {
  const identity = { courseId: value.courseId, assetId: value.assetId, storageKey: value.storageKey };
  if (typeof identity.courseId !== 'string' || !COURSE_ID.test(identity.courseId) ||
      typeof identity.assetId !== 'string' || !ASSET_ID.test(identity.assetId) ||
      typeof identity.storageKey !== 'string' || !STORAGE_KEY.test(identity.storageKey)) {
    throw new CourseImageError('IDENTITY_INVALID');
  }
  return Object.freeze(identity);
}

function objectKey(identity: CourseImageIdentity) {
  return `${KEY_PREFIX}${identity.courseId}/${identity.storageKey}`;
}

function isWorkerHeaders(headers: Headers): headers is Headers & WorkerHeaders {
  // The app intentionally keeps DOM globals. Its imported R2 types additionally
  // require Workers' documented getAll method. Verify the actual host object;
  // do not cast away that boundary or polyfill/mutate conditional headers.
  return 'getAll' in headers && typeof headers.getAll === 'function';
}

function createOnlyConditionHeaders(): Headers & WorkerHeaders {
  const headers = new Headers({ 'If-None-Match': '*' });
  if (!isWorkerHeaders(headers)) throw new CourseImageError('STORAGE_UNAVAILABLE');
  return headers;
}

/** Generate once per server operation, before any R2 write. These opaque IDs
 * are not a read capability, upload idempotency key or public URL. */
export function createCourseImageIdentity(courseId: string): CourseImageIdentity {
  return snapshotIdentity({ courseId, assetId: crypto.randomUUID(), storageKey: `${crypto.randomUUID()}.png` });
}

function matchesObject(
  object: {
    key: string; size: number; customMetadata?: Record<string, string>;
    httpMetadata?: { contentType?: string; contentEncoding?: string; cacheControl?: string };
  },
  identity: CourseImageIdentity,
  byteSize: number,
) {
  const metadata = object.customMetadata;
  return object.key === objectKey(identity) && Number.isSafeInteger(object.size) && object.size === byteSize &&
    object.size >= 1 && object.size <= COURSE_IMAGE_MAX_BYTES &&
    metadata !== undefined && Object.keys(metadata).length === METADATA_KEYS.length &&
    METADATA_KEYS.every(key => Object.prototype.hasOwnProperty.call(metadata, key)) &&
    metadata.scope === OBJECT_SCOPE && metadata.courseId === identity.courseId &&
    metadata.assetId === identity.assetId && metadata.format === 'png' &&
    object.httpMetadata?.contentType === COURSE_IMAGE_CONTENT_TYPE &&
    object.httpMetadata.contentEncoding === undefined && object.httpMetadata.cacheControl === 'private, no-store';
}

/** Call only after fresh current-editor authorization and bounded multipart
 * admission. Normalization occurs here so arbitrary caller bytes cannot be
 * labelled canonical. Exactly one conditional put; no HEAD-before-PUT race,
 * unconditional fallback, overwrite, automatic retry, D1 mutation or cleanup.
 *
 * R2 reference: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations
 * Atomic create-once semantics: https://developers.cloudflare.com/r2/reference/consistency/#conditional-writes
 */
export async function putCourseImage(identityInput: CourseImageIdentity, file: File): Promise<CourseImageCreateResult> {
  const identity = snapshotIdentity(identityInput);
  const bucket = env.BUCKET;
  if (!bucket) throw new CourseImageError('STORAGE_UNAVAILABLE');
  const onlyIf = createOnlyConditionHeaders();
  const bytes = await normalizeCourseImage(file);
  const asset: CourseImageRowMetadata = Object.freeze({
    id: identity.assetId, courseId: identity.courseId, storageKey: identity.storageKey,
    contentType: COURSE_IMAGE_CONTENT_TYPE, byteSize: bytes.byteLength,
  });
  try {
    const stored = await bucket.put(objectKey(identity), bytes, {
      // Headers explicitly use the documented wildcard create-only contract.
      // Never accept caller-provided conditional headers or remove this guard.
      onlyIf,
      httpMetadata: { contentType: COURSE_IMAGE_CONTENT_TYPE, cacheControl: 'private, no-store' },
      customMetadata: {
        scope: OBJECT_SCOPE, courseId: identity.courseId, assetId: identity.assetId, format: 'png',
      },
    });
    // Documented Workers precondition failure means this call stored nothing.
    // It does not establish ownership of or authorize reusing the existing key.
    if (stored === null) return { state: 'not-created', asset };
    if (!matchesObject(stored, identity, asset.byteSize)) return { state: 'unknown', asset };
    return { state: 'created', asset };
  } catch {
    // A rejected/lost response may follow a commit. Preserve the exact identity
    // for later reconciliation; never delete it, blindly repeat the upload or
    // insert a public row on this result. Provider errors are not exposed.
    return { state: 'unknown', asset };
  }
}

/** Call only after the existing final fresh-primary D1 ACL succeeds. Both
 * authorized IDs are explicit, separate inputs; paths/metadata grant nothing.
 * The row projection must be extended by a later reviewed integration to
 * include id and courseId. Legacy FS rows are never guessed or fallen back to.
 */
export async function getCourseImage(
  authorizedCourseId: string,
  authorizedAssetId: string,
  row: CourseImageRowMetadata,
): Promise<{ bytes: Uint8Array; contentType: 'image/png'; byteSize: number; headers: Record<string, string> } | null> {
  let identity: CourseImageIdentity;
  const byteSize = row.byteSize;
  try {
    identity = snapshotIdentity({ courseId: authorizedCourseId, assetId: authorizedAssetId, storageKey: row.storageKey });
    if (row.id !== identity.assetId || row.courseId !== identity.courseId || row.contentType !== COURSE_IMAGE_CONTENT_TYPE ||
        !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > COURSE_IMAGE_MAX_BYTES) return null;
  } catch { return null; }
  const bucket = env.BUCKET;
  if (!bucket) throw new CourseImageError('STORAGE_UNAVAILABLE');
  try {
    const object = await bucket.get(objectKey(identity));
    if (!object) return null;
    if (!matchesObject(object, identity, byteSize)) {
      // Cancellation must not hold the response open on an unbounded provider
      // cancellation promise. No bytes are consumed after a metadata failure.
      void object.body.cancel().catch(() => {});
      return null;
    }
    // R2 size is checked before buffering; the independent length check also
    // rejects inconsistent bodies. At most the accepted 5 MiB object is read.
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== byteSize) return null;
    try { assertCanonicalCourseImageBytes(bytes); }
    catch { return null; }
    return { bytes, contentType: COURSE_IMAGE_CONTENT_TYPE, byteSize, headers: courseImagePrivateHeaders(byteSize) };
  } catch {
    throw new CourseImageError('STORAGE_READ_FAILED');
  }
}

// R2 and a future CourseAsset D1 INSERT are NOT cross-store atomic. 'created'
// confirms only R2. An unused object can remain private after row failure.
// Neither a negative read after an unknown in-flight write nor a missing D1
// row proves that the object cannot later commit. No delete/GC is provided.
