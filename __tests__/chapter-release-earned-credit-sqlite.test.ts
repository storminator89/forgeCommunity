/** @jest-environment node */

import { rmSync } from 'node:fs';
import { getServerSession } from '@/lib/sites-auth/server';
import prisma from '@/lib/prisma';
import { GET as readContents } from '@/app/api/courses/[courseId]/contents/route';
import { GET as readProgress, PATCH as markProgress } from '@/app/api/courses/[courseId]/progress/route';
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route';
import { mutateDraft, publicationDigest, publishDraft, reviewPublication, type CoursePayload } from '@/lib/server/course-authoring';
import { completionState, contentVersionToken, courseContentRevision, recordCourseCompletion } from '@/lib/server/course-progress';
import { decideAssignmentGrade, readOwnAssignment, submitAssignment } from '@/lib/server/course-assignments';
import { privatePathwayViews, reconcileUserPathways } from '@/lib/server/learning-pathways';
import { courseQuizApprovalRevision, reconcileCourseRewards, reconcileLearnerCourseReward, reconcileUserRewards } from '@/lib/server/rewards';
import { VERIFIED_COURSE_BADGE } from '@/lib/course-achievement-badge';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    }
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
// The fixtures use already-sanitized content. Keep the real authoring,
// learner-write, grading, reward and pathway transactions and SQLite adapter.
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
  const directory = mkdtempSync(join(tmpdir(), 'forge-release-credit-'));
  const filename = join(directory, 'test.db');
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Invalid SQLite fixture');
  } finally { db.close(); }
  return { __esModule: true, __directory: directory, __filename: filename,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${filename}` }) }) };
});

const owner = { id: 'release-credit-teacher', role: 'INSTRUCTOR' as const };
const RELEASE = '2030-02-03';
const MIDNIGHT = Date.parse(`${RELEASE}T00:00:00.000Z`);
const originalEnv = {
  DATABASE_PROVIDER: process.env.DATABASE_PROVIDER,
  DATABASE_URL: process.env.DATABASE_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
};
const quiz = JSON.stringify({ passingScore: 70, questions: [
  { id: 'question-one', type: 'SINGLE_CHOICE', question: 'Correct?', options: ['Yes', 'No'], correctAnswers: [0] },
] });
let serial = 0;
let clock: jest.SpiedFunction<typeof Date.now>;

type Fixture = {
  courseId: string; publicationId: string; learner: string; newcomer: string;
  chapter: string; lesson: string; quiz: string; final: string; assignment?: string;
  payload: CoursePayload;
};

function viewer(userId: string) {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: userId, role: 'USER' } } as never);
}
function request(fixture: Fixture, suffix: string, method = 'GET', body?: object) {
  return new Request(`http://localhost/api/courses/${fixture.courseId}${suffix}`, {
    method, ...(body && { body: JSON.stringify(body) }),
  }) as never;
}
const context = (fixture: Fixture) => ({ params: Promise.resolve({ courseId: fixture.courseId }) });
async function tokenBody(fixture: Fixture, contentId: string) {
  const content = await prisma.courseContent.findUniqueOrThrow({ where: { id: contentId } });
  return { publicationId: fixture.publicationId, contentVersionToken: contentVersionToken(fixture.publicationId, content) };
}
async function mark(fixture: Fixture, contentId: string, userId = fixture.learner) {
  viewer(userId);
  return markProgress(request(fixture, '/progress', 'PATCH', {
    contentId, completed: true, ...await tokenBody(fixture, contentId),
  }), context(fixture));
}
async function passQuiz(fixture: Fixture, submissionId: string, userId = fixture.learner) {
  viewer(userId);
  return submitQuiz(request(fixture, `/contents/${fixture.quiz}/attempts`, 'POST', {
    submissionId, answers: { 'question-one': [0] }, ...await tokenBody(fixture, fixture.quiz),
  }), { params: Promise.resolve({ courseId: fixture.courseId, contentId: fixture.quiz }) });
}
async function progress(fixture: Fixture, userId = fixture.learner) {
  viewer(userId);
  const response = await readProgress(request(fixture, '/progress'), context(fixture));
  expect(response.status).toBe(200);
  return response.json();
}
function flatten(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.flatMap(row => [row, ...flatten((row.subContents ?? []) as Array<Record<string, unknown>>)]);
}
async function contents(fixture: Fixture, userId = fixture.learner) {
  viewer(userId);
  const response = await readContents(request(fixture, '/contents'), context(fixture));
  expect(response.status).toBe(200);
  return flatten(await response.json());
}

