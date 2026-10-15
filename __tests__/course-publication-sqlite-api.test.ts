/** @jest-environment node */
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { GET as readDraft, PATCH as mutateDraft, DELETE as discardDraft } from '@/app/api/courses/[courseId]/authoring/route';
import { GET as listAuthorCourses } from '@/app/api/courses/authoring/route';
import { GET as reviewDraft } from '@/app/api/courses/[courseId]/authoring/review/route';
import { POST as publishDraft } from '@/app/api/courses/[courseId]/authoring/publish/route';
import { GET as readHistory } from '@/app/api/courses/[courseId]/authoring/history/route';
import { POST as restoreDraft } from '@/app/api/courses/[courseId]/authoring/restore/route';
import { GET as readContents } from '@/app/api/courses/[courseId]/contents/route';
import { PATCH as markProgress, GET as readProgress } from '@/app/api/courses/[courseId]/progress/route';
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route';
import { POST as issueCertificate } from '@/app/api/courses/[courseId]/certificate/route';
import { POST as createCourse, GET as listCourses } from '@/app/api/courses/route';
import { GET as readCourse } from '@/app/api/courses/[courseId]/route';
import { POST as enroll } from '@/app/api/courses/[courseId]/enrollment/route';
import { contentVersionToken } from '@/lib/server/course-progress';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    }
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('uuid', () => ({ v4: () => 'certificate-123' }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
// Jest's CommonJS runner cannot require the ESM-only jsdom dependency used by
// the sanitizer. These fixtures are already sanitized; database/API behavior
// remains real and sanitizer coverage lives in its dedicated suite.
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.trim(),
  sanitizeCourseTextContentServer: (value: string) => value,
}));
jest.mock('@/lib/server/certificate-pdf', () => ({ certificatePdfResponse: () => new Response('certificate', { status: 200 }) }));
jest.mock('@/lib/server/course-assets', () => ({
  CourseAssetError: class extends Error { status = 400 },
  extractCourseAssetUrls: () => [], assertCanReferenceCourseAsset: async () => {},
}), { virtual: true });
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-publication-api-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => item.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
    const integrity = db.prepare('PRAGMA foreign_key_check').all();
    if (integrity.length) throw new Error(`Foreign key check failed: ${JSON.stringify(integrity)}`);
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, __dbPath: path,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const courseId = 'course-123';
const lessonId = 'lesson-123';
const quizId = 'quiz-123';
const baseId = 'publication-initial-123';
const context = { params: Promise.resolve({ courseId }) };
const quizContext = { params: Promise.resolve({ courseId, contentId: quizId }) };
const quizBody = JSON.stringify({ passingScore: 70, questions: [
  { id: 'q1', type: 'SINGLE_CHOICE', question: 'Frage?', options: ['Nein', 'Ja'], correctAnswers: [1], explanation: 'Secret' },
] });

