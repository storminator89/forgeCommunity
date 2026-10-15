import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject } from '@/lib/server/api-input';
import { readPracticeDraft, savePracticeDraft } from '@/lib/server/formative-practice';
import { practiceFailure, practicePrivateHeaders, practiceUnauthorized } from '@/app/api/courses/practice/errors';

type Context = { params: Promise<{ courseId: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try { const { courseId } = await context.params;
    return NextResponse.json(await readPracticeDraft(courseId, session.user), { headers: practicePrivateHeaders }); }
  catch (error) { return practiceFailure(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try { const { courseId } = await context.params;
    const body = await readJsonObject(request, 36 * 1024);
    return NextResponse.json(await savePracticeDraft(courseId, session.user, body.expectedRevision, body.items), { headers: practicePrivateHeaders }); }
  catch (error) { return practiceFailure(error); }
}