async function seed(withAssignment = false, existingLearner?: string): Promise<Fixture> {
  const prefix = `release-credit-${++serial}`;
  const fixture: Fixture = { courseId: `${prefix}-course`, publicationId: `${prefix}-publication`,
    learner: existingLearner ?? `${prefix}-learner`, newcomer: `${prefix}-newcomer`, chapter: `${prefix}-chapter`,
    lesson: `${prefix}-lesson`, quiz: `${prefix}-quiz`, final: `${prefix}-final`, payload: {} as CoursePayload };
  if (!existingLearner) await prisma.user.create({ data: { id: fixture.learner, email: `${fixture.learner}@example.invalid`, role: 'USER' } });
  await prisma.user.create({ data: { id: fixture.newcomer, email: `${fixture.newcomer}@example.invalid`, role: 'USER' } });
  fixture.payload = { schemaVersion: 1, title: `Earned course ${serial}`, description: 'Schedule-only reward regression',
    startDate: null, endDate: null, imageUrl: null, contents: [
      { id: fixture.chapter, parentId: null, title: 'Chapter', type: 'TEXT', content: '<p>Chapter</p>', order: 1 },
      { id: fixture.lesson, parentId: fixture.chapter, title: 'Lesson', type: 'TEXT', content: '<p>Original lesson</p>', order: 1 },
      { id: fixture.quiz, parentId: fixture.chapter, title: 'Quiz', type: 'TEXT', content: quiz, order: 2, prerequisiteIds: [fixture.lesson] },
      { id: fixture.final, parentId: null, title: 'Final lesson', type: 'TEXT', content: '<p>Final lesson</p>', order: 2, prerequisiteIds: [fixture.quiz] },
    ] };
  if (withAssignment) {
    fixture.assignment = `${prefix}-assignment`;
    fixture.payload.contents.push({ id: fixture.assignment, parentId: fixture.chapter, title: 'Assignment', type: 'ASSIGNMENT',
      content: JSON.stringify({ prompt: 'Explain your solution.', passingScore: 70 }), order: 3, prerequisiteIds: [fixture.quiz] });
  }
  const projected = fixture.payload.contents.map(({ prerequisiteIds: _prerequisites, releaseOn: _release, ...node }) => ({
    ...node, type: node.type === 'QUIZ' ? 'TEXT' as const : node.type, courseId: fixture.courseId,
  }));
  await prisma.course.create({ data: { id: fixture.courseId, title: fixture.payload.title, description: fixture.payload.description,
    instructorId: owner.id, rewardEligible: true, rewardApprovalRevision: courseQuizApprovalRevision(projected) } });
  for (const node of projected) await prisma.courseContent.create({ data: node });
  await prisma.coursePublication.create({ data: { id: fixture.publicationId, courseId: fixture.courseId,
    sequence: 1, source: 'AUTHOR', payload: JSON.stringify(fixture.payload), digest: publicationDigest(fixture.payload), contentCount: projected.length } });
  await prisma.course.update({ where: { id: fixture.courseId }, data: { activePublicationId: fixture.publicationId } });
  await prisma.courseDraft.create({ data: { courseId: fixture.courseId, basePublicationId: fixture.publicationId,
    revision: 0, payload: JSON.stringify(fixture.payload), digest: publicationDigest(fixture.payload) } });
  await prisma.enrollment.createMany({ data: [fixture.learner, fixture.newcomer].map(userId => ({ userId, courseId: fixture.courseId })) });
  return fixture;
}

