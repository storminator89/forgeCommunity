import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Only deliberately opted-in learners are ranked; source/course IDs stay private. */
export async function GET() {
  try {
    const eligible = { role: 'USER' as const, isTestAccount: false,
      userSettings: { is: { publicRankingOptIn: true } } };
    // Aggregate in the database rather than returning every member's ledger
    // rows to the web process. User IDs are used only for deterministic ties.
    const totals = await prisma.rewardLedger.groupBy({
      by: ['userId'],
      where: { revokedAt: null, user: eligible },
      _sum: { points: true },
      orderBy: [{ _sum: { points: 'desc' } }, { userId: 'asc' }],
      take: 10,
    });
    const rankedIds = totals.map(total => total.userId);
    // Consent is checked again when resolving names in case an account opted
    // out between aggregation and profile lookup.
    const rankedUsers = rankedIds.length ? await prisma.user.findMany({
      where: { ...eligible, id: { in: rankedIds } },
      select: { id: true, name: true, image: true },
    }) : [];
    const byId = new Map(rankedUsers.map(user => [user.id, user]));
    const ranking = totals.flatMap(total => {
      const user = byId.get(total.userId);
      return user ? [{ name: user.name || 'Anonymous', image: user.image,
        points: total._sum.points ?? 0 }] : [];
    });
    // Preserve the established zero-point tail without loading all opted-in
    // users: only the unfilled top-ten positions are retrieved.
    // If consent changed between the two reads, return fewer results rather
    // than placing zero-point accounts ahead of an unseen active contender.
    if (ranking.length === totals.length && ranking.length < 10) {
      const unrankedUsers = await prisma.user.findMany({
        where: { ...eligible, id: { notIn: rankedIds }, rewardLedger: { none: { revokedAt: null } } },
        orderBy: { id: 'asc' },
        take: 10 - ranking.length,
        select: { name: true, image: true },
      });
      ranking.push(...unrankedUsers.map(user => ({ name: user.name || 'Anonymous', image: user.image, points: 0 })));
    }
    return NextResponse.json(ranking, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to fetch leaderboard', error);
    return NextResponse.json({ error: 'Error fetching leaderboard' }, { status: 500 });
  }
}
