import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/options';
import { ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload';
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';

const MAX_MULTIPART_REQUEST_BYTES = 5 * 1024 * 1024 + 256 * 1024;

function optionalDate(value: FormDataEntryValue | null): Date | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) throw new Error('Invalid date');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
  if (value.length === 10 && date.toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return date;
}

function optionalNumber(value: FormDataEntryValue | null, integer = false): number | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid number');
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && (!Number.isSafeInteger(number) || number < 1))) throw new Error('Invalid number');
  return number;
}

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
    const title = formData.get('title');
    const description = formData.get('description');
    const currency = formData.get('currency');
    const image = formData.get('image');
    if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim() ||
        (currency !== null && typeof currency !== 'string') || (image !== null && !(image instanceof File))) {
      return NextResponse.json({ error: 'Invalid course fields' }, { status: 400 });
    }
    let startDate: Date | null;
    let endDate: Date | null;
    let price: number | null;
    let maxStudents: number | null;
    try {
      startDate = optionalDate(formData.get('startDate'));
      endDate = optionalDate(formData.get('endDate'));
      price = optionalNumber(formData.get('price'));
      maxStudents = optionalNumber(formData.get('maxStudents'), true);
    } catch {
      return NextResponse.json({ error: 'Invalid course dates or numbers' }, { status: 400 });
    }
    if (startDate && endDate && endDate < startDate) {
      return NextResponse.json({ error: 'End date precedes start date' }, { status: 400 });
    }

    let imageUrl = null;
    if (image) {
      imageUrl = await saveImageUpload(image, 'course');
    }

    const newCourse = await prisma.course.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        startDate,
        endDate,
        price,
        currency: currency || null,
        maxStudents,
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
      { error: error instanceof ImageUploadValidationError ? error.message : 'Failed to create course' },
      { status: error instanceof ImageUploadValidationError ? 400 : error instanceof RequestBodyLimitError ? 413 : 500 }
    );
  }
}
