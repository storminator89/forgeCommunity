import { setTimeout as delay } from 'node:timers/promises';
import prismaPackage from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import retention from '../lib/server/formative-practice-retention-core.cjs';

const { PrismaClient } = prismaPackage;
const { sweepPracticeRetentionBatch } = retention;
const TICK_MS = 15 * 60_000;
const MAX_BATCHES = 20;
const BATCH_SIZE = 500;

function runtimeDatabase() {
  const provider = process.env.DATABASE_PROVIDER ?? 'postgresql';
  const url = process.env.DATABASE_URL;
  if (provider !== 'sqlite' && provider !== 'postgresql') throw new Error('Invalid retention provider');
  if (!url || (provider === 'sqlite' ? !/^file:\/(?!\/)[^%?#]+$/.test(url) : !/^postgres(?:ql)?:\/\//.test(url))) {
    throw new Error('Invalid retention database URL');
  }
  let schema = null;
  if (provider === 'postgresql') {
    schema = new URL(url).searchParams.get('schema');
    if (schema !== null && (!schema || schema.includes('\0') || Buffer.byteLength(schema, 'utf8') > 63)) {
      throw new Error('Invalid retention PostgreSQL schema');
    }
  }
  return { provider, url, schema };
}

export function createRetentionClient({ provider, url, schema }) {
  const adapter = provider === 'sqlite' ? new PrismaBetterSqlite3({ url })
    : new PrismaPg({ connectionString: url }, schema ? { schema } : undefined);
  const client = new PrismaClient({ adapter });
  if (client._engineConfig.activeProvider !== provider) throw new Error('Retention Prisma Client provider mismatch');
  return client;
}

function retryable(error) {
  return error?.code === 'P2034' || error?.code === 'P2028' || error?.code === 'P1008' ||
    /SQLITE_BUSY|database is locked|Operation has timed out/i.test(String(error?.message ?? ''));
}

/** One bounded tick; callable against a disposable test DB without starting a timer. */
export async function runPracticeRetentionTick({ client, provider, schema = null, assertReady = async () => {},
  now = new Date(), batchSize = BATCH_SIZE, maxBatches = MAX_BATCHES } = {}) {
  if (!client || !['sqlite', 'postgresql'].includes(provider) || !Number.isSafeInteger(maxBatches) ||
      maxBatches < 1 || maxBatches > MAX_BATCHES) throw new Error('Invalid retention tick configuration');
  await assertReady();
  const summary = { skippedLock: false, skippedBusy: false, hasMore: false, batches: 0,
    candidateLearners: 0, candidateReceipts: 0, deletedLearners: 0, deletedReceipts: 0 };
  for (let index = 0; index < maxBatches; index++) {
    let batch;
    for (let attempt = 0; ; attempt++) {
      try { batch = await sweepPracticeRetentionBatch(client, { provider, schema, now, apply: true, batchSize }); break; }
      catch (error) {
        if (retryable(error) && attempt < 2) { await delay(40 * (attempt + 1)); continue; }
        if (retryable(error)) return { ...summary, skippedBusy: true, hasMore: true };
        throw error;
      }
    }
    if (batch.skippedLock) return { ...summary, skippedLock: true, hasMore: true };
    summary.batches++;
    summary.candidateLearners += batch.candidateLearners;
    summary.candidateReceipts += batch.candidateReceipts;
    summary.deletedLearners += batch.deletedLearners;
    summary.deletedReceipts += batch.deletedReceipts;
    summary.hasMore = batch.hasMore;
    if (!batch.hasMore) return summary;
    await delay(10);
  }
  return summary;
}

function logSummary(summary, elapsedMs) {
  console.info('practice_retention', JSON.stringify({ event: 'tick', ...summary, elapsedMs }));
}
function logFailure(error) {
  // Never log SQL parameters, row values, IDs, email addresses, or raw driver text.
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,16}$/.test(error.code) ? error.code : 'unknown';
  console.error('practice_retention', JSON.stringify({ event: 'error', code }));
}

/** Production startup owns the timer; developer `next dev` has no silent bypass. */
export async function startPracticeRetentionScheduler() {
  const config = runtimeDatabase();
  const client = createRetentionClient(config);
  let running = false;
  let catchUpTimer = null;
  const scheduleCatchUp = () => {
    if (catchUpTimer) return;
    catchUpTimer = setTimeout(() => { catchUpTimer = null; void tick(); }, 60_000);
    catchUpTimer.unref();
  };
  const tick = async (startup = false) => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    try {
      const summary = await runPracticeRetentionTick({ client, provider: config.provider, schema: config.schema,
        assertReady: () => assertCoursePublicationReady(config.url, config.provider) });
      logSummary(summary, Date.now() - startedAt);
      if (!startup && summary.hasMore) scheduleCatchUp();
      return summary;
    } catch (error) {
      logFailure(error);
      if (startup) throw error;
      scheduleCatchUp();
      return { hasMore: true };
    }
    finally { running = false; }
  };
  try {
    // Do not serve a learner endpoint until this instance has observed a fully
    // caught-up sweep. A competing instance's advisory lock is retried here.
    while ((await tick(true))?.hasMore) await delay(250);
  } catch (error) { await client.$disconnect(); throw error; }
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref();
  return { stop: async () => { clearInterval(timer); if (catchUpTimer) clearTimeout(catchUpTimer); await client.$disconnect(); } };
}
