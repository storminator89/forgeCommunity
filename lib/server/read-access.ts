import 'server-only';

import type { Prisma } from '@/generated/prisma/client';

/** A session may have been validated before a committed role change. */
export async function hasCurrentAdminReadAccess(db: Pick<Prisma.TransactionClient, 'user'>,
  user: { id: string; role?: string | null }) {
  if (user.role !== 'ADMIN') return false;
  const actor = await db.user.findUnique({ where: { id: user.id }, select: { role: true } });
  return actor?.role === 'ADMIN';
}
