import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { canManageCourse, enrollInCourse } from '@/lib/server/course-lifecycle';
import { readJsonObject, readPage } from '@/lib/server/api-input';
import { courseErrorResponse } from '@/lib/server/course-api';

export async function GET(request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { courseId } = await props.params;
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { instructorId: true, maxStudents: true } });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    if (!canManageCourse(session.user, course)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const { skip, take } = readPage(request);
    const [enrollments, total] = await Promise.all([
      prisma.enrollment.findMany({ where: { courseId }, skip, take, orderBy: [{ enrolledAt: 'desc' }, { id: 'asc' }],
        select: { id: true, enrolledAt: true, completedAt: true, user: { select: { id: true, name: true, email: true } } } }),
      prisma.enrollment.count({ where: { courseId } }),
    ]);
    return NextResponse.json({ enrollments, maxStudents: course.maxStudents, total, hasMore: skip + enrollments.length < total });
  } catch (error) { return courseErrorResponse(error); }
}

export async function POST(request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await readJsonObject(request, 4096);
    const keys = Object.keys(body);
    if (keys.length !== 1 || !['userId', 'email'].includes(keys[0]) ||
        typeof body[keys[0]] !== 'string' || !(body[keys[0]] as string).trim() || (body[keys[0]] as string).length > 320) {
      return NextResponse.json({ error: 'Provide exactly one userId or email' }, { status: 400 });
    }
    const target = typeof body.email === 'string' ? { email: body.email.trim().toLowerCase() } : { userId: (body.userId as string).trim() };
    const { courseId } = await props.params;
    return NextResponse.json(await enrollInCourse(courseId, session.user, target));
  } catch (error) { return courseErrorResponse(error); }
}
