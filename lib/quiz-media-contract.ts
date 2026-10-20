/**
 * HELD DRAFT: intentionally unimported by the application.
 * Pure JSON media contract only; validation is neither authorization nor ACL.
 * Incomplete uploads/details use the separate local-only pending type below.
 */

export type QuizOptionImageQuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE';

export type QuizOptionImageRights =
  | {
      readonly basis: 'OWN';
      readonly attribution?: string;
      readonly sourceUrl?: string;
      readonly licenseLabel?: string;
    }
  | {
      readonly basis: 'PERMISSION_OR_LICENSE';
      readonly attribution: string;
      readonly sourceUrl?: string;
      readonly licenseLabel: string;
    };

export interface QuizOptionImage {
  readonly src: string;
  readonly alt: string;
  readonly rights: QuizOptionImageRights;
}

/** Local-only details state, NEVER persisted media or a learner DTO. Status
 * describes an observed upload; it does not implement upload/slot lifecycle. */
export interface PendingQuizOptionImage {
  readonly kind: 'LOCAL_PENDING_IMAGE';
  readonly upload:
    | { readonly status: 'PENDING' }
    | { readonly status: 'FAILED' }
    | { readonly status: 'UPLOADED'; readonly src: string };
  readonly alt: string;
  readonly rights: {
    readonly basis: QuizOptionImageRights['basis'] | null;
    readonly attribution?: string;
    readonly sourceUrl?: string;
    readonly licenseLabel?: string;
  };
}

export type QuizOptionImages = ReadonlyArray<QuizOptionImage | null>;

export interface LearnerQuizOptionImageAttribution {
  readonly text: string;
  readonly sourceUrl?: string;
  readonly licenseLabel?: string;
}

export interface LearnerQuizOptionImage {
  readonly src: string;
  readonly alt: string;
  readonly attribution?: LearnerQuizOptionImageAttribution;
}

export type LearnerQuizOptionImages = ReadonlyArray<LearnerQuizOptionImage | null>;

export interface QuizOptionImageReference {
  readonly courseId: string;
  readonly assetId: string;
  readonly src: string;
  readonly optionIndex: number;
}

export type QuizOptionImageErrorCode =
  | 'INVALID_COURSE_ID'
  | 'INVALID_QUESTION'
  | 'UNSUPPORTED_QUESTION_TYPE'
  | 'INVALID_OPTIONS'
  | 'INVALID_OPTION_IMAGES'
  | 'OPTION_IMAGES_LENGTH_MISMATCH'
  | 'OMIT_ALL_NULL_OPTION_IMAGES'
  | 'INVALID_IMAGE'
  | 'INVALID_ASSET_URL'
  | 'INVALID_ALT'
  | 'INVALID_RIGHTS'
  | 'INVALID_ATTRIBUTION'
  | 'INVALID_SOURCE_URL'
  | 'INVALID_LICENSE_LABEL';

export type QuizOptionImageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: QuizOptionImageErrorCode; readonly path: string } };

export type QuizOptionImageReadinessResult =
  | { readonly ready: true; readonly image: QuizOptionImage }
  | { readonly ready: false; readonly error: {
      readonly code: QuizOptionImageErrorCode | 'UPLOAD_PENDING' | 'UPLOAD_FAILED';
      readonly path: string;
    } };

export interface CanonicalQuizOptionAssetUrl {
  readonly courseId: string;
  readonly assetId: string;
  readonly src: string;
}

const IDENTIFIER_MAX_LENGTH = 80;
const ASSET_URL_MAX_LENGTH = '/api/courses/'.length + IDENTIFIER_MAX_LENGTH + '/assets/'.length + IDENTIFIER_MAX_LENGTH;
const ALT_MAX_LENGTH = 300;
const ATTRIBUTION_MAX_LENGTH = 300;
const LICENSE_LABEL_MAX_LENGTH = 120;
const SOURCE_URL_MAX_LENGTH = 2048;
const LOCAL_HOST_SUFFIXES = [
  'localhost', 'localdomain', 'local', 'internal', 'intranet', 'lan', 'home',
  'corp', 'private', 'test', 'invalid', 'example', 'onion', 'i2p', 'arpa',
];

function failure(code: QuizOptionImageErrorCode, path: string): QuizOptionImageResult<never> {
  return { ok: false, error: { code, path } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOwnDataProperty(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return Boolean(descriptor && descriptor.enumerable && hasOwn(descriptor, 'value'));
}

function isDenseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    if (!hasOwnDataProperty(value, String(index))) return false;
  }
  return true;
}

/** Inspect raw presence BEFORE any pool/capability normalization or projection. */
export function hasQuizOptionImagesField(value: unknown): boolean {
  return value !== null && typeof value === 'object' && hasOwn(value, 'optionImages');
}

