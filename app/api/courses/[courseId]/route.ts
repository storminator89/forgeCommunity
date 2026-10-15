import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { Prisma } from '@prisma/client';
import { authOptions } from "../../auth/[...nextauth]/options";
import { deleteCourseDependencies } from '@/lib/server/course-deletion';
import { hasCurrentAdminReadAccess } from '@/lib/server/read-access';
import { contentTransaction } from './contents/content-mutations';

class CourseHasCertificatesError extends Error {}
class CourseNotFoundError extends Error {}
class CourseDeleteForbiddenError extends Error {}
class CourseDeleteConflictError extends Error {}

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

    const result = await contentTransaction(async tx => {
      const course = await tx.course.findUnique({
        where: { id: courseId },
        select: { id: true, title: true, description: true, createdAt: true, updatedAt: true,
          instructorId: true, activePublicationId: true },
      });
      if (!course) return { status: 404 as const };
      const account = await tx.user.findUnique({ where: { id: session.user.id }, select: { id: true } });
      if (!account) return { status: 403 as const };
      const canEdit = course.instructorId === session.user.id || await hasCurrentAdminReadAccess(tx, session.user);
      if (!canEdit) {
        // Guessing an unpublished course ID or retaining a stale enrollment
        // must not reveal its staged metadata.
        if (!course.activePublicationId) return { status: 404 as const };
        const enrollment = await tx.enrollment.findUnique({
          where: { userId_courseId: { userId: session.user.id, courseId } }, select: { id: true },
        });
        if (!enrollment) return { status: 403 as const };
      }
      return { status: 200 as const, course, canEdit };
    });
    if (result.status !== 200) return NextResponse.json({ error: result.status === 404 ? 'Course not found' : 'Access denied to this course' }, { status: result.status });
    const { course, canEdit } = result;

    return NextResponse.json({
      id: course.id,
      name: course.title,
      canEdit,
      description: course.description,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      activePublicationId: course.activePublicationId,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch course',
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

    // Grading/reward issuance is serializable too. The course, permission and
    // reward revocation must share one snapshot so a concurrent award cannot
    // remain active after the course is removed. Retry from the first read.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await prisma.$transaction(async (tx) => {
          const course = await tx.course.findUnique({
            where: { id: courseId },
            select: { instructorId: true },
          });
          if (!course) throw new CourseNotFoundError();

          if (course.instructorId !== session.user.id) {
            if (session.user.role !== 'ADMIN') throw new CourseDeleteForbiddenError();
            // A stale administrator session must not authorize deletion after
            // the account has been demoted or removed.
            const actor = await tx.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
            if (actor?.role !== 'ADMIN') throw new CourseDeleteForbiddenError();
          }

          const issued = await tx.certificate.findFirst({ where: { courseId }, select: { id: true } });
          if (issued) throw new CourseHasCertificatesError();
          await deleteCourseDependencies(tx, [courseId]);
          await tx.course.delete({ where: { id: courseId } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        if (attempt === 3) throw new CourseDeleteConflictError();
      }
    }

    return NextResponse.json({ message: 'Course and all related data deleted successfully' });
  } catch (error) {
    if (error instanceof CourseHasCertificatesError) {
      return NextResponse.json({ error: 'Der Kurs hat ausgestellte Zertifikate und kann nicht gelöscht werden.' }, { status: 409 });
    }
    if (error instanceof CourseNotFoundError) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    if (error instanceof CourseDeleteForbiddenError) {
      return NextResponse.json({ error: 'Unauthorized to delete this course' }, { status: 403 });
    }
    if (error instanceof CourseDeleteConflictError) {
      return NextResponse.json({ error: 'Gleichzeitige Änderung. Bitte erneut versuchen.' }, { status: 409 });
    }
    console.error('Error deleting course:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete course',
      },
      { status: 500 }
    );
  }
}
