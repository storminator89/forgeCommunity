/** @jest-environment node */
import { createHash } from 'node:crypto';
import { POST as createContent } from '@/app/api/courses/[courseId]/contents/route';
import { PUT as updateContent, DELETE as deleteContent } from '@/app/api/courses/[courseId]/contents/[contentId]/route';
import { PUT as reorderContent } from '@/app/api/courses/[courseId]/contents/[contentId]/reorder/route';
import { PUT as moveContent } from '@/app/api/courses/[courseId]/contents/[contentId]/move/route';
import { PATCH as updateDraft } from '@/app/api/courses/[courseId]/authoring/route';
import { POST as publishDraft } from '@/app/api/courses/[courseId]/authoring/publish/route';
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route';
import { courseQuizApprovalRevision } from '@/lib/server/rewards';
import { contentVersionToken, courseContentRevision } from '@/lib/server/course-progress';
import { VERIFIED_COURSE_BADGE } from '@/lib/course-achievement-badge';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getServerSession } from '@/lib/sites-auth/server';
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
const lessonId = 'lesson-123';
const quizId = 'quiz-123';
const publicationId = 'publication-initial-123';
const courseParams = { params: Promise.resolve({ courseId: 'course' }) };
const contentParams = { params: Promise.resolve({ courseId: 'course', contentId: quizId }) };
const request = (method: string, body?: object, path = `/contents/${quizId}`) => Object.assign(new Request(`http://localhost/api/courses/course${path}`, {
  method, ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
}), { nextUrl: new URL(`http://localhost/api/courses/course${path}`) }) as never;
const viewer = (id = 'admin', role = 'ADMIN') => jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
const digest = (payload: object) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const save = (operation: object, expectedRevision = 0) => updateDraft(request('PATCH', { expectedRevision, operation }, '/authoring'), courseParams);
const publish = (expectedRevision: number, requestId: string) => publishDraft(request('POST', {
  expectedRevision, expectedActivePublicationId: publicationId, requestId,
}, '/authoring/publish'), courseParams);
const snapshot = async () => ({
  course: await prisma.course.findUniqueOrThrow({ where: { id: 'course' } }),
  draft: await prisma.courseDraft.findUniqueOrThrow({ where: { courseId: 'course' } }),
  publications: await prisma.coursePublication.findMany({ orderBy: { sequence: 'asc' } }),
  receipts: await prisma.publicationRequest.findMany({ orderBy: { requestId: 'asc' } }),
  contents: await prisma.courseContent.findMany({ orderBy: { id: 'asc' } }),
  progress: await prisma.courseContentProgress.findMany({ orderBy: { contentId: 'asc' } }),
  attempts: await prisma.quizAttempt.findMany({ orderBy: { id: 'asc' } }),
  ledger: await prisma.rewardLedger.findMany({ orderBy: { id: 'asc' }, include: { changes: { orderBy: { version: 'asc' } } } }),
  badges: await prisma.userBadge.findMany({ orderBy: { id: 'asc' } }),
  completions: await prisma.courseCompletionRecord.findMany({ orderBy: { courseId: 'asc' } }),
  certificates: await prisma.certificate.findMany({ orderBy: { id: 'asc' } }),
});
const mutations = [
  ['create', () => createContent(request('POST', { title: 'New quiz', type: 'QUIZ', content: quiz }), courseParams)],
  ['update', () => updateContent(request('PUT', { type: 'QUIZ', content: revisedQuiz }), contentParams)],
  ['delete', () => deleteContent(request('DELETE'), contentParams)],
  ['reorder', () => reorderContent(request('PUT', { direction: 'up', mainContentId: null }), contentParams)],
  ['move', () => moveContent(request('PUT', { targetId: lessonId, position: 'inside' }), contentParams)],
] as const;
const draftOperations = [
  ['metadata', { kind: 'setMetadata', patch: { title: 'Saved draft' } }],
  ['insert', { kind: 'insertNode', node: { id: 'new-lesson-123', title: 'New', type: 'TEXT', content: 'Reading' }, parentId: null, afterId: quizId }],
  ['update', { kind: 'updateNode', id: quizId, patch: { content: revisedQuiz } }],
  ['move', { kind: 'moveNode', id: quizId, parentId: lessonId, afterId: null }],
  ['delete', { kind: 'deleteNode', id: quizId }],
] as const;
const h5pInsert = { kind: 'insertNode', node: { id: 'new-package-123', title: 'Package', type: 'H5P', content: '/h5p/embed/foreign-package' }, parentId: null, afterId: quizId };

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
  process.env.NEXTAUTH_SECRET = 'test-only-course-authorization-version-secret';
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  // Removing content first also handles parent links from successful move tests.
  await prisma.certificate.deleteMany();
  await prisma.courseContent.deleteMany();
  await prisma.h5PContent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' },
    { id: 'teacher', email: 'teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: 'learner', email: 'learner@example.invalid', role: 'USER' },
  ] });
  const contents = [
    { id: lessonId, title: 'Lesson', courseId: 'course', parentId: null, type: 'TEXT' as const, content: 'Reading', order: 1 },
    { id: quizId, title: 'Quiz', courseId: 'course', parentId: null, type: 'TEXT' as const, content: quiz, order: 2 },
  ];
  await prisma.course.create({ data: { id: 'course', title: 'Approved course', description: 'Course', instructorId: 'teacher',
    rewardEligible: true, rewardApprovalRevision: courseQuizApprovalRevision(contents) } });
  await prisma.courseContent.createMany({ data: contents });
  const payload = { schemaVersion: 1, title: 'Approved course', description: 'Course', startDate: null, endDate: null, imageUrl: null,
    contents: contents.map(row => ({ id: row.id, parentId: row.parentId, title: row.title,
      type: row.id === quizId ? 'QUIZ' : 'TEXT', content: row.content, order: row.order })) };
  await prisma.coursePublication.create({ data: { id: publicationId, courseId: 'course', sequence: 1, source: 'AUTHOR',
    payload: JSON.stringify(payload), digest: digest(payload), contentCount: 2 } });
  await prisma.course.update({ where: { id: 'course' }, data: { activePublicationId: publicationId } });
  await prisma.courseDraft.create({ data: { courseId: 'course', basePublicationId: publicationId, revision: 0,
    payload: JSON.stringify(payload), digest: digest(payload) } });
  await prisma.h5PContent.create({ data: { id: 'foreign-package', title: 'Private package', contentType: 'H5P.QuestionSet', userId: 'teacher' } });
  await prisma.enrollment.create({ data: { userId: 'learner', courseId: 'course' } });
  await prisma.courseContentProgress.create({ data: { userId: 'learner', courseId: 'course', contentId: lessonId, revision: courseContentRevision(contents[0]) } });
  viewer('learner', 'USER');
  const savedQuiz = await prisma.courseContent.findUniqueOrThrow({ where: { id: quizId } });
  expect((await submitQuiz(request('POST', { submissionId: 'initial-pass', publicationId,
    contentVersionToken: contentVersionToken(publicationId, savedQuiz), answers: { question: [0] } }), contentParams)).status).toBe(200);
  expect(await prisma.rewardLedger.count({ where: { revokedAt: null } })).toBe(1);
  expect(await prisma.userBadge.count({ where: { badgeId: VERIFIED_COURSE_BADGE.id } })).toBe(1);
  await prisma.certificate.create({ data: { id: 'certificate-123', userId: 'learner', courseId: 'course',
    courseName: 'Approved course', userName: 'Learner', publicationId } });
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
  expect((await mutate()).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test.each(mutations)('%s rejects a removed administrator with a stale session claim', async (_name, mutate) => {
  const before = await snapshot();
  await prisma.user.delete({ where: { id: 'admin' } });
  expect((await mutate()).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test.each(mutations)('legacy %s refuses an authorized live write with a reload conflict', async (_name, mutate) => {
  const before = await snapshot();
  expect((await mutate()).status).toBe(409);
  expect(await snapshot()).toEqual(before);
});

test.each(draftOperations)('draft %s rechecks committed admin demotion before saving', async (_name, operation) => {
  const before = await snapshot();
  jest.mocked(getServerSession).mockImplementationOnce(async () => {
    await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
    return { user: { id: 'admin', role: 'ADMIN' } } as never;
  });
  expect((await save(operation)).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test.each(draftOperations)('draft %s rejects a deleted admin with a stale session', async (_name, operation) => {
  const before = await snapshot();
  await prisma.user.delete({ where: { id: 'admin' } });
  expect((await save(operation)).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test.each(draftOperations)('draft %s saves for a current admin without changing published learning', async (_name, operation) => {
  const before = await snapshot();
  expect((await save(operation)).status).toBe(200);
  const after = await snapshot();
  expect(after.draft.revision).toBe(1);
  expect(after.course).toEqual(before.course);
  expect(after.contents).toEqual(before.contents);
  expect(after.ledger).toEqual(before.ledger);
  expect(after.badges).toEqual(before.badges);
  expect(after.certificates).toEqual(before.certificates);
  expect(after.publications).toEqual(before.publications);
});

test('demotion does not remove course ownership draft editing permission', async () => {
  await prisma.user.update({ where: { id: 'teacher' }, data: { role: 'USER' } });
  viewer('teacher', 'INSTRUCTOR');
  expect((await save({ kind: 'updateNode', id: quizId, patch: { title: 'Still owned' } })).status).toBe(200);
  const draft = await prisma.courseDraft.findUniqueOrThrow({ where: { courseId: 'course' } });
  expect(JSON.parse(draft.payload).contents.find((row: { id: string }) => row.id === quizId).title).toBe('Still owned');
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: quizId } })).title).toBe('Quiz');
  expect(await prisma.rewardLedger.count({ where: { revokedAt: null } })).toBe(1);
});

test('H5P draft insert denies a demoted admin another owner’s package', async () => {
  await prisma.course.update({ where: { id: 'course' }, data: { instructorId: 'admin' } });
  const before = await snapshot();
  jest.mocked(getServerSession).mockImplementationOnce(async () => {
    await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
    return { user: { id: 'admin', role: 'ADMIN' } } as never;
  });
  expect((await save(h5pInsert)).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test('H5P draft insert permits a current admin to attach another owner’s package', async () => {
  expect((await save(h5pInsert)).status).toBe(200);
  expect(await prisma.courseContent.count()).toBe(2);
});

test('H5P draft insert permits a demoted package owner to attach their own package', async () => {
  await prisma.user.update({ where: { id: 'teacher' }, data: { role: 'USER' } });
  viewer('teacher', 'ADMIN');
  expect((await save(h5pInsert)).status).toBe(200);
});

test('a serialization retry rechecks admin authority and rolls back the first H5P draft insert', async () => {
  await prisma.course.update({ where: { id: 'course' }, data: { instructorId: 'admin' } });
  const before = await snapshot();
  const spy = demoteAfterRollback();
  expect((await save(h5pInsert)).status).toBe(403);
  expect(spy).toHaveBeenCalledTimes(2);
  for (const call of spy.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'Serializable', timeout: 20_000 });
  expect(await snapshot()).toEqual(before);
});

test.each(['admin', 'teacher'])('current %s can publish revised scoring and revoke rewards atomically', async id => {
  viewer(id, id === 'admin' ? 'ADMIN' : 'INSTRUCTOR');
  const before = await snapshot();
  expect((await save({ kind: 'updateNode', id: quizId, patch: { content: revisedQuiz } })).status).toBe(200);
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: quizId } })).content).toBe(quiz);
  expect(await prisma.rewardLedger.count({ where: { revokedAt: null } })).toBe(1);
  expect((await publish(1, `publish-${id}-123`)).status).toBe(200);
  expect(await prisma.course.findUniqueOrThrow({ where: { id: 'course' } })).toMatchObject({ rewardEligible: false, rewardApprovalRevision: null });
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: quizId } })).content).toBe(revisedQuiz);
  const ledger = await prisma.rewardLedger.findFirstOrThrow({ include: { changes: { orderBy: { version: 'asc' } } } });
  expect(ledger.revokedAt).not.toBeNull();
  expect(ledger.stateVersion).toBe(2);
  expect(ledger.changes.map(change => [change.type, change.reason, change.pointsDelta])).toEqual([
    ['AWARDED', null, 50], ['REVOKED', 'QUIZ_REVISED', -50],
  ]);
  expect(await prisma.userBadge.count({ where: { badgeId: VERIFIED_COURSE_BADGE.id } })).toBe(0);
  expect(await prisma.courseCompletionRecord.count()).toBe(1);
  expect(await prisma.quizAttempt.count()).toBe(before.attempts.length);
  expect(await prisma.certificate.findUniqueOrThrow({ where: { id: 'certificate-123' } })).toEqual(before.certificates[0]);
});

test('a serialization retry rechecks admin authority and rolls back publication and rewards', async () => {
  expect((await save({ kind: 'updateNode', id: quizId, patch: { content: revisedQuiz } })).status).toBe(200);
  const before = await snapshot();
  const spy = demoteAfterRollback();
  expect((await publish(1, 'publish-retry-123')).status).toBe(403);
  expect(spy).toHaveBeenCalledTimes(2);
  for (const call of spy.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'Serializable', timeout: 20_000 });
  expect(await snapshot()).toEqual(before);
});
