// app/api/courses/[courseId]/contents/[contentId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../auth/[...nextauth]/options";
import prisma from '@/lib/prisma';
import { sanitizeCourseTextContentServer, sanitizeTextServer } from '@/lib/server/sanitize-html';

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ courseId: string; contentId: string }> }
) {
  const params = await props.params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const existingContent = await prisma.courseContent.findUnique({
      where: { id: params.contentId },
      select: {
        id: true,
        courseId: true,
        type: true,
        course: {
          select: {
            instructorId: true,
          },
        },
      },
    });

    if (!existingContent || existingContent.courseId !== params.courseId) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    if (
      existingContent.course.instructorId !== session.user.id &&
      session.user.role !== 'ADMIN'
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const deletedContent = await prisma.$transaction(async (tx) => {
      await tx.courseContent.deleteMany({
        where: { parentId: params.contentId },
      });

      return tx.courseContent.delete({
        where: { id: params.contentId },
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Content deleted successfully',
      deletedContent
    });
  } catch (error) {
    console.error('Error in DELETE operation:', error);
    return NextResponse.json({
      error: 'Failed to delete content',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

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

    const existingContent = await prisma.courseContent.findUnique({
      where: { id: params.contentId },
      select: {
        id: true,
        courseId: true,
        type: true,
        course: {
          select: {
            instructorId: true,
          },
        },
      },
    });

    if (!existingContent || existingContent.courseId !== params.courseId) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    if (
      existingContent.course.instructorId !== session.user.id &&
      session.user.role !== 'ADMIN'
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { title, type, content, order, parentId } = body;
    const sanitizedTitle = title !== undefined ? sanitizeTextServer(title) : undefined;
    const effectiveType = type ?? existingContent.type;
    const sanitizedContent =
      content !== undefined
        ? (effectiveType === 'TEXT' || effectiveType === null
            ? sanitizeCourseTextContentServer(content)
            : sanitizeTextServer(content))
        : undefined;

    const updatedContent = await prisma.courseContent.update({
      where: {
        id: params.contentId,
      },
      data: {
        ...(sanitizedTitle !== undefined && { title: sanitizedTitle }),
        ...(type !== undefined && { type }),
        ...(sanitizedContent !== undefined && { content: sanitizedContent }),
        ...(order !== undefined && { order }),
        ...(parentId !== undefined && { parentId })
      },
    });

    return NextResponse.json(updatedContent);
  } catch (error) {
    console.error('Error updating content:', error);
    return NextResponse.json({ error: 'Failed to update content' }, { status: 500 });
  }
}
