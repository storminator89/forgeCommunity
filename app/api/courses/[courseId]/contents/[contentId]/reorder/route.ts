import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../../auth/[...nextauth]/options";
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ courseId: string; contentId: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { direction, mainContentId } = await readJsonObject(request);
    if ((direction !== 'up' && direction !== 'down') || typeof mainContentId !== 'string' || !mainContentId) {
      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 });
    }

    const parentContent = await prisma.courseContent.findUnique({
      where: { id: mainContentId },
      select: {
        id: true,
        courseId: true,
        course: {
          select: {
            instructorId: true,
          },
        },
      },
    });

    if (!parentContent || parentContent.courseId !== params.courseId) {
      return NextResponse.json({ error: 'Main content not found' }, { status: 404 });
    }

    if (
      parentContent.course.instructorId !== session.user.id &&
      session.user.role !== 'ADMIN'
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await prisma.$transaction(async (tx) => {
          const subContents = await tx.courseContent.findMany({
            where: { parentId: mainContentId, courseId: params.courseId },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
          });
          const currentIndex = subContents.findIndex(content => content.id === params.contentId);
          if (currentIndex === -1) throw new Error('CONTENT_NOT_FOUND');
          const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
          if (newIndex < 0 || newIndex >= subContents.length) throw new Error('CONTENT_BOUNDARY');
          const current = subContents[currentIndex];
          const target = subContents[newIndex];
          await tx.courseContent.update({ where: { id: current.id }, data: { order: target.order } });
          await tx.courseContent.update({ where: { id: target.id }, data: { order: current.order } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if (attempt === 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'CONTENT_NOT_FOUND') return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    if (error instanceof Error && error.message === 'CONTENT_BOUNDARY') return NextResponse.json({ error: 'Cannot move content further' }, { status: 400 });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Error reordering content:', error);
    return NextResponse.json({ error: 'Failed to reorder content' }, { status: 500 });
  }
}
