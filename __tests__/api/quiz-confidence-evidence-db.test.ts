/** @jest-environment node */
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route';
import { GET as readEvidence } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/[submissionId]/evidence/route';
import { GET as readAnalytics } from '@/app/api/courses/[courseId]/analytics/route';
import { GET as exportAnalytics } from '@/app/api/courses/[courseId]/analytics/export/route';
import { contentVersionToken } from '@/lib/server/course-progress';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    }
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.trim(),
  sanitizeCourseTextContentServer: (value: string) => value,
}));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-confidence-evidence-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((entry: string) => /^\d+_.*\.sql$/.test(entry)).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign key check failed');
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const courseId = 'confidence-course';
const contentId = 'confidence-quiz';
const publicationId = 'confidence-publication-1';
const quiz = JSON.stringify({ passingScore: 80, questions: [
  { id: 'q_single', type: 'SINGLE_CHOICE', question: 'Single?', options: ['No', 'Yes'], correctAnswers: [1], explanation: 'Private key A' },
  { id: 'q_multi', type: 'MULTIPLE_CHOICE', question: 'Multi?', options: ['A', 'B', 'C'], correctAnswers: [0, 2] },
  { id: 'q_tf', type: 'TRUE_FALSE', question: 'True?', options: ['True', 'False'], correctAnswers: [1] },
  { id: 'q_text', type: 'TEXT_INPUT', question: 'Text?', correctAnswer: 'Gamma' },
  { id: 'q_match', type: 'MATCHING', question: 'Match?', pairs: [{ left: 'A', right: 'One' }] },
  { id: 'q_blank', type: 'FILL_BLANKS', question: 'Blank?', text: '[blank]', answers: ['Alpha'] },
] });
const mixedAnswers = { q_single: [1], q_multi: [0], q_tf: [0], q_text: ' GAMMA ', q_match: ['one'], q_blank: ['alpha'] };
const correctAnswers = { ...mixedAnswers, q_multi: [0, 2], q_tf: [1] };
const wrongAnswers = { q_single: [0], q_multi: [1], q_tf: [0], q_text: 'wrong', q_match: ['wrong'], q_blank: ['wrong'] };
const confidence = { q_single: 'GUESSED', q_multi: 'SURE', q_tf: 'UNSURE', q_text: 'SOMEWHAT_SURE', q_match: null, q_blank: 'SURE' };
const courseParams = { params: Promise.resolve({ courseId }) };
const attemptParams = { params: Promise.resolve({ courseId, contentId }) };
const publicationPayload = JSON.stringify({ schemaVersion: 1,
  contents: [{ id: contentId, parentId: null, order: 1, title: 'Quiz', prerequisiteIds: [] }] });

function actor(id: string | null, role = 'USER') {
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
}
function body(submissionId: string, answers: object, confidenceByQuestion?: object | null, pub = publicationId) {
  return { submissionId, publicationId: pub, contentVersionToken: contentVersionToken(pub, { id: contentId, type: 'TEXT', content: quiz }),
    answers, ...(confidenceByQuestion !== undefined && { confidenceByQuestion }) };
}
function submit(payload: object) {
  return submitQuiz(new Request(`http://localhost/api/courses/${courseId}/contents/${contentId}/attempts`,
    { method: 'POST', body: JSON.stringify(payload) }) as never, attemptParams);
}
function evidence(submissionId: string) {
  return readEvidence(new Request(`http://localhost/api/courses/${courseId}/contents/${contentId}/attempts/${submissionId}/evidence`) as never,
    { params: Promise.resolve({ courseId, contentId, submissionId }) });
}

