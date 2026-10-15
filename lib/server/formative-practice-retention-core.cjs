// Shared by the app-facing dry-run hook and the production standalone worker.
// Keep this dependency-light: it receives a provider-matched Prisma client.
const { Prisma } = require('@prisma/client');
const DAY_MS = 86400_000;

function practiceRetentionCutoffs(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid retention clock');
  const year = now.getUTCFullYear() - 1;
  const month = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const privateHistoryBefore = new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
  const receiptsBefore = new Date(now.getTime() - 90 * DAY_MS);
  return { privateHistoryBefore, receiptsBefore };
}

function assertPostgresqlAdapterSchema(client, requestedSchema) {
  // PrismaPg uses this adapter setting to qualify model queries. The caller's
  // `schema` (or a transaction-local search_path) cannot prove which schema
  // those queries will touch. If the adapter API changes, stop rather than
  // run the retention worker against an unverified namespace.
  const adapter = client?._engineConfig?.adapter;
  const configuredSchema = adapter?.options?.schema ?? null;
  if (adapter?.adapterName !== '@prisma/adapter-pg' || adapter?.provider !== 'postgres' ||
      configuredSchema !== requestedSchema) {
    throw new Error('Retention worker PostgreSQL adapter schema mismatch');
  }
}

async function sweepPracticeRetentionBatch(client, { now = new Date(), apply = false, batchSize = 500,
  provider = 'sqlite', schema = null } = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('Invalid retention batch size');
  if (provider !== 'sqlite' && provider !== 'postgresql') throw new Error('Invalid retention provider');
  if (schema !== null && (provider !== 'postgresql' || typeof schema !== 'string' || !schema ||
      schema.includes('\0') || Buffer.byteLength(schema, 'utf8') > 63)) throw new Error('Invalid retention schema');
  if (provider === 'postgresql') assertPostgresqlAdapterSchema(client, schema);
  const cutoffs = practiceRetentionCutoffs(now);
  return client.$transaction(async tx => {
    if (apply && provider === 'postgresql') {
      // PrismaPg qualifies model queries with its configured schema, but raw SQL
      // need not inherit that search_path. Set it transaction-locally with a
      // bound value, then verify PostgreSQL resolved the exact active schema.
      if (schema) {
        const path = `"${schema.replaceAll('"', '""')}"`;
        await tx.$queryRaw(Prisma.sql`SELECT pg_catalog.set_config('search_path', ${path}, true)`);
      }
      // No schema name or learner input is interpolated into SQL identifiers.
      // The lock is xact-scoped, so a crash or rollback releases it automatically.
      const active = await tx.$queryRaw(Prisma.sql`SELECT current_schema() AS schema_name, pg_catalog.pg_try_advisory_xact_lock(761834, 27) AS acquired`);
      if (!Array.isArray(active) || active.length !== 1 || (schema && active[0].schema_name !== schema)) {
        throw new Error('Retention worker PostgreSQL schema mismatch');
      }
      if (!active[0].acquired) return { applied: false, skippedLock: true, hasMore: false,
        candidateLearners: 0, candidateReceipts: 0, deletedLearners: 0, deletedReceipts: 0, ...cutoffs };
    }
    if (apply) {
      // A SQLite UPSERT acquires the database writer lock before selecting rows;
      // PostgreSQL already holds its advisory xact lock. Only lastSuccessAt proves health.
      await tx.practiceRetentionHealth.upsert({ where: { id: 'learner' },
        create: { id: 'learner', lastSuccessAt: null }, update: { updatedAt: now } });
    }
    const candidates = await tx.practiceLearnerSetting.findMany({
      where: { lastActivityAt: { lt: cutoffs.privateHistoryBefore } },
      orderBy: [{ lastActivityAt: 'asc' }, { userId: 'asc' }, { courseId: 'asc' }], take: batchSize + 1,
      select: { userId: true, courseId: true },
    });
    const receipts = await tx.practiceLearnerSubmissionReceipt.findMany({
      where: { createdAt: { lt: cutoffs.receiptsBefore } },
      orderBy: [{ createdAt: 'asc' }, { sessionId: 'asc' }, { submissionId: 'asc' }], take: batchSize + 1,
      select: { sessionId: true, submissionId: true },
    });
    const hasMore = candidates.length > batchSize || receipts.length > batchSize;
    const learnersToDelete = candidates.slice(0, batchSize);
    const receiptsToDelete = receipts.slice(0, batchSize);
    if (!apply) return { applied: false, skippedLock: false, hasMore,
      candidateLearners: learnersToDelete.length, candidateReceipts: receiptsToDelete.length,
      deletedLearners: 0, deletedReceipts: 0, ...cutoffs };
    const deletedLearners = learnersToDelete.length ? (await tx.practiceLearnerSetting.deleteMany({ where: {
      OR: learnersToDelete, lastActivityAt: { lt: cutoffs.privateHistoryBefore },
    } })).count : 0;
    const deletedReceipts = receiptsToDelete.length ? (await tx.practiceLearnerSubmissionReceipt.deleteMany({ where: {
      OR: receiptsToDelete, createdAt: { lt: cutoffs.receiptsBefore },
    } })).count : 0;
    if (!hasMore) await tx.practiceRetentionHealth.update({ where: { id: 'learner' },
      data: { lastSuccessAt: now } });
    return { applied: true, skippedLock: false, hasMore,
      candidateLearners: learnersToDelete.length, candidateReceipts: receiptsToDelete.length,
      deletedLearners, deletedReceipts, ...cutoffs };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

module.exports = { practiceRetentionCutoffs, sweepPracticeRetentionBatch };
