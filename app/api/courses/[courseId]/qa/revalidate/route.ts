import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject } from '@/lib/server/api-input';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { revalidateCourseQuestionIds } from '@/lib/server/course-qa';
import { privateHeaders, qaFailure } from '../errors';

type Context = { params: Promise<{ courseId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401, headers: privateHeaders });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle.' }, { status: 403, headers: privateHeaders });
  try {
    const { courseId } = await context.params;
    const body = await readJsonObject(request, 32 * 1024);
    return NextResponse.json(await revalidateCourseQuestionIds(courseId, session.user, body), { headers: privateHeaders });
  } catch (error) { return qaFailure(error); }
}
