import { QUIZ_MEDIA_CAPABILITY_HEADER } from '@/lib/quiz-media-compatibility';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject } from '@/lib/server/api-input';
import { restoreDraft } from '@/lib/server/course-authoring';
import { authoringFailure } from '../errors';

type Context = { params: Promise<{ courseId: string }> };
export async function POST(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const { courseId } = await context.params;
    const body = await readJsonObject(request, 4 * 1024);
    return NextResponse.json(await restoreDraft(courseId, session.user, body.expectedRevision, body.publicationId, request.headers.get(QUIZ_MEDIA_CAPABILITY_HEADER)),
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return authoringFailure(error); }
}
