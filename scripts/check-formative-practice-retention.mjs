import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import prismaPackage from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { runPracticeRetentionTick, startPracticeRetentionScheduler } from './formative-practice-retention-scheduler.mjs';
import { assertCoursePublicationReady } from './assert-course-publication-ready.mjs';
import { initializeSqlite } from './sqlite-init.mjs';
import retention from '../lib/server/formative-practice-retention-core.cjs';

const { Prisma, PrismaClient } = prismaPackage;
const dir = mkdtempSync(join(tmpdir(), 'forge-retention-disposable-'));
const path = join(dir, 'forge.sqlite');
const url = `file:${path}`;
process.env.DATABASE_PROVIDER = 'sqlite';
process.env.DATABASE_URL = url;
initializeSqlite(url);
const db = new DatabaseSync(path);
db.exec('PRAGMA foreign_keys=ON');
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
db.close();
const makeClient = () => new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
const first = makeClient();
const second = makeClient();
const ready = () => assertCoursePublicationReady(url, 'sqlite');

test('PostgreSQL adapter schema mismatch fails before opening a transaction', async () => {
  const adapter = new PrismaPg({ connectionString: 'postgresql://placeholder.invalid/forge' }, { schema: 'tenant_a' });
  const client = { _engineConfig: { adapter }, $transaction: () => { throw new Error('transaction opened'); } };
  for (const schema of ['tenant_b', 'public', null]) {
    await assert.rejects(retention.sweepPracticeRetentionBatch(client, {
      provider: 'postgresql', schema, apply: true,
    }), /adapter schema mismatch/);
  }
});

async function seed() {
  await first.user.createMany({ data: [
    { id: 'retention-author-123', email: 'retention-author@example.invalid', role: 'INSTRUCTOR' },
    { id: 'retention-active-123', email: 'retention-active@example.invalid', role: 'USER' },
    { id: 'retention-dormant-123', email: 'retention-dormant@example.invalid', role: 'USER' },
    { id: 'retention-dormant-456', email: 'retention-dormant-2@example.invalid', role: 'USER' },
  ] });
  await first.course.create({ data: { id: 'retention-course-123', instructorId: 'retention-author-123',
    title: 'Retention fixture', description: 'Disposable only' } });
  await first.courseDraft.create({ data: { courseId: 'retention-course-123', payload: '{}', digest: 'draft-digest' } });
  await first.coursePublication.create({ data: { id: 'retention-pub-123', courseId: 'retention-course-123',
    sequence: 1, source: 'AUTHOR', payload: '{}', digest: 'pub-digest', contentCount: 0 } });
  await first.practiceSnapshot.create({ data: { id: 'retention-snap-123', courseId: 'retention-course-123',
    coursePublicationId: 'retention-pub-123', sequence: 1, draftRevision: 1, payload: '{}', digest: 'snap-digest',
    itemCount: 1, actorId: 'retention-author-123' } });
  await first.practiceLearnerSetting.createMany({ data: [
    { userId: 'retention-active-123', courseId: 'retention-course-123', optedIn: true,
      lastActivityAt: new Date('2026-10-01T00:00:00Z') },
    { userId: 'retention-dormant-123', courseId: 'retention-course-123', optedIn: false,
      lastActivityAt: new Date('2025-01-01T00:00:00Z') },
  ] });
  await first.practiceLearnerSession.create({ data: { id: 'retention-session-123', userId: 'retention-active-123',
    courseId: 'retention-course-123', snapshotId: 'retention-snap-123' } });
  await first.practiceLearnerReservation.create({ data: { id: 'retention-reservation-123',
    sessionId: 'retention-session-123', ordinal: 1, itemId: 'retention-item-123', itemRevision: 1 } });
  await first.practiceLearnerAnswer.create({ data: { id: 'retention-answer-123', reservationId: 'retention-reservation-123',
    optionIndex: 0, correct: false, nextDueAt: new Date('2026-01-02T00:00:00Z') } });
  await first.practiceLearnerSubmissionReceipt.create({ data: { sessionId: 'retention-session-123',
    submissionId: 'retention-submit-123', answerId: 'retention-answer-123', requestDigest: 'digest',
    createdAt: new Date('2026-01-01T00:00:00Z') } });
}

