import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { completionState } from '@/lib/server/course-progress';
import { CoursePathError, publicationPathNodes } from '@/lib/server/course-path';
import { chapterIsReleased, chapterReleaseDates, chapterReleaseLabel } from '@/lib/course-release';

export { CoursePathError } from '@/lib/server/course-path';

/**
 * Gate the current published node against server time in the caller's
 * authenticated, authorized serializable transaction. A saved draft never
 * grants or removes access.
 */
export async function assertCurrentChapterRelease(
  tx: Prisma.TransactionClient, courseId: string, contentId: string, publicationId: string, now = Date.now(),
) {
  const course = await tx.course.findUnique({ where: { id: courseId }, select: { activePublicationId: true } });
  if (!course?.activePublicationId) throw new CoursePathError('Course not found', 404);
  if (course.activePublicationId !== publicationId) throw new CoursePathError('Course publication changed; reload before continuing', 412);
  const publication = await tx.coursePublication.findUnique({ where: { id: publicationId }, select: { courseId: true, payload: true } });
  if (!publication || publication.courseId !== courseId) throw new CoursePathError('Course publication is unavailable', 409);
  const nodes = publicationPathNodes(publication.payload);
  const node = nodes.find(row => row.id === contentId);
  if (!node) throw new CoursePathError('Content not found', 404);
  const live = await tx.courseContent.findUnique({ where: { id: contentId }, select: { courseId: true, archivedAt: true } });
  if (!live || live.courseId !== courseId || live.archivedAt) throw new CoursePathError('Content not found', 404);
  // The date gate must precede the no-prerequisites fast path. Reauthorize
  // direct submissions, evidence, H5P and asset requests against server time.
  const releaseOn = chapterReleaseDates(nodes).get(contentId) ?? null;
  if (!chapterIsReleased(releaseOn, now)) {
    throw new CoursePathError(`Freigabe ab ${chapterReleaseLabel(releaseOn!)}`, 423);
  }
  return node;
}

/** Current-revision and grade-aware prerequisite proof shares the same snapshot. */
export async function assertCurrentPrerequisites(
  tx: Prisma.TransactionClient, userId: string, courseId: string, contentId: string, publicationId: string, now = Date.now(),
): Promise<void> {
  const node = await assertCurrentChapterRelease(tx, courseId, contentId, publicationId, now);
  if (!(node.prerequisiteIds ?? []).length) return;
  const state = await completionState(tx, userId, courseId, now);
  const completed = new Set(state.completedContentIds);
  if (node.prerequisiteIds?.some(id => !completed.has(id))) {
    throw new CoursePathError('Complete the required earlier content before continuing', 423);
  }
}
