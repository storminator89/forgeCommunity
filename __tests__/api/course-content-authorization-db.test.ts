/** @jest-environment node */
import { POST as createContent } from '@/app/api/courses/[courseId]/contents/route';
import { PUT as updateContent, DELETE as deleteContent } from '@/app/api/courses/[courseId]/contents/[contentId]/route';
import { PUT as reorderContent } from '@/app/api/courses/[courseId]/contents/[contentId]/reorder/route';
import { PUT as moveContent } from '@/app/api/courses/[courseId]/contents/[contentId]/move/route';
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route';
import { courseQuizApprovalRevision } from '@/lib/server/rewards';
import { courseContentRevision } from '@/lib/server/course-progress';
import { VERIFIED_COURSE_BADGE } from '@/lib/course-achievement-badge';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
// HTML sanitation has its own tests; exercise real authorization, progress,
// reward reconciliation and transaction rollback in this database suite.
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
  const directory = mkdtempSync(join(tmpdir(), 'forge-course-authorization-'));
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

type ContentWork = (tx: Prisma.TransactionClient) => Promise<unknown>;
const quiz = JSON.stringify({ questions: [{ id: 'question', type: 'SINGLE_CHOICE', question: 'Correct?', options: ['yes', 'no'], correctAnswers: [0] }] });
const revisedQuiz = JSON.stringify({ questions: [{ id: 'question', type: 'SINGLE_CHOICE', question: 'Changed scoring?', options: ['yes', 'no'], correctAnswers: [1] }] });
const courseParams = { params: Promise.resolve({ courseId: 'course' }) };
const contentParams = { params: Promise.resolve({ courseId: 'course', contentId: 'quiz' }) };
const request = (method: string, body?: object) => Object.assign(new Request('http://localhost/api/courses/course/contents/quiz', {
  method, ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
}), { nextUrl: new URL('http://localhost/api/courses/course/contents/quiz') }) as never;
const viewer = (id = 'admin', role = 'ADMIN') => jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
const snapshot = async () => ({
  course: await prisma.course.findUniqueOrThrow({ where: { id: 'course' } }),
  contents: await prisma.courseContent.findMany({ orderBy: { id: 'asc' } }),
  progress: await prisma.courseContentProgress.findMany({ orderBy: { contentId: 'asc' } }),
  attempts: await prisma.quizAttempt.findMany({ orderBy: { id: 'asc' } }),
  ledger: await prisma.rewardLedger.findMany({ orderBy: { id: 'asc' }, include: { changes: { orderBy: { version: 'asc' } } } }),
  badges: await prisma.userBadge.findMany({ orderBy: { id: 'asc' } }),
  completions: await prisma.courseCompletionRecord.findMany({ orderBy: { courseId: 'asc' } }),
});
const mutations = [
  ['create', () => createContent(request('POST', { title: 'New quiz', type: 'QUIZ', content: quiz }), courseParams)],
  ['update', () => updateContent(request('PUT', { type: 'QUIZ', content: revisedQuiz }), contentParams)],
  ['delete', () => deleteContent(request('DELETE'), contentParams)],
  ['reorder', () => reorderContent(request('PUT', { direction: 'up', mainContentId: null }), contentParams)],
  ['move', () => moveContent(request('PUT', { targetId: 'lesson', position: 'inside' }), contentParams)],
] as const;
const h5pMutations = [
  ['create', () => createContent(request('POST', { title: 'New package', type: 'H5P', content: '/h5p/embed/foreign-package' }), courseParams)],
  ['update', () => updateContent(request('PUT', { type: 'H5P', content: '/h5p/embed/foreign-package' }), contentParams)],
] as const;

