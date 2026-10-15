import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { getPracticeItemRevision } from '@/lib/server/formative-practice';
import { practiceFailure, practicePrivateHeaders, practiceUnauthorized } from '../../../../errors';

type Context = { params: Promise<{ itemId: string; revision: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try {
    const { itemId, revision } = await context.params;
    return NextResponse.json(await getPracticeItemRevision(session.user, itemId, Number(revision)), { headers: practicePrivateHeaders });
  } catch (error) { return practiceFailure(error); }
}
