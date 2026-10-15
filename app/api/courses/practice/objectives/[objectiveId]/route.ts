import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject } from '@/lib/server/api-input';
import { getPracticeObjective, revisePracticeObjective } from '@/lib/server/formative-practice';
import { practiceFailure, practicePrivateHeaders, practiceUnauthorized } from '../../errors';

type Context = { params: Promise<{ objectiveId: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try {
    const { objectiveId } = await context.params;
    return NextResponse.json(await getPracticeObjective(session.user, objectiveId), { headers: practicePrivateHeaders });
  } catch (error) { return practiceFailure(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try {
    const { objectiveId } = await context.params;
    const body = await readJsonObject(request, 8 * 1024);
    return NextResponse.json(await revisePracticeObjective(session.user, objectiveId, body.expectedRevision, body.patch),
      { headers: practicePrivateHeaders });
  } catch (error) { return practiceFailure(error); }
}
