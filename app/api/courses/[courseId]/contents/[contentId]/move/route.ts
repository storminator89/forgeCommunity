import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { groupCourseContents } from '@/lib/server/group-course-contents';

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ courseId: string; contentId: string }> },
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { targetId, position } = await readJsonObject(request);
    if (typeof targetId !== 'string' || !targetId ||
        (position !== 'before' && position !== 'after' && position !== 'inside')) {
      return NextResponse.json({ error: 'Invalid move request' }, { status: 400 });
    }
    if (targetId === params.contentId) return NextResponse.json({ error: 'Content cannot be moved onto itself' }, { status: 400 });

    let contents;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        contents = await prisma.$transaction(async (tx) => {
          const moved = await tx.courseContent.findUnique({
            where: { id: params.contentId },
            select: { id: true, courseId: true, parentId: true, order: true, course: { select: { instructorId: true } } },
          });
          if (!moved || moved.courseId !== params.courseId) throw new Error('CONTENT_NOT_FOUND');
          if (moved.course.instructorId !== session.user.id && session.user.role !== 'ADMIN') throw new Error('CONTENT_FORBIDDEN');
          const target = await tx.courseContent.findUnique({
            where: { id: targetId }, select: { id: true, courseId: true, parentId: true, order: true },
          });
          if (!target || target.courseId !== params.courseId) throw new Error('TARGET_NOT_FOUND');

          // The ancestry and both sibling sets must be read in the same
          // serializable transaction as the write, including the two nodes.
          const destinationParentId = position === 'inside' ? target.id : target.parentId;
          const visited = new Set<string>();
          let ancestorId = destinationParentId;
          while (ancestorId) {
            if (ancestorId === moved.id || visited.has(ancestorId)) throw new Error('CONTENT_MOVE_CYCLE');
            visited.add(ancestorId);
            const ancestor = await tx.courseContent.findUnique({
              where: { id: ancestorId }, select: { parentId: true, courseId: true },
            });
            if (!ancestor || ancestor.courseId !== params.courseId) throw new Error('CONTENT_MOVE_CYCLE');
            ancestorId = ancestor.parentId;
          }

          const oldSiblings = await tx.courseContent.findMany({
            where: { courseId: params.courseId, parentId: moved.parentId },
            select: { id: true, parentId: true, order: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }],
          });
          const destinationSiblings = destinationParentId === moved.parentId ? oldSiblings : await tx.courseContent.findMany({
            where: { courseId: params.courseId, parentId: destinationParentId },
            select: { id: true, parentId: true, order: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }],
          });
          const oldWithoutMoved = oldSiblings.filter((content) => content.id !== moved.id);
          const destinationWithoutMoved = destinationSiblings.filter((content) => content.id !== moved.id);
          const targetIndex = destinationWithoutMoved.findIndex((content) => content.id === target.id);
          const insertionIndex = position === 'inside' ? destinationWithoutMoved.length : targetIndex + (position === 'after' ? 1 : 0);
          if (position !== 'inside' && targetIndex < 0) throw new Error('TARGET_NOT_FOUND');
          const newDestination = [...destinationWithoutMoved];
          newDestination.splice(insertionIndex, 0, { id: moved.id, parentId: destinationParentId, order: moved.order });
          if (destinationParentId !== moved.parentId) {
            for (const [index, content] of oldWithoutMoved.entries()) {
              await tx.courseContent.update({ where: { id: content.id }, data: { order: index + 1 } });
            }
          }
          for (const [index, content] of newDestination.entries()) {
            await tx.courseContent.update({ where: { id: content.id }, data: { order: index + 1, parentId: destinationParentId } });
          }
          return tx.courseContent.findMany({
            where: { courseId: params.courseId }, orderBy: [{ order: 'asc' }, { id: 'asc' }],
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if (attempt === 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    return NextResponse.json(groupCourseContents(contents!));
  } catch (error) {
    const status: Record<string, number> = {
      CONTENT_NOT_FOUND: 404, CONTENT_FORBIDDEN: 403, TARGET_NOT_FOUND: 404, CONTENT_MOVE_CYCLE: 400,
    };
    if (error instanceof Error && status[error.message]) {
      return NextResponse.json({ error: error.message === 'CONTENT_MOVE_CYCLE' ? 'Content cannot be moved below its descendant' : error.message }, { status: status[error.message] });
    }
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Error moving course content:', error);
    return NextResponse.json({ error: 'Failed to move content' }, { status: 500 });
  }
}
