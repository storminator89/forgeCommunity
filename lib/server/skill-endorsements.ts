import type { Prisma } from '@prisma/client';

// Call inside the same transaction that deletes the user, before cascade removes
// their endorsement records. Legacy totals remain untouched.
export async function decrementSkillEndorsementsForDeletedUser(tx: Prisma.TransactionClient, userId: string) {
  const given = await tx.skillEndorsement.groupBy({
    by: ['userSkillId'],
    where: { endorserId: userId, userSkill: { userId: { not: userId } } },
    _count: { _all: true },
  });
  for (const row of given) {
    const count = row._count._all;
    const updated = await tx.userSkill.updateMany({
      where: { id: row.userSkillId, endorsements: { gte: count } },
      data: { endorsements: { decrement: count } },
    });
    if (updated.count !== 1) {
      throw new Error(`Skill endorsement total is inconsistent for ${row.userSkillId}`);
    }
  }
}
