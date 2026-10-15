import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject } from '@/lib/server/api-input';
import { discardDraft, mutateDraft, readAuthoring } from '@/lib/server/course-authoring';
import { authoringFailure } from './errors';

type Context = { params: Promise<{ courseId: string }> };
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateHeaders });
  try {
    const { courseId } = await context.params;
    return NextResponse.json(await readAuthoring(courseId, session.user), { headers: privateHeaders });
  } catch (error) { return authoringFailure(error); }
}

export async function PATCH(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateHeaders });
  try {
    const { courseId } = await context.params;
    const body = await readJsonObject(request, 128 * 1024);
    const result = await mutateDraft(courseId, session.user, body.expectedRevision, body.operation, request.nextUrl.origin);
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) { return authoringFailure(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateHeaders });
  try {
    const { courseId } = await context.params;
    const body = await readJsonObject(request, 4 * 1024);
    return NextResponse.json(await discardDraft(courseId, session.user, body.expectedRevision), { headers: privateHeaders });
  } catch (error) { return authoringFailure(error); }
}
