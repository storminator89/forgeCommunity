/** @jest-environment node */
import { rmSync } from 'node:fs';
import { GET as readLearner } from '@/app/api/courses/[courseId]/practice/learner/route';
import { POST as optIn } from '@/app/api/courses/[courseId]/practice/learner/opt-in/route';
import { POST as optOut } from '@/app/api/courses/[courseId]/practice/learner/opt-out/route';
import { POST as pause } from '@/app/api/courses/[courseId]/practice/learner/pause/route';
import { POST as start } from '@/app/api/courses/[courseId]/practice/learner/start/route';
import { POST as next } from '@/app/api/courses/[courseId]/practice/learner/next/route';
import { POST as answer } from '@/app/api/courses/[courseId]/practice/learner/answer/route';
import { POST as prepareReset } from '@/app/api/courses/[courseId]/practice/learner/reset/prepare/route';
import { POST as reset } from '@/app/api/courses/[courseId]/practice/learner/reset/route';
import { sweepPracticeRetention, practiceRetentionCutoffs } from '@/lib/server/formative-practice-retention';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value),
    { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }); }
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-formative-learner-'));
  const path = join(directory, 'practice.db');
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.DATABASE_URL = `file:${path}`;
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => item.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const courseId = 'learner-course-123';
const teacherId = 'learner-teacher-123';
const studentId = 'learner-student-123';
const strangerId = 'learner-stranger-123';
const pub1 = 'learner-publication-1';
const pub2 = 'learner-publication-2';
const snap1 = 'learner-snapshot-1';
const snap2 = 'learner-snapshot-2';
const context = { params: Promise.resolve({ courseId }) };
const objectiveId = 'learner-objective-1';
const items = ['learner-item-1', 'learner-item-2', 'learner-item-3'];
let staleSessionId: string;
let staleReservationId: string;
function actor(id: string) { jest.mocked(getServerSession).mockResolvedValue({ user: { id } } as never); }
function request(path: string, method = 'GET', body?: object, targetCourseId = courseId) {
  return new Request(`http://localhost/api/courses/${targetCourseId}/practice/learner${path}`, { method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
}
function snapshotItems() { return items.map((itemId, index) => ({ objectiveId, objectiveRevision: 1, itemId, itemRevision: 1,
  objectiveTitle: 'Recall', objectiveDescription: '', schemaVersion: 1, type: 'SINGLE_CHOICE',
  prompt: `Question ${index + 1}?`, options: ['Wrong', 'Correct'], correctIndex: 1, explanation: 'The second option is right.' })); }
async function makeSnapshot(id: string, publicationId: string, sequence: number) {
  return prisma.practiceSnapshot.create({ data: { id, courseId, coursePublicationId: publicationId, sequence,
    draftRevision: 1, payload: JSON.stringify({ schemaVersion: 1, coursePublicationId: publicationId, items: snapshotItems() }),
    digest: `digest-${sequence}`, itemCount: items.length, actorId: teacherId } });
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: teacherId, email: 'learner-teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: studentId, email: 'learner-student@example.invalid', role: 'USER' },
    { id: strangerId, email: 'learner-stranger@example.invalid', role: 'USER' },
  ] });
  await prisma.course.create({ data: { id: courseId, instructorId: teacherId, title: 'Course', description: 'Practice test' } });
  await prisma.enrollment.create({ data: { userId: studentId, courseId } });
  await prisma.coursePublication.create({ data: { id: pub1, courseId, sequence: 1, source: 'AUTHOR', payload: '{}', digest: 'credential-digest', contentCount: 0 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: pub1 } });
  await prisma.practiceObjective.create({ data: { id: objectiveId, ownerId: teacherId, title: 'Recall' } });
  for (const [index, itemId] of items.entries()) {
    await prisma.practiceItem.create({ data: { id: itemId, ownerId: teacherId, objectiveId, latestRevision: 1 } });
    await prisma.practiceItemRevision.create({ data: { itemId, revision: 1, payload: JSON.stringify({ schemaVersion: 1,
      type: 'SINGLE_CHOICE', prompt: `Question ${index + 1}?`, options: ['Wrong', 'Correct'], correctIndex: 1,
      explanation: 'The second option is right.' }) } });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('default off, enrolled authorization, and explicit opt-in', async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  expect((await readLearner(request(''), context)).status).toBe(401);
  actor(strangerId);
  expect((await readLearner(request(''), context)).status).toBe(403);
  actor(studentId);
  expect((await readLearner(request(''), context)).headers.get('Cache-Control')).toBe('private, no-store');
  expect((await (await readLearner(request(''), context)).json()).status).toBe('off');
  expect((await start(request('/start', 'POST'), context)).status).toBe(409);
  await makeSnapshot(snap1, pub1, 1);
  expect((await (await readLearner(request(''), context)).json()).status).toBe('available');
  expect((await start(request('/start', 'POST'), context)).status).toBe(409);
  expect((await optIn(request('/opt-in', 'POST'), context)).status).toBe(503);
  await prisma.practiceRetentionHealth.create({ data: { id: 'learner', lastSuccessAt: new Date() } });
  expect((await optIn(request('/opt-in', 'POST'), context)).status).toBe(200);
  const due = await readLearner(request(''), context);
  expect((await due.json())).toMatchObject({ status: 'ready', dueCount: 3, snapshotId: snap1 });
});