function request(path: string, method = 'GET', body?: object) {
  const url = new URL(`http://localhost/api/courses/${courseId}${path}`);
  return Object.assign(new Request(url, { method, ...(body && { body: JSON.stringify(body) }) }), { nextUrl: url }) as never;
}
function digest(payload: object) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
function setActor(id: string, role = 'INSTRUCTOR') {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
}

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = 'test-only-publication-token-secret';
  await prisma.user.create({ data: { id: 'teacher-123', email: 'teacher-publication@example.invalid', name: 'Lehrkraft', role: 'INSTRUCTOR' } });
  await prisma.user.create({ data: { id: 'learner-123', email: 'learner-publication@example.invalid', name: 'Lernende', role: 'USER' } });
  await prisma.course.create({ data: { id: courseId, instructorId: 'teacher-123', title: 'Kurs', description: 'Beschreibung' } });
  await prisma.courseContent.create({ data: { id: lessonId, courseId, title: 'Lektion', content: '<p>Version 1</p>', type: 'TEXT', order: 1 } });
  await prisma.courseContent.create({ data: { id: quizId, courseId, title: 'Quiz', content: quizBody, type: 'TEXT', order: 2 } });
  const payload = { schemaVersion: 1, title: 'Kurs', description: 'Beschreibung', startDate: null, endDate: null, imageUrl: null,
    contents: [
      { id: lessonId, parentId: null, title: 'Lektion', type: 'TEXT', content: '<p>Version 1</p>', order: 1 },
      { id: quizId, parentId: null, title: 'Quiz', type: 'TEXT', content: quizBody, order: 2 },
    ] };
  await prisma.coursePublication.create({ data: { id: baseId, courseId, sequence: 1, source: 'AUTHOR',
    payload: JSON.stringify(payload), digest: digest(payload), contentCount: 2 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: baseId } });
  await prisma.courseDraft.create({ data: { courseId, basePublicationId: baseId, revision: 0,
    payload: JSON.stringify(payload), digest: digest(payload) } });
  await prisma.enrollment.create({ data: { id: 'enrollment-123', userId: 'learner-123', courseId } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('draft CAS is private and a save does not change the learner projection', async () => {
  setActor('teacher-123');
  const initialList = await listAuthorCourses();
  expect((await initialList.json()).courses).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: courseId, hasUnpublishedChanges: false }),
  ]));
  const initial = await readDraft(request('/authoring'), context);
  expect(initial.status).toBe(200);
  expect((await initial.json()).draft.revision).toBe(0);
  const changed = await mutateDraft(request('/authoring', 'PATCH', { expectedRevision: 0,
    operation: { kind: 'updateNode', id: lessonId, patch: { content: '<p>Version 2</p>' } } }), context);
  expect(changed.status).toBe(200);
  expect((await changed.json()).draft.revision).toBe(1);
  const stale = await mutateDraft(request('/authoring', 'PATCH', { expectedRevision: 0,
    operation: { kind: 'setMetadata', patch: { title: 'Überschreibt nicht' } } }), context);
  expect(stale.status).toBe(412);
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } })).content).toBe('<p>Version 1</p>');
  setActor('learner-123', 'USER');
  const denied = await readDraft(request('/authoring'), context);
  expect(denied.status).toBe(403);
  const learner = await readContents(request('/contents'), context);
  expect(JSON.stringify(await learner.json())).not.toContain('Version 2');
});

test('publish is atomic and idempotent; latest material requires fresh completion, historical certificate survives', async () => {
  setActor('learner-123', 'USER');
  const current = await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } });
  const marked = await markProgress(request('/progress', 'PATCH', { contentId: lessonId, completed: true,
    publicationId: baseId, contentVersionToken: contentVersionToken(baseId, current) }), context);
  expect(marked.status).toBe(200);
  const priorCompletion = await prisma.courseContentProgress.findUniqueOrThrow({ where: { userId_contentId: { userId: 'learner-123', contentId: lessonId } } });
  setActor('teacher-123');
  const review = await reviewDraft(request(`/authoring/review?expectedRevision=1&expectedActivePublicationId=${baseId}`), context);
  expect(review.status).toBe(200);
  expect((await review.json()).impact.changed).toContain(lessonId);
  const body = { expectedRevision: 1, expectedActivePublicationId: baseId, requestId: 'publish-request-123' };
  const first = await publishDraft(request('/authoring/publish', 'POST', body), context);
  expect(first.status).toBe(200);
  const published = await first.json();
  expect(published.publication.sequence).toBe(2);
  expect(published.unchanged).toBe(false);
  const retry = await publishDraft(request('/authoring/publish', 'POST', body), context);
  expect(await retry.json()).toEqual(published);
  expect(await prisma.coursePublication.count({ where: { courseId } })).toBe(2);
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } })).content).toBe('<p>Version 2</p>');
  expect((await prisma.courseContentProgress.findUniqueOrThrow({ where: { userId_contentId: { userId: 'learner-123', contentId: lessonId } } })).completedAt).toEqual(priorCompletion.completedAt);
  setActor('learner-123', 'USER');
  const progress = await readProgress(request('/progress'), context);
  expect((await progress.json()).completedContentIds).not.toContain(lessonId);
  const stale = await markProgress(request('/progress', 'PATCH', { contentId: lessonId, completed: true,
    publicationId: baseId, contentVersionToken: contentVersionToken(baseId, current) }), context);
  expect(stale.status).toBe(412);
  const live = await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } });
  const fresh = await markProgress(request('/progress', 'PATCH', { contentId: lessonId, completed: true,
    publicationId: published.publication.id, contentVersionToken: contentVersionToken(published.publication.id, live) }), context);
  expect(fresh.status).toBe(200);
  const history = await readHistory(request('/authoring/history'), context);
  expect(history.status).toBe(403);
  setActor('teacher-123');
  expect((await readHistory(request('/authoring/history'), context)).status).toBe(200);
});

