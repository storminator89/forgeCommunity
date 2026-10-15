import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export class ReportReviewError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** Keep the current actor and the one-way decision in one serializable snapshot. */
export async function reviewContentReport(actorId: string, reportId: string,
  status: 'DISMISSED' | 'RESOLVED', resolutionNote: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
        if (actor?.role !== 'ADMIN' && actor?.role !== 'MODERATOR') {
          throw new ReportReviewError('Nicht autorisiert', 403);
        }
        const reviewedAt = new Date();
        const updated = await tx.contentReport.updateMany({
          where: { id: reportId, status: 'OPEN' },
          data: { status, resolutionNote, reviewedAt, reviewedById: actorId },
        });
        if (updated.count === 0) {
          const existing = await tx.contentReport.findUnique({ where: { id: reportId }, select: { id: true } });
          throw new ReportReviewError(existing ? 'Meldung wurde bereits bearbeitet' : 'Meldung nicht gefunden',
            existing ? 409 : 404);
        }
        return { id: reportId, status, reviewedAt, reviewedById: actorId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // Do not retry input, authorization, invariant, or unrelated adapter errors.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      if (attempt === 3) throw new ReportReviewError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
      // A new transaction must reread the actor after a serialization conflict.
    }
  }
  throw new ReportReviewError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
