import 'server-only';

import prisma from '@/lib/prisma';
import type { ContributionSummary } from '@/lib/contributions';

/** Never consult history, reports, likes or rewards. Only live selections count. */
export async function currentContributionSummary(userId: string): Promise<ContributionSummary | null> {
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isTestAccount: true } });
    if (!user) return null;
    if (user.role !== 'USER' || user.isTestAccount) return { eligible: false, selectedByAuthors: 0, saturated: false };

    // GROUP BY and LIMIT run in the database. Unlike findMany/distinct, this
    // never transfers a growing set of selected posts or author identities.
    const authors = await tx.post.groupBy({
      by: ['authorId'],
      where: {
        published: true,
        authorId: { not: userId },
        author: { is: { role: 'USER', isTestAccount: false } },
        acceptedSolution: { is: { comment: { is: {
          authorId: userId,
          author: { is: { role: 'USER', isTestAccount: false } },
        } } } },
      },
      orderBy: { authorId: 'asc' },
      take: 5,
    });
    return { eligible: true, selectedByAuthors: authors.length, saturated: authors.length === 5 };
  });
}
