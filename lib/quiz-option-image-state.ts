/**
 * HELD DRAFT: intentionally unimported by the application.
 * Pure local choice operations, not a media parser, grader or upload lifecycle.
 * Images must first come from quiz-media-contract's strict same-course parser
 * or readiness result. Pending attachments do not belong in this state.
 */
import type { QuizOptionImage, QuizOptionImages } from './quiz-media-contract';

export interface QuizOptionImageState {
  readonly options: ReadonlyArray<string>;
  readonly correctAnswers: ReadonlyArray<number>;
  readonly optionImages?: QuizOptionImages;
}

export type QuizOptionImageStateErrorCode =
  | 'INVALID_STATE'
  | 'INVALID_OPTIONS'
  | 'INVALID_CORRECT_ANSWERS'
  | 'INVALID_OPTION_IMAGES'
  | 'OPTION_IMAGES_LENGTH_MISMATCH'
  | 'INVALID_INDEX'
  | 'INVALID_PERMUTATION'
  | 'INVALID_CAPTION';

export type QuizOptionImageStateResult =
  | { readonly ok: true; readonly value: QuizOptionImageState }
  | { readonly ok: false; readonly error: { readonly code: QuizOptionImageStateErrorCode; readonly path: string } };

function failure(code: QuizOptionImageStateErrorCode, path: string): QuizOptionImageStateResult {
  return { ok: false, error: { code, path } };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.has(key) || !descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) return false;
  }
  return required.every(key => hasOwn(value, key));
}

function isDenseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

/** Shape guard for safe copying only. Same-course/URL/rights readiness belongs
 * to the separate contract parser, not an implicit normalization by this file. */
function isCopyableImage(value: unknown): value is QuizOptionImage {
  if (!isRecord(value) || !hasExactDataKeys(value, ['src', 'alt', 'rights']) ||
      typeof value.src !== 'string' || typeof value.alt !== 'string' ||
      !isRecord(value.rights) || !hasExactDataKeys(value.rights, ['basis'], ['attribution', 'sourceUrl', 'licenseLabel'])) return false;
  const rights = value.rights;
  if (rights.basis !== 'OWN' && rights.basis !== 'PERMISSION_OR_LICENSE') return false;
  for (const key of ['attribution', 'sourceUrl', 'licenseLabel']) {
    if (hasOwn(rights, key) && typeof rights[key] !== 'string') return false;
  }
  return rights.basis === 'OWN' || (typeof rights.attribution === 'string' && typeof rights.licenseLabel === 'string');
}

function copyImage(image: QuizOptionImage): QuizOptionImage {
  const rights = image.rights;
  if (rights.basis === 'PERMISSION_OR_LICENSE') {
    const copied: { basis: 'PERMISSION_OR_LICENSE'; attribution: string; licenseLabel: string; sourceUrl?: string } = {
      basis: 'PERMISSION_OR_LICENSE', attribution: rights.attribution, licenseLabel: rights.licenseLabel,
    };
    if (rights.sourceUrl !== undefined) copied.sourceUrl = rights.sourceUrl;
    return { src: image.src, alt: image.alt, rights: copied };
  }
  const copied: { basis: 'OWN'; attribution?: string; sourceUrl?: string; licenseLabel?: string } = { basis: 'OWN' };
  if (rights.attribution !== undefined) copied.attribution = rights.attribution;
  if (rights.sourceUrl !== undefined) copied.sourceUrl = rights.sourceUrl;
  if (rights.licenseLabel !== undefined) copied.licenseLabel = rights.licenseLabel;
  return { src: image.src, alt: image.alt, rights: copied };
}

function validateState(state: QuizOptionImageState): QuizOptionImageStateResult | null {
  if (!isRecord(state) || !hasExactDataKeys(state, ['options', 'correctAnswers'], ['optionImages'])) return failure('INVALID_STATE', 'state');
  // Blank captions and no selected answers remain valid incomplete LOCAL state.
  // No two/six-option publication or builder limit is imposed on legacy data.
  if (!isDenseDataArray(state.options) || state.options.some(option => typeof option !== 'string')) return failure('INVALID_OPTIONS', 'options');
  if (!isDenseDataArray(state.correctAnswers) || state.correctAnswers.some(answer =>
    typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= state.options.length) ||
    new Set(state.correctAnswers).size !== state.correctAnswers.length) return failure('INVALID_CORRECT_ANSWERS', 'correctAnswers');
  if (hasOwn(state, 'optionImages')) {
    if (!isDenseDataArray(state.optionImages)) return failure('INVALID_OPTION_IMAGES', 'optionImages');
    if (state.optionImages.length !== state.options.length) return failure('OPTION_IMAGES_LENGTH_MISMATCH', 'optionImages');
    if (state.optionImages.some(image => image !== null && !isCopyableImage(image))) return failure('INVALID_OPTION_IMAGES', 'optionImages');
  }
  return null;
}