test('startup and concurrent ticks delete eligible disposable rows once and record a heartbeat', async () => {
  await seed();
  assert.equal(await ready(), true);
  const now = new Date('2026-10-15T00:00:00Z');
  const [a, b] = await Promise.all([first, second].map(client => runPracticeRetentionTick({
    client, provider: 'sqlite', assertReady: ready, now, batchSize: 1, maxBatches: 5,
  })));
  assert.equal(a.deletedLearners + b.deletedLearners, 1);
  assert.equal(a.deletedReceipts + b.deletedReceipts, 1);
  assert.equal(await first.practiceLearnerSetting.count(), 1);
  assert.equal(await first.practiceLearnerAnswer.count(), 1);
  assert.equal(await first.practiceLearnerSubmissionReceipt.count(), 0);
  assert.equal((await first.practiceRetentionHealth.findUnique({ where: { id: 'learner' } })).lastSuccessAt.toISOString(), now.toISOString());
  assert.ok(!JSON.stringify([a, b]).includes('retention-active-123'));
});

test('restart refreshes stale heartbeat; migration checksum mismatch fails before any delete', async () => {
  await first.practiceRetentionHealth.update({ where: { id: 'learner' }, data: { lastSuccessAt: new Date('2025-01-01T00:00:00Z') } });
  const now = new Date('2026-10-15T01:00:00Z');
  const restarted = await runPracticeRetentionTick({ client: first, provider: 'sqlite', assertReady: ready, now });
  assert.equal(restarted.hasMore, false);
  assert.equal((await first.practiceRetentionHealth.findUnique({ where: { id: 'learner' } })).lastSuccessAt.toISOString(), now.toISOString());
  await first.practiceLearnerSetting.create({ data: { userId: 'retention-dormant-123', courseId: 'retention-course-123',
    optedIn: false, lastActivityAt: new Date('2025-01-01T00:00:00Z') } });
  const original = (await first.$queryRaw(Prisma.sql`SELECT checksum FROM _app_migrations WHERE name='0016_formative_practice_learner.sql'`))[0].checksum;
  await first.$executeRaw(Prisma.sql`UPDATE _app_migrations SET checksum='tampered' WHERE name='0016_formative_practice_learner.sql'`);
  await assert.rejects(runPracticeRetentionTick({ client: first, provider: 'sqlite', assertReady: ready, now }), /history is missing, divergent/);
  await assert.rejects(startPracticeRetentionScheduler(), /history is missing, divergent/);
  assert.equal(await first.practiceLearnerSetting.count(), 2);
  await first.$executeRaw(Prisma.sql`UPDATE _app_migrations SET checksum=${original} WHERE name='0016_formative_practice_learner.sql'`);
  await first.practiceLearnerSetting.create({ data: { userId: 'retention-dormant-456', courseId: 'retention-course-123',
    optedIn: false, lastActivityAt: new Date('2025-01-01T00:00:00Z') } });
  const limited = await runPracticeRetentionTick({ client: first, provider: 'sqlite', assertReady: ready,
    now: new Date('2026-10-15T02:00:00Z'), batchSize: 1, maxBatches: 1 });
  assert.equal(limited.deletedLearners, 1);
  assert.equal(limited.hasMore, true);
  assert.equal((await first.practiceRetentionHealth.findUnique({ where: { id: 'learner' } })).lastSuccessAt.toISOString(), now.toISOString());
  const scheduler = await startPracticeRetentionScheduler();
  try {
    assert.equal(await first.practiceLearnerSetting.count(), 1);
    assert.ok((await first.practiceRetentionHealth.findUnique({ where: { id: 'learner' } })).lastSuccessAt > now);
  } finally { await scheduler.stop(); }
});

test.after(async () => { await first.$disconnect(); await second.$disconnect(); rmSync(dir, { recursive: true, force: true }); });
