/** @jest-environment node */
import { rmSync } from 'node:fs';
import { GET as readAnalytics } from '@/app/api/courses/[courseId]/analytics/route';
import { GET as exportAnalytics } from '@/app/api/courses/[courseId]/analytics/export/route';
import { courseContentRevision } from '@/lib/server/course-progress';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) { return Response.json(value, init); }
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
  const directory = mkdtempSync(join(tmpdir(), 'forge-course-analytics-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => /^\d+_.*\.sql$/.test(item)).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const courseId = 'analytics-course';
const context = { params: Promise.resolve({ courseId }) };
const quizBody = JSON.stringify({ passingScore: 70, questions: [
  { id: 'q1', type: 'SINGLE_CHOICE', question: 'Frage?', options: ['Nein', 'Ja'], correctAnswers: [1], explanation: 'SECRET_ANSWER' },
] });
const lessonRevision = courseContentRevision({ type: 'TEXT', content: 'Live lesson' });
const quizRevision = courseContentRevision({ type: 'TEXT', content: quizBody });
function publicationPayload(lesson = 'Live lesson', quiz = quizBody, quizPrerequisites: string[] = []) {
  return JSON.stringify({ schemaVersion: 1, title: 'Live course', description: 'Course', startDate: null,
    endDate: null, imageUrl: null, contents: [
      { id: 'lesson', parentId: null, title: '+Unsafe title', type: 'TEXT', content: lesson, order: 1 },
      { id: 'quiz', parentId: null, title: 'Quiz', type: 'QUIZ', content: quiz, order: 2, prerequisiteIds: quizPrerequisites },
    ] });
}
function request(suffix = '') { return new Request(`http://localhost/api/courses/${courseId}/analytics${suffix}`); }
function actor(id: string | null, role = 'USER') {
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null as never);
}

beforeEach(async () => {
  await prisma.certificate.deleteMany();
  await prisma.assignmentSubmission.deleteMany();
  expect(await prisma.assignmentGradeDecision.count()).toBe(0);
  await prisma.quizAttempt.deleteMany();
  await prisma.courseContentProgress.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.course.updateMany({ data: { activePublicationId: null } });
  await prisma.coursePublication.deleteMany();
  await prisma.courseContent.deleteMany();
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'owner', email: 'owner@example.invalid', role: 'USER', name: 'Owner' },
    { id: 'other', email: 'other@example.invalid', role: 'INSTRUCTOR', name: 'Other' },
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN', name: 'Admin' },
    { id: 'learner-a', email: 'learner-a@example.invalid', name: ' =SUM(1,1)' },
    { id: 'learner-b', email: 'learner-b@example.invalid', name: 'Berta' },
  ] });
  await prisma.course.create({ data: { id: courseId, instructorId: 'owner', title: 'Live course', description: 'Course' } });
  await prisma.courseContent.createMany({ data: [
    { id: 'lesson', courseId, title: '+Unsafe title', content: 'Live lesson', type: 'TEXT', order: 1 },
    { id: 'quiz', courseId, title: 'Quiz', content: quizBody, type: 'TEXT', order: 2 },
  ] });
  await prisma.coursePublication.create({ data: { id: 'pub-1', courseId, sequence: 1, source: 'AUTHOR', payload: publicationPayload(), digest: 'digest', contentCount: 2 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: 'pub-1' } });
  await prisma.enrollment.createMany({ data: [
    { id: 'enroll-a', userId: 'learner-a', courseId, enrolledAt: new Date('2026-01-02'), completedAt: null },
    { id: 'enroll-b', userId: 'learner-b', courseId, enrolledAt: new Date('2026-01-01'), completedAt: new Date('2025-12-01') },
  ] });
  await prisma.courseContentProgress.create({ data: { userId: 'learner-a', courseId, contentId: 'lesson', revision: lessonRevision } });
  await prisma.quizAttempt.createMany({ data: [
    { id: 'attempt-a', userId: 'learner-a', courseId, contentId: 'quiz', submissionId: 'submission-a', answerDigest: 'private-digest', revision: quizRevision, score: 0, passed: false, publicationId: 'pub-1' },
    { id: 'attempt-b', userId: 'learner-b', courseId, contentId: 'quiz', submissionId: 'submission-b', answerDigest: 'old-digest', revision: 'old-revision', score: 0, passed: false, publicationId: 'pub-1' },
  ] });
  await prisma.certificate.create({ data: { id: 'certificate-b', userId: 'learner-b', courseId, userName: 'Berta', courseName: 'Live course', publicationId: 'pub-1' } });
  actor('owner');
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('checks live owner and admin state for both reads and exports', async () => {
  actor(null);
  expect((await readAnalytics(request(), context)).status).toBe(401);
  expect((await exportAnalytics(request('/export'), context)).status).toBe(401);
  actor('other', 'INSTRUCTOR');
  const denied = await readAnalytics(request(), context);
  expect(denied.status).toBe(403);
  expect(JSON.stringify(await denied.json())).not.toContain('Berta');
  expect((await exportAnalytics(request('/export'), context)).status).toBe(403);
  actor('admin', 'ADMIN');
  expect((await readAnalytics(request(), context)).status).toBe(200);
  await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
  expect((await readAnalytics(request(), context)).status).toBe(403);
  expect((await exportAnalytics(request('/export'), context)).status).toBe(403);
  actor('owner');
  await prisma.course.update({ where: { id: courseId }, data: { instructorId: 'other' } });
  expect((await readAnalytics(request(), context)).status).toBe(403);
  expect((await exportAnalytics(request('/export'), context)).status).toBe(403);
  actor('other', 'INSTRUCTOR');
  expect((await readAnalytics(request(), context)).status).toBe(200);
});