test('missing or stale retention heartbeat blocks persistence but keeps private read and pause available', async () => {
  actor(studentId);
  await prisma.practiceRetentionHealth.update({ where: { id: 'learner' },
    data: { lastSuccessAt: new Date(Date.now() - 46 * 60_000) } });
  expect((await start(request('/start', 'POST'), context)).status).toBe(503);
  expect((await (await readLearner(request(''), context)).json()).status).toBe('ready');
  expect((await pause(request('/pause', 'POST'), context)).status).toBe(200);
  expect((await optIn(request('/opt-in', 'POST'), context)).status).toBe(503);
  await prisma.practiceRetentionHealth.update({ where: { id: 'learner' }, data: { lastSuccessAt: new Date() } });
  expect((await optIn(request('/opt-in', 'POST'), context)).status).toBe(200);
});

test('start reserves once; GET and next never leak answers; answer and replay are private and idempotent', async () => {
  actor(studentId);
  const first = await (await start(request('/start', 'POST'), context)).json();
  expect(first.pending).toMatchObject({ ordinal: 1, item: { prompt: expect.any(String), options: ['Wrong', 'Correct'] } });
  const again = await (await start(request('/start', 'POST'), context)).json();
  expect(again.pending.reservationId).toBe(first.pending.reservationId);
  const read = await (await readLearner(request(''), context)).json();
  expect(read.session.pending.reservationId).toBe(first.pending.reservationId);
  expect(JSON.stringify(read)).not.toMatch(/correctIndex|explanation|The second option/);
  expect(JSON.stringify(first)).not.toMatch(/correctIndex|explanation|The second option/);
  const nextEarly = await (await next(request('/next', 'POST', { sessionId: first.sessionId }), context)).json();
  expect(nextEarly.pending.reservationId).toBe(first.pending.reservationId);
  const body = { sessionId: first.sessionId, reservationId: first.pending.reservationId,
    submissionId: 'learner-submission-1', optionIndex: 1, confidence: 'SURE' };
  await prisma.practiceRetentionHealth.update({ where: { id: 'learner' },
    data: { lastSuccessAt: new Date(Date.now() - 46 * 60_000) } });
  expect((await next(request('/next', 'POST', { sessionId: first.sessionId }), context)).status).toBe(503);
  expect((await answer(request('/answer', 'POST', body), context)).status).toBe(503);
  expect(await prisma.practiceLearnerAnswer.count()).toBe(0);
  expect((await (await readLearner(request(''), context)).json()).session.pending.reservationId).toBe(first.pending.reservationId);
  await prisma.practiceRetentionHealth.update({ where: { id: 'learner' }, data: { lastSuccessAt: new Date() } });
  const answered = await answer(request('/answer', 'POST', body), context);
  expect(answered.status).toBe(200);
  const feedback = await answered.json();
  expect(feedback).toMatchObject({ correct: true, correctIndex: 1,
    explanation: 'The second option is right.', answeredCount: 1, replay: false });
  expect(new Date(feedback.nextDueAt).getTime() - Date.now()).toBeGreaterThan(46 * 3600_000);
  expect(await (await answer(request('/answer', 'POST', body), context)).json()).toMatchObject({ correct: true, replay: true });
  await prisma.practiceLearnerSchedule.update({ where: { userId_courseId_snapshotId_itemId: {
    userId: studentId, courseId, snapshotId: snap1, itemId: first.pending.item.itemId } },
    data: { dueAt: new Date('2035-01-01T00:00:00Z') } });
  const replayAfterReschedule = await (await answer(request('/answer', 'POST', body), context)).json();
  expect(replayAfterReschedule.nextDueAt).toBe(feedback.nextDueAt);
  expect(replayAfterReschedule.answeredCount).toBe(1);
  expect((await answer(request('/answer', 'POST', { ...body, optionIndex: 0 }), context)).status).toBe(409);
  expect((await answer(request('/answer', 'POST', { ...body, submissionId: 'learner-submission-2' }), context)).status).toBe(409);
  const second = await (await next(request('/next', 'POST', { sessionId: first.sessionId }), context)).json();
  expect(second.pending.reservationId).not.toBe(first.pending.reservationId);
  expect(second.pending.item.itemId).not.toBe(first.pending.item.itemId);
  expect(JSON.stringify(second)).not.toMatch(/correctIndex|explanation|The second option/);
  const lessSure = await (await answer(request('/answer', 'POST', { sessionId: first.sessionId,
    reservationId: second.pending.reservationId, submissionId: 'learner-submission-unsure',
    optionIndex: 1, confidence: 'UNSURE' }), context)).json();
  expect(new Date(lessSure.nextDueAt).getTime() - Date.now()).toBeGreaterThan(5 * 3600_000);
  expect(new Date(lessSure.nextDueAt).getTime() - Date.now()).toBeLessThan(7 * 3600_000);
  const third = await (await next(request('/next', 'POST', { sessionId: first.sessionId }), context)).json();
  staleSessionId = third.sessionId;
  staleReservationId = third.pending.reservationId;
  expect(await prisma.quizAttempt.count()).toBe(0);
  expect(await prisma.courseContentProgress.count()).toBe(0);
  expect(await prisma.rewardLedger.count()).toBe(0);
  expect(await prisma.certificate.count()).toBe(0);
});