async function earnLearnerWork(fixture: Fixture) {
  expect((await mark(fixture, fixture.lesson)).status).toBe(200);
  const passed = await passQuiz(fixture, `${fixture.courseId}-earned-attempt`);
  expect(passed.status).toBe(200);
  expect(await passed.json()).toEqual({ score: 100, passed: true });
  expect((await mark(fixture, fixture.final)).status).toBe(200);
  return prisma.$transaction(tx => recordCourseCompletion(tx, fixture.learner, fixture.courseId));
}

async function publishSchedule(fixture: Fixture, changeLesson = false) {
  const changed = await mutateDraft(fixture.courseId, owner, 0, { kind: 'setReleaseOn', id: fixture.chapter, releaseOn: RELEASE });
  const draft = changeLesson ? await mutateDraft(fixture.courseId, owner, changed.draft.revision,
    { kind: 'updateNode', id: fixture.lesson, patch: { content: '<p>Revised lesson requires new work</p>' } }) : changed;
  const review = await reviewPublication(fixture.courseId, owner, draft.draft.revision, fixture.publicationId);
  expect(review.ready).toBe(true);
  const published = await publishDraft(fixture.courseId, owner, draft.draft.revision, fixture.publicationId, `${fixture.courseId}-schedule-request`);
  fixture.publicationId = published.publication.id;
  return review;
}

async function evidence(fixture: Fixture) {
  return {
    progress: await prisma.courseContentProgress.findMany({ where: { userId: fixture.learner, courseId: fixture.courseId }, orderBy: { contentId: 'asc' } }),
    attempts: await prisma.quizAttempt.findMany({ where: { userId: fixture.learner, courseId: fixture.courseId },
      include: { itemEvidence: { orderBy: { questionId: 'asc' } } }, orderBy: { id: 'asc' } }),
  };
}
async function creditSnapshot(userId: string) {
  return {
    enrollments: await prisma.enrollment.findMany({ where: { userId }, orderBy: { courseId: 'asc' } }),
    completions: await prisma.courseCompletionRecord.findMany({ where: { userId }, orderBy: { courseId: 'asc' } }),
    ledger: await prisma.rewardLedger.findMany({ where: { userId }, include: { changes: { orderBy: { version: 'asc' } } }, orderBy: { sourceId: 'asc' } }),
    badges: await prisma.userBadge.findMany({ where: { userId }, orderBy: { badgeId: 'asc' } }),
    pathways: await prisma.learningPathwayParticipation.findMany({ where: { userId }, include: { changes: { orderBy: { version: 'asc' } } }, orderBy: { pathwayId: 'asc' } }),
  };
}
async function reconcile(fixture: Fixture) {
  return prisma.$transaction(async tx => {
    const state = await recordCourseCompletion(tx, fixture.learner, fixture.courseId);
    await reconcileLearnerCourseReward(tx, fixture.learner, fixture.courseId);
    await reconcileUserRewards(tx, fixture.learner);
    return state;
  });
}