test('reports current revision signals separately from historical completion without private quiz material', async () => {
  const response = await readAnalytics(request(), context);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await response.json();
  expect(body.summary).toMatchObject({ enrolled: 2, currentComplete: 0, notStarted: 1, inProgress: 1, unmeasurable: 0 });
  expect(body.summary.quizSignals).toEqual([{ contentId: 'quiz', title: 'Quiz', attemptedLearners: 1, latestFailureLearners: 1 }]);
  const berta = body.learners.find((row: { displayName: string }) => row.displayName === 'Berta');
  expect(berta).toMatchObject({ currentStatus: 'not-started', completedLeaves: 0, quizAttempts: 0,
    historicalCompletedAt: '2025-12-01T00:00:00.000Z' });
  expect(berta.certificateIssuedAt).toBeTruthy();
  const serialized = JSON.stringify(body);
  expect(serialized).not.toMatch(/SECRET_ANSWER|private-digest|old-digest|learner-a@example|learner-b@example|correctAnswers/);
});

test('re-publication makes stale progress and quiz attempts ineligible', async () => {
  await prisma.coursePublication.create({ data: { id: 'pub-2', courseId, sequence: 2, source: 'AUTHOR',
    payload: publicationPayload('Changed lesson', quizBody.replace('Frage?', 'Neue Frage?')), digest: 'digest-2', contentCount: 2 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: 'pub-2' } });
  await prisma.courseContent.update({ where: { id: 'lesson' }, data: { content: 'Changed lesson' } });
  await prisma.courseContent.update({ where: { id: 'quiz' }, data: { content: quizBody.replace('Frage?', 'Neue Frage?') } });
  const body = await readAnalytics(request(), context).then(row => row.json());
  expect(body.summary).toMatchObject({ enrolled: 2, currentComplete: 0, notStarted: 2, inProgress: 0, quizSignals: [] });
  expect(body.learners.every((row: Row) => row.quizAttempts === 0 && row.completedLeaves === 0)).toBe(true);
  expect(body.learners.find((row: Row) => row.displayName === 'Berta').historicalCompletedAt).toBeTruthy();
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: null } });
  const unpublished = await readAnalytics(request(), context).then(row => row.json());
  expect(unpublished.summary).toMatchObject({ unmeasurable: 2, notStarted: 0, inProgress: 0 });
  expect(unpublished.learners.every((row: Row) => row.totalLeaves === 0)).toBe(true);
});

