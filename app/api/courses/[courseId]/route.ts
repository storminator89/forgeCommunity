import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "@/lib/sites-auth/server";
import { Prisma } from '@/generated/prisma/client';
import { authOptions } from '@/lib/auth';
import { deleteCourseDependencies } from '@/lib/server/course-deletion';
import { courseLearningDatabase, d1CourseDetail, readD1CourseSnapshot } from '@/lib/server/d1-course-learning';
import { CoursePathError } from '@/lib/server/course-path';

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

    const snapshot = await readD1CourseSnapshot(courseLearningDatabase(), session.user, courseId);
    return NextResponse.json(d1CourseDetail(snapshot), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status });
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
