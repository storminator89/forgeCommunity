import { getServerSession } from '@/lib/sites-auth/server';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { PracticeError } from '@/lib/server/formative-practice';
import { requestErrorResponse } from '@/lib/server/api-input';

export type LearnerContext = { params: Promise<{ courseId: string }> };
export const learnerHeaders = { 'Cache-Control': 'private, no-store' };
export async function learnerRoute(context: LearnerContext,
  action: (courseId: string, userId: string) => Promise<unknown>) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: learnerHeaders });
  try {
    const { courseId } = await context.params;
    return NextResponse.json(await action(courseId, session.user.id), { headers: learnerHeaders });
  } catch (error) {
    if (error instanceof PracticeError) return NextResponse.json({ error: error.message }, { status: error.status, headers: learnerHeaders });
    const inputError = requestErrorResponse(error);
    if (inputError) {
      inputError.headers.set('Cache-Control', 'private, no-store');
      return inputError;
    }
    console.error('Formative learner practice failed:', error);
    return NextResponse.json({ error: 'Übung konnte nicht verarbeitet werden.' }, { status: 500, headers: learnerHeaders });
  }
}
