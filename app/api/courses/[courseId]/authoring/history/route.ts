import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { listHistory } from '@/lib/server/course-authoring';
import { authoringFailure } from '../errors';

type Context = { params: Promise<{ courseId: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const { courseId } = await context.params;
    return NextResponse.json(await listHistory(courseId, session.user), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return authoringFailure(error); }
}
