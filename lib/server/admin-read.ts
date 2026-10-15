import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type AdminRead<T> = { authorized: false } | { authorized: true; data: T };

/** Authorize and read protected data from one snapshot, never from session role alone. */
export async function readAsAdmin<T>(actorId: string, read: (tx: Prisma.TransactionClient) => Promise<T>): Promise<AdminRead<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
        if (actor?.role !== 'ADMIN') return { authorized: false } as const;
        return { authorized: true, data: await read(tx) } as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // Retry only serialization conflicts, rereading authority in a new snapshot.
      // Exhausted or unrelated failures retain each route's existing error response.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 3) throw error;
    }
  }
}