/** Media records accept only enumerable own data properties with known keys. */
function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) return false;
  }
  return required.every(key => hasOwn(value, key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= IDENTIFIER_MAX_LENGTH &&
    !/[^A-Za-z0-9_-]/.test(value);
}

function isNonemptyText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && value.trim().length > 0;
}

/** Exact original spelling only: no trimming, decoding, absolute URLs or aliases. */
export function parseCanonicalQuizOptionAssetUrl(value: unknown, expectedCourseId: string): QuizOptionImageResult<CanonicalQuizOptionAssetUrl> {
  if (!isIdentifier(expectedCourseId)) return failure('INVALID_COURSE_ID', 'courseId');
  if (typeof value !== 'string' || value.length > ASSET_URL_MAX_LENGTH) return failure('INVALID_ASSET_URL', 'src');
  const match = /^\/api\/courses\/([A-Za-z0-9_-]{1,80})\/assets\/([A-Za-z0-9_-]{1,80})$/.exec(value);
  const assetId = match?.[2];
  if (!match || match[1] !== expectedCourseId || !assetId) return failure('INVALID_ASSET_URL', 'src');
  const canonical = `/api/courses/${expectedCourseId}/assets/${assetId}`;
  if (value !== canonical) return failure('INVALID_ASSET_URL', 'src');
  return { ok: true, value: { courseId: expectedCourseId, assetId, src: canonical } };
}

/**
 * Syntactic public-HTTPS policy only. Never fetches or resolves DNS; a public-
 * looking domain may still resolve privately or change later. This is no SSRF
 * authorization and must never be reused as permission for a server-side fetch.
 */
export function isQuizImageAttributionSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > SOURCE_URL_MAX_LENGTH ||
      !value.startsWith('https://') || /[\s\\?#\u0000-\u001f\u007f]/.test(value)) return false;
  const authority = value.slice('https://'.length).split('/')[0] ?? '';
  if (authority.includes('@')) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname.length > 253 || hostname.endsWith('.')) return false;
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  // Also rejects canonical IPv4, numeric/hex shorthand normalized by URL, and
  // IPv6 literals (which cannot pass the DNS-label grammar above).
  const topLevelLabel = labels[labels.length - 1];
  if (!topLevelLabel || !/[a-z]/.test(topLevelLabel)) return false;
  return !LOCAL_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function parseImageBase(value: Record<string, unknown>, expectedCourseId: string, path: string): QuizOptionImageResult<{ src: string; alt: string }> {
  const source = parseCanonicalQuizOptionAssetUrl(value.src, expectedCourseId);
  if (!source.ok) return failure('INVALID_ASSET_URL', `${path}.src`);
  if (!isNonemptyText(value.alt, ALT_MAX_LENGTH)) return failure('INVALID_ALT', `${path}.alt`);
  return { ok: true, value: { src: source.value.src, alt: value.alt } };
}

function parseImage(value: unknown, expectedCourseId: string, path: string): QuizOptionImageResult<QuizOptionImage> {
  if (!isRecord(value) || !hasExactKeys(value, ['src', 'alt', 'rights'])) return failure('INVALID_IMAGE', path);
  const base = parseImageBase(value, expectedCourseId, path);
  if (!base.ok) return base;
  const rights = value.rights;
  if (!isRecord(rights) || !hasExactKeys(rights, ['basis'], ['attribution', 'sourceUrl', 'licenseLabel']) ||
      (rights.basis !== 'OWN' && rights.basis !== 'PERMISSION_OR_LICENSE')) return failure('INVALID_RIGHTS', `${path}.rights`);
  if (hasOwn(rights, 'attribution') && !isNonemptyText(rights.attribution, ATTRIBUTION_MAX_LENGTH)) return failure('INVALID_ATTRIBUTION', `${path}.rights.attribution`);
  if (hasOwn(rights, 'sourceUrl') && !isQuizImageAttributionSourceUrl(rights.sourceUrl)) return failure('INVALID_SOURCE_URL', `${path}.rights.sourceUrl`);
  if (hasOwn(rights, 'licenseLabel') && !isNonemptyText(rights.licenseLabel, LICENSE_LABEL_MAX_LENGTH)) return failure('INVALID_LICENSE_LABEL', `${path}.rights.licenseLabel`);
  let copiedRights: { basis: 'OWN'; attribution?: string; sourceUrl?: string; licenseLabel?: string } |
    { basis: 'PERMISSION_OR_LICENSE'; attribution: string; sourceUrl?: string; licenseLabel: string };
  if (rights.basis === 'PERMISSION_OR_LICENSE') {
    if (!isNonemptyText(rights.attribution, ATTRIBUTION_MAX_LENGTH)) return failure('INVALID_ATTRIBUTION', `${path}.rights.attribution`);
    if (!isNonemptyText(rights.licenseLabel, LICENSE_LABEL_MAX_LENGTH)) return failure('INVALID_LICENSE_LABEL', `${path}.rights.licenseLabel`);
    copiedRights = { basis: 'PERMISSION_OR_LICENSE', attribution: rights.attribution, licenseLabel: rights.licenseLabel };
  } else {
    copiedRights = { basis: 'OWN' };
    if (typeof rights.attribution === 'string') copiedRights.attribution = rights.attribution;
    if (typeof rights.licenseLabel === 'string') copiedRights.licenseLabel = rights.licenseLabel;
  }
  if (typeof rights.sourceUrl === 'string') copiedRights.sourceUrl = rights.sourceUrl;
  return { ok: true, value: { src: base.value.src, alt: base.value.alt, rights: copiedRights } };
}

