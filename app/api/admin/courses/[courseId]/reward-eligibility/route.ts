import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { contentTransaction } from '@/app/api/courses/[courseId]/contents/content-mutations';
import { courseApprovalFingerprint, courseHasRewardableQuiz, reconcileCourseRewards } from '@/lib/server/rewards';

class ApprovalError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await readJsonObject(request);
    if (Object.keys(body).length !== 1 || typeof body.eligible !== 'boolean') {
      return NextResponse.json({ error: 'Invalid eligibility' }, { status: 400 });
    }
    const { courseId } = await props.params;
    const result = await contentTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
      if (actor?.role !== 'ADMIN') throw new ApprovalError('Forbidden', 403);
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true, activePublicationId: true } });
      if (!course) throw new ApprovalError('Course not found', 404);
      if (body.eligible && !course.activePublicationId) throw new ApprovalError('A published course is required for reward approval', 409);
      if (body.eligible && !(await courseHasRewardableQuiz(tx, courseId))) {
        throw new ApprovalError('A published valid quiz leaf is required for reward approval', 409);
      }
      const rewardApprovalRevision = body.eligible ? await courseApprovalFingerprint(tx, courseId) : null;
      await tx.course.update({ where: { id: courseId }, data: { rewardEligible: body.eligible as boolean, rewardApprovalRevision } });
      await reconcileCourseRewards(tx, courseId);
      return { rewardEligible: body.eligible };
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ApprovalError) return NextResponse.json({ error: error.message }, { status: error.status });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to update reward eligibility', error);
    return NextResponse.json({ error: 'Failed to update reward eligibility' }, { status: 500 });
  }
}
