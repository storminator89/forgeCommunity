import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../auth/[...nextauth]/options';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { assertCanAttachH5P } from '@/lib/server/h5p-access';
import { H5PValidationError } from '@/lib/server/h5p-archive';
import { assertParent, canEdit, contentTransaction, ContentMutationError, normalizeOrder, presentContent, prepareContent, siblings, validateContentFields } from '../content-mutations';

export async function DELETE(request: NextRequest, props: { params: Promise<{ courseId: string; contentId: string }> }) {
  const { courseId, contentId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const deletedContent = await contentTransaction(async (tx) => {
      const current = await tx.courseContent.findUnique({ where: { id: contentId }, include: { course: { select: { instructorId: true } } } });
      if (!current || current.courseId !== courseId) throw new ContentMutationError('Content not found', 404);
      canEdit(current.course.instructorId, session.user);
      const contents = await tx.courseContent.findMany({ where: { courseId }, select: { id: true, parentId: true } });
      const descendants = new Set([contentId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of contents) {
          if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); changed = true; }
        }
      }
      const remaining = new Map(contents.filter(item => descendants.has(item.id)).map(item => [item.id, item]));
      while (remaining.size) {
        const parents = new Set([...remaining.values()].map(item => item.parentId));
        const leaves = [...remaining.keys()].filter(id => !parents.has(id));
        if (!leaves.length) throw new ContentMutationError('Invalid content hierarchy', 409);
        await tx.courseContent.deleteMany({ where: { courseId, id: { in: leaves } } });
        leaves.forEach(id => remaining.delete(id));
      }
      await normalizeOrder(tx, (await siblings(tx, courseId, current.parentId)).map(item => item.id));
      const { course: _course, ...deleted } = current;
      return deleted;
    });
    return NextResponse.json({ success: true, message: 'Content deleted successfully', deletedContent });
  } catch (error) {
    if (error instanceof ContentMutationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error deleting content:', error);
    return NextResponse.json({ error: 'Failed to delete content' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, props: { params: Promise<{ courseId: string; contentId: string }> }) {
  const { courseId, contentId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await readJsonObject(request);
    validateContentFields(body, false);
    const updatedContent = await contentTransaction(async (tx) => {
      const current = await tx.courseContent.findUnique({ where: { id: contentId }, include: { course: { select: { instructorId: true } } } });
      if (!current || current.courseId !== courseId) throw new ContentMutationError('Content not found', 404);
      canEdit(current.course.instructorId, session.user);
      const destinationParentId = body.parentId === undefined ? current.parentId : body.parentId as string | null;
      if (body.parentId !== undefined) await assertParent(tx, courseId, destinationParentId, contentId);
      const effectiveType = body.type === undefined ? current.type : body.type as string | null;
      const prepared = body.content !== undefined ? prepareContent(body.content as string, effectiveType) :
        body.type !== undefined ? prepareContent(current.content, effectiveType) : undefined;
      if (effectiveType === 'H5P' && prepared && (current.type !== 'H5P' || prepared !== current.content)) await assertCanAttachH5P(session.user.id, session.user.role, prepared, request.nextUrl.origin, tx);
      const data = {
        ...(body.title !== undefined && { title: sanitizeTextServer(body.title as string) }),
        ...(body.type !== undefined && { type: effectiveType === 'QUIZ' ? 'TEXT' as const : effectiveType as 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | null }),
        ...(prepared !== undefined && { content: prepared }),
        ...(body.parentId !== undefined && { parentId: destinationParentId }),
      };
      let order = current.order;
      let updated;
      if (body.order !== undefined || destinationParentId !== current.parentId) {
        const destination = (await siblings(tx, courseId, destinationParentId)).filter(item => item.id !== contentId);
        const insertionIndex = typeof body.order === 'number' ? Math.max(0, Math.min(body.order - 1, destination.length)) : destination.length;
        order = insertionIndex + 1;
        destination.splice(insertionIndex, 0, { id: contentId, order });
        updated = await tx.courseContent.update({ where: { id: contentId }, data: { ...data, order } });
        if (destinationParentId !== current.parentId) await normalizeOrder(tx, (await siblings(tx, courseId, current.parentId)).filter(item => item.id !== contentId).map(item => item.id));
        await normalizeOrder(tx, destination.map(item => item.id));
      } else {
        updated = await tx.courseContent.update({ where: { id: contentId }, data });
      }
      return presentContent({ ...updated, order });
    });
    return NextResponse.json(updatedContent);
  } catch (error) {
    if (error instanceof ContentMutationError) return NextResponse.json({ error: error.message }, { status: error.status });
    const inputError = requestErrorResponse(error);
    if (error instanceof H5PValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (inputError) return inputError;
    console.error('Error updating content:', error);
    return NextResponse.json({ error: 'Failed to update content' }, { status: 500 });
  }
}