beforeAll(async () => {
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.DATABASE_URL = `file:${jest.requireMock('@/lib/prisma').__filename}`;
  process.env.NEXTAUTH_SECRET = 'test-only-earned-release-credit';
  await prisma.user.create({ data: { ...owner, email: 'release-credit-teacher@example.invalid' } });
});
beforeEach(() => { clock = jest.spyOn(Date, 'now').mockReturnValue(MIDNIGHT - 1); });
afterEach(() => { clock.mockRestore(); });
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('date-only publication preserves earned completion, rewards, badges and pathway history through ordinary reads and UTC release', async () => {
  const fixture = await seed();
  const companion = await seed(false, fixture.learner);
  expect(await earnLearnerWork(fixture)).toMatchObject({ complete: true });
  expect(await earnLearnerWork(companion)).toMatchObject({ complete: true });
  const pathway = await prisma.learningPathway.create({ data: { title: 'Earned pathway', description: 'Two verified courses',
    badgeLabel: 'Verified pathway', createdById: owner.id,
    courses: { create: [fixture, companion].map((course, position) => ({ position, courseId: course.courseId, title: course.payload.title })) } } });
  await prisma.learningPathway.update({ where: { id: pathway.id }, data: { sealedAt: new Date() } });
  await prisma.learningPathwayParticipation.create({ data: { userId: fixture.learner, pathwayId: pathway.id } });
  await prisma.$transaction(tx => reconcileUserPathways(tx, fixture.learner));
  const before = await creditSnapshot(fixture.learner);
  expect(before.ledger).toHaveLength(2);
  for (const ledger of before.ledger) {
    expect(ledger).toMatchObject({ points: 50, stateVersion: 1, revokedAt: null });
    expect(ledger.changes).toMatchObject([{ version: 1, type: 'AWARDED', pointsDelta: 50 }]);
  }
  expect(before.badges).toEqual([expect.objectContaining({ badgeId: VERIFIED_COURSE_BADGE.id })]);
  expect(before.pathways).toMatchObject([{ pathwayId: pathway.id, badgeActive: true, stateVersion: 1,
    changes: [{ type: 'AWARDED', version: 1 }] }]);
  const savedEvidence = await evidence(fixture);
  const projected = await prisma.courseContent.findMany({ where: { courseId: fixture.courseId }, orderBy: { id: 'asc' } });
  const review = await publishSchedule(fixture);
  expect(review.impact).toMatchObject({ completionMayChange: false, rewardsMayChange: false });
  expect(await prisma.courseContent.findMany({ where: { courseId: fixture.courseId }, orderBy: { id: 'asc' } })).toEqual(projected);
  expect(await evidence(fixture)).toEqual(savedEvidence);
  expect(await creditSnapshot(fixture.learner)).toEqual(before);

  const lockedContents = await contents(fixture);
  expect(lockedContents.find(row => row.id === fixture.lesson)).toMatchObject({
    locked: true, releaseLocked: true, content: '', contentVersionToken: null,
  });
  // An earned prerequisite still counts, including across a scheduled chapter.
  expect(lockedContents.find(row => row.id === fixture.final)).toMatchObject({ locked: false, missingPrerequisites: [] });
  expect(await progress(fixture)).toMatchObject({ complete: true,
    completedContentIds: expect.arrayContaining([fixture.lesson, fixture.quiz, fixture.final]) });
  expect(await reconcile(fixture)).toMatchObject({ complete: true });
  expect(await creditSnapshot(fixture.learner)).toEqual(before);
  expect((await privatePathwayViews(prisma, fixture.learner, pathway.id))[0]).toMatchObject({ creditedCount: 2, participation: { badgeActive: true } });

  // Even valid, server-generated preconditions cannot start new learner work.
  expect((await mark(fixture, fixture.lesson)).status).toBe(423);
  expect((await passQuiz(fixture, `${fixture.courseId}-new-locked-attempt`)).status).toBe(423);
  expect((await mark(fixture, fixture.lesson, fixture.newcomer)).status).toBe(423);
  expect((await passQuiz(fixture, `${fixture.courseId}-newcomer-attempt`, fixture.newcomer)).status).toBe(423);
  expect((await mark(fixture, fixture.final, fixture.newcomer)).status).toBe(423);
  expect(await progress(fixture, fixture.newcomer)).toMatchObject({ complete: false, completedContentIds: [] });
  expect(await prisma.courseContentProgress.count({ where: { userId: fixture.newcomer, courseId: fixture.courseId } })).toBe(0);
  expect(await prisma.quizAttempt.count({ where: { userId: fixture.newcomer, courseId: fixture.courseId } })).toBe(0);

  // No scheduler runs: only the clock changes, then normal read/reconcile paths.
  clock.mockReturnValue(MIDNIGHT);
  expect((await contents(fixture)).find(row => row.id === fixture.lesson)).toMatchObject({ locked: false, releaseLocked: false });
  expect(await progress(fixture)).toMatchObject({ complete: true });
  expect(await reconcile(fixture)).toMatchObject({ complete: true });
  expect(await creditSnapshot(fixture.learner)).toEqual(before);
  expect(await evidence(fixture)).toEqual(savedEvidence);
  expect((await mark(fixture, fixture.lesson, fixture.newcomer)).status).toBe(200);
  expect((await passQuiz(fixture, `${fixture.courseId}-released-attempt`, fixture.newcomer)).status).toBe(200);
  expect((await mark(fixture, fixture.final, fixture.newcomer)).status).toBe(200);
  expect(await progress(fixture, fixture.newcomer)).toMatchObject({ complete: true });
});

