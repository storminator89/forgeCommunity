import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject } from '@/lib/server/api-input';
import { previewPracticeRefs } from '@/lib/server/formative-practice';
import { practiceFailure, practicePrivateHeaders, practiceUnauthorized } from '@/app/api/courses/practice/errors';

type Context = { params: Promise<{ courseId: string }> };
export async function POST(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try {
    const { courseId } = await context.params;
    const body = await readJsonObject(request, 36 * 1024);
    return NextResponse.json(await previewPracticeRefs(courseId, session.user, body.items), { headers: practicePrivateHeaders });
  } catch (error) { return practiceFailure(error); }
}