test('a failed current quiz attempt is recorded activity even without completed content', async () => {
  await prisma.quizAttempt.create({ data: { id: 'attempt-b-current', userId: 'learner-b', courseId, contentId: 'quiz',
    submissionId: 'submission-b-current', answerDigest: 'hidden', revision: quizRevision, score: 20, passed: false,
    publicationId: 'pub-1', submittedAt: new Date('2026-10-15T12:00:00.000Z') } });
  const body = await readAnalytics(request(), context).then(row => row.json());
  expect(body.summary).toMatchObject({ enrolled: 2, inProgress: 2, notStarted: 0 });
  expect(body.learners.find((row: Row) => row.displayName === 'Berta')).toMatchObject({ currentStatus: 'in-progress',
    completedLeaves: 0, quizAttempts: 1, quizNeedsReview: 1 });
});

test('current completion follows published prerequisites rather than dependent progress mirrors', async () => {
  await prisma.coursePublication.create({ data: { id: 'pub-path', courseId, sequence: 2, source: 'AUTHOR',
    payload: publicationPayload('Live lesson', quizBody, ['lesson']), digest: 'path-digest', contentCount: 2 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: 'pub-path' } });
  await prisma.courseContentProgress.create({ data: { userId: 'learner-b', courseId, contentId: 'quiz', revision: quizRevision } });
  let body = await readAnalytics(request(), context).then(response => response.json());
  expect(body.learners.find((row: Row) => row.displayName === 'Berta')).toMatchObject({
    completedLeaves: 0, currentStatus: 'in-progress', firstIncomplete: { id: 'lesson' },
  });
  await prisma.courseContentProgress.create({ data: { userId: 'learner-b', courseId, contentId: 'lesson', revision: lessonRevision } });
  body = await readAnalytics(request(), context).then(response => response.json());
  expect(body.learners.find((row: Row) => row.displayName === 'Berta')).toMatchObject({
    completedLeaves: 2, currentStatus: 'current-complete', firstIncomplete: null,
  });
});

test('assignment completion uses the newest current grade, while pending work remains activity', async () => {
  const taskBody = JSON.stringify({ prompt: 'Explain the concept.', passingScore: 70 });
  const taskRevision = courseContentRevision({ type: 'ASSIGNMENT', content: taskBody });
  await prisma.courseContent.create({ data: { id: 'task', courseId, title: 'Written task', type: 'ASSIGNMENT', content: taskBody, order: 3 } });
  const snapshot = JSON.parse(publicationPayload()) as { contents: Array<Record<string, unknown>> };
  snapshot.contents.push({ id: 'task', parentId: null, title: 'Written task', type: 'ASSIGNMENT', content: taskBody, order: 3 });
  await prisma.coursePublication.create({ data: { id: 'pub-task', courseId, sequence: 2, source: 'AUTHOR',
    payload: JSON.stringify(snapshot), digest: 'task-digest', contentCount: 3 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: 'pub-task' } });
  const submission = await prisma.assignmentSubmission.create({ data: { id: 'submission-task-1', userId: 'learner-b', courseId,
    contentId: 'task', publicationId: 'pub-task', revision: taskRevision, passingScore: 70,
    requestId: 'request-task-1', response: 'Synthetic answer', responseDigest: 'digest-1', attemptNumber: 1 } });
  // An old mirrored progress row is deliberately not accepted as grading proof.
  await prisma.courseContentProgress.create({ data: { userId: 'learner-b', courseId, contentId: 'task', revision: taskRevision } });
  const berta = async () => (await readAnalytics(request(), context).then(response => response.json())).learners
    .find((row: Row) => row.displayName === 'Berta');
  expect(await berta()).toMatchObject({ completedLeaves: 0, currentStatus: 'in-progress' });
  await prisma.assignmentGradeDecision.create({ data: { submissionId: submission.id, requestId: 'grade-task-1',
    graderId: 'owner', action: 'GRADED', score: 80, sequence: 1 } });
  expect(await berta()).toMatchObject({ completedLeaves: 1, currentStatus: 'in-progress' });
  await prisma.assignmentGradeDecision.create({ data: { submissionId: submission.id, requestId: 'grade-task-2',
    graderId: 'owner', action: 'GRADED', score: 40, sequence: 2 } });
  expect(await berta()).toMatchObject({ completedLeaves: 0, currentStatus: 'in-progress' });
  await prisma.assignmentSubmission.create({ data: { id: 'submission-task-2', userId: 'learner-b', courseId,
    contentId: 'task', publicationId: 'pub-task', revision: taskRevision, passingScore: 70,
    requestId: 'request-task-2', response: 'Revised synthetic answer', responseDigest: 'digest-2', attemptNumber: 2 } });
  expect(await berta()).toMatchObject({ completedLeaves: 0, currentStatus: 'in-progress' });
  await prisma.assignmentGradeDecision.create({ data: { submissionId: 'submission-task-2', requestId: 'grade-task-3',
    graderId: 'owner', action: 'GRADED', score: 90, sequence: 1 } });
  expect(await berta()).toMatchObject({ completedLeaves: 1, currentStatus: 'in-progress' });
  await prisma.assignmentGradeDecision.create({ data: { submissionId: 'submission-task-2', requestId: 'grade-task-4',
    graderId: 'owner', action: 'WITHDRAWN', score: null, sequence: 2 } });
  expect(await berta()).toMatchObject({ completedLeaves: 0, currentStatus: 'in-progress' });
});