test('a real content revision still revokes earned credit once and cannot silently reinstate at release', async () => {
  const fixture = await seed();
  expect(await earnLearnerWork(fixture)).toMatchObject({ complete: true });
  const before = await creditSnapshot(fixture.learner);
  const savedEvidence = await evidence(fixture);
  const originalRevision = savedEvidence.progress.find(row => row.contentId === fixture.lesson)!.revision;
  await publishSchedule(fixture, true);
  const revised = await prisma.courseContent.findUniqueOrThrow({ where: { id: fixture.lesson } });
  expect(courseContentRevision(revised)).not.toBe(originalRevision);
  // Non-scoring text edits keep quiz approval but still require fresh learning.
  expect(await prisma.course.findUniqueOrThrow({ where: { id: fixture.courseId } })).toMatchObject({ rewardEligible: true });
  const revoked = await creditSnapshot(fixture.learner);
  expect(revoked.enrollments).toEqual(before.enrollments);
  expect(revoked.completions).toEqual(before.completions);
  expect(revoked.ledger).toHaveLength(1);
  expect(revoked.ledger[0]).toMatchObject({ id: before.ledger[0].id, stateVersion: 2, points: 50, revokedAt: expect.any(Date) });
  expect(revoked.ledger[0].changes).toMatchObject([
    { version: 1, type: 'AWARDED', pointsDelta: 50 },
    { version: 2, type: 'REVOKED', reason: 'LEARNING_CHANGED', pointsDelta: -50 },
  ]);
  expect(revoked.badges).toEqual([]);
  for (const now of [MIDNIGHT - 1, MIDNIGHT, MIDNIGHT + 1]) {
    clock.mockReturnValue(now);
    expect(await progress(fixture)).toMatchObject({ complete: false, completedContentIds: [] });
    expect(await reconcile(fixture)).toMatchObject({ complete: false });
    expect(await creditSnapshot(fixture.learner)).toEqual(revoked);
    expect(await evidence(fixture)).toEqual(savedEvidence);
  }
});

