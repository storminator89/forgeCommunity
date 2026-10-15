import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { listPracticeHistory } from '@/lib/server/formative-practice';
import { practiceFailure, practicePrivateHeaders, practiceUnauthorized } from '@/app/api/courses/practice/errors';

type Context = { params: Promise<{ courseId: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try { const { courseId } = await context.params;
    return NextResponse.json(await listPracticeHistory(courseId, session.user), { headers: practicePrivateHeaders }); }
  catch (error) { return practiceFailure(error); }
}
