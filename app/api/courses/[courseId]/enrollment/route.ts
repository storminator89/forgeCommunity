import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { mutateD1CourseEnrollment } from '@/lib/server/d1-course-learning';
import { CoursePathError } from '@/lib/server/course-path';

type Context = { params: Promise<{ courseId: string }> };

async function currentUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

function failure(error: unknown) {
  if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('Course enrollment failed:', error);
  return NextResponse.json({ error: 'Course enrollment failed' }, { status: 500 });
}

export async function POST(_request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { courseId } = await params;
  try {
    const result = await mutateD1CourseEnrollment(userId, courseId, true);
    return NextResponse.json({ isEnrolled: true, participants: result.participants }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { courseId } = await params;
  try {
    const { participants } = await mutateD1CourseEnrollment(userId, courseId, false);
    return NextResponse.json({ isEnrolled: false, participants });
  } catch (error) {
    return failure(error);
  }
}
