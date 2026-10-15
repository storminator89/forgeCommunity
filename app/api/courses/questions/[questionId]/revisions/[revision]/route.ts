import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { getBankQuestionRevision } from '@/lib/server/question-bank';
import { privateBankHeaders, questionBankFailure } from '../../../errors';

type Context = { params: Promise<{ questionId: string; revision: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateBankHeaders });
  try {
    const { questionId, revision } = await context.params;
    const parsedRevision = /^\d+$/.test(revision) ? Number(revision) : NaN;
    return NextResponse.json(await getBankQuestionRevision(session.user.id, questionId, parsedRevision),
      { headers: privateBankHeaders });
  } catch (error) { return questionBankFailure(error); }
}
