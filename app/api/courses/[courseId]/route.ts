import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/options";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ courseId: string }> }
) {
  const params = await props.params;
  const courseId = params.courseId;
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!courseId) {
      return NextResponse.json({ error: 'Course ID is required' }, { status: 400 });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        instructorId: true,
      },
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
        return NextResponse.json({ error: 'Access denied to this course' }, { status: 403 });
      }
    }

    return NextResponse.json({
      id: course.id,
      name: course.title,
      description: course.description,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch course',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
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
      select: { instructorId: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Check authorization
    if (session.user.role !== 'ADMIN' && course.instructorId !== session.user.id) {
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
  }
}
