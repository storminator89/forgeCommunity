import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

export async function PUT(
  request: NextRequest,
  { params }: { params: { courseId: string, contentId: string } }
) {
  const session = await getServerSession(authOptions);
  const { courseId, contentId } = params;

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

    const { title, type, content, order } = await request.json();

    const updatedContent = await prisma.courseContent.update({
      where: { id: contentId },
      data: {
        title,
        type,
        content,
        order,
      },
    });

    return NextResponse.json(updatedContent, { status: 200 });
  } catch (error) {
    console.error('Failed to update course content:', error);
    return NextResponse.json({ error: 'Failed to update course content' }, { status: 500 });
  }
}

// Fügen Sie auch die GET- und DELETE-Methoden hinzu, falls sie noch nicht vorhanden sind
export async function GET(
  request: NextRequest,
  { params }: { params: { courseId: string, contentId: string } }
) {
  // Implementierung für GET
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { courseId: string, contentId: string } }
) {
  // Implementierung für DELETE
}