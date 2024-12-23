// app/api/courses/[courseId]/contents/[contentId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

// PUT-Methode zum Aktualisieren eines Inhalts
export async function PUT(
  request: NextRequest,
  { params }: { params: { courseId: string, contentId: string } }
) {
  const { courseId, contentId } = params;
  const session = await getServerSession(authOptions);

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

    // Validierung der Eingabedaten (optional, aber empfohlen)
    if (order !== undefined && typeof order !== 'number') {
      return NextResponse.json({ error: 'Invalid order value' }, { status: 400 });
    }

    // Map QUIZ type to TEXT for database compatibility
    const dbType = type === 'QUIZ' ? 'TEXT' : type;

    // Erstellen des Update-Datenobjekts dynamisch
    const updateData: any = {
      title,
      type: dbType,
      content,
    };

    if (order !== undefined) {
      updateData.order = order;
    }

    if (parentId !== undefined) {
      updateData.parentId = parentId;
    }

    const updatedContent = await prisma.courseContent.update({
      where: { id: contentId },
      data: updateData,
    });

    return NextResponse.json(updatedContent, { status: 200 });
  } catch (error) {
    console.error('Failed to update course content:', error);
    return NextResponse.json({ error: 'Failed to update course content' }, { status: 500 });
  }
}


// DELETE-Methode zum Löschen eines Inhalts (bereits vorhanden)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { courseId: string, contentId: string } }
) {
  const { courseId, contentId } = params;
  const session = await getServerSession(authOptions);

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

    // Überprüfen Sie, ob der Inhalt existiert
    const content = await prisma.courseContent.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    // Löschen Sie zuerst alle Unterinhalte, falls vorhanden
    await prisma.courseContent.deleteMany({
      where: { parentId: contentId },
    });

    // Dann löschen Sie den Hauptinhalt
    await prisma.courseContent.delete({
      where: { id: contentId },
    });

    return NextResponse.json({ message: 'Content deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Failed to delete course content:', error);
    return NextResponse.json({ error: 'Failed to delete course content' }, { status: 500 });
  }
}
