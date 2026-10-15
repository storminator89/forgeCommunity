/** @jest-environment node */
import { GET, POST, PATCH, DELETE } from '@/app/api/learning-goals/me/route';
import { PATCH as markProgress } from '@/app/api/courses/[courseId]/progress/route';
import { contentVersionToken, courseContentRevision } from '@/lib/server/course-progress';
import { goalDeadline, pausedCalendarDays, shiftGoalDeadline } from '@/lib/learning-goal-clock';
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
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const temporary = mkdtempSync(join(tmpdir(), 'forge-goal-api-'));
  const path = join(temporary, 'app.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __temporary: temporary, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const quiz = JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Correct?', options: ['Yes', 'No'], correctAnswers: [0] }] });
const sessionFor = (id: string | null) => jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role: 'USER' } } as never : null);
const request = (method: string, body?: unknown) => new Request('http://localhost/api/learning-goals/me', {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const goal = async () => (await GET().then(result => result.json())).goal;

async function mark(userId: string, courseId: string, contentId: string) {
  sessionFor(userId);
  const content = await prisma.courseContent.findUniqueOrThrow({ where: { id: contentId } });
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  return markProgress(new Request(`http://localhost/api/courses/${courseId}/progress`, {
    method: 'PATCH', body: JSON.stringify({ contentId, completed: true, publicationId: course.activePublicationId,
      contentVersionToken: contentVersionToken(course.activePublicationId!, content) }),
  }) as never, { params: Promise.resolve({ courseId }) });
}

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET ??= 'test-only-learning-goal-secret';
  for (const id of ['teacher', 'alice', 'bob']) await prisma.user.create({ data: { id, email: `${id}@example.invalid` } });
  await prisma.course.create({ data: { id: 'mixed', title: 'Mixed course', description: 'Course', instructorId: 'teacher' } });
  await prisma.course.create({ data: { id: 'short', title: 'Short course', description: 'Course', instructorId: 'teacher' } });
  await prisma.course.create({ data: { id: 'own', title: 'Own course', description: 'Course', instructorId: 'alice' } });
  for (const [id, courseId, value] of [
    ['lesson', 'mixed', 'Read this'], ['quiz', 'mixed', quiz], ['single', 'short', 'Short content'], ['own-leaf', 'own', 'Own content'],
  ]) await prisma.courseContent.create({ data: { id, title: id, courseId, content: value, type: 'TEXT', order: 1 } });
  for (const courseId of ['mixed', 'short', 'own']) {
    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    const contents = await prisma.courseContent.findMany({ where: { courseId }, orderBy: { id: 'asc' } });
    const payload = { schemaVersion: 1, title: course.title, description: course.description, startDate: null, endDate: null,
      imageUrl: null, contents: contents.map(content => ({ id: content.id, parentId: content.parentId, title: content.title,
        type: content.type, content: content.content, order: content.order })) };
    const publicationId = `publication-${courseId}`;
    await prisma.coursePublication.create({ data: { id: publicationId, courseId, sequence: 1, source: 'AUTHOR',
      payload: JSON.stringify(payload), digest: `fixture-${courseId}`, contentCount: contents.length } });
    await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: publicationId } });
    await prisma.courseDraft.create({ data: { courseId, basePublicationId: publicationId, payload: JSON.stringify(payload),
      digest: `fixture-${courseId}` } });
  }
  for (const userId of ['alice', 'bob']) for (const courseId of ['mixed', 'short']) {
    await prisma.enrollment.create({ data: { id: `${userId}-${courseId}`, userId, courseId } });
  }
  await prisma.enrollment.create({ data: { id: 'alice-own', userId: 'alice', courseId: 'own' } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__temporary, { recursive: true, force: true });
});

