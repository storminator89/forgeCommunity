import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "@/lib/sites-auth/server";
import { authOptions } from '@/lib/auth';
import { activeCourseContentWhere, publishedCourseWhere } from '@/lib/server/published-course';
import { hasCurrentAdminReadAccess } from '@/lib/server/read-access';
import { contentTransaction } from '@/app/api/courses/[courseId]/contents/content-mutations';
import { profileCourseCompletionStats } from '@/lib/server/course-profile-completion';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (session.user.id !== params.id && !await hasCurrentAdminReadAccess(prisma, session.user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Math.min(1000, Number.parseInt(searchParams.get('page') || '1', 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(searchParams.get('limit') || '6', 10) || 6));
    const skip = (page - 1) * limit;

    const { enrollments, total, completion } = await contentTransaction(async tx => {
    const [enrollments, total] = await Promise.all([
      tx.enrollment.findMany({
        where: {
          userId: params.id,
          course: publishedCourseWhere,
        },
        include: {
          course: {
            include: {
              instructor: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
              _count: {
                select: {
                  enrollments: true,
                  contents: { where: activeCourseContentWhere },
                },
              },
              enrollments: { select: { userId: true, completedAt: true } },
            },
          },
        },
        orderBy: {
          enrolledAt: 'desc'
        },
        skip,
        take: limit,
      }),
      tx.enrollment.count({
        where: {
          userId: params.id,
          course: publishedCourseWhere,
        }
      })
    ]);
    return { enrollments, total, completion: await profileCourseCompletionStats(tx, enrollments.map(row => row.course)) };
    });

    const formattedCourses = enrollments.map(enrollment => {
      const course = enrollment.course;
      return {
        id: course.id,
        title: course.title,
        description: course.description,
        imageUrl: course.imageUrl,
        instructor: course.instructor,
        price: course.price,
        currency: course.currency,
        startDate: course.startDate,
        endDate: course.endDate,
        category: course.description,
        stats: {
          enrollments: course._count.enrollments,
          maxStudents: course.maxStudents,
          completionRate: completion.get(course.id)?.completionRate ?? 0,
          everCompletionRate: completion.get(course.id)?.everCompletionRate ?? 0,
          lessonsCount: course._count.contents,
        },
        enrolled: true,
        // The schema tracks course completion, but has no per-lesson progress
        // records. Do not present enrollment time or a fabricated zero as
        // lesson progress.
        progress: null,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
      };
    });

    return NextResponse.json({
      courses: formattedCourses,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        currentPage: page,
        hasMore: skip + enrollments.length < total
      }
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Failed to fetch user enrollments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch enrollments' },
      { status: 500 }
    );
  }
}