test('staff can grade pre-reschedule work under a date lock, while new submissions stay blocked and grades remain revision-bound', async () => {
  const fixture = await seed(true);
  const assignmentId = fixture.assignment!;
  expect(await earnLearnerWork(fixture)).toMatchObject({ complete: false });
  const submission = await submitAssignment(fixture.courseId, assignmentId, fixture.learner, {
    requestId: `${fixture.courseId}-prior-submission`, response: 'My previously submitted solution.',
    ...await tokenBody(fixture, assignmentId),
  });
  const savedSubmission = await prisma.assignmentSubmission.findUniqueOrThrow({ where: { id: submission.id } });
  await publishSchedule(fixture);
  expect(await progress(fixture)).toMatchObject({ complete: false });
  expect(await prisma.rewardLedger.count({ where: { userId: fixture.learner } })).toBe(0);
  await expect(readOwnAssignment(fixture.courseId, assignmentId, fixture.learner)).rejects.toMatchObject({ status: 423 });
  await expect(submitAssignment(fixture.courseId, assignmentId, fixture.newcomer, {
    requestId: `${fixture.courseId}-blocked-submission`, response: 'A new response under lock.', ...await tokenBody(fixture, assignmentId),
  })).rejects.toMatchObject({ status: 423 });
  await expect(decideAssignmentGrade(fixture.courseId, submission.id, { id: fixture.newcomer, role: 'USER' }, {
    requestId: `${fixture.courseId}-unauthorized-grade`, action: 'GRADED', score: 90, expectedDecisionId: null,
  })).rejects.toMatchObject({ status: 403 });

  // An assignment mirror row alone is never authoritative passing evidence.
  const assignment = await prisma.courseContent.findUniqueOrThrow({ where: { id: assignmentId } });
  await prisma.courseContentProgress.create({ data: { userId: fixture.learner, courseId: fixture.courseId,
    contentId: assignmentId, revision: courseContentRevision(assignment) } });
  expect(await prisma.$transaction(tx => completionState(tx, fixture.learner, fixture.courseId))).toMatchObject({ complete: false });
  const grade = await decideAssignmentGrade(fixture.courseId, submission.id, owner, {
    requestId: `${fixture.courseId}-authorized-grade`, action: 'GRADED', score: 90, expectedDecisionId: null,
  });
  expect(grade.decision).toMatchObject({ passed: true });
  expect(await prisma.assignmentSubmission.findUniqueOrThrow({ where: { id: submission.id } })).toEqual(savedSubmission);
  expect(await progress(fixture)).toMatchObject({ complete: true, completedContentIds: expect.arrayContaining([assignmentId]) });
  const earned = await creditSnapshot(fixture.learner);
  expect(earned.ledger).toMatchObject([{ stateVersion: 1, revokedAt: null, changes: [{ type: 'AWARDED', version: 1 }] }]);
  expect(earned.badges).toEqual([expect.objectContaining({ badgeId: VERIFIED_COURSE_BADGE.id })]);
  await expect(readOwnAssignment(fixture.courseId, assignmentId, fixture.learner)).rejects.toMatchObject({ status: 423 });
  await expect(submitAssignment(fixture.courseId, assignmentId, fixture.learner, {
    requestId: `${fixture.courseId}-new-after-grade`, response: 'Another response under lock.', ...await tokenBody(fixture, assignmentId),
  })).rejects.toMatchObject({ status: 423 });
  expect(await reconcile(fixture)).toMatchObject({ complete: true });
  clock.mockReturnValue(MIDNIGHT);
  expect(await progress(fixture)).toMatchObject({ complete: true });
  expect(await reconcile(fixture)).toMatchObject({ complete: true });
  expect(await creditSnapshot(fixture.learner)).toEqual(earned);
  expect(await prisma.assignmentSubmission.count({ where: { courseId: fixture.courseId } })).toBe(1);

  const changed = await mutateDraft(fixture.courseId, owner, 1, { kind: 'updateNode', id: assignmentId,
    patch: { content: JSON.stringify({ prompt: 'Explain the revised solution.', passingScore: 70 }) } });
  const revised = await publishDraft(fixture.courseId, owner, changed.draft.revision, fixture.publicationId, `${fixture.courseId}-revised-assignment`);
  fixture.publicationId = revised.publication.id;
  await expect(decideAssignmentGrade(fixture.courseId, submission.id, owner, {
    requestId: `${fixture.courseId}-stale-revision-grade`, action: 'GRADED', score: 100, expectedDecisionId: grade.decision!.id,
  })).rejects.toMatchObject({ status: 412 });
  expect(await reconcile(fixture)).toMatchObject({ complete: false });
  const invalidated = await creditSnapshot(fixture.learner);
  expect(invalidated.ledger).toMatchObject([{ stateVersion: 2, revokedAt: expect.any(Date),
    changes: [{ type: 'AWARDED', version: 1 }, { type: 'REVOKED', version: 2, reason: 'LEARNING_CHANGED' }] }]);
  expect(invalidated.badges).toEqual([]);
  expect(await prisma.assignmentGradeDecision.count({ where: { submissionId: submission.id } })).toBe(1);
});

