import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { contentTransaction } from '@/app/api/courses/[courseId]/contents/content-mutations';
import { reconcileUserRewards } from '@/lib/server/rewards';

class FlagError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await readJsonObject(request);
    if (Object.keys(body).length !== 1 || typeof body.isTestAccount !== 'boolean') {
      return NextResponse.json({ error: 'Invalid account flag' }, { status: 400 });
    }
    const { id } = await props.params;
    const result = await contentTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
      if (actor?.role !== 'ADMIN') throw new FlagError('Forbidden', 403);
      const target = await tx.user.findUnique({ where: { id }, select: { id: true } });
      if (!target) throw new FlagError('User not found', 404);
      await tx.user.update({ where: { id }, data: { isTestAccount: body.isTestAccount as boolean } });
      await reconcileUserRewards(tx, id);
      return { isTestAccount: body.isTestAccount };
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof FlagError) return NextResponse.json({ error: error.message }, { status: error.status });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to update test account flag', error);
    return NextResponse.json({ error: 'Failed to update test account flag' }, { status: 500 });
  }
}
