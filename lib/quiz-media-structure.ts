/**
 * STRUCTURAL VALIDATION ONLY. No inferred course identity may authorize a
 * mutation, public projection, asset reference or byte read. Those boundaries
 * MUST supply the real expected course ID to the strict media contract.
 */
import { parseCanonicalQuizOptionAssetUrl } from './quiz-media-contract';

/** Compatibility for existing context-free quiz classification/readiness and
 * credential-overlap callers. Infer one candidate from a canonical media src;
 * the strict parser must then validate EVERY entry against that candidate.
 * No recursive scan, solution/explanation lookup, or URL normalization occurs.
 */
export function inferQuizMediaCourseIdForStructuralValidationOnly(question: unknown): string | null {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(question, 'optionImages');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Array.isArray(descriptor.value)) return null;
  for (let index = 0; index < descriptor.value.length; index++) {
    const entryDescriptor = Object.getOwnPropertyDescriptor(descriptor.value, String(index));
    if (!entryDescriptor || !Object.hasOwn(entryDescriptor, 'value')) return null;
    const entry: unknown = entryDescriptor.value;
    if (entry === null) continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const sourceDescriptor = Object.getOwnPropertyDescriptor(entry, 'src');
    if (!sourceDescriptor || !Object.hasOwn(sourceDescriptor, 'value') || typeof sourceDescriptor.value !== 'string') return null;
    const source = sourceDescriptor.value;
    const match = /^\/api\/courses\/([A-Za-z0-9_-]{1,80})\/assets\/[A-Za-z0-9_-]{1,80}$/.exec(source);
    const courseId = match?.[1];
    if (!courseId || !parseCanonicalQuizOptionAssetUrl(source, courseId).ok) return null;
    return courseId;
  }
  return null;
}

/** Classify quizzes BEFORE HTML scanners. Malformed quiz-like legacy JSON is
 * still quiz-like and must never gain text-image access by a parse failure. */
export function isQuizLikeBodyForMediaPolicy(node: { readonly type: unknown; readonly content: unknown }): boolean {
  if (node.type === 'QUIZ') return true;
  if (node.type !== null && node.type !== 'TEXT') return false;
  if (typeof node.content !== 'string') return false;
  try {
    const value: unknown = JSON.parse(node.content);
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'questions'));
  } catch {
    return node.content.trimStart().startsWith('{') && /["']questions["']\s*:/.test(node.content);
  }
}
