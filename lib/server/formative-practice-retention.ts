import 'server-only';

import prisma from '@/lib/prisma';
import { getDatabaseProvider, getPostgresqlSchema } from '@/lib/database-provider';
import { practiceRetentionCutoffs, sweepPracticeRetentionBatch } from './formative-practice-retention-core.cjs';

export { practiceRetentionCutoffs };

/** Dry-run by default. Only the trusted production worker activates apply. */
export function sweepPracticeRetention({ now = new Date(), apply = false, batchSize = 500 } = {}) {
  const provider = getDatabaseProvider();
  return sweepPracticeRetentionBatch(prisma, { now, apply, batchSize, provider,
    schema: provider === 'postgresql' ? getPostgresqlSchema() : null });
}