test('only the signed-in account can create, read, pause, resume and remove its own goal', async () => {
  sessionFor(null);
  expect((await GET()).status).toBe(401);
  expect((await POST(request('POST', { targetLeaves: 3, durationDays: 7, timezone: 'UTC' }))).status).toBe(401);
  expect((await PATCH(request('PATCH', { action: 'pause' }))).status).toBe(401);
  expect((await DELETE()).status).toBe(401);

  sessionFor('alice');
  expect((await POST(request('POST', { userId: 'bob', targetLeaves: 3, durationDays: 7, timezone: 'UTC' }))).status).toBe(400);
  expect((await POST(request('POST', { targetLeaves: 3, durationDays: 7, timezone: 'Invalid/Zone' }))).status).toBe(400);
  const created = await POST(request('POST', { targetLeaves: 3, durationDays: 7, timezone: 'Europe/Berlin' }));
  expect(created.status).toBe(201);
  expect(created.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await created.json()).goal).toMatchObject({ targetLeaves: 3, completedLeaves: 0, status: 'active' });
  expect((await POST(request('POST', { targetLeaves: 3, durationDays: 7, timezone: 'UTC' }))).status).toBe(409);

  sessionFor('bob');
  expect(await goal()).toBeNull();
  expect((await PATCH(request('PATCH', { action: 'pause' }))).status).toBe(404);
  expect((await POST(request('POST', { targetLeaves: 1, durationDays: 14, timezone: 'UTC' }))).status).toBe(201);
  expect((await PATCH(request('PATCH', { action: 'pause', userId: 'alice' }))).status).toBe(400);
  expect((await PATCH(request('PATCH', { action: 'pause' }))).status).toBe(200);
  expect((await PATCH(request('PATCH', { action: 'pause' }))).status).toBe(200);
  expect((await goal()).status).toBe('paused');
  expect((await PATCH(request('PATCH', { action: 'resume' }))).status).toBe(200);
  expect((await PATCH(request('PATCH', { action: 'resume' }))).status).toBe(200);
  expect((await goal()).status).toBe('active');
  expect((await DELETE()).status).toBe(200);
  expect(await goal()).toBeNull();
  sessionFor('alice');
  expect((await goal()).targetLeaves).toBe(3);
});

test('repeated completion is counted once; quiz pass, revisions, deletion and owner exclusion remain authoritative', async () => {
  expect((await mark('alice', 'mixed', 'lesson')).status).toBe(200);
  sessionFor('alice');
  expect((await goal()).completedLeaves).toBe(1);
  const firstCompletion = (await prisma.courseContentProgress.findUniqueOrThrow({ where: { userId_contentId: { userId: 'alice', contentId: 'lesson' } } })).completedAt;
  expect((await mark('alice', 'mixed', 'lesson')).status).toBe(200);
  sessionFor('alice');
  expect((await goal()).completedLeaves).toBe(1);
  expect((await prisma.courseContentProgress.findUniqueOrThrow({ where: { userId_contentId: { userId: 'alice', contentId: 'lesson' } } })).completedAt).toEqual(firstCompletion);

  expect((await mark('alice', 'short', 'single')).status).toBe(200);
  sessionFor('alice');
  expect((await goal()).completedLeaves).toBe(2);
  // A progress row alone cannot turn a quiz into a goal completion.
  await prisma.courseContentProgress.create({ data: { userId: 'alice', courseId: 'mixed', contentId: 'quiz', revision: courseContentRevision({ type: 'TEXT', content: quiz }) } });
  expect((await goal()).completedLeaves).toBe(2);
  await prisma.quizAttempt.create({ data: { userId: 'alice', courseId: 'mixed', contentId: 'quiz', submissionId: 'passed_once', answerDigest: 'digest', revision: courseContentRevision({ type: 'TEXT', content: quiz }), score: 100, passed: true } });
  expect(await goal()).toMatchObject({ completedLeaves: 3, status: 'achieved' });

  await prisma.courseContent.update({ where: { id: 'quiz' }, data: { content: JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Revised?', options: ['Yes', 'No'], correctAnswers: [1] }] }) } });
  expect((await goal()).completedLeaves).toBe(2);
  await prisma.courseContent.update({ where: { id: 'single' }, data: { content: 'Revised short content' } });
  expect((await goal()).completedLeaves).toBe(1);

  expect((await mark('alice', 'own', 'own-leaf')).status).toBe(200);
  sessionFor('alice');
  expect((await goal()).completedLeaves).toBe(1);
  await prisma.course.delete({ where: { id: 'mixed' } });
  expect((await goal()).completedLeaves).toBe(0);
  sessionFor('bob');
  expect(await goal()).toBeNull();
});

test('local-calendar deadline and paused-day extension preserve midnight across DST', () => {
  const start = new Date('2026-03-26T17:30:00.000Z');
  const due = goalDeadline(start, 'Europe/Berlin', 7);
  expect(due.toISOString()).toBe('2026-04-01T22:00:00.000Z');
  const pausedAt = new Date('2026-03-28T22:30:00.000Z'); // March 28, 23:30 local
  const resumedAt = new Date('2026-03-30T08:00:00.000Z'); // March 30, 10:00 local
  expect(pausedCalendarDays(pausedAt, resumedAt, 'Europe/Berlin')).toBe(2);
  expect(shiftGoalDeadline(due, 'Europe/Berlin', 2).toISOString()).toBe('2026-04-03T22:00:00.000Z');
});
