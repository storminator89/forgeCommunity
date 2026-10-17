import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject } from '@/lib/server/api-input';
import { createPracticeObjective, listPracticeObjectives } from '@/lib/server/formative-practice';
import { practiceFailure, practicePrivateHeaders, practiceUnauthorized } from '../errors';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try { return NextResponse.json(await listPracticeObjectives(session.user, request.nextUrl.searchParams.get('cursor')), { headers: practicePrivateHeaders }); }
  catch (error) { return practiceFailure(error); }
}
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return practiceUnauthorized();
  try { return NextResponse.json(await createPracticeObjective(session.user, await readJsonObject(request, 8 * 1024)),
    { status: 201, headers: practicePrivateHeaders }); }
  catch (error) { return practiceFailure(error); }
}
