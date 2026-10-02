// app/api/courses/[courseId]/contents/route.ts

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { groupCourseContents } from '@/lib/server/group-course-contents';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { assertCanAttachH5P } from '@/lib/server/h5p-access';
import { H5PValidationError } from '@/lib/server/h5p-archive';
import { assertParent, canEdit, contentTransaction, ContentMutationError, normalizeOrder, presentContent, prepareContent, siblings, validateContentFields } from './content-mutations';

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
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });

    return NextResponse.json(groupCourseContents(contents.map(presentContent)));
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

    const body = await readJsonObject(request);
    validateContentFields(body, true);
    const { title, type, content, order } = body;
    const parentId = typeof body.parentId === 'string' ? body.parentId : null;
    const effectiveType = typeof type === 'string' ? type : 'TEXT';
    const sanitizedContent = prepareContent(typeof content === 'string' ? content : '', effectiveType);
    if (effectiveType === 'H5P' && sanitizedContent) await assertCanAttachH5P(session.user.id, session.user.role, sanitizedContent, request.nextUrl.origin);
    const newContent = await contentTransaction(async (tx) => {
      const currentCourse = await tx.course.findUnique({ where: { id: courseId }, select: { instructorId: true } });
      if (!currentCourse) throw new ContentMutationError('Course not found', 404);
      canEdit(currentCourse.instructorId, session.user);
      await assertParent(tx, courseId, parentId);
      const currentSiblings = await siblings(tx, courseId, parentId);
      const insertionIndex = typeof order === 'number' ? Math.max(0, Math.min(order - 1, currentSiblings.length)) : currentSiblings.length;
      const created = await tx.courseContent.create({ data: {
        title: sanitizeTextServer(title as string), type: effectiveType === 'QUIZ' ? 'TEXT' : effectiveType as 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P',
        content: sanitizedContent, order: insertionIndex + 1, parentId, courseId,
      } });
      const ids = currentSiblings.map(item => item.id);
      ids.splice(insertionIndex, 0, created.id);
      await normalizeOrder(tx, ids);
      return presentContent({ ...created, order: insertionIndex + 1 });
    });

    return NextResponse.json(newContent, { status: 201 });
  } catch (error) {
    if (error instanceof H5PValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ContentMutationError) return NextResponse.json({ error: error.message }, { status: error.status });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to create course content:', error);
    return NextResponse.json({ error: 'Failed to create course content' }, { status: 500 });
  }
}
