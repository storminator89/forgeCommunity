import 'server-only';

import type { Prisma } from '@prisma/client';
import type { CourseQaCurrentLessonContext, CourseQaLessonContextPair, CourseQaScope } from '@/lib/course-qa-context-contract';
import { completionState } from '@/lib/server/course-progress';
import { CoursePathError, coursePathAccess, publicationPathNodes } from '@/lib/server/course-path';

const unavailable = { status: 'unavailable' } as const;
type Projection = Map<string, { context: CourseQaCurrentLessonContext | null; status: number }>;

/** One lazy, bounded CURRENT-publication proof per authorized transaction. No historical lookup. */
export function courseQaContextProjection(tx: Prisma.TransactionClient, courseId: string, userId: string,
  activePublicationId: string | null, now: number) {
  let pending: Promise<Projection> | undefined;
  const project = () => pending ??= (async () => {
    if (!activePublicationId) return new Map();
    const publication = await tx.coursePublication.findUnique({ where: { id: activePublicationId }, select: { courseId: true, payload: true } });
    if (!publication || publication.courseId !== courseId) throw new CoursePathError('Course publication is unavailable', 409);
    const nodes = publicationPathNodes(publication.payload);
    // Path parsing validates the complete published topology; materialized congruence and
    // grade/current-revision completion use the existing read-only engine, including for staff.
    const live = await tx.courseContent.findMany({ where: { courseId, archivedAt: null }, take: 501,
      select: { id: true, courseId: true, title: true, type: true, content: true, parentId: true, order: true } });
    const byId = new Map(live.map(row => [row.id, row]));
    if (live.length !== nodes.length || nodes.some(node => {
      const row = byId.get(node.id);
      return !row || row.parentId !== node.parentId || row.order !== node.order;
    })) return new Map(nodes.map(node => [node.id, { status: byId.has(node.id) ? 409 : 404, context: null }]));
    const state = await completionState(tx, userId, courseId, now);
    const gates = coursePathAccess(nodes, state.completedContentIds, now);
    const parents = new Set(nodes.map(node => node.parentId));
    return new Map(nodes.map(node => {
      const row = byId.get(node.id)!;
      // publicationPathNodes intentionally returns only its public path shape. Inspect
      // target scalar fields internally, never serialize the publication or lesson body.
      const target = node as typeof node & { type?: unknown; content?: unknown };
      const type = target.type === 'QUIZ' ? 'TEXT' : target.type;
      const status = parents.has(node.id) ? 404 :
        typeof target.content !== 'string' || ![null, 'TEXT', 'VIDEO', 'AUDIO', 'H5P', 'ASSIGNMENT'].includes(type as string | null) ||
        row.title !== node.title || row.type !== type || row.content !== target.content ? 409 :
        gates.get(node.id)?.locked !== false ? 423 : 200;
      return [node.id, { status, context: status === 200 ? {
        status: 'current' as const, publicationId: activePublicationId, contentId: node.id, title: row.title,
        href: `/courses/${encodeURIComponent(courseId)}/contents?content=${encodeURIComponent(node.id)}`,
      } : null }];
    }));
  })();

  async function result(pair: CourseQaLessonContextPair) {
    if (pair.publicationId !== activePublicationId) return { status: 412, context: null };
    try { return (await project()).get(pair.contentId) ?? { status: 404, context: null }; }
    catch (error) {
      if (error instanceof CoursePathError) return { status: error.status, context: null };
      throw error; // A service failure is not evidence of lost permission.
    }
  }
  return {
    async context(pair: CourseQaLessonContextPair | null) {
      if (!pair) return null;
      return (await result(pair)).context ?? unavailable;
    },
    async scope(pair: CourseQaLessonContextPair | null): Promise<CourseQaScope> {
      return pair ? { kind: 'lesson', lessonContext: (await result(pair)).context ?? unavailable } : { kind: 'course' };
    },
    async assertCurrent(pair: CourseQaLessonContextPair) {
      const proof = await result(pair);
      if (!proof.context) throw new CoursePathError('Lektionskontext ist nicht verfügbar. Bitte neu laden.', proof.status);
      return proof.context;
    },
  };
}
