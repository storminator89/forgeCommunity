import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject } from '@/lib/server/api-input';
import { getPracticeItem, revisePracticeItem } from '@/lib/server/formative-practice';
import { practiceFailure, practicePrivateHeaders, practiceUnauthorized } from '../../errors';

type Context = { params: Promise<{ itemId: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try {
    const { itemId } = await context.params;
    return NextResponse.json(await getPracticeItem(session.user, itemId), { headers: practicePrivateHeaders });
  } catch (error) { return practiceFailure(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try {
    const { itemId } = await context.params;
    const body = await readJsonObject(request, 20 * 1024);
    return NextResponse.json(await revisePracticeItem(session.user, itemId, body.expectedRevision, body.choice),
      { headers: practicePrivateHeaders });
  } catch (error) { return practiceFailure(error); }
}
