import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../../../auth/[...nextauth]/options';
import { markCourseContent } from '@/lib/server/course-lifecycle';
import { readJsonObject } from '@/lib/server/api-input';
import { courseErrorResponse } from '@/lib/server/course-api';

export async function PUT(request: NextRequest, props: { params: Promise<{ courseId: string; contentId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await readJsonObject(request, 4096);
    if (typeof body.completed !== 'boolean' || Object.keys(body).some((key) => key !== 'completed')) {
      return NextResponse.json({ error: 'Expected only a completed boolean' }, { status: 400 });
    }
    const { courseId, contentId } = await props.params;
    return NextResponse.json(await markCourseContent(courseId, contentId, session.user.id, body.completed));
  } catch (error) { return courseErrorResponse(error); }
}
