import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

export async function DELETE(
  request: NextRequest,
  { params }: { params: { courseId: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const courseId = params.courseId;

    // Überprüfen, ob der Benutzer der Kursleiter ist
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { instructor: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    if (course.instructor.id !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized to delete this course' }, { status: 403 });
    }

    // Löschen aller abhängigen Datensätze
    await prisma.$transaction(async (prisma) => {
      // Löschen aller Einschreibungen für diesen Kurs
      await prisma.enrollment.deleteMany({
        where: { courseId: courseId },
      });

      // Löschen aller Lektionen für diesen Kurs
      await prisma.lesson.deleteMany({
        where: { courseId: courseId },
      });

      // Löschen aller Kursinhalte für diesen Kurs
      await prisma.courseContent.deleteMany({
        where: { courseId: courseId },
      });

      // Kurs löschen
      await prisma.course.delete({
        where: { id: courseId },
      });
    });

    return NextResponse.json({ message: 'Course and all related data deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Failed to delete course:', error);
    return NextResponse.json({ error: 'Failed to delete course' }, { status: 500 });
  }
}