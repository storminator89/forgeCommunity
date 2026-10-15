/** @jest-environment node */
import { GET as readContents } from '@/app/api/courses/[courseId]/contents/route';
import { GET as readCourse } from '@/app/api/courses/[courseId]/route';
import { GET as readProgress } from '@/app/api/courses/[courseId]/progress/route';
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route';
import { GET as readH5PMetadata } from '@/app/api/h5p/contents/[id]/route';
import { GET as previewH5P } from '@/app/h5p/embed/[id]/route';
import { GET as listH5P } from '@/app/api/h5p/contents/route';
import { readH5PAsset } from '@/lib/server/h5p-storage';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { rmSync } from 'node:fs';

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
// Authorization uses real SQLite records. The preview file reader is mocked so
// rejected previews can prove they never reach package storage or mint tokens.
jest.mock('@/lib/server/h5p-storage', () => ({
  ...jest.requireActual('@/lib/server/h5p-storage'),
  readH5PAsset: jest.fn(async () => ({ filename: 'h5p.json', bytes: Buffer.from('{}') })),
}));
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').trim(),
  sanitizeCourseTextContentServer: (value: string) => value,
}));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-course-read-authorization-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const courseParams = { params: Promise.resolve({ courseId: 'paid-course' }) };
const quizParams = { params: Promise.resolve({ courseId: 'paid-course', contentId: 'quiz' }) };
const h5pParams = { params: Promise.resolve({ id: 'course-package' }) };
const request = (path = '/api/courses/paid-course/contents') => new Request(`http://localhost${path}`) as never;
const viewer = (id = 'admin', role = 'ADMIN') => jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
const reads = [
  ['course contents', () => readContents(request(), courseParams)],
  ['course detail', () => readCourse(request('/api/courses/paid-course'), courseParams)],
  ['course progress', () => readProgress(request('/api/courses/paid-course/progress'), courseParams)],
  ['H5P metadata', () => readH5PMetadata(request('/api/h5p/contents/course-package'), h5pParams)],
  ['H5P preview', () => previewH5P(request('/h5p/embed/course-package'), h5pParams)],
] as const;
const originalSecret = process.env.NEXTAUTH_SECRET;

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.NEXTAUTH_SECRET = 'synthetic-course-read-test-secret';
  await prisma.h5PContent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' },
    { id: 'teacher', email: 'teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: 'learner', email: 'learner@example.invalid', role: 'USER' },
    { id: 'stranger', email: 'stranger@example.invalid', role: 'USER' },
  ] });
  await prisma.course.create({ data: { id: 'paid-course', title: 'Paid material', description: 'Paid course', instructorId: 'teacher', price: 50 } });
  await prisma.courseContent.createMany({ data: [
    { id: 'lesson', title: 'Paid lesson', courseId: 'paid-course', type: 'TEXT', content: 'PRIVATE-LESSON-MATERIAL', order: 1 },
    { id: 'quiz', title: 'Quiz', courseId: 'paid-course', type: 'TEXT', content: JSON.stringify({ questions: [
      { id: 'secret-question', type: 'TEXT_INPUT', question: 'What is the answer?', correctAnswer: 'PRIVATE-SCORING-KEY', explanation: 'PRIVATE-EXPLANATION' },
    ] }), order: 2 },
    { id: 'package-reference', title: 'H5P lesson', courseId: 'paid-course', type: 'H5P', content: '/h5p/embed/course-package', order: 3 },
  ] });
  await prisma.h5PContent.createMany({ data: [
    { id: 'course-package', title: 'PRIVATE-PACKAGE-TITLE', contentType: 'H5P.QuestionSet', userId: 'teacher' },
    { id: 'unreferenced-package', title: 'UNREFERENCED-PRIVATE-PACKAGE', contentType: 'H5P.QuestionSet', userId: 'teacher' },
  ] });
  await prisma.enrollment.create({ data: { userId: 'learner', courseId: 'paid-course' } });
  viewer();
});

