import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { AnalyticsError, courseAnalytics, parseAnalyticsQuery } from '@/lib/server/course-analytics';
import { CoursePathError } from '@/lib/server/course-path';

type Context = { params: Promise<{ courseId: string }> };
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateHeaders });
  try {
    const { courseId } = await context.params;
    const query = parseAnalyticsQuery(new URL(request.url).searchParams);
    return NextResponse.json(await courseAnalytics(courseId, session.user, query), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AnalyticsError) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    console.error('Failed to read course analytics:', error);
    return NextResponse.json({ error: 'Kursanalyse konnte nicht geladen werden.' }, { status: 500, headers: privateHeaders });
  }
}
