import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../auth/[...nextauth]/options';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { groupCourseContents } from '@/lib/server/group-course-contents';
import { canEdit, contentTransaction, ContentMutationError, normalizeOrder, presentContent, siblings } from '../../content-mutations';

export async function PUT(request: NextRequest, props: { params: Promise<{ courseId: string; contentId: string }> }) {
  const { courseId, contentId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { direction, mainContentId } = await readJsonObject(request);
    if ((direction !== 'up' && direction !== 'down') || (mainContentId !== null && (typeof mainContentId !== 'string' || !mainContentId))) {
      return NextResponse.json({ error: 'Invalid reorder request' }, { status: 400 });
    }
    const contents = await contentTransaction(async (tx) => {
      const current = await tx.courseContent.findUnique({ where: { id: contentId }, select: { courseId: true, parentId: true, course: { select: { instructorId: true } } } });
      if (!current || current.courseId !== courseId || current.parentId !== mainContentId) throw new ContentMutationError('Content not found', 404);
      canEdit(current.course.instructorId, session.user);
      const ordered = await siblings(tx, courseId, mainContentId as string | null);
      const currentIndex = ordered.findIndex(item => item.id === contentId);
      if (currentIndex < 0) throw new ContentMutationError('Content not found', 404);
      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= ordered.length) throw new ContentMutationError('Cannot move content further');
      [ordered[currentIndex], ordered[nextIndex]] = [ordered[nextIndex], ordered[currentIndex]];
      // Swapping equal legacy order values never changes their sort order.
      // Normalize the complete sibling set to unique ranks in one transaction.
      await normalizeOrder(tx, ordered.map(item => item.id));
      return tx.courseContent.findMany({ where: { courseId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
    });
    return NextResponse.json({ success: true, contents: groupCourseContents(contents.map(presentContent)) });
  } catch (error) {
    if (error instanceof ContentMutationError) return NextResponse.json({ error: error.message }, { status: error.status });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Error reordering content:', error);
    return NextResponse.json({ error: 'Failed to reorder content' }, { status: 500 });
  }
}