/** Readiness is distinct from persisted parsing. The caller must deliberately
 * use the returned image. Present blank optional details fail, not disappear.
 * No pending object is normalized in place; no byte/ACL access is established. */
export function getPendingQuizOptionImageReadiness(pending: PendingQuizOptionImage, expectedCourseId: string): QuizOptionImageReadinessResult {
  if (!isIdentifier(expectedCourseId)) return { ready: false, error: { code: 'INVALID_COURSE_ID', path: 'courseId' } };
  if (!isRecord(pending) || !hasExactKeys(pending, ['kind', 'upload', 'alt', 'rights']) ||
      pending.kind !== 'LOCAL_PENDING_IMAGE' || !isRecord(pending.upload)) {
    return { ready: false, error: { code: 'INVALID_IMAGE', path: 'pending' } };
  }
  const upload = pending.upload;
  if (!hasExactKeys(upload, ['status'], ['src'])) {
    return { ready: false, error: { code: 'INVALID_IMAGE', path: 'pending.upload' } };
  }
  if (upload.status === 'PENDING' || upload.status === 'FAILED') {
    if (!hasExactKeys(upload, ['status'])) return { ready: false, error: { code: 'INVALID_IMAGE', path: 'pending.upload' } };
    return { ready: false, error: { code: upload.status === 'PENDING' ? 'UPLOAD_PENDING' : 'UPLOAD_FAILED', path: 'pending.upload' } };
  }
  if (upload.status !== 'UPLOADED' || !hasExactKeys(upload, ['status', 'src'])) {
    return { ready: false, error: { code: 'INVALID_IMAGE', path: 'pending.upload' } };
  }
  const parsed = parseImage({ src: upload.src, alt: pending.alt, rights: pending.rights }, expectedCourseId, 'pending');
  return parsed.ok ? { ready: true, image: parsed.value } : { ready: false, error: parsed.error };
}

function parseLearnerImage(value: unknown, expectedCourseId: string, path: string): QuizOptionImageResult<LearnerQuizOptionImage> {
  if (!isRecord(value) || !hasExactKeys(value, ['src', 'alt'], ['attribution'])) return failure('INVALID_IMAGE', path);
  const base = parseImageBase(value, expectedCourseId, path);
  if (!base.ok) return base;
  const copied: { src: string; alt: string; attribution?: LearnerQuizOptionImageAttribution } = { src: base.value.src, alt: base.value.alt };
  if (hasOwn(value, 'attribution')) {
    const attribution = value.attribution;
    if (!isRecord(attribution) || !hasExactKeys(attribution, ['text'], ['sourceUrl', 'licenseLabel']) ||
        !isNonemptyText(attribution.text, ATTRIBUTION_MAX_LENGTH)) return failure('INVALID_ATTRIBUTION', `${path}.attribution`);
    if (hasOwn(attribution, 'sourceUrl') && !isQuizImageAttributionSourceUrl(attribution.sourceUrl)) return failure('INVALID_SOURCE_URL', `${path}.attribution.sourceUrl`);
    if (hasOwn(attribution, 'licenseLabel') && !isNonemptyText(attribution.licenseLabel, LICENSE_LABEL_MAX_LENGTH)) return failure('INVALID_LICENSE_LABEL', `${path}.attribution.licenseLabel`);
    const publicAttribution: { text: string; sourceUrl?: string; licenseLabel?: string } = { text: attribution.text };
    if (typeof attribution.sourceUrl === 'string') publicAttribution.sourceUrl = attribution.sourceUrl;
    if (typeof attribution.licenseLabel === 'string') publicAttribution.licenseLabel = attribution.licenseLabel;
    copied.attribution = publicAttribution;
  }
  return { ok: true, value: copied };
}