beforeEach(async () => {
  process.env.NEXTAUTH_SECRET = 'test-only-confidence-secret';
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.DATABASE_URL = 'file:./confidence-test.db';
  jest.clearAllMocks();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'teacher', email: 'confidence-teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: 'learner', email: 'confidence-learner@example.invalid', role: 'USER' },
    { id: 'other', email: 'confidence-other@example.invalid', role: 'USER' },
  ] });
  await prisma.course.create({ data: { id: courseId, title: 'Confidence Course', description: 'Private', instructorId: 'teacher' } });
  await prisma.courseContent.create({ data: { id: contentId, courseId, title: 'Quiz', type: 'TEXT', content: quiz, order: 1 } });
  await prisma.coursePublication.create({ data: { id: publicationId, courseId, sequence: 1, source: 'AUTHOR',
    payload: publicationPayload, digest: createHash('sha256').update(publicationPayload).digest('hex'), contentCount: 1 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: publicationId } });
  await prisma.enrollment.createMany({ data: [{ userId: 'learner', courseId }, { userId: 'other', courseId }] });
  actor('learner');
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('stores server-owned correctness for all six types and optional confidence without affecting grading', async () => {
  const response = await submit(body('mixed-attempt', mixedAnswers, confidence));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ score: 4 * 100 / 6, passed: false });
  const attempt = await prisma.quizAttempt.findUniqueOrThrow({ where: {
    userId_contentId_submissionId: { userId: 'learner', contentId, submissionId: 'mixed-attempt' } },
    include: { itemEvidence: true } });
  expect(attempt.confidenceDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(attempt.itemEvidence.map(row => [row.questionId, row.correct, row.confidence]).sort()).toEqual([
    ['q_blank', true, 'SURE'], ['q_match', true, null], ['q_multi', false, 'SURE'],
    ['q_single', true, 'GUESSED'], ['q_text', true, 'SOMEWHAT_SURE'], ['q_tf', false, 'UNSURE'],
  ]);
  expect(await prisma.courseContentProgress.count()).toBe(0);
  expect(await prisma.certificate.count()).toBe(0);
  expect(JSON.stringify(await evidence('mixed-attempt').then(result => result.json()))).not.toMatch(/q_|true.*SURE|Private key A|Gamma|correct|score/i);
});

test('normalizes null or missing confidence, preserves old clients, and rejects a changed retry', async () => {
  expect((await submit(body('legacy-attempt', mixedAnswers))).status).toBe(200);
  const oldAttempt = await prisma.quizAttempt.findFirstOrThrow({ where: { submissionId: 'legacy-attempt' }, include: { itemEvidence: true } });
  expect(oldAttempt.confidenceDigest).toBeNull();
  expect(oldAttempt.itemEvidence).toHaveLength(6);
  expect(oldAttempt.itemEvidence.every(row => row.confidence === null)).toBe(true);
  expect((await submit(body('legacy-attempt', mixedAnswers, { q_single: null }))).status).toBe(200);
  expect((await submit(body('legacy-attempt', mixedAnswers, { hidden: null }))).status).toBe(400);
  expect((await submit(body('legacy-attempt', mixedAnswers, { q_single: 'SURE' }))).status).toBe(409);
  expect((await submit(body('mixed-attempt', mixedAnswers, confidence))).status).toBe(200);
  expect((await submit(body('mixed-attempt', mixedAnswers,
    { q_blank: 'SURE', q_text: 'SOMEWHAT_SURE', q_tf: 'UNSURE', q_multi: 'SURE', q_single: 'GUESSED' }))).status).toBe(200);
  expect((await submit(body('mixed-attempt', mixedAnswers, { ...confidence, q_single: 'SURE' }))).status).toBe(409);
  expect(await prisma.quizAttempt.count()).toBe(2);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(12);
});

test('failed submissions and invalid confidence leave no attempt or evidence', async () => {
  expect((await submit({ ...body('invalid-enum', mixedAnswers), confidenceByQuestion: { q_single: 'EXPERT' } })).status).toBe(400);
  expect((await submit({ ...body('unknown-item', mixedAnswers), confidenceByQuestion: { hidden: 'SURE' } })).status).toBe(400);
  expect((await submit({ ...body('unknown-null', mixedAnswers), confidenceByQuestion: { hidden: null } })).status).toBe(400);
  expect((await submit(body('invalid-answer', { ...mixedAnswers, q_single: [9] }, confidence))).status).toBe(400);
  expect((await submit({ ...body('stale-attempt', mixedAnswers, confidence), contentVersionToken: 'wrong' })).status).toBe(409);
  actor(null);
  expect((await submit(body('unauthorized', mixedAnswers, confidence))).status).toBe(401);
  expect(await prisma.quizAttempt.count()).toBe(0);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(0);
});

