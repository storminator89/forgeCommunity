import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { listAuthorCourses } from '@/lib/server/course-authoring';
import { authoringFailure } from '../[courseId]/authoring/errors';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    return NextResponse.json(await listAuthorCourses(session.user),
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return authoringFailure(error); }
}
