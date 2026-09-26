// app/api/courses/[courseId]/contents/route.ts

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { sanitizeCourseTextContentServer, sanitizeTextServer } from '@/lib/server/sanitize-html';
import { groupCourseContents } from '@/lib/server/group-course-contents';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { Prisma } from '@prisma/client';

// GET-Methode zum Abrufen der Kursinhalte
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ courseId: string }> }
) {
  const params = await props.params;
  const courseId = params.courseId;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { instructorId: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    if (session.user.role !== 'ADMIN' && course.instructorId !== session.user.id) {
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          userId_courseId: {
            userId: session.user.id,
            courseId,
          },
        },
        select: { id: true },
      });

      if (!enrollment) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }
    }

    const contents = await prisma.courseContent.findMany({
      where: { courseId: courseId },
      orderBy: { order: 'asc' },
    });

    return NextResponse.json(groupCourseContents(contents));
  } catch (error) {
    console.error('Failed to fetch course contents:', error);
    return NextResponse.json({ error: 'Failed to fetch course contents' }, { status: 500 });
  }
}

// POST-Methode zum Hinzufügen eines neuen Inhalts
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ courseId: string }> }
) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  const courseId = params.courseId;

  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { instructorId: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    if (course.instructorId !== session.user.id && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { title, type, content, order, parentId } = await readJsonObject(request);
    if (parentId !== undefined && parentId !== null && typeof parentId !== 'string') {
      return NextResponse.json({ error: 'Invalid parent content' }, { status: 400 });
    }

    if (typeof title !== 'string' || !title.trim() || (content !== undefined && typeof content !== 'string') ||
        (type !== undefined && type !== null && !['TEXT', 'VIDEO', 'AUDIO', 'H5P'].includes(String(type))) ||
        (order !== undefined && (!Number.isSafeInteger(order) || Number(order) < 0))) {
      return NextResponse.json({ error: 'Invalid content fields' }, { status: 400 });
    }

    const sanitizedTitle = sanitizeTextServer(title);
    const sanitizedContent =
      type === 'TEXT' || !type
        ? sanitizeCourseTextContentServer(content as string | undefined)
        : sanitizeTextServer(content as string | undefined);

    // If order is not provided, find the next available order number
    const newContent = await prisma.$transaction(async (tx) => {
      if (parentId) {
        const parentContent = await tx.courseContent.findUnique({
          where: { id: parentId }, select: { courseId: true },
        });
        if (!parentContent || parentContent.courseId !== courseId) throw new Error('INVALID_PARENT');
      }
      const last = typeof order === 'number' ? null : await tx.courseContent.findFirst({
        where: { courseId, parentId: typeof parentId === 'string' && parentId ? parentId : null },
        orderBy: { order: 'desc' }, select: { order: true },
      });
      return tx.courseContent.create({ data: {
        title: sanitizedTitle, type: (type || 'TEXT') as Prisma.CourseContentCreateInput['type'],
        content: sanitizedContent, order: typeof order === 'number' ? order : (last?.order ?? 0) + 1,
        parentId: typeof parentId === 'string' && parentId ? parentId : null, courseId,
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json(newContent, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PARENT') return NextResponse.json({ error: 'Invalid parent content' }, { status: 400 });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to create course content:', error);
    return NextResponse.json({ error: 'Failed to create course content' }, { status: 500 });
  }
}
