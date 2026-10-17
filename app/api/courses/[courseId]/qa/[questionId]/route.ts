import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject } from '@/lib/server/api-input';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { hideCourseQuestion, readCourseQuestion } from '@/lib/server/course-qa';
import { privateHeaders, qaFailure } from '../errors';

type Context = { params: Promise<{ courseId: string; questionId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401, headers: privateHeaders });
  try {
    const { courseId, questionId } = await context.params;
    return NextResponse.json(await readCourseQuestion(courseId, questionId, session.user), { headers: privateHeaders });
  } catch (error) { return qaFailure(error); }
}

export async function PATCH(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401, headers: privateHeaders });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle.' }, { status: 403, headers: privateHeaders });
  try {
    const { courseId, questionId } = await context.params;
    const body = await readJsonObject(request, 1024);
    return NextResponse.json(await hideCourseQuestion(courseId, questionId, session.user, body.hidden), { headers: privateHeaders });
  } catch (error) { return qaFailure(error); }
}