afterAll(async () => {
  if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = originalSecret;
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test.each(reads)('%s rejects administrator demotion committed after session validation', async (_name, read) => {
  jest.mocked(getServerSession).mockImplementationOnce(async () => {
    await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
    return { user: { id: 'admin', role: 'ADMIN' } } as never;
  });
  const response = await read();
  expect(response.status).toBe(403);
  expect(await response.text()).not.toMatch(/PRIVATE-|\/api\/h5p\/assets\//);
  expect(readH5PAsset).not.toHaveBeenCalled();
});

test.each(reads)('%s rejects a removed administrator with a captured session', async (_name, read) => {
  await prisma.user.delete({ where: { id: 'admin' } });
  const response = await read();
  expect(response.status).toBe(403);
  expect(await response.text()).not.toMatch(/PRIVATE-|\/api\/h5p\/assets\//);
  expect(readH5PAsset).not.toHaveBeenCalled();
});

test.each(reads)('%s keeps current administrators authorized', async (_name, read) => {
  expect((await read()).status).toBe(200);
});

test.each(reads)('%s preserves course-owner access after role demotion', async (_name, read) => {
  await prisma.user.update({ where: { id: 'teacher' }, data: { role: 'USER' } });
  viewer('teacher', 'INSTRUCTOR');
  expect((await read()).status).toBe(200);
});

test.each(reads)('%s preserves enrolled-learner access', async (_name, read) => {
  viewer('learner', 'USER');
  expect((await read()).status).toBe(200);
});

test.each(reads)('%s rejects anonymous and unenrolled ordinary readers', async (_name, read) => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  expect((await read()).status).toBe(401);
  viewer('stranger', 'USER');
  expect((await read()).status).toBe(403);
  expect(readH5PAsset).not.toHaveBeenCalled();
});

test('a demoted enrolled administrator receives only learner quiz data and cannot edit', async () => {
  await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
  await prisma.enrollment.create({ data: { userId: 'admin', courseId: 'paid-course' } });
  const response = await readContents(request(), courseParams);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await response.text();
  expect(body).toContain('PRIVATE-LESSON-MATERIAL');
  expect(body).not.toMatch(/PRIVATE-SCORING-KEY|PRIVATE-EXPLANATION|correctAnswer/);
  expect(await (await readCourse(request(), courseParams)).json()).toMatchObject({ canEdit: false });
});

test('a retried content read rereads authority before releasing quiz keys', async () => {
  const transaction = prisma.$transaction.bind(prisma);
  const conflict = new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
  const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object,
  ) => {
    try {
      await transaction(async tx => { await work(tx); throw conflict; }, options);
    } catch (error) {
      await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
      throw error;
    }
  }) as never);
  const response = await readContents(request(), courseParams);
  expect(response.status).toBe(403);
  expect(await response.text()).not.toMatch(/PRIVATE-|correctAnswer/);
  expect(spy).toHaveBeenCalledTimes(2);
  for (const call of spy.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'Serializable' });
});

test.each(reads)('%s fails closed when the persisted administrator lookup fails', async (_name, read) => {
  const transaction = prisma.$transaction.bind(prisma);
  jest.spyOn(prisma, '$transaction').mockImplementation((async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object,
  ) => transaction(async tx => {
    const wrapped = new Proxy(tx, { get(target, key) {
      if (key === 'user') return { findUnique: async () => { throw new Error('Unavailable stored role'); } };
      return Reflect.get(target, key);
    } });
    return work(wrapped);
  }, options)) as never);
  // Detail/progress use a fresh stored-role read without a read transaction.
  jest.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error('Unavailable stored role'));
  const response = await read();
  expect(response.status).toBe(500);
  expect(await response.text()).not.toMatch(/PRIVATE-|\/api\/h5p\/assets\//);
  expect(readH5PAsset).not.toHaveBeenCalled();
});

test.each(['demoted', 'deleted'])('H5P list hides other owners\' packages from a %s administrator', async state => {
  if (state === 'demoted') await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
  else await prisma.user.delete({ where: { id: 'admin' } });
  const response = await listH5P(request('/api/h5p/contents'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
});

test('H5P list retains current administrator and package-owner visibility', async () => {
  expect(await (await listH5P(request('/api/h5p/contents'))).json()).toHaveLength(2);
  viewer('teacher', 'USER');
  expect(await (await listH5P(request('/api/h5p/contents'))).json()).toHaveLength(2);
  viewer('learner', 'USER');
  expect(await (await listH5P(request('/api/h5p/contents'))).json()).toEqual([]);
});

test('an enrolled learner cannot preview an unrelated private H5P package', async () => {
  viewer('learner', 'USER');
  const response = await previewH5P(request('/h5p/embed/unreferenced-package'), { params: Promise.resolve({ id: 'unreferenced-package' }) });
  expect(response.status).toBe(403);
  expect(readH5PAsset).not.toHaveBeenCalled();
});

test('quiz submission never gains an enrollment bypass from an ADMIN session claim', async () => {
  const content = await prisma.courseContent.findUniqueOrThrow({ where: { id: 'quiz' } });
  const response = await submitQuiz(new Request('http://localhost/api/courses/paid-course/contents/quiz/attempts', {
    method: 'POST', body: JSON.stringify({ submissionId: 'test-attempt', contentUpdatedAt: content.updatedAt.toISOString(), answers: { 'secret-question': 'PRIVATE-SCORING-KEY' } }),
  }) as never, quizParams);
  expect(response.status).toBe(403);
  expect(await prisma.quizAttempt.count()).toBe(0);
  expect(await prisma.courseContentProgress.count()).toBe(0);
  expect(await prisma.rewardLedger.count()).toBe(0);
});
