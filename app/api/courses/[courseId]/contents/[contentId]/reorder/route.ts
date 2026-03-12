import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../../auth/[...nextauth]/options";
import prisma from '@/lib/prisma';

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

    const { direction, mainContentId } = await request.json();
    if (direction !== 'up' && direction !== 'down') {
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

    const subContents = await prisma.courseContent.findMany({
      where: {
        parentId: mainContentId,
        courseId: params.courseId,
      },
      orderBy: { order: 'asc' },
    });

    const currentIndex = subContents.findIndex(content => content.id === params.contentId);
    if (currentIndex === -1) return NextResponse.json({ error: 'Content not found' }, { status: 404 });

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= subContents.length) {
      return NextResponse.json({ error: 'Cannot move content further' }, { status: 400 });
    }

    // Tausche die order-Werte
    const currentOrder = subContents[currentIndex].order;
    const targetOrder = subContents[newIndex].order;

    await prisma.$transaction([
      prisma.courseContent.update({
        where: { id: subContents[currentIndex].id },
        data: { order: targetOrder },
      }),
      prisma.courseContent.update({
        where: { id: subContents[newIndex].id },
        data: { order: currentOrder },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reordering content:', error);
    return NextResponse.json({ error: 'Failed to reorder content' }, { status: 500 });
  }
}
