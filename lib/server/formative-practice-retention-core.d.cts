import type { PrismaClient } from '@prisma/client';
export function practiceRetentionCutoffs(now?: Date): { privateHistoryBefore: Date; receiptsBefore: Date };
export function sweepPracticeRetentionBatch(client: PrismaClient, options?: {
  now?: Date; apply?: boolean; batchSize?: number; provider?: 'sqlite' | 'postgresql'; schema?: string | null;
}): Promise<{ applied: boolean; skippedLock: boolean; hasMore: boolean; candidateLearners: number;
  candidateReceipts: number; deletedLearners: number; deletedReceipts: number;
  privateHistoryBefore: Date; receiptsBefore: Date }>;
