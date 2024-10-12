import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/options";

const prisma = new PrismaClient();

export async function GET() {
  try {
    const courses = await prisma.course.findMany({
      include: {
        instructor: {
          select: {
            name: true,
          },
        },
        enrollments: {
          select: {
            userId: true,
          },
        },
      },
    });

    const formattedCourses = courses.map(course => ({
      id: course.id,
      title: course.title,
      instructor: course.instructor.name,
      duration: course.startDate && course.endDate
        ? `${Math.ceil((course.endDate.getTime() - course.startDate.getTime()) / (1000 * 60 * 60 * 24 * 7))} Wochen`
        : 'Flexibel',
      startDate: course.startDate ? course.startDate.toISOString().split('T')[0] : null,
      endDate: course.endDate ? course.endDate.toISOString().split('T')[0] : null,
      category: course.description,
      participants: course.enrollments.length,
    }));

    return NextResponse.json(formattedCourses);
  } catch (error) {
    console.error('Failed to fetch courses:', error);
    return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, description, startDate, endDate, price, currency, maxStudents } = body;

    const newCourse = await prisma.course.create({
      data: {
        title,
        description,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        price: parseFloat(price),
        currency,
        maxStudents: parseInt(maxStudents),
        instructor: {
          connect: { id: session.user.id }
        }
      },
      include: {
        instructor: {
          select: { name: true }
        }
      }
    });

    return NextResponse.json(newCourse, { status: 201 });
  } catch (error) {
    console.error('Failed to create course:', error);
    return NextResponse.json({ error: 'Failed to create course' }, { status: 500 });
  }
}