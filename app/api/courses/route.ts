import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/options';
import { ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload';
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';

const MAX_MULTIPART_REQUEST_BYTES = 5 * 1024 * 1024 + 256 * 1024;

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
      imageUrl: course.imageUrl,
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
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_REQUEST_BYTES) {
      return NextResponse.json({ error: 'File is too large' }, { status: 413 });
    }
    const limitedRequest = await requestWithBodyLimit(request, MAX_MULTIPART_REQUEST_BYTES);
    const formData = await limitedRequest.formData();
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;
    const price = formData.get('price') as string;
    const currency = formData.get('currency') as string;
    const maxStudents = formData.get('maxStudents') as string;
    const image = formData.get('image') as File | null;

    let imageUrl = null;
    if (image) {
      imageUrl = await saveImageUpload(image, 'course');
    }

    const newCourse = await prisma.course.create({
      data: {
        title,
        description,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        price: parseFloat(price),
        currency,
        maxStudents: parseInt(maxStudents),
        imageUrl,
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create course' },
      { status: error instanceof ImageUploadValidationError ? 400 : error instanceof RequestBodyLimitError ? 413 : 500 }
    );
  }
}