function demoteAfterRollback() {
  const transaction = prisma.$transaction.bind(prisma);
  const conflict = new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
  return jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: ContentWork, options: object) => {
    try {
      await transaction(async tx => { await work(tx); throw conflict; }, options);
    } catch (error) {
      await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
      throw error;
    }
  }) as never);
}

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  // Removing content first also handles parent links from successful move tests.
  await prisma.courseContent.deleteMany();
  await prisma.h5PContent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' },
    { id: 'teacher', email: 'teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: 'learner', email: 'learner@example.invalid', role: 'USER' },
  ] });
  const contents = [
    { id: 'lesson', title: 'Lesson', courseId: 'course', parentId: null, type: 'TEXT' as const, content: 'Reading', order: 1 },
    { id: 'quiz', title: 'Quiz', courseId: 'course', parentId: null, type: 'TEXT' as const, content: quiz, order: 2 },
  ];
  await prisma.course.create({ data: { id: 'course', title: 'Approved course', description: 'Course', instructorId: 'teacher',
    rewardEligible: true, rewardApprovalRevision: courseQuizApprovalRevision(contents) } });
  await prisma.courseContent.createMany({ data: contents });
  await prisma.h5PContent.create({ data: { id: 'foreign-package', title: 'Private package', contentType: 'H5P.QuestionSet', userId: 'teacher' } });
  await prisma.enrollment.create({ data: { userId: 'learner', courseId: 'course' } });
  await prisma.courseContentProgress.create({ data: { userId: 'learner', courseId: 'course', contentId: 'lesson', revision: courseContentRevision(contents[0]) } });
  viewer('learner', 'USER');
  const savedQuiz = await prisma.courseContent.findUniqueOrThrow({ where: { id: 'quiz' } });
  expect((await submitQuiz(request('POST', { submissionId: 'initial-pass', contentUpdatedAt: savedQuiz.updatedAt.toISOString(), answers: { question: [0] } }), contentParams)).status).toBe(200);
  expect(await prisma.rewardLedger.count({ where: { revokedAt: null } })).toBe(1);
  expect(await prisma.userBadge.count({ where: { badgeId: VERIFIED_COURSE_BADGE.id } })).toBe(1);
  viewer();
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test.each(mutations)('%s rejects committed admin demotion after session validation without changing learning or rewards', async (_name, mutate) => {
  const before = await snapshot();
  jest.mocked(getServerSession).mockImplementationOnce(async () => {
    const session = { user: { id: 'admin', role: 'ADMIN' } };
    await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
    return session as never;
  });
  const response = await mutate();
  expect(response.status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test.each(mutations)('%s rejects a removed administrator with a stale session claim', async (_name, mutate) => {
  const before = await snapshot();
  await prisma.user.delete({ where: { id: 'admin' } });
  expect((await mutate()).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test.each(mutations)('%s permits a currently authorized administrator', async (name, mutate) => {
  expect((await mutate()).status).toBe(name === 'create' ? 201 : 200);
});

test.each(h5pMutations)('H5P %s denies a demoted course owner access to another owner\'s package', async (_name, mutate) => {
  await prisma.course.update({ where: { id: 'course' }, data: { instructorId: 'admin' } });
  const before = await snapshot();
  jest.mocked(getServerSession).mockImplementationOnce(async () => {
    await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
    return { user: { id: 'admin', role: 'ADMIN' } } as never;
  });
  expect((await mutate()).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test.each(h5pMutations)('H5P %s permits a current administrator to attach another owner\'s package', async (name, mutate) => {
  expect((await mutate()).status).toBe(name === 'create' ? 201 : 200);
});

test.each(h5pMutations)('H5P %s permits a demoted owner to attach their own package', async (name, mutate) => {
  await prisma.user.update({ where: { id: 'teacher' }, data: { role: 'USER' } });
  viewer('teacher', 'ADMIN');
  expect((await mutate()).status).toBe(name === 'create' ? 201 : 200);
});

test.each(h5pMutations)('H5P %s rechecks package authority on retry even when the actor owns the course', async (_name, mutate) => {
  await prisma.course.update({ where: { id: 'course' }, data: { instructorId: 'admin' } });
  const before = await snapshot();
  const spy = demoteAfterRollback();
  expect((await mutate()).status).toBe(403);
  expect(spy).toHaveBeenCalledTimes(2);
  for (const call of spy.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'Serializable' });
  expect(await snapshot()).toEqual(before);
});

test('demotion does not remove the existing course ownership editing permission', async () => {
  await prisma.user.update({ where: { id: 'teacher' }, data: { role: 'USER' } });
  viewer('teacher', 'INSTRUCTOR');
  expect((await updateContent(request('PUT', { title: 'Still owned' }), contentParams)).status).toBe(200);
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: 'quiz' } })).title).toBe('Still owned');
  expect(await prisma.rewardLedger.count({ where: { revokedAt: null } })).toBe(1);
  expect(await prisma.userBadge.count({ where: { badgeId: VERIFIED_COURSE_BADGE.id } })).toBe(1);
});

test.each(['admin', 'teacher'])('current %s can revise scoring and revoke its reward and badge atomically', async id => {
  viewer(id, id === 'admin' ? 'ADMIN' : 'INSTRUCTOR');
  expect((await updateContent(request('PUT', { type: 'QUIZ', content: revisedQuiz }), contentParams)).status).toBe(200);
  expect(await prisma.course.findUniqueOrThrow({ where: { id: 'course' } })).toMatchObject({ rewardEligible: false, rewardApprovalRevision: null });
  const ledger = await prisma.rewardLedger.findFirstOrThrow({ include: { changes: { orderBy: { version: 'asc' } } } });
  expect(ledger.revokedAt).not.toBeNull();
  expect(ledger.stateVersion).toBe(2);
  expect(ledger.changes.map(change => [change.type, change.reason, change.pointsDelta])).toEqual([
    ['AWARDED', null, 50], ['REVOKED', 'QUIZ_REVISED', -50],
  ]);
  expect(await prisma.userBadge.count({ where: { badgeId: VERIFIED_COURSE_BADGE.id } })).toBe(0);
  expect(await prisma.courseCompletionRecord.count()).toBe(1);
});

test('a serialization retry rechecks administrator authority and rolls back the first quiz/reward changes', async () => {
  const before = await snapshot();
  const spy = demoteAfterRollback();
  expect((await updateContent(request('PUT', { type: 'QUIZ', content: revisedQuiz }), contentParams)).status).toBe(403);
  expect(spy).toHaveBeenCalledTimes(2);
  for (const call of spy.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'Serializable' });
  expect(await snapshot()).toEqual(before);
});
