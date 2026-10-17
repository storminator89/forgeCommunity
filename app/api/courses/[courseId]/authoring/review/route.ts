import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { reviewPublication } from '@/lib/server/course-authoring';
import { authoringFailure } from '../errors';

type Context = { params: Promise<{ courseId: string }> };
export async function GET(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const { courseId } = await context.params;
    const revision = request.nextUrl.searchParams.get('expectedRevision');
    const active = request.nextUrl.searchParams.get('expectedActivePublicationId');
    const result = await reviewPublication(courseId, session.user,
      revision === null ? undefined : Number(revision), active === null ? undefined : active === 'null' ? null : active,
      request.nextUrl.origin);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return authoringFailure(error); }
}
