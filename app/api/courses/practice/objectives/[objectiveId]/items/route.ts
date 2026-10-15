import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject } from '@/lib/server/api-input';
import { createPracticeItem, listPracticeItems } from '@/lib/server/formative-practice';
import { practiceFailure, practicePrivateHeaders, practiceUnauthorized } from '../../../errors';

type Context = { params: Promise<{ objectiveId: string }> };
export async function GET(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try {
    const { objectiveId } = await context.params;
    return NextResponse.json(await listPracticeItems(session.user, objectiveId, request.nextUrl.searchParams.get('cursor')), { headers: practicePrivateHeaders });
  } catch (error) { return practiceFailure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try {
    const { objectiveId } = await context.params;
    const body = await readJsonObject(request, 20 * 1024);
    return NextResponse.json(await createPracticeItem(session.user, objectiveId, body.choice),
      { status: 201, headers: practicePrivateHeaders });
  } catch (error) { return practiceFailure(error); }
}
