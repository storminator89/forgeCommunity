import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../auth/[...nextauth]/options';
import prisma from '@/lib/prisma';

function groupContents<T extends { id: string; parentId: string | null }>(contents: T[]) {
  const childrenByParent = new Map<string, T[]>();

  for (const content of contents) {
    if (!content.parentId) continue;
    const children = childrenByParent.get(content.parentId) ?? [];
    children.push(content);
    childrenByParent.set(content.parentId, children);
  }

  return contents
    .filter((content) => !content.parentId)
    .map((content) => ({
      ...content,
      subContents: childrenByParent.get(content.id) ?? [],
    }));
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ courseId: string; contentId: string }> },
) {
  const params = await props.params;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { targetId, position } = body as {
      targetId?: unknown;
      position?: unknown;
    };

    if (
      typeof targetId !== 'string' ||
      !targetId ||
      (position !== 'before' && position !== 'after' && position !== 'inside')
    ) {
      return NextResponse.json({ error: 'Invalid move request' }, { status: 400 });
    }

    if (targetId === params.contentId) {
      return NextResponse.json({ error: 'Content cannot be moved onto itself' }, { status: 400 });
    }

    const movedContent = await prisma.courseContent.findUnique({
      where: { id: params.contentId },
      select: {
        id: true,
        courseId: true,
        parentId: true,
        order: true,
        course: { select: { instructorId: true } },
      },
    });

    if (!movedContent || movedContent.courseId !== params.courseId) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    if (
      movedContent.course.instructorId !== session.user.id &&
      session.user.role !== 'ADMIN'
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const targetContent = await prisma.courseContent.findUnique({
      where: { id: targetId },
      select: { id: true, courseId: true, parentId: true, order: true },
    });

    if (!targetContent || targetContent.courseId !== params.courseId) {
      return NextResponse.json({ error: 'Target content not found' }, { status: 404 });
    }

    const contents = await prisma.$transaction(async (tx) => {
      // A content item cannot be placed below one of its descendants. Walk
      // the target's ancestry inside the transaction so the relationship
      // cannot change between authorization and the move.
      const visited = new Set<string>();
      let ancestorId = targetContent.parentId;
      while (ancestorId && !visited.has(ancestorId)) {
        if (ancestorId === movedContent.id) {
          throw new Error('CONTENT_MOVE_CYCLE');
        }
        visited.add(ancestorId);
        const ancestor = await tx.courseContent.findUnique({
          where: { id: ancestorId },
          select: { parentId: true, courseId: true },
        });
        if (!ancestor || ancestor.courseId !== params.courseId) break;
        ancestorId = ancestor.parentId;
      }

      const destinationParentId = position === 'inside' ? targetContent.id : targetContent.parentId;
      const oldSiblings = await tx.courseContent.findMany({
        where: { courseId: params.courseId, parentId: movedContent.parentId },
        select: { id: true, parentId: true, order: true },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
      const destinationSiblings = destinationParentId === movedContent.parentId
        ? oldSiblings
        : await tx.courseContent.findMany({
            where: { courseId: params.courseId, parentId: destinationParentId },
            select: { id: true, parentId: true, order: true },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
          });

      const oldWithoutMoved = oldSiblings.filter((content) => content.id !== movedContent.id);
      const destinationWithoutMoved = destinationSiblings.filter((content) => content.id !== movedContent.id);
      const targetIndex = destinationWithoutMoved.findIndex((content) => content.id === targetContent.id);
      const insertionIndex = position === 'inside'
        ? destinationWithoutMoved.length
        : targetIndex + (position === 'after' ? 1 : 0);

      if (insertionIndex < 0 || (position !== 'inside' && targetIndex < 0)) {
        throw new Error('CONTENT_MOVE_TARGET_NOT_FOUND');
      }

      const newDestination = [...destinationWithoutMoved];
      newDestination.splice(insertionIndex, 0, {
        id: movedContent.id,
        parentId: destinationParentId,
        order: movedContent.order,
      });

      const updates = [] as Promise<unknown>[];
      if (destinationParentId !== movedContent.parentId) {
        updates.push(...oldWithoutMoved.map((content, index) =>
          tx.courseContent.update({
            where: { id: content.id },
            data: { order: index + 1 },
          }),
        ));
      }

      updates.push(...newDestination.map((content, index) =>
        tx.courseContent.update({
          where: { id: content.id },
          data: { order: index + 1, parentId: destinationParentId },
        }),
      ));

      await Promise.all(updates);

      const contents = await tx.courseContent.findMany({
        where: { courseId: params.courseId },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });

      return contents;
    });

    return NextResponse.json(groupContents(contents));
  } catch (error) {
    if (error instanceof Error && error.message === 'CONTENT_MOVE_CYCLE') {
      return NextResponse.json({ error: 'Content cannot be moved below its descendant' }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'CONTENT_MOVE_TARGET_NOT_FOUND') {
      return NextResponse.json({ error: 'Target content not found' }, { status: 404 });
    }

    console.error('Error moving course content:', error);
    return NextResponse.json({ error: 'Failed to move content' }, { status: 500 });
  }
}
