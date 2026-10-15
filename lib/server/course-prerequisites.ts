import 'server-only';

import type { Prisma } from '@prisma/client';
import { completionState } from '@/lib/server/course-progress';
import { CoursePathError, publicationPathNodes } from '@/lib/server/course-path';

export { CoursePathError } from '@/lib/server/course-path';

/**
 * Gate learner actions in the caller's serializable transaction. The active
 * publication, projected leaf, and grade-aware current completion are read
 * from one snapshot; a saved draft never grants or removes access.
 */
export async function assertCurrentPrerequisites(
  tx: Prisma.TransactionClient, userId: string, courseId: string, contentId: string, publicationId: string,
): Promise<void> {
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
  if (!(node.prerequisiteIds ?? []).length) return;
  const state = await completionState(tx, userId, courseId);
  const completed = new Set(state.completedContentIds);
  if (node.prerequisiteIds?.some(id => !completed.has(id))) {
    throw new CoursePathError('Complete the required earlier content before continuing', 423);
  }
}
