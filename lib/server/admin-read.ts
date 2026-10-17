import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';

type AdminRead<T> = { authorized: false } | { authorized: true; data: T };

/**
 * D1 cannot execute interactive Prisma transactions. Check current authority
 * before reading, and again before returning protected data. If the actor is
 * deleted or demoted during the reads, discard the result.
 *
 * The callback must only read; this helper provides no write transaction.
 */
export async function readAsAdmin<T>(actorId: string, read: (tx: Prisma.TransactionClient) => Promise<T>): Promise<AdminRead<T>> {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== 'ADMIN') return { authorized: false };

  const data = await read(prisma);
  const currentActor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (currentActor?.role !== 'ADMIN') return { authorized: false };
  return { authorized: true, data };
}