test('withdrawing a prior passing assignment grade under a date lock revokes credit without a release-time reinstatement', async () => {
  const fixture = await seed(true);
  const assignmentId = fixture.assignment!;
  expect(await earnLearnerWork(fixture)).toMatchObject({ complete: false });
  const submission = await submitAssignment(fixture.courseId, assignmentId, fixture.learner, {
    requestId: `${fixture.courseId}-withdrawal-submission`, response: 'Submitted before rescheduling.',
    ...await tokenBody(fixture, assignmentId),
  });
  const pass = await decideAssignmentGrade(fixture.courseId, submission.id, owner, {
    requestId: `${fixture.courseId}-initial-passing-grade`, action: 'GRADED', score: 90, expectedDecisionId: null,
  });
  const earned = await creditSnapshot(fixture.learner);
  expect(earned.ledger).toMatchObject([{ stateVersion: 1, revokedAt: null }]);
  await publishSchedule(fixture);
  expect(await creditSnapshot(fixture.learner)).toEqual(earned);
  expect((await contents(fixture)).find(row => row.id === assignmentId)).toMatchObject({ locked: true, releaseLocked: true });
  await decideAssignmentGrade(fixture.courseId, submission.id, owner, {
    requestId: `${fixture.courseId}-withdraw-passing-grade`, action: 'WITHDRAWN', expectedDecisionId: pass.decision!.id,
  });
  expect(await prisma.courseContentProgress.count({ where: { userId: fixture.learner, contentId: assignmentId } })).toBe(0);
  expect((await prisma.assignmentGradeDecision.findMany({ where: { submissionId: submission.id }, orderBy: { sequence: 'asc' } }))
    .map(decision => decision.action)).toEqual(['GRADED', 'WITHDRAWN']);
  const revoked = await creditSnapshot(fixture.learner);
  expect(revoked.enrollments).toEqual(earned.enrollments);
  expect(revoked.completions).toEqual(earned.completions);
  expect(revoked.ledger).toMatchObject([{ stateVersion: 2, revokedAt: expect.any(Date), changes: [
    { version: 1, type: 'AWARDED', pointsDelta: 50 },
    { version: 2, type: 'REVOKED', reason: 'LEARNING_CHANGED', pointsDelta: -50 },
  ] }]);
  expect(revoked.badges).toEqual([]);
  for (const now of [MIDNIGHT - 1, MIDNIGHT]) {
    clock.mockReturnValue(now);
    const state = await reconcile(fixture);
    expect(state.complete).toBe(false);
    expect(state.completedContentIds).not.toContain(assignmentId);
    expect(await progress(fixture)).toMatchObject({ complete: false });
    expect(await creditSnapshot(fixture.learner)).toEqual(revoked);
  }
});

test.each([
  ['approval withdrawal', 'APPROVAL_WITHDRAWN'],
  ['ineligible account role', 'ACCOUNT_INELIGIBLE'],
] as const)('%s under a date lock still revokes rewards while preserving earned completion', async (change, reason) => {
  const fixture = await seed();
  expect(await earnLearnerWork(fixture)).toMatchObject({ complete: true });
  await publishSchedule(fixture);
  const earned = await creditSnapshot(fixture.learner);
  const savedEvidence = await evidence(fixture);
  expect(earned.ledger).toMatchObject([{ stateVersion: 1, revokedAt: null }]);
  expect((await contents(fixture)).find(row => row.id === fixture.lesson)).toMatchObject({ locked: true, releaseLocked: true });
  await prisma.$transaction(async tx => {
    if (reason === 'APPROVAL_WITHDRAWN') {
      await tx.course.update({ where: { id: fixture.courseId }, data: { rewardEligible: false, rewardApprovalRevision: null } });
      await reconcileCourseRewards(tx, fixture.courseId);
    } else {
      await tx.user.update({ where: { id: fixture.learner }, data: { role: 'MODERATOR' } });
      await reconcileUserRewards(tx, fixture.learner);
    }
  });
  const revoked = await creditSnapshot(fixture.learner);
  expect(revoked.enrollments).toEqual(earned.enrollments);
  expect(revoked.completions).toEqual(earned.completions);
  expect(revoked.ledger).toMatchObject([{ stateVersion: 2, revokedAt: expect.any(Date), changes: [
    { version: 1, type: 'AWARDED', pointsDelta: 50 },
    { version: 2, type: 'REVOKED', reason, pointsDelta: -50 },
  ] }]);
  expect(revoked.badges).toEqual([]);
  for (const now of [MIDNIGHT - 1, MIDNIGHT]) {
    clock.mockReturnValue(now);
    expect(await progress(fixture)).toMatchObject({ complete: true,
      completedContentIds: expect.arrayContaining([fixture.lesson, fixture.quiz, fixture.final]) });
    expect(await reconcile(fixture)).toMatchObject({ complete: true });
    expect(await creditSnapshot(fixture.learner)).toEqual(revoked);
    expect(await evidence(fixture)).toEqual(savedEvidence);
  }
});
