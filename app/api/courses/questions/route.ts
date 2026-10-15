import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject } from '@/lib/server/api-input';
import { createBankQuestion, listBankQuestions } from '@/lib/server/question-bank';
import { privateBankHeaders, questionBankFailure } from './errors';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateBankHeaders });
  try { return NextResponse.json(await listBankQuestions(session.user.id, new URL(request.url).searchParams.get('cursor')), { headers: privateBankHeaders }); }
  catch (error) { return questionBankFailure(error); }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateBankHeaders });
  try {
    const body = await readJsonObject(request, 20 * 1024);
    return NextResponse.json(await createBankQuestion(session.user.id, body.question), { status: 201, headers: privateBankHeaders });
  } catch (error) { return questionBankFailure(error); }
}
