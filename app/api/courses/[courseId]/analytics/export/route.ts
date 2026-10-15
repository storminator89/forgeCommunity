import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { AnalyticsError, analyticsCsv, courseAnalytics, parseAnalyticsQuery } from '@/lib/server/course-analytics';
import { CoursePathError } from '@/lib/server/course-path';

type Context = { params: Promise<{ courseId: string }> };
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const errorResponse = (message: string, status: number) => Response.json({ error: message }, { status, headers: privateHeaders });

export async function GET(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return errorResponse('Unauthorized', 401);
  try {
    const { courseId } = await context.params;
    const query = parseAnalyticsQuery(new URL(request.url).searchParams);
    const result = await courseAnalytics(courseId, session.user, query, true);
    return new Response(analyticsCsv(result.learners), {
      headers: { ...privateHeaders, 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="course-analytics.csv"' },
    });
  } catch (error) {
    if (error instanceof AnalyticsError) return errorResponse(error.message, error.status);
    if (error instanceof CoursePathError) return errorResponse(error.message, error.status);
    console.error('Failed to export course analytics:', error);
    return errorResponse('Kursanalyse konnte nicht exportiert werden.', 500);
  }
}