test('quiz submission is tied to publication and idempotent without exposing answer keys', async () => {
  const publicationId = (await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).activePublicationId!;
  const quiz = await prisma.courseContent.findUniqueOrThrow({ where: { id: quizId } });
  setActor('learner-123', 'USER');
  const learner = await readContents(request('/contents'), context);
  expect(JSON.stringify(await learner.json())).not.toMatch(/correctAnswers|Secret/);
  const body = { submissionId: 'quiz-attempt-123', answers: { q1: [1] }, publicationId,
    contentVersionToken: contentVersionToken(publicationId, quiz) };
  const first = await submitQuiz(request(`/contents/${quizId}/attempts`, 'POST', body), quizContext);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ score: 100, passed: true });
  const retry = await submitQuiz(request(`/contents/${quizId}/attempts`, 'POST', body), quizContext);
  expect(retry.status).toBe(200);
  expect(await prisma.quizAttempt.count({ where: { userId: 'learner-123', contentId: quizId } })).toBe(1);
  const reused = await submitQuiz(request(`/contents/${quizId}/attempts`, 'POST', { ...body, answers: { q1: [0] } }), quizContext);
  expect(reused.status).toBe(409);
  const certificate = await issueCertificate(request('/certificate', 'POST'), context);
  expect(certificate.status).toBe(200);
  const saved = await prisma.certificate.findFirstOrThrow({ where: { userId: 'learner-123', courseId } });
  expect(saved.publicationId).toBe(publicationId);
  expect((await issueCertificate(request('/certificate', 'POST'), context)).status).toBe(200);
  expect(await prisma.certificate.count({ where: { userId: 'learner-123', courseId } })).toBe(1);
});

test('restore copies history to a new draft and discard increments the revision', async () => {
  setActor('teacher-123');
  const restore = await restoreDraft(request('/authoring/restore', 'POST', { expectedRevision: 1, publicationId: baseId }), context);
  expect(restore.status).toBe(200);
  const restored = await restore.json();
  expect(restored.draft.revision).toBe(2);
  expect(restored.draft.payload.contents[0].content).toBe('<p>Version 1</p>');
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } })).content).toBe('<p>Version 2</p>');
  const priorCertificate = await prisma.certificate.findFirstOrThrow({ where: { courseId, userId: 'learner-123' } });
  const activeBefore = (await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).activePublicationId!;
  const republish = await publishDraft(request('/authoring/publish', 'POST', { expectedRevision: 2,
    expectedActivePublicationId: activeBefore, requestId: 'restore-request-123' }), context);
  expect(republish.status).toBe(200);
  expect((await republish.json()).publication.sequence).toBe(3);
  expect((await prisma.coursePublication.findFirstOrThrow({ where: { courseId, sequence: 3 } })).source).toBe('RESTORE');
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } })).content).toBe('<p>Version 1</p>');
  setActor('learner-123', 'USER');
  expect((await readProgress(request('/progress'), context).then(row => row.json())).completedContentIds).not.toContain(lessonId);
  expect((await issueCertificate(request('/certificate', 'POST'), context)).status).toBe(200);
  expect((await prisma.certificate.findFirstOrThrow({ where: { courseId, userId: 'learner-123' } })).id).toBe(priorCertificate.id);
  expect((await prisma.certificate.findFirstOrThrow({ where: { courseId, userId: 'learner-123' } })).publicationId).toBe(priorCertificate.publicationId);
  setActor('teacher-123');
  const discarded = await discardDraft(request('/authoring', 'DELETE', { expectedRevision: 2 }), context);
  expect(discarded.status).toBe(200);
  expect((await discarded.json()).draft.revision).toBe(3);
  const delayed = await mutateDraft(request('/authoring', 'PATCH', { expectedRevision: 2,
    operation: { kind: 'setMetadata', patch: { title: 'Verzögerter Save' } } }), context);
  expect(delayed.status).toBe(412);
});

