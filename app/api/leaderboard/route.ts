import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Only deliberately opted-in learners are ranked; source/course IDs stay private. */
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'USER', isTestAccount: false, userSettings: { is: { publicRankingOptIn: true } } },
      select: {
        id: true, name: true, image: true,
        rewardLedger: { where: { revokedAt: null }, select: { points: true } },
      },
    });
    const ranking = users.map(user => ({
      id: user.id,
      name: user.name || 'Anonymous',
      image: user.image,
      points: user.rewardLedger.reduce((sum, reward) => sum + reward.points, 0),
    })).sort((a, b) => b.points - a.points || a.id.localeCompare(b.id)).slice(0, 10)
      .map(user => ({ name: user.name, image: user.image, points: user.points }));
    return NextResponse.json(ranking, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to fetch leaderboard', error);
    return NextResponse.json({ error: 'Error fetching leaderboard' }, { status: 500 });
  }
}
