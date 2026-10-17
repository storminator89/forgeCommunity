import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject } from '@/lib/server/api-input';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { hideCourseAnswer } from '@/lib/server/course-qa';
import { privateHeaders, qaFailure } from '../../../errors';

type Context = { params: Promise<{ courseId: string; questionId: string; answerId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401, headers: privateHeaders });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle.' }, { status: 403, headers: privateHeaders });
  try {
    const { courseId, questionId, answerId } = await context.params;
    const body = await readJsonObject(request, 1024);
    return NextResponse.json(await hideCourseAnswer(courseId, questionId, answerId, session.user, body.hidden), { headers: privateHeaders });
  } catch (error) { return qaFailure(error); }
}
