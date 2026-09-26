// app/api/courses/[courseId]/contents/[contentId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../auth/[...nextauth]/options";
import prisma from '@/lib/prisma';
import { sanitizeCourseTextContentServer, sanitizeTextServer } from '@/lib/server/sanitize-html';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { Prisma } from '@prisma/client';

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
      const contents = await tx.courseContent.findMany({
        where: { courseId: params.courseId }, select: { id: true, parentId: true },
      });
      const descendants = new Set([params.contentId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const content of contents) {
          if (content.parentId && descendants.has(content.parentId) && !descendants.has(content.id)) {
            descendants.add(content.id);
            changed = true;
          }
        }
      }
      const remaining = contents.filter((content) => descendants.has(content.id) && content.id !== params.contentId);
      while (remaining.length) {
        const parents = new Set(remaining.map((content) => content.parentId));
        const leaves = remaining.filter((content) => !parents.has(content.id));
        if (!leaves.length) throw new Error('Invalid content hierarchy');
        await tx.courseContent.deleteMany({ where: { id: { in: leaves.map((content) => content.id) } } });
        for (const leaf of leaves) remaining.splice(remaining.indexOf(leaf), 1);
      }
      return tx.courseContent.delete({ where: { id: params.contentId } });
    });

    return NextResponse.json({
      success: true,
      message: 'Content deleted successfully',
      deletedContent
    });
  } catch (error) {
    console.error('Error in DELETE operation:', error);
    return NextResponse.json({ error: 'Failed to delete content' }, { status: 500 });
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

    const body = await readJsonObject(request);
    const { title, type, content, order, parentId } = body;

    if ((parentId !== undefined && parentId !== null && (typeof parentId !== 'string' || !parentId)) ||
        (title !== undefined && typeof title !== 'string') ||
        (content !== undefined && typeof content !== 'string') ||
        (type !== undefined && type !== null && !['TEXT', 'VIDEO', 'AUDIO', 'H5P'].includes(String(type))) ||
        (order !== undefined && (!Number.isSafeInteger(order) || Number(order) < 0))) {
      return NextResponse.json({ error: 'Invalid content fields' }, { status: 400 });
    }

    const sanitizedTitle = title !== undefined ? sanitizeTextServer(title as string) : undefined;
    const effectiveType = type ?? existingContent.type;
    const sanitizedContent =
      content !== undefined
        ? (effectiveType === 'TEXT' || effectiveType === null
            ? sanitizeCourseTextContentServer(content as string)
            : sanitizeTextServer(content as string))
        : undefined;

    let updatedContent;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        updatedContent = await prisma.$transaction(async (tx) => {
          const current = await tx.courseContent.findUnique({
            where: { id: params.contentId }, select: { courseId: true, course: { select: { instructorId: true } } },
          });
          if (!current || current.courseId !== params.courseId) throw new Error('CONTENT_NOT_FOUND');
          if (current.course.instructorId !== session.user.id && session.user.role !== 'ADMIN') throw new Error('CONTENT_FORBIDDEN');
          const visited = new Set<string>();
          let ancestorId = typeof parentId === 'string' ? parentId : null;
          while (ancestorId) {
            if (ancestorId === params.contentId || visited.has(ancestorId)) throw new Error('INVALID_PARENT');
            visited.add(ancestorId);
            const ancestor = await tx.courseContent.findUnique({ where: { id: ancestorId }, select: { courseId: true, parentId: true } });
            if (!ancestor || ancestor.courseId !== params.courseId) throw new Error('INVALID_PARENT');
            ancestorId = ancestor.parentId;
          }
          return tx.courseContent.update({
            where: { id: params.contentId },
            data: {
              ...(sanitizedTitle !== undefined && { title: sanitizedTitle }),
              ...(type !== undefined && { type: type as Prisma.CourseContentUpdateInput['type'] }),
              ...(sanitizedContent !== undefined && { content: sanitizedContent }),
              ...(order !== undefined && { order: order as number }),
              ...(parentId !== undefined && { parentId: parentId as string | null }),
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if (attempt === 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }

    return NextResponse.json(updatedContent);
  } catch (error) {
    if (error instanceof Error && ['INVALID_PARENT', 'CONTENT_NOT_FOUND', 'CONTENT_FORBIDDEN'].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'INVALID_PARENT' ? 400 : error.message === 'CONTENT_NOT_FOUND' ? 404 : 403 });
    }
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Error updating content:', error);
    return NextResponse.json({ error: 'Failed to update content' }, { status: 500 });
  }
}
