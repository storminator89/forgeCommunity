/** @jest-environment node */
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route';
import { courseQuizApprovalRevision } from '@/lib/server/rewards';
import { deleteCourseDependencies } from '@/lib/server/course-deletion';
import { rmSync } from 'node:fs';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    }
  }
  return { NextResponse: MockNextResponse };
});
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-reward-distinct-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of ['0001_initial.sql', '0002_skill_endorsements.sql', '0003_course_progress.sql', '0004_reports.sql', '0005_reward_ledger.sql']) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const params = { params: Promise.resolve({ courseId: 'reward-course', contentId: 'quiz-content' }) };
const quiz = JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Correct?', options: ['yes', 'no'], correctAnswers: [0] }] });

beforeAll(async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'learner', role: 'USER' } } as never);
  await prisma.user.create({ data: { id: 'teacher', email: 'teacher@example.invalid' } });
  await prisma.user.create({ data: { id: 'learner', email: 'learner@example.invalid' } });
  const approval = courseQuizApprovalRevision([{ id: 'quiz-content', courseId: 'reward-course', parentId: null, type: 'TEXT', content: quiz, order: 1 }]);
  await prisma.course.create({ data: { id: 'reward-course', title: 'Reward course', description: 'Course', instructorId: 'teacher', rewardEligible: true, rewardApprovalRevision: approval } });
  await prisma.courseContent.create({ data: { id: 'quiz-content', title: 'Quiz', type: 'TEXT', content: quiz, order: 1, courseId: 'reward-course' } });
  await prisma.enrollment.create({ data: { id: 'enrollment', userId: 'learner', courseId: 'reward-course' } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('distinct simultaneous passing submissions never duplicate a reward or transition', async () => {
  const content = await prisma.courseContent.findUniqueOrThrow({ where: { id: 'quiz-content' } });
  const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => submitQuiz(new Request(
    'http://localhost/api/courses/reward-course/contents/quiz-content/attempts',
    { method: 'POST', body: JSON.stringify({ submissionId: `simultaneous_${index}`, contentUpdatedAt: content.updatedAt.toISOString(), answers: { q1: [0] } }) },
  ) as never, params)));
  expect(outcomes.map(result => result.status)).toEqual(Array(6).fill(200));
  expect(await prisma.quizAttempt.count({ where: { userId: 'learner', courseId: 'reward-course', passed: true } })).toBe(6);
  const ledger = await prisma.rewardLedger.findMany({ where: { userId: 'learner', sourceId: 'reward-course' }, include: { changes: true } });
  expect(ledger).toHaveLength(1);
  expect(ledger[0]).toMatchObject({ points: 50, stateVersion: 1, revokedAt: null });
  expect(ledger[0].changes).toMatchObject([{ version: 1, type: 'AWARDED', pointsDelta: 50 }]);

  await prisma.$transaction(async tx => {
    await deleteCourseDependencies(tx, ['reward-course']);
    await tx.course.delete({ where: { id: 'reward-course' } });
  });
  const retained = await prisma.rewardLedger.findUniqueOrThrow({ where: { userId_eventType_sourceId: { userId: 'learner', eventType: 'COURSE_COMPLETED', sourceId: 'reward-course' } }, include: { changes: true } });
  expect(retained).toMatchObject({ stateVersion: 2, courseTitle: 'Reward course' });
  expect(retained.revokedAt).not.toBeNull();
  expect(retained.changes).toHaveLength(2);
  expect(retained.changes.find(change => change.version === 2)).toMatchObject({ type: 'REVOKED', version: 2, reason: 'COURSE_REMOVED', pointsDelta: -50 });
  expect(await prisma.courseCompletionRecord.count({ where: { userId: 'learner' } })).toBe(1);
  await prisma.user.delete({ where: { id: 'learner' } });
  expect(await prisma.rewardLedger.count()).toBe(0);
  expect(await prisma.rewardLedgerChange.count()).toBe(0);
  expect(await prisma.courseCompletionRecord.count()).toBe(0);
});
