import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

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

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where: {
          instructorId: params.id
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
              rating: true,
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limit,
      }),
      prisma.course.count({
        where: {
          instructorId: params.id
        }
      })
    ]);

    const formattedCourses = courses.map(course => {
      const ratings = course.enrollments
        .map(e => e.rating)
        .filter((r): r is number => r !== null);
      
      const averageRating = ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

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
          completionRate: course._count.enrollments > 0
            ? (course.enrollments.length / course._count.enrollments) * 100
            : 0,
          rating: averageRating,
          ratingCount: ratings.length,
          lessonsCount: course._count.lessons,
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
    });
  } catch (error) {
    console.error('Failed to fetch user courses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch courses' },
      { status: 500 }
    );
  }
}