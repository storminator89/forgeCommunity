import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/options";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ courseId: string }> }
) {
  const params = await props.params;
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
      // Check if user has access to this course
      const userCourse = await prisma.enrollment.findFirst({
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
      name: (error as any)?.name,
      message: (error as any)?.message,
      stack: (error as any)?.stack,
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
  props: { params: Promise<{ courseId: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const courseId = params.courseId;

    if (!courseId) {
      return NextResponse.json({ error: 'Course ID is required' }, { status: 400 });
    }

    // Fetch the course with instructor info
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { instructor: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Check authorization
    if (session.user.role !== 'ADMIN' && course.instructor.id !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized to delete this course' }, { status: 403 });
    }

    // Delete all related records in the correct order
    await prisma.$transaction(async (tx) => {
      // Delete certificates first
      await tx.certificate.deleteMany({
        where: { courseId },
      });

      // Delete enrollments
      await tx.enrollment.deleteMany({
        where: { courseId },
      });

      // Delete course contents (handle nested contents first)
      const contents = await tx.courseContent.findMany({
        where: { courseId },
        select: { id: true },
      });

      // Delete child contents first
      await tx.courseContent.deleteMany({
        where: {
          courseId,
          parentId: { not: null },
        },
      });

      // Then delete parent contents
      await tx.courseContent.deleteMany({
        where: {
          courseId,
          parentId: null,
        },
      });

      // Delete lessons
      await tx.lesson.deleteMany({
        where: { courseId },
      });

      // Finally delete the course
      await tx.course.delete({
        where: { id: courseId },
      });
    });

    return NextResponse.json({ message: 'Course and all related data deleted successfully' });
  } catch (error) {
    console.error('Error deleting course:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete course',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}