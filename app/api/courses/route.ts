import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/options";
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

// Funktion zum Erstellen des Upload-Verzeichnisses, falls es nicht existiert
async function ensureUploadDirectory() {
  const uploadDir = path.join(process.cwd(), 'public', 'images', 'uploads');
  try {
    await mkdir(uploadDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create upload directory:', error);
  }
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
    // Ensure the upload directory exists
    await ensureUploadDirectory();

    const formData = await request.formData();
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
      const bytes = await image.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const uint8Array = new Uint8Array(buffer);

      const uploadDir = path.join(process.cwd(), 'public', 'images', 'uploads');
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
      const filename = `${uniqueSuffix}-${image.name}`;
      const filepath = path.join(uploadDir, filename);

      await writeFile(filepath, uint8Array);
      imageUrl = `/images/uploads/${filename}`;
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
    return NextResponse.json({ error: 'Failed to create course' }, { status: 500 });
  }
}