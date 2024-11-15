import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/options";

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function GET(
  request: NextRequest,
  { params }: { params: { courseId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    console.log('Session in GET /api/courses/[courseId]:', session);

    if (!session || !session.user?.id) {
      console.log('No valid session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const courseId = params.courseId;
    console.log('Attempting to fetch course with ID:', courseId);

    if (!courseId) {
      console.log('No courseId provided');
      return NextResponse.json({ error: 'Course ID is required' }, { status: 400 });
    }

    // Since user is an admin, skip the userCourse check
    if (session.user.role !== 'ADMIN') {
      // Check if user has access to this course
      const userCourse = await prisma.userCourse.findFirst({
        where: {
          courseId: courseId,
          userId: session.user.id,
        },
      });

      console.log('User course access:', userCourse);

      if (!userCourse) {
        console.log('User does not have access to this course');
        return NextResponse.json({ error: 'Access denied to this course' }, { status: 403 });
      }
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    console.log('Found course:', course);

    if (!course) {
      console.log('Course not found');
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Transform the response to match the expected format
    return NextResponse.json({
      id: course.id,
      name: course.title,  // Map 'title' to 'name' in the response
      description: course.description,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    });
  } catch (error) {
    console.error('Detailed error in course fetch:', error);
    console.error('Full error object:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch course', 
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { courseId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    console.log('Session:', session); // Debug log

    if (!session || !session.user?.id) {
      console.log('Unauthorized - No valid session'); // Debug log
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const courseId = params.courseId;
    console.log('Deleting course with ID:', courseId); // Debug log

    if (!courseId) {
      console.log('No courseId provided'); // Debug log
      return NextResponse.json({ error: 'Course ID is required' }, { status: 400 });
    }

    // Überprüfen, ob der Benutzer der Kursleiter ist
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { instructor: true },
    });

    console.log('Found course:', course); // Debug log

    if (!course) {
      console.log('Course not found for ID:', courseId); // Debug log
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    if (session.user.role !== 'ADMIN' && course.instructor.id !== session.user.id) {
      console.log('Unauthorized to delete this course'); // Debug log
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

    console.log('Course and all related data deleted successfully'); // Debug log
    return NextResponse.json({ message: 'Course and all related data deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Detailed error in course deletion:', error);
    return NextResponse.json(
      { error: 'Failed to delete course', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}