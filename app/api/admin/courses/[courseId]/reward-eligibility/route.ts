import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { CoursePathError } from '@/lib/server/course-path';
import { updateD1CourseRewardEligibility } from '@/lib/server/d1-course-reward-eligibility';

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
    const result = await updateD1CourseRewardEligibility({ id: session.user.id, role: session.user.role }, courseId, body.eligible);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to update reward eligibility', error);
    return NextResponse.json({ error: 'Failed to update reward eligibility' }, { status: 500 });
  }
}