test('pause and opt-out preserve evidence; republish fails closed for old session', async () => {
  actor(studentId);
  expect((await pause(request('/pause', 'POST'), context)).status).toBe(200);
  expect((await (await readLearner(request(''), context)).json()).status).toBe('paused');
  expect(await prisma.practiceLearnerAnswer.count()).toBe(2);
  expect((await optOut(request('/opt-out', 'POST'), context)).status).toBe(200);
  expect((await (await readLearner(request(''), context)).json()).status).toBe('available');
  expect(await prisma.practiceLearnerAnswer.count()).toBe(2);
  await prisma.coursePublication.create({ data: { id: pub2, courseId, sequence: 2, source: 'AUTHOR', payload: '{}', digest: 'credential-digest-2', contentCount: 0 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: pub2 } });
  expect((await (await readLearner(request(''), context)).json()).status).toBe('archived');
  expect((await answer(request('/answer', 'POST', { sessionId: staleSessionId,
    reservationId: staleReservationId, submissionId: 'stale-published-answer', optionIndex: 1 }), context)).status).toBe(409);
  expect((await optIn(request('/opt-in', 'POST'), context)).status).toBe(409);
  await makeSnapshot(snap2, pub2, 2);
  expect((await optIn(request('/opt-in', 'POST'), context)).status).toBe(200);
  const restarted = await (await start(request('/start', 'POST'), context)).json();
  expect(restarted.pending).toBeDefined();
  expect(await prisma.practiceLearnerSession.count({ where: { status: 'SUPERSEDED' } })).toBe(1);
});