test('a post-insert progress failure rolls back the attempt and every item-evidence row', async () => {
  const path = join(jest.requireMock('@/lib/prisma').__tempDirectory, 'test.db');
  const install = new DatabaseSync(path);
  try {
    install.exec(`CREATE TRIGGER "confidence_rollback_fixture" BEFORE INSERT ON "CourseContentProgress"
      BEGIN SELECT RAISE(ABORT, 'forced failure after attempt insertion'); END`);
  } finally { install.close(); }
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await submit(body('rollback-after-insert', correctAnswers, confidence));
    expect(response.status).toBe(500);
    expect(await prisma.quizAttempt.count()).toBe(0);
    expect(await prisma.quizAttemptItemEvidence.count()).toBe(0);
    expect(await prisma.courseContentProgress.count()).toBe(0);
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: 'learner', courseId } } })).completedAt).toBeNull();
    expect(await prisma.courseCompletionRecord.count()).toBe(0);
    expect(await prisma.certificate.count()).toBe(0);
    expect(await prisma.rewardLedger.count()).toBe(0);
  } finally {
    logged.mockRestore();
    const cleanup = new DatabaseSync(path);
    try { cleanup.exec('DROP TRIGGER "confidence_rollback_fixture"'); }
    finally { cleanup.close(); }
  }
});

test('accepts confidence for a valid published question ID longer than 256 characters', async () => {
  const longId = `question-${'x'.repeat(300)}`;
  const revisedQuiz = JSON.parse(quiz);
  revisedQuiz.questions[0].id = longId;
  const content = JSON.stringify(revisedQuiz);
  await prisma.courseContent.update({ where: { id: contentId }, data: { content } });
  const { q_single: _oldId, ...otherAnswers } = mixedAnswers;
  const response = await submit({ submissionId: 'long-id-attempt', publicationId,
    contentVersionToken: contentVersionToken(publicationId, { id: contentId, type: 'TEXT', content }),
    answers: { ...otherAnswers, [longId]: [1] }, confidenceByQuestion: { [longId]: 'SURE' } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ score: 4 * 100 / 6, passed: false });
  expect(await prisma.quizAttemptItemEvidence.findFirstOrThrow({ where: { questionId: longId } }))
    .toMatchObject({ correct: true, confidence: 'SURE' });
});

test('rate limit and unpublished prerequisite access do not create further evidence', async () => {
  for (let index = 0; index < 5; index++) {
    expect((await submit(body(`wrong-try-${index}`, wrongAnswers, confidence))).status).toBe(200);
  }
  expect((await submit(body('wrong-try-6', wrongAnswers, confidence))).status).toBe(429);
  expect(await prisma.quizAttempt.count()).toBe(5);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(30);

  await prisma.courseContent.create({ data: { id: 'required-lesson', courseId, title: 'Required', type: 'TEXT', content: 'Read me', order: 1 } });
  await prisma.courseContent.update({ where: { id: contentId }, data: { order: 2 } });
  const gatedPayload = JSON.stringify({ schemaVersion: 1, contents: [
    { id: 'required-lesson', parentId: null, order: 1, title: 'Required', prerequisiteIds: [] },
    { id: contentId, parentId: null, order: 2, title: 'Quiz', prerequisiteIds: ['required-lesson'] },
  ] });
  await prisma.coursePublication.create({ data: { id: 'gated-publication', courseId, sequence: 2, source: 'AUTHOR',
    payload: gatedPayload, digest: createHash('sha256').update(gatedPayload).digest('hex'),
    previousPublicationId: publicationId, contentCount: 2 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: 'gated-publication' } });
  expect((await submit(body('gated-attempt', mixedAnswers, confidence, 'gated-publication'))).status).toBe(423);
  expect(await prisma.quizAttempt.count()).toBe(5);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(30);
});

test('parallel identical submissions create one attempt and exactly one evidence set', async () => {
  const [first, second] = await Promise.all([
    submit(body('parallel-attempt', mixedAnswers, confidence)),
    submit(body('parallel-attempt', mixedAnswers, confidence)),
  ]);
  expect([first.status, second.status]).toEqual([200, 200]);
  expect(await prisma.quizAttempt.count()).toBe(1);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(6);
});

