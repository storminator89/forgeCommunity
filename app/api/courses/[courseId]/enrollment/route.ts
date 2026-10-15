import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/options';
import { ParticipationError, participationTransaction } from '@/lib/server/participation';

type Context = { params: Promise<{ courseId: string }> };

async function currentUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

function failure(error: unknown) {
  if (error instanceof ParticipationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('Course enrollment failed:', error);
  return NextResponse.json({ error: 'Course enrollment failed' }, { status: 500 });
}

export async function POST(_request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { courseId } = await params;
  try {
    const result = await participationTransaction(async tx => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { price: true, maxStudents: true } });
      if (!course) throw new ParticipationError('Course not found', 404);
      const existing = await tx.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId } }, select: { id: true },
      });
      if (existing) {
        const participants = await tx.enrollment.count({ where: { courseId } });
        return { participants, created: false };
      }
      if (course.price !== null && course.price > 0) throw new ParticipationError('Paid courses require a separate checkout', 403);
      const participants = await tx.enrollment.count({ where: { courseId } });
      if (course.maxStudents !== null && participants >= course.maxStudents) throw new ParticipationError('Course is full', 409);
      await tx.enrollment.create({ data: { userId, courseId } });
      return { participants: participants + 1, created: true };
    });
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
    const participants = await participationTransaction(async tx => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { price: true } });
      if (!course) throw new ParticipationError('Course not found', 404);
      if (course.price !== null && course.price > 0) throw new ParticipationError('Paid enrollment cannot be cancelled here', 403);
      const existing = await tx.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId } }, select: { completedAt: true },
      });
      if (existing?.completedAt) throw new ParticipationError('Completed course enrollment cannot be removed', 409);
      if (existing) await tx.enrollment.deleteMany({ where: { userId, courseId } });
      return tx.enrollment.count({ where: { courseId } });
    });
    return NextResponse.json({ isEnrolled: false, participants });
  } catch (error) {
    return failure(error);
  }
}