test('reset requires separate prepare and exact confirmation; dry-run retention never deletes', async () => {
  actor(studentId);
  const token = (await (await prepareReset(request('/reset/prepare', 'POST'), context)).json()).token;
  expect((await reset(request('/reset', 'POST', { token, confirmation: 'no' }), context)).status).toBe(428);
  const before = await prisma.practiceLearnerAnswer.count();
  const dry = await sweepPracticeRetention({ now: new Date('2027-10-15T00:00:00Z') });
  expect(dry.applied).toBe(false);
  expect(await prisma.practiceLearnerAnswer.count()).toBe(before);
  expect(practiceRetentionCutoffs(new Date('2027-10-15T00:00:00Z')).privateHistoryBefore.toISOString()).toBe('2026-10-15T00:00:00.000Z');
  expect(practiceRetentionCutoffs(new Date('2028-02-29T12:00:00Z')).privateHistoryBefore.toISOString()).toBe('2027-02-28T12:00:00.000Z');
  expect((await reset(request('/reset', 'POST', { token, confirmation: 'RESET_MY_PRACTICE' }), context)).status).toBe(200);
  expect(await prisma.practiceLearnerAnswer.count()).toBe(0);
  expect(await prisma.practiceLearnerSchedule.count()).toBe(0);
  expect(await prisma.practiceLearnerSetting.count()).toBe(0);
  expect((await reset(request('/reset', 'POST', { token, confirmation: 'RESET_MY_PRACTICE' }), context)).status).toBe(409);
  expect((await (await readLearner(request(''), context)).json()).status).toBe('available');
});

