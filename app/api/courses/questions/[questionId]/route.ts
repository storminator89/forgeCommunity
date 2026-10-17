import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject } from '@/lib/server/api-input';
import { getBankQuestionHistory, reviseBankQuestion } from '@/lib/server/question-bank';
import { privateBankHeaders, questionBankFailure } from '../errors';

type Context = { params: Promise<{ questionId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateBankHeaders });
  try {
    const { questionId } = await context.params;
    return NextResponse.json(await getBankQuestionHistory(session.user.id, questionId), { headers: privateBankHeaders });
  } catch (error) { return questionBankFailure(error); }
}

export async function PATCH(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateBankHeaders });
  try {
    const { questionId } = await context.params;
    const body = await readJsonObject(request, 20 * 1024);
    return NextResponse.json(await reviseBankQuestion(session.user.id, questionId, body.expectedRevision, body.question),
      { headers: privateBankHeaders });
  } catch (error) { return questionBankFailure(error); }
}
