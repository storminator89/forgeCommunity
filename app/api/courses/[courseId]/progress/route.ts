import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/options';
import { getCourseProgress } from '@/lib/server/course-lifecycle';
import { courseErrorResponse } from '@/lib/server/course-api';

export async function GET(_request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { courseId } = await props.params;
    return NextResponse.json(await getCourseProgress(courseId, session.user.id));
  } catch (error) { return courseErrorResponse(error); }
}