test('90-day receipt and 12-month inactive-history purge apply only in disposable test DB', async () => {
  actor(studentId);
  await optIn(request('/opt-in', 'POST'), context);
  const started = await (await start(request('/start', 'POST'), context)).json();
  const body = { sessionId: started.sessionId, reservationId: started.pending.reservationId,
    submissionId: 'retention-receipt-1', optionIndex: 0 };
  expect((await answer(request('/answer', 'POST', body), context)).status).toBe(200);
  await prisma.practiceLearnerSubmissionReceipt.update({ where: { sessionId_submissionId: { sessionId: started.sessionId,
    submissionId: body.submissionId } }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
  const now = new Date('2027-01-01T00:00:00Z');
  const receiptSweep = await sweepPracticeRetention({ now, apply: true });
  expect(receiptSweep.deletedReceipts).toBe(1);
  expect(receiptSweep.deletedLearners).toBe(0);
  expect(await prisma.practiceLearnerAnswer.count()).toBe(1);
  await prisma.practiceRetentionHealth.update({ where: { id: 'learner' }, data: { lastSuccessAt: new Date() } });
  // Durable reservation/answer uniqueness blocks late duplicate submission.
  expect((await answer(request('/answer', 'POST', body), context)).status).toBe(409);
  await prisma.practiceLearnerSetting.update({ where: { userId_courseId: { userId: studentId, courseId } },
    data: { lastActivityAt: new Date('2025-01-01T00:00:00Z') } });
  const historySweep = await sweepPracticeRetention({ now, apply: true });
  expect(historySweep.deletedLearners).toBe(1);
  expect(await prisma.practiceLearnerAnswer.count()).toBe(0);
  expect(await prisma.practiceLearnerSession.count()).toBe(0);
  expect(await prisma.practiceLearnerSchedule.count()).toBe(0);
});

test('concurrent start and answer reserve and grade exactly once', async () => {
  actor(studentId);
  await prisma.practiceRetentionHealth.update({ where: { id: 'learner' }, data: { lastSuccessAt: new Date() } });
  await optIn(request('/opt-in', 'POST'), context);
  const responses = await Promise.all([start(request('/start', 'POST'), context), start(request('/start', 'POST'), context)]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  const [a, b] = await Promise.all(responses.map(response => response.json()));
  expect(a.pending.reservationId).toBe(b.pending.reservationId);
  expect(await prisma.practiceLearnerReservation.count({ where: { sessionId: a.sessionId } })).toBe(1);
  const payload = { sessionId: a.sessionId, reservationId: a.pending.reservationId,
    submissionId: 'concurrent-answer-1', optionIndex: 1 };
  const answers = await Promise.all([answer(request('/answer', 'POST', payload), context),
    answer(request('/answer', 'POST', payload), context)]);
  expect(answers.map(response => response.status)).toEqual([200, 200]);
  expect(await prisma.practiceLearnerAnswer.count({ where: { reservationId: a.pending.reservationId } })).toBe(1);
  expect(await prisma.practiceLearnerSubmissionReceipt.count({ where: { sessionId: a.sessionId } })).toBe(1);
});

test('selection has stable ties and stops at ten answers per session', async () => {
  actor(studentId);
  const token = (await (await prepareReset(request('/reset/prepare', 'POST'), context)).json()).token;
  expect((await reset(request('/reset', 'POST', { token, confirmation: 'RESET_MY_PRACTICE' }), context)).status).toBe(200);
  const thirdPublication = 'learner-publication-3';
  const thirdSnapshot = 'learner-snapshot-3';
  const more = Array.from({ length: 9 }, (_, index) => `learner-item-${String(index + 4).padStart(2, '0')}`);
  for (const [index, itemId] of more.entries()) {
    await prisma.practiceItem.create({ data: { id: itemId, ownerId: teacherId, objectiveId, latestRevision: 1 } });
    await prisma.practiceItemRevision.create({ data: { itemId, revision: 1, payload: JSON.stringify({ schemaVersion: 1,
      type: 'SINGLE_CHOICE', prompt: `Extra ${index + 4}?`, options: ['Wrong', 'Correct'], correctIndex: 1,
      explanation: 'Try again later.' }) } });
  }
  await prisma.coursePublication.create({ data: { id: thirdPublication, courseId, sequence: 3, source: 'AUTHOR',
    payload: '{}', digest: 'credential-digest-3', contentCount: 0 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: thirdPublication } });
  const extra = more.map((itemId, index) => ({ objectiveId, objectiveRevision: 1, itemId, itemRevision: 1,
    objectiveTitle: 'Recall', objectiveDescription: '', schemaVersion: 1, type: 'SINGLE_CHOICE',
    prompt: `Extra ${index + 4}?`, options: ['Wrong', 'Correct'], correctIndex: 1, explanation: 'Try again later.' }));
  await prisma.practiceSnapshot.create({ data: { id: thirdSnapshot, courseId, coursePublicationId: thirdPublication,
    sequence: 3, draftRevision: 1, payload: JSON.stringify({ schemaVersion: 1,
      coursePublicationId: thirdPublication, items: [...snapshotItems(), ...extra] }),
    digest: 'digest-3', itemCount: 12, actorId: teacherId } });
  await optIn(request('/opt-in', 'POST'), context);
  let state = await (await start(request('/start', 'POST'), context)).json();
  const sessionId = state.sessionId;
  const shown: string[] = [];
  for (let index = 0; index < 10; index++) {
    expect(state.pending.ordinal).toBe(index + 1);
    shown.push(state.pending.item.itemId);
    const feedback = await answer(request('/answer', 'POST', { sessionId, reservationId: state.pending.reservationId,
      submissionId: `cap-answer-${index}`, optionIndex: 1 }), context);
    expect(feedback.status).toBe(200);
    expect((await feedback.json()).canContinue).toBe(index < 9);
    if (index < 9) state = await (await next(request('/next', 'POST', { sessionId }), context)).json();
  }
  expect(shown).toEqual([...shown].sort());
  expect(new Set(shown).size).toBe(10);
  expect(await prisma.practiceLearnerSession.findUnique({ where: { id: sessionId } })).toMatchObject({ status: 'COMPLETE', answeredCount: 10 });
  expect(await prisma.practiceLearnerReservation.count({ where: { sessionId } })).toBe(10);
  expect((await next(request('/next', 'POST', { sessionId }), context)).status).toBe(409);
});

test('last item completes durably without Next, and is available in a later session after its due date', async () => {
  actor(studentId);
  await prisma.practiceRetentionHealth.update({ where: { id: 'learner' }, data: { lastSuccessAt: new Date() } });
  const soloCourseId = 'learner-solo-course';
  const soloPublicationId = 'learner-solo-publication';
  const soloSnapshotId = 'learner-solo-snapshot';
  const soloContext = { params: Promise.resolve({ courseId: soloCourseId }) };
  await prisma.course.create({ data: { id: soloCourseId, instructorId: teacherId, title: 'Solo', description: 'One item' } });
  await prisma.enrollment.create({ data: { userId: studentId, courseId: soloCourseId } });
  await prisma.coursePublication.create({ data: { id: soloPublicationId, courseId: soloCourseId, sequence: 1,
    source: 'AUTHOR', payload: '{}', digest: 'solo-publication', contentCount: 0 } });
  await prisma.course.update({ where: { id: soloCourseId }, data: { activePublicationId: soloPublicationId } });
  await prisma.practiceSnapshot.create({ data: { id: soloSnapshotId, courseId: soloCourseId,
    coursePublicationId: soloPublicationId, sequence: 1, draftRevision: 1,
    payload: JSON.stringify({ schemaVersion: 1, coursePublicationId: soloPublicationId, items: [snapshotItems()[0]] }),
    digest: 'solo-snapshot', itemCount: 1, actorId: teacherId } });
  const call = (path: string, method = 'GET', body?: object) => request(path, method, body, soloCourseId);
  expect((await optIn(call('/opt-in', 'POST'), soloContext)).status).toBe(200);
  const started = await (await start(call('/start', 'POST'), soloContext)).json();
  const body = { sessionId: started.sessionId, reservationId: started.pending.reservationId,
    submissionId: 'solo-answer-once', optionIndex: 1 };
  const feedback = await (await answer(call('/answer', 'POST', body), soloContext)).json();
  expect(feedback).toMatchObject({ correct: true, answeredCount: 1, canContinue: false, replay: false });
  expect(await prisma.practiceLearnerSession.findUnique({ where: { id: started.sessionId } })).toMatchObject({ status: 'COMPLETE' });
  expect((await (await readLearner(call(''), soloContext)).json()).status).toBe('complete');
  expect(await (await answer(call('/answer', 'POST', body), soloContext)).json()).toMatchObject({
    canContinue: false, nextDueAt: feedback.nextDueAt, replay: true,
  });
  // Move this disposable fixture's review window past 24 hours; production rows
  // reach the same state naturally the next day without a page-open write.
  await prisma.practiceLearnerReservation.update({ where: { id: started.pending.reservationId },
    data: { shownAt: new Date(Date.now() - 25 * 3600_000) } });
  await prisma.practiceLearnerSchedule.update({ where: { userId_courseId_snapshotId_itemId: {
    userId: studentId, courseId: soloCourseId, snapshotId: soloSnapshotId, itemId: items[0] } },
    data: { dueAt: new Date(Date.now() - 25 * 3600_000) } });
  expect(await (await readLearner(call(''), soloContext)).json()).toMatchObject({ status: 'ready', dueCount: 1 });
  const restarted = await (await start(call('/start', 'POST'), soloContext)).json();
  expect(restarted.sessionId).not.toBe(started.sessionId);
  expect(restarted.pending.item.itemId).toBe(items[0]);
  // A pre-fix ACTIVE session with its sole item consumed can still be closed
  // deliberately, without reserving another question or losing evidence.
  await prisma.practiceLearnerSession.update({ where: { id: restarted.sessionId },
    data: { pendingReservationId: null, answeredCount: 1 } });
  expect(await (await readLearner(call(''), soloContext)).json()).toMatchObject({ status: 'active', dueCount: 0 });
  expect(await (await next(call('/next', 'POST', { sessionId: restarted.sessionId }), soloContext)).json()).toMatchObject({
    sessionId: restarted.sessionId, complete: true, answeredCount: 1,
  });
  expect(await prisma.practiceLearnerAnswer.count({ where: { reservationId: started.pending.reservationId } })).toBe(1);
});