function inRange(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/** Each success deliberately returns NEW local state. All-null media is omitted
 * only here; the old input is never mutated or normalized in place. */
function success(options: readonly string[], correctAnswers: readonly number[], images?: QuizOptionImages): QuizOptionImageStateResult {
  const value: { options: string[]; correctAnswers: number[]; optionImages?: Array<QuizOptionImage | null> } = {
    options: [...options], correctAnswers: [...correctAnswers],
  };
  if (images !== undefined && images.some(image => image !== null)) {
    value.optionImages = images.map(image => image === null ? null : copyImage(image));
  }
  return { ok: true, value };
}

/** Fresh arrays and nested rights, reusing only immutable asset URL strings. */
export function copyQuizOptionImageState(state: QuizOptionImageState): QuizOptionImageStateResult {
  const invalid = validateState(state);
  return invalid ?? success(state.options, state.correctAnswers, state.optionImages);
}

export function appendQuizOption(state: QuizOptionImageState, caption = ''): QuizOptionImageStateResult {
  const invalid = validateState(state);
  if (invalid) return invalid;
  if (typeof caption !== 'string') return failure('INVALID_CAPTION', 'caption');
  const images = state.optionImages === undefined ? undefined : [...state.optionImages, null];
  return success([...state.options, caption], state.correctAnswers, images);
}

export function replaceQuizOptionCaption(state: QuizOptionImageState, index: number, caption: string): QuizOptionImageStateResult {
  const invalid = validateState(state);
  if (invalid) return invalid;
  if (!inRange(index, state.options.length)) return failure('INVALID_INDEX', 'index');
  if (typeof caption !== 'string') return failure('INVALID_CAPTION', 'caption');
  const options = [...state.options];
  options[index] = caption;
  return success(options, state.correctAnswers, state.optionImages);
}

export function removeQuizOption(state: QuizOptionImageState, index: number): QuizOptionImageStateResult {
  const invalid = validateState(state);
  if (invalid) return invalid;
  if (!inRange(index, state.options.length)) return failure('INVALID_INDEX', 'index');
  return success(
    state.options.filter((_, oldIndex) => oldIndex !== index),
    state.correctAnswers.filter(answer => answer !== index).map(answer => answer > index ? answer - 1 : answer),
    state.optionImages?.filter((_, oldIndex) => oldIndex !== index),
  );
}

/** order[newIndex] = oldIndex. Only a complete, dense bijection is accepted. */
export function reorderQuizOptions(state: QuizOptionImageState, order: ReadonlyArray<number>): QuizOptionImageStateResult {
  const invalid = validateState(state);
  if (invalid) return invalid;
  if (!isDenseDataArray(order) || order.length !== state.options.length ||
      order.some(index => typeof index !== 'number' || !inRange(index, state.options.length)) ||
      new Set(order).size !== order.length) return failure('INVALID_PERMUTATION', 'order');
  const oldToNew = new Map<number, number>();
  order.forEach((oldIndex, newIndex) => oldToNew.set(oldIndex, newIndex));
  // The checked bijection and validated answer indexes make lookups total.
  const options = order.map(oldIndex => state.options[oldIndex] as string);
  const answers = state.correctAnswers.map(oldIndex => oldToNew.get(oldIndex) as number);
  const images = state.optionImages === undefined ? undefined : order.map(oldIndex => state.optionImages![oldIndex] as QuizOptionImage | null);
  return success(options, answers, images);
}

/** toIndex is the desired final index, not a boundary before removing source. */
export function moveQuizOption(state: QuizOptionImageState, fromIndex: number, toIndex: number): QuizOptionImageStateResult {
  const invalid = validateState(state);
  if (invalid) return invalid;
  if (!inRange(fromIndex, state.options.length)) return failure('INVALID_INDEX', 'fromIndex');
  if (!inRange(toIndex, state.options.length)) return failure('INVALID_INDEX', 'toIndex');
  const order = state.options.map((_, index) => index);
  order.splice(fromIndex, 1);
  order.splice(toIndex, 0, fromIndex);
  return reorderQuizOptions(state, order);
}

/** Receives a ready same-course image, never a pending upload/details value. */
export function replaceQuizOptionImage(state: QuizOptionImageState, index: number, image: QuizOptionImage): QuizOptionImageStateResult {
  const invalid = validateState(state);
  if (invalid) return invalid;
  if (!inRange(index, state.options.length)) return failure('INVALID_INDEX', 'index');
  if (!isCopyableImage(image)) return failure('INVALID_OPTION_IMAGES', `optionImages[${index}]`);
  const images = state.optionImages === undefined ? state.options.map(() => null as QuizOptionImage | null) : [...state.optionImages];
  images[index] = image;
  return success(state.options, state.correctAnswers, images);
}

export function removeQuizOptionImage(state: QuizOptionImageState, index: number): QuizOptionImageStateResult {
  const invalid = validateState(state);
  if (invalid) return invalid;
  if (!inRange(index, state.options.length)) return failure('INVALID_INDEX', 'index');
  if (state.optionImages === undefined) return success(state.options, state.correctAnswers);
  const images = [...state.optionImages];
  images[index] = null;
  return success(state.options, state.correctAnswers, images);
}
