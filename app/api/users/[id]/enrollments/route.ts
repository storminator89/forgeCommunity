import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '6');
    const skip = (page - 1) * limit;

    const [enrollments, total] = await Promise.all([
      prisma.enrollment.findMany({
        where: {
          userId: params.id
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
                  lessons: true,
                },
              },
              enrollments: {
                where: {
                  completedAt: {
                    not: null
                  }
                },
                select: {
                  completedAt: true,
                },
              },
            },
          },
        },
        orderBy: {
          enrolledAt: 'desc'
        },
        skip,
        take: limit,
      }),
      prisma.enrollment.count({
        where: {
          userId: params.id
        }
      })
    ]);

    const formattedCourses = enrollments.map(enrollment => {
      const course = enrollment.course;
      const completedCount = course.enrollments.length;
      const totalEnrollments = course._count.enrollments;

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
          completionRate: totalEnrollments > 0
            ? (completedCount / totalEnrollments) * 100
            : 0,
          lessonsCount: course._count.lessons,
        },
        enrolled: true,
        progress: {
          completed: 0, // TODO: Implementieren Sie die Logik für abgeschlossene Lektionen
          total: course._count.lessons,
          lastAccessed: enrollment.enrolledAt,
        },
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
    });
  } catch (error) {
    console.error('Failed to fetch user enrollments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch enrollments' },
      { status: 500 }
    );
  }
}