function parseField<T>(question: unknown, expectedCourseId: string,
  parseEntry: (value: unknown, courseId: string, path: string) => QuizOptionImageResult<T>): QuizOptionImageResult<ReadonlyArray<T | null> | undefined> {
  if (!isIdentifier(expectedCourseId)) return failure('INVALID_COURSE_ID', 'courseId');
  if (!isRecord(question)) return failure('INVALID_QUESTION', 'question');
  // This is a media-only validator. Absent media does not reinterpret legacy
  // questions or impose unrelated type/option-count/grading restrictions.
  if (!hasQuizOptionImagesField(question)) return { ok: true, value: undefined };
  if (!hasOwnDataProperty(question, 'optionImages')) return failure('INVALID_OPTION_IMAGES', 'optionImages');
  if (!hasOwnDataProperty(question, 'type')) return failure('UNSUPPORTED_QUESTION_TYPE', 'type');
  if (question.type !== 'SINGLE_CHOICE' && question.type !== 'MULTIPLE_CHOICE') return failure('UNSUPPORTED_QUESTION_TYPE', 'type');
  if (!hasOwnDataProperty(question, 'options') || !isDenseDataArray(question.options) ||
      question.options.some(option => typeof option !== 'string' || !option.trim())) return failure('INVALID_OPTIONS', 'options');
  if (!isDenseDataArray(question.optionImages)) return failure('INVALID_OPTION_IMAGES', 'optionImages');
  if (question.optionImages.length !== question.options.length) return failure('OPTION_IMAGES_LENGTH_MISMATCH', 'optionImages');
  const images: Array<T | null> = [];
  let nonNull = false;
  for (let index = 0; index < question.optionImages.length; index++) {
    const entry: unknown = question.optionImages[index];
    if (entry === null) { images.push(null); continue; }
    const parsed = parseEntry(entry, expectedCourseId, `optionImages[${index}]`);
    if (!parsed.ok) return parsed;
    images.push(parsed.value);
    nonNull = true;
  }
  // Raw all-null presence must remain observable to future capability/pool
  // gates. The caller must deliberately omit the field in new local state.
  if (!nonNull) return failure('OMIT_ALL_NULL_OPTION_IMAGES', 'optionImages');
  return { ok: true, value: images };
}

/** Complete persisted media only. Invalid/unsupported/present-undefined fails. */
export function parseQuizOptionImages(question: unknown, expectedCourseId: string): QuizOptionImageResult<QuizOptionImages | undefined> {
  return parseField(question, expectedCourseId, parseImage);
}

/** Independently validates public DTOs; author rights/unknown fields fail. */
export function parseLearnerQuizOptionImages(question: unknown, expectedCourseId: string): QuizOptionImageResult<LearnerQuizOptionImages | undefined> {
  return parseField(question, expectedCourseId, parseLearnerImage);
}

/** Fresh allowlist only; never spread a question, author media or rights. */
export function projectQuizOptionImagesForLearner(question: unknown, expectedCourseId: string): QuizOptionImageResult<LearnerQuizOptionImages | undefined> {
  const parsed = parseQuizOptionImages(question, expectedCourseId);
  if (!parsed.ok) return parsed;
  if (parsed.value === undefined) return { ok: true, value: undefined };
  const images: Array<LearnerQuizOptionImage | null> = [];
  for (const image of parsed.value) {
    if (image === null) { images.push(null); continue; }
    const publicImage: { src: string; alt: string; attribution?: LearnerQuizOptionImageAttribution } = { src: image.src, alt: image.alt };
    if (image.rights.attribution !== undefined) {
      const attribution: { text: string; sourceUrl?: string; licenseLabel?: string } = { text: image.rights.attribution };
      if (image.rights.sourceUrl !== undefined) attribution.sourceUrl = image.rights.sourceUrl;
      if (image.rights.licenseLabel !== undefined) attribution.licenseLabel = image.rights.licenseLabel;
      publicImage.attribution = attribution;
    }
    images.push(publicImage);
  }
  return { ok: true, value: images };
}

/** Only typed, ready option-image src values; never scans text/HTML/metadata. */
export function enumerateQuizOptionImageReferences(question: unknown, expectedCourseId: string): QuizOptionImageResult<ReadonlyArray<QuizOptionImageReference>> {
  const parsed = parseQuizOptionImages(question, expectedCourseId);
  if (!parsed.ok) return parsed;
  const references: QuizOptionImageReference[] = [];
  if (parsed.value === undefined) return { ok: true, value: references };
  for (const [index, image] of parsed.value.entries()) {
    if (image === null) continue;
    const source = parseCanonicalQuizOptionAssetUrl(image.src, expectedCourseId);
    if (!source.ok) return source;
    references.push({ courseId: source.value.courseId, assetId: source.value.assetId, src: source.value.src, optionIndex: index });
  }
  return { ok: true, value: references };
}
