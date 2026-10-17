import { PaginationError, readPagination } from '@/lib/server/pagination';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "@/lib/sites-auth/server";
import { authOptions } from '@/lib/auth';
import { activeCourseContentWhere, publishedCourseWhere } from '@/lib/server/published-course';
import { contentTransaction } from '@/app/api/courses/[courseId]/contents/content-mutations';

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

    const { searchParams } = new URL(request.url);
    const { page, limit, skip } = readPagination(searchParams, 6);

    const { courses, total } = await contentTransaction(async tx => {
    const [courses, total] = await Promise.all([
      tx.course.findMany({
        where: {
          instructorId: params.id,
          ...publishedCourseWhere,
        },
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
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limit,
      }),
      tx.course.count({
        where: {
          instructorId: params.id,
          ...publishedCourseWhere,
        }
      })
    ]);
    return { courses, total };
    });

    const formattedCourses = courses.map(course => {
      // Rating logic removed as 'rating' field does not exist on Enrollment
      const averageRating = 0;
      const ratingCount = 0;

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
          rating: averageRating,
          ratingCount: ratingCount,
          lessonsCount: course._count.contents,
        },
        createdAt: course.createdAt,
      };
    });

    return NextResponse.json({
      courses: formattedCourses,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        currentPage: page,
        hasMore: skip + courses.length < total
      }
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof PaginationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Failed to fetch user courses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch courses' },
      { status: 500 }
    );
  }
}
