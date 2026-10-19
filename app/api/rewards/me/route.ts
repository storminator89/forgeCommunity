import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { readPrivateRewardHistory } from '@/lib/server/reward-history';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const [ledger, completedCourses, changes] = await Promise.all([
      prisma.rewardLedger.aggregate({ where: { userId: user.id, revokedAt: null }, _sum: { points: true } }),
      prisma.courseCompletionRecord.count({ where: { userId: user.id } }),
      readPrivateRewardHistory(user.id),
    ]);
    return NextResponse.json({
      points: ledger._sum.points ?? 0,
      completedCourses,
      firstCourseCompleted: completedCourses > 0,
      history: changes,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Failed to fetch private rewards', error);
    return NextResponse.json({ error: 'Failed to fetch private rewards' }, { status: 500 });
  }
}
