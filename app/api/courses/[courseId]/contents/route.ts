// app/api/courses/[courseId]/contents/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

// GET-Methode zum Abrufen der Kursinhalte
export async function GET(
  request: NextRequest,
  { params }: { params: { courseId: string } }
) {
  const courseId = params.courseId;

  try {
    const contents = await prisma.courseContent.findMany({
      where: { courseId: courseId },
      orderBy: { order: 'asc' },
    });

    // Gruppieren Sie die Inhalte in Haupt- und Unterinhalte
    const groupedContents = contents.reduce((acc, content) => {
      if (!content.parentId) {
        acc.push({
          ...content,
          subContents: contents.filter(c => c.parentId === content.id)
        });
      }
      return acc;
    }, [] as any[]); // Typisierung anpassen, falls nötig

    return NextResponse.json(groupedContents);
  } catch (error) {
    console.error('Failed to fetch course contents:', error);
    return NextResponse.json({ error: 'Failed to fetch course contents' }, { status: 500 });
  }
}

// POST-Methode zum Hinzufügen eines neuen Inhalts
export async function POST(
  request: NextRequest,
  { params }: { params: { courseId: string } }
) {
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

    if (!course || course.instructorId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { title, type, content, order, parentId } = await request.json();

    const newContent = await prisma.courseContent.create({
      data: {
        title,
        type,
        content,
        order,
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