test('two real SQLite adapter saves with one revision cannot overwrite each other', async () => {
  setActor('teacher-123');
  const revision = (await prisma.courseDraft.findUniqueOrThrow({ where: { courseId } })).revision;
  const writes = await Promise.all([
    mutateDraft(request('/authoring', 'PATCH', { expectedRevision: revision,
      operation: { kind: 'setMetadata', patch: { title: 'Titel A' } } }), context),
    mutateDraft(request('/authoring', 'PATCH', { expectedRevision: revision,
      operation: { kind: 'setMetadata', patch: { title: 'Titel B' } } }), context),
  ]);
  expect(writes.map(row => row.status).sort()).toEqual([200, 412]);
  const draft = await prisma.courseDraft.findUniqueOrThrow({ where: { courseId } });
  expect(draft.revision).toBe(revision + 1);
  expect(['Titel A', 'Titel B']).toContain(JSON.parse(draft.payload).title);
});

test('a real SQLite failure mid-materialization rolls back snapshot, projection, pointer, receipt and rewards', async () => {
  setActor('teacher-123');
  const beforeCourse = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  const beforeLesson = await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } });
  const beforePublications = await prisma.coursePublication.count({ where: { courseId } });
  const startRevision = (await prisma.courseDraft.findUniqueOrThrow({ where: { courseId } })).revision;
  const nodeId = 'error-node-123';
  const save = await mutateDraft(request('/authoring', 'PATCH', { expectedRevision: startRevision,
    operation: { kind: 'insertNode', node: { id: nodeId, title: 'Ausfall', type: 'TEXT', content: '<p>Neu</p>' },
      parentId: null, afterId: lessonId } }), context);
  expect(save.status).toBe(200);
  const revision = (await save.json()).draft.revision;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(jest.requireMock('@/lib/prisma').__dbPath);
  db.exec(`CREATE TRIGGER fail_publication_insert BEFORE INSERT ON "CourseContent" WHEN NEW."id" = '${nodeId}' BEGIN SELECT RAISE(ABORT, 'injected materialization failure'); END;`);
  db.close();
  const publish = await publishDraft(request('/authoring/publish', 'POST', { expectedRevision: revision,
    expectedActivePublicationId: beforeCourse.activePublicationId, requestId: 'failure-request-123' }), context);
  expect(publish.status).toBe(500);
  expect(await prisma.coursePublication.count({ where: { courseId } })).toBe(beforePublications);
  expect((await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).activePublicationId).toBe(beforeCourse.activePublicationId);
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } })).content).toBe(beforeLesson.content);
  expect(await prisma.courseContent.findUnique({ where: { id: nodeId } })).toBeNull();
  expect(await prisma.publicationRequest.findUnique({ where: { courseId_requestId: { courseId, requestId: 'failure-request-123' } } })).toBeNull();
  expect((await prisma.courseDraft.findUniqueOrThrow({ where: { courseId } })).revision).toBe(revision);
});