test('parallel conflicting submissions return one success and one conflict without duplicate evidence', async () => {
  const [first, second] = await Promise.all([
    submit(body('parallel-conflict', mixedAnswers, { q_single: 'SURE' })),
    submit(body('parallel-conflict', mixedAnswers, { q_single: 'UNSURE' })),
  ]);
  expect([first.status, second.status].sort()).toEqual([200, 409]);
  expect(await prisma.quizAttempt.count()).toBe(1);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(6);
});

test('private GET and analytics/export never expose correctness or confidence cross-tabs', async () => {
  await submit(body('mixed-attempt', mixedAnswers, confidence));
  await submit(body('wrong-attempt', wrongAnswers, { q_single: 'SURE' }));
  await submit(body('toggled-attempt', mixedAnswers, { q_single: 'SURE' }));
  await submit(body('omitted-attempt', mixedAnswers));
  const first = await evidence('mixed-attempt');
  const second = await evidence('wrong-attempt');
  const toggled = await evidence('toggled-attempt');
  const omitted = await evidence('omitted-attempt');
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(toggled.status).toBe(200);
  expect(omitted.status).toBe(200);
  expect(first.headers.get('Cache-Control')).toBe('private, no-store');
  const firstBody = await first.json();
  expect(firstBody).toEqual(await second.json());
  expect(firstBody).toEqual(await toggled.json());
  expect(await omitted.json()).toEqual({ ...firstBody, confidenceRecorded: false });
  actor('other');
  expect((await evidence('mixed-attempt')).status).toBe(404);
  actor(null);
  expect((await evidence('mixed-attempt')).status).toBe(401);
  actor('teacher', 'INSTRUCTOR');
  const analytics = await readAnalytics(new Request(`http://localhost/api/courses/${courseId}/analytics`), courseParams);
  const csv = await exportAnalytics(new Request(`http://localhost/api/courses/${courseId}/analytics/export`), courseParams);
  expect(analytics.status).toBe(200);
  expect(csv.status).toBe(200);
  expect(JSON.stringify(await analytics.json()) + await csv.text()).not.toMatch(/q_single|q_multi|SURE|GUESSED|confidenceDigest|itemEvidence|Private key A/);
});

test('passing with low confidence retains ordinary completion and the same generic private review', async () => {
  const failed = await submit(body('mixed-attempt', mixedAnswers, confidence));
  const passed = await submit(body('passed-attempt', correctAnswers, { q_single: 'GUESSED', q_multi: 'UNSURE' }));
  expect(await failed.json()).toEqual({ score: 4 * 100 / 6, passed: false });
  expect(await passed.json()).toEqual({ score: 100, passed: true });
  expect(await prisma.courseContentProgress.count({ where: { userId: 'learner', contentId } })).toBe(1);
  expect(await prisma.courseCompletionRecord.count({ where: { userId: 'learner', courseId } })).toBe(1);
  expect(await evidence('mixed-attempt').then(result => result.json()))
    .toEqual(await evidence('passed-attempt').then(result => result.json()));
});

test('republication retires evidence reads while a lost-response retry remains idempotent', async () => {
  await submit(body('mixed-attempt', mixedAnswers, confidence));
  await prisma.coursePublication.create({ data: { id: 'confidence-publication-2', courseId, sequence: 2, source: 'AUTHOR',
    payload: publicationPayload, digest: createHash('sha256').update(publicationPayload).digest('hex'),
    previousPublicationId: publicationId, contentCount: 1 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: 'confidence-publication-2' } });
  expect((await evidence('mixed-attempt')).status).toBe(404);
  const retry = await submit(body('mixed-attempt', mixedAnswers, confidence));
  expect(retry.status).toBe(200);
  expect(await prisma.quizAttempt.count()).toBe(1);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(6);
});

test('deleting the learner cascades to private item evidence', async () => {
  await submit(body('mixed-attempt', mixedAnswers, confidence));
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(6);
  await prisma.user.delete({ where: { id: 'learner' } });
  expect(await prisma.quizAttempt.count()).toBe(0);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(0);
});
