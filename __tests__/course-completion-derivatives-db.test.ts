/** @jest-environment node */
import { rmSync } from 'node:fs';
import prisma from '@/lib/prisma';
import { courseContentRevision } from '@/lib/server/course-progress';
import { profileCourseCompletionStats } from '@/lib/server/course-profile-completion';
import { countVerifiedGoalLeaves } from '@/lib/server/learning-goals';

jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-completion-derivatives-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => item.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __directory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const courseId = 'derivative-course';
const userId = 'derivative-learner';
const publicationId = 'derivative-publication';
const startedAt = new Date('2026-10-14T00:00:00.000Z');
const completedAt = new Date('2026-10-14T12:00:00.000Z');
const now = new Date('2026-10-15T12:00:00.000Z');
const assignment = JSON.stringify({ prompt: 'Explain your solution.', passingScore: 70 });
const nodes = [
  { id: 'derivative-gate', parentId: null, title: 'Gate', type: 'TEXT', content: 'Read this', order: 1 },
  { id: 'derivative-downstream', parentId: null, title: 'Downstream', type: 'TEXT', content: 'Then this', order: 3, prerequisiteIds: ['derivative-gate'] },
  { id: 'derivative-assignment', parentId: null, title: 'Assignment', type: 'ASSIGNMENT', content: assignment, order: 4, prerequisiteIds: ['derivative-downstream'] },
];
const payload = (contents: typeof nodes) => JSON.stringify({ schemaVersion: 1, title: 'Derivatives', contents });

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: 'derivative-teacher', email: 'derivative-teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: userId, email: 'derivative-learner@example.invalid', role: 'USER' },
  ] });
  await prisma.course.create({ data: { id: courseId, title: 'Derivatives', description: '', instructorId: 'derivative-teacher' } });
  for (const node of nodes) await prisma.courseContent.create({ data: {
    id: node.id, courseId, title: node.title, parentId: node.parentId, type: node.type as 'TEXT' | 'ASSIGNMENT',
    content: node.content, order: node.order,
  } });
  await prisma.coursePublication.create({ data: {
    id: publicationId, courseId, sequence: 1, source: 'AUTHOR', payload: payload(nodes), digest: 'first', contentCount: nodes.length,
  } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: publicationId } });
  await prisma.enrollment.create({ data: { userId, courseId, completedAt } });
  await prisma.learningGoal.create({ data: { userId, targetLeaves: 3, durationDays: 7, timezone: 'UTC', startedAt,
    endsAt: new Date('2026-10-21T00:00:00.000Z') } });
  for (const node of nodes) await prisma.courseContentProgress.create({ data: {
    userId, courseId, contentId: node.id, revision: courseContentRevision(node), completedAt,
  } });
  await prisma.assignmentSubmission.create({ data: {
    id: 'derivative-submission', userId, courseId, contentId: 'derivative-assignment', publicationId,
    revision: courseContentRevision(nodes[2]), passingScore: 70, requestId: 'derivative-request',
    response: 'A private answer that must not be projected.', responseDigest: 'digest', attemptNumber: 1,
  } });
  await prisma.assignmentGradeDecision.create({ data: {
    id: 'derivative-grade', submissionId: 'derivative-submission', requestId: 'derivative-grade-request',
    graderId: 'derivative-teacher', action: 'GRADED', score: 90, sequence: 1,
    createdAt: new Date(completedAt.getTime() + 120_000),
    feedback: 'Private staff feedback.',
  } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync((jest.requireMock('@/lib/prisma') as { __directory: string }).__directory, { recursive: true, force: true });
});

async function actual() {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: {
    id: true, activePublicationId: true, enrollments: { select: { userId: true, completedAt: true } },
  } });
  const goal = await prisma.learningGoal.findUniqueOrThrow({ where: { userId } });
  const [profile, leaves] = await Promise.all([
    profileCourseCompletionStats(prisma, [course]), countVerifiedGoalLeaves(prisma, goal, now),
  ]);
  return { profile: profile.get(courseId), leaves };
}

test('profile and private goal follow published locks and latest assignment grade, never a stale mirror', async () => {
  expect(await actual()).toEqual({ profile: { completionRate: 100, everCompletionRate: 100 }, leaves: 3 });

  // A prerequisite may predate opt-in while the unlocked work still counts.
  const laterStart = new Date(completedAt.getTime() + 60_000);
  const laterCompletion = new Date(completedAt.getTime() + 120_000);
  await prisma.learningGoal.update({ where: { userId }, data: { startedAt: laterStart } });
  await prisma.courseContentProgress.update({ where: { userId_contentId: { userId, contentId: 'derivative-downstream' } },
    data: { completedAt: laterCompletion } });
  expect(await actual()).toEqual({ profile: { completionRate: 100, everCompletionRate: 100 }, leaves: 2 });
  await prisma.learningGoal.update({ where: { userId }, data: { startedAt } });

  const newGate = { id: 'derivative-new-gate', parentId: null, title: 'New gate', type: 'TEXT', content: 'New reading', order: 2 };
  await prisma.courseContent.create({ data: { ...newGate, courseId, type: 'TEXT' } });
  const revisedNodes = [nodes[0], newGate, { ...nodes[1], prerequisiteIds: ['derivative-new-gate'] }, nodes[2]];
  await prisma.coursePublication.create({ data: { id: 'derivative-publication-2', courseId, sequence: 2, source: 'AUTHOR',
    payload: payload(revisedNodes), digest: 'new-gate', contentCount: revisedNodes.length } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: 'derivative-publication-2' } });
  expect(await actual()).toEqual({ profile: { completionRate: 0, everCompletionRate: 100 }, leaves: 1 });

  await prisma.courseContentProgress.create({ data: { userId, courseId, contentId: newGate.id,
    revision: courseContentRevision(newGate), completedAt } });
  expect(await actual()).toEqual({ profile: { completionRate: 100, everCompletionRate: 100 }, leaves: 4 });

  await prisma.assignmentGradeDecision.create({ data: {
    id: 'derivative-withdrawal', submissionId: 'derivative-submission', requestId: 'derivative-withdrawal-request',
    graderId: 'derivative-teacher', action: 'WITHDRAWN', sequence: 2,
  } });
  expect(await prisma.courseContentProgress.count({ where: { userId, contentId: 'derivative-assignment' } })).toBe(1);
  expect(await actual()).toEqual({ profile: { completionRate: 0, everCompletionRate: 100 }, leaves: 3 });

  await prisma.assignmentGradeDecision.create({ data: {
    id: 'derivative-regrade', submissionId: 'derivative-submission', requestId: 'derivative-regrade-request',
    graderId: 'derivative-teacher', action: 'GRADED', score: 85, sequence: 3, createdAt: now,
  } });
  await prisma.courseContentProgress.delete({ where: { userId_contentId: { userId, contentId: 'derivative-assignment' } } });
  expect(await actual()).toEqual({ profile: { completionRate: 100, everCompletionRate: 100 }, leaves: 4 });
});
