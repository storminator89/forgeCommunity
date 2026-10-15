import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export class ParticipationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function parseEventCapacity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) {
    throw new ParticipationError('Invalid event capacity', 400);
  }
  return number;
}

// A capacity check and its write must share a serializable transaction. Retry
// serialization and unique-key races so a repeated join is idempotent.
export async function participationTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
      if (code !== 'P2034' && code !== 'P2002') throw error;
      if (attempt === 3) throw new ParticipationError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
    }
  }
  throw new ParticipationError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
