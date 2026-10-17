import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

/** A public precondition, never an authorization capability or a hash of quiz
 * answers. Publications are immutable and receive a fresh ID on every publish.
 * D1 reads separately enforce full publication/content parity, and mutation
 * batches fence the exact private snapshot before changing learner evidence. */
export function d1CourseContentVersionToken(publicationId: string, contentId: string): string {
  return createHash('sha256').update(JSON.stringify([
    'd1-course-publication-content-v1', publicationId, contentId,
  ])).digest('base64url');
}

export function matchesD1CourseContentVersionToken(token: unknown, publicationId: string, contentId: string): boolean {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const expected = Buffer.from(d1CourseContentVersionToken(publicationId, contentId));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
