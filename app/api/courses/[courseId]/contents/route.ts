// app/api/courses/[courseId]/contents/route.ts

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { sanitizeCourseTextContentServer, sanitizeTextServer } from '@/lib/server/sanitize-html';

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

    const subContentsByParent = new Map<string, typeof contents>();

    for (const content of contents) {
      if (!content.parentId) {
        continue;
      }

      const siblings = subContentsByParent.get(content.parentId) ?? [];
      siblings.push(content);
      subContentsByParent.set(content.parentId, siblings);
    }

    const groupedContents = contents
      .filter((content) => !content.parentId)
      .map((content) => ({
        ...content,
        subContents: subContentsByParent.get(content.id) ?? [],
      }));

    return NextResponse.json(groupedContents);
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

    const { title, type, content, order, parentId } = await request.json();
    const sanitizedTitle = sanitizeTextServer(title);
    const sanitizedContent =
      type === 'TEXT' || !type
        ? sanitizeCourseTextContentServer(content)
        : sanitizeTextServer(content);

    // If order is not provided, find the next available order number
    let nextOrder = order;
    if (typeof order !== 'number') {
      const existingContents = await prisma.courseContent.findMany({
        where: {
          courseId,
          parentId: parentId || null,
        },
        orderBy: {
          order: 'desc',
        },
        take: 1,
      });
      nextOrder = existingContents.length > 0 ? existingContents[0].order + 1 : 1;
    }

    const newContent = await prisma.courseContent.create({
      data: {
        title: sanitizedTitle,
        type: type || 'TEXT',
        content: sanitizedContent,
        order: nextOrder,
        parentId,
        courseId,
      },
    });

    return NextResponse.json(newContent, { status: 201 });
  } catch (error) {
    console.error('Failed to create course content:', error);
    return NextResponse.json({ error: 'Failed to create course content' }, { status: 500 });
  }
}