test('corrupt publication projections fail closed without learner rows', async () => {
  await prisma.courseContent.update({ where: { id: 'quiz' }, data: { order: 3 } });
  const response = await readAnalytics(request(), context);
  expect(response.status).toBe(409);
  expect(JSON.stringify(await response.json())).not.toMatch(/Berta|SUM\(1,1\)/);
  expect((await exportAnalytics(request('/export'), context)).status).toBe(409);
});

type Row = { displayName: string; quizAttempts: number; completedLeaves: number; historicalCompletedAt: string | null; totalLeaves: number };
test('validates bounded pages and filters by name or current status', async () => {
  const first = await readAnalytics(request('?pageSize=1&page=1'), context).then(row => row.json());
  const second = await readAnalytics(request('?pageSize=1&page=2'), context).then(row => row.json());
  expect(first.pagination).toMatchObject({ total: 2, pageSize: 1, pages: 2 });
  expect(first.learners[0].enrollmentId).not.toBe(second.learners[0].enrollmentId);
  const searched = await readAnalytics(request('?search=Berta'), context).then(row => row.json());
  expect(searched.pagination.total).toBe(1);
  expect(searched.learners[0].displayName).toBe('Berta');
  const filtered = await readAnalytics(request('?status=needs-quiz-review'), context).then(row => row.json());
  expect(filtered.pagination.total).toBe(1);
  expect(filtered.learners[0].enrollmentId).toBe('enroll-a');
  expect((await readAnalytics(request('?pageSize=51'), context)).status).toBe(400);
  expect((await readAnalytics(request('?status=unknown'), context)).status).toBe(400);
});

test('CSV exports only filtered rows, escapes formula cells, and rejects incomplete exports', async () => {
  const csv = await exportAnalytics(request('/export?search=SUM'), context);
  expect(csv.status).toBe(200);
  expect(csv.headers.get('Content-Disposition')).toContain('attachment');
  const text = await csv.text();
  expect(text).toContain("'=SUM(1,1)");
  const titleCsv = await exportAnalytics(request('/export?search=Berta'), context).then(row => row.text());
  expect(titleCsv).toContain("'+Unsafe title");
  expect(text).not.toMatch(/SECRET_ANSWER|private-digest|learner-a@example/);
  await prisma.user.update({ where: { id: 'learner-a' }, data: { name: `AAA${'x'.repeat(1024 * 1024)}` } });
  expect((await exportAnalytics(request('/export?search=AAAx'), context)).status).toBe(413);
  await prisma.user.update({ where: { id: 'learner-a' }, data: { name: ' =SUM(1,1)' } });
  await prisma.user.createMany({ data: Array.from({ length: 499 }, (_, index) => ({ id: `extra-${index}`, email: `extra-${index}@example.invalid`, name: `Extra ${index}` })) });
  await prisma.enrollment.createMany({ data: Array.from({ length: 499 }, (_, index) => ({ id: `enroll-extra-${index}`, userId: `extra-${index}`, courseId })) });
  const tooMany = await exportAnalytics(request('/export'), context);
  expect(tooMany.status).toBe(413);
  expect(tooMany.headers.get('Content-Type')).toContain('application/json');
  expect((await tooMany.json()).error).toMatch(/keine unvollständige Datei/i);
  const filtered = await exportAnalytics(request('/export?search=Berta'), context);
  expect(filtered.status).toBe(200);
  expect((await filtered.text()).split('\r\n').length).toBe(3);
});