test('new course creation saves only a private draft and blocks guessed-ID learner entry', async () => {
  setActor('teacher-123');
  const form = new URLSearchParams({ title: 'Vertraulicher Entwurf', description: 'Noch in Arbeit' });
  const created = await createCourse(new Request('http://localhost/api/courses', { method: 'POST', body: form }) as never);
  expect(created.status).toBe(201);
  const id = (await created.json()).id as string;
  const stored = await prisma.course.findUniqueOrThrow({ where: { id } });
  expect(stored.activePublicationId).toBeNull();
  expect(stored.title).toBe('Unveröffentlichter Kurs');
  const draft = await prisma.courseDraft.findUniqueOrThrow({ where: { courseId: id } });
  expect(JSON.parse(draft.payload).title).toBe('Vertraulicher Entwurf');
  const owned = await listAuthorCourses();
  expect((await owned.json()).courses).toEqual(expect.arrayContaining([
    expect.objectContaining({ id, title: 'Vertraulicher Entwurf', revision: 0, activePublication: null, hasUnpublishedChanges: true }),
  ]));
  const publicList = await listCourses();
  expect(JSON.stringify(await publicList.json())).not.toContain('Vertraulicher Entwurf');
  const ownedList = await listAuthorCourses();
  expect((await ownedList.json()).courses).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: courseId, hasUnpublishedChanges: true }),
  ]));
  setActor('learner-123', 'USER');
  expect((await listAuthorCourses().then(row => row.json())).courses).toEqual([]);
  expect((await readCourse(request('') as never, { params: Promise.resolve({ courseId: id }) })).status).toBe(404);
  expect((await enroll(new Request(`http://localhost/api/courses/${id}/enrollment`, { method: 'POST' }),
    { params: Promise.resolve({ courseId: id }) })).status).toBe(404);
});

test('archived quiz is neither returned nor counted, while its prior attempt and certificate remain', async () => {
  setActor('teacher-123');
  const draft = await prisma.courseDraft.findUniqueOrThrow({ where: { courseId } });
  const discard = await discardDraft(request('/authoring', 'DELETE', { expectedRevision: draft.revision }), context);
  expect(discard.status).toBe(200);
  const revision = (await discard.json()).draft.revision;
  const deleted = await mutateDraft(request('/authoring', 'PATCH', { expectedRevision: revision,
    operation: { kind: 'deleteNode', id: quizId } }), context);
  expect(deleted.status).toBe(200);
  const activeBefore = (await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).activePublicationId!;
  const published = await publishDraft(request('/authoring/publish', 'POST', { expectedRevision: revision + 1,
    expectedActivePublicationId: activeBefore, requestId: 'archive-request-123' }), context);
  expect(published.status).toBe(200);
  const newPublicationId = (await published.json()).publication.id as string;
  expect((await prisma.courseContent.findUniqueOrThrow({ where: { id: quizId } })).archivedAt).not.toBeNull();
  setActor('learner-123', 'USER');
  const contents = await readContents(request('/contents'), context);
  expect((await contents.json()).map((row: { id: string }) => row.id)).toEqual([lessonId]);
  const newAttempt = await submitQuiz(request(`/contents/${quizId}/attempts`, 'POST', {
    publicationId: newPublicationId, contentVersionToken: 'a'.repeat(43), submissionId: 'archive-attempt-123', answers: { q1: [1] },
  }), quizContext);
  expect(newAttempt.status).toBe(404);
  const liveLesson = await prisma.courseContent.findUniqueOrThrow({ where: { id: lessonId } });
  expect((await markProgress(request('/progress', 'PATCH', { contentId: lessonId, completed: true,
    publicationId: newPublicationId, contentVersionToken: contentVersionToken(newPublicationId, liveLesson) }), context)).status).toBe(200);
  expect((await readProgress(request('/progress'), context).then(row => row.json())).complete).toBe(true);
  expect(await prisma.quizAttempt.count({ where: { userId: 'learner-123', contentId: quizId } })).toBe(1);
  expect(await prisma.certificate.count({ where: { userId: 'learner-123', courseId } })).toBe(1);
});
