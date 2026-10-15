/** @jest-environment node */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import prisma from '@/lib/prisma'
import { assignmentSubmittedUserIds, completionState, contentVersionToken, courseContentRevision } from '@/lib/server/course-progress'
import { decideAssignmentGrade, readAssignmentQueue, readOwnAssignment, submitAssignment } from '@/lib/server/course-assignments'
import { courseAnalytics } from '@/lib/server/course-analytics'
import { countVerifiedGoalLeaves } from '@/lib/server/learning-goals'

jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const { DatabaseSync } = require('node:sqlite')
  const { PrismaClient } = jest.requireActual('@prisma/client')
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3')
  const directory = mkdtempSync(join(tmpdir(), 'forge-assignment-api-'))
  const path = join(directory, 'test.db')
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => item.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'))
    }
  } finally { db.close() }
  return { __esModule: true, __directory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) }
})

const teacher = { id: 'assignment-teacher', role: 'INSTRUCTOR' }
const outsider = { id: 'assignment-outsider', role: 'USER' }
const admin = { id: 'assignment-admin', role: 'ADMIN' }
const courseId = 'assignment-course'
const contentId = 'assignment-content'
const publicationId = 'assignment-publication'
const prompt = JSON.stringify({ prompt: 'Beschreibe den Lösungsweg.', passingScore: 70 })
function publicationPayload(content: string) {
  return JSON.stringify({ schemaVersion: 1, title: 'Aufgabenkurs', description: '', startDate: null,
    endDate: null, imageUrl: null, contents: [{ id: contentId, parentId: null, title: 'Aufgabe',
      type: 'ASSIGNMENT', content, order: 1 }] })
}

async function failure(action: () => Promise<unknown>, status: number) {
  await expect(action()).rejects.toMatchObject({ status })
}

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = 'test-only-assignment-version-secret'
  await prisma.user.createMany({ data: [
    { id: teacher.id, email: 'assignment-teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: 'assignment-learner', email: 'assignment-learner@example.invalid', role: 'USER' },
    { id: outsider.id, email: 'assignment-outsider@example.invalid', role: 'USER' },
    { id: admin.id, email: 'assignment-admin@example.invalid', role: 'ADMIN' },
  ] })
  await prisma.course.create({ data: { id: courseId, title: 'Aufgabenkurs', description: '', instructorId: teacher.id } })
  await prisma.coursePublication.create({ data: { id: publicationId, courseId, sequence: 1, source: 'AUTHOR', payload: publicationPayload(prompt), digest: 'initial', contentCount: 1 } })
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: publicationId } })
  await prisma.courseContent.create({ data: { id: contentId, courseId, title: 'Aufgabe', type: 'ASSIGNMENT', content: prompt, order: 1 } })
  await prisma.enrollment.create({ data: { userId: 'assignment-learner', courseId } })
})

afterAll(async () => {
  await prisma.$disconnect()
  const directory = (jest.requireMock('@/lib/prisma') as { __directory: string }).__directory
  rmSync(directory, { recursive: true, force: true })
})

test('learner submission, correction and withdrawal are private, idempotent, and current-only', async () => {
  const content = await prisma.courseContent.findUniqueOrThrow({ where: { id: contentId } })
  const token = contentVersionToken(publicationId, content)
  await failure(() => submitAssignment(courseId, contentId, outsider.id, { requestId: 'request-outside', response: 'Antwort', publicationId, contentVersionToken: token }), 403)
  await failure(() => submitAssignment(courseId, contentId, 'assignment-learner', { requestId: 'request-stale', response: 'Antwort', publicationId, contentVersionToken: 'wrong' }), 412)
  const body = { requestId: 'request-first', response: 'Eine eigene Textantwort.', publicationId, contentVersionToken: token }
  const first = await submitAssignment(courseId, contentId, 'assignment-learner', body)
  expect(first.unchanged).toBe(false)
  expect((await submitAssignment(courseId, contentId, 'assignment-learner', body)).id).toBe(first.id)
  await failure(() => submitAssignment(courseId, contentId, 'assignment-learner', { ...body, response: 'Anders' }), 409)
  await failure(() => submitAssignment(courseId, contentId, 'assignment-learner', { ...body, requestId: 'request-second' }), 409)
  const own = await readOwnAssignment(courseId, contentId, 'assignment-learner')
  expect(own.submissions[0].response).toBe(body.response)
  expect(own.maySubmit).toBe(false)
  await failure(() => readOwnAssignment(courseId, contentId, outsider.id), 403)
  await failure(() => readAssignmentQueue(courseId, outsider), 403)
  expect((await readAssignmentQueue(courseId, teacher)).submissions.map(row => row.id)).toEqual([first.id])
  await failure(() => decideAssignmentGrade(courseId, first.id, outsider, { requestId: 'grade-outsider', action: 'GRADED', score: 100, expectedDecisionId: null }), 403)
  const graded = await decideAssignmentGrade(courseId, first.id, teacher, { requestId: 'grade-first', action: 'GRADED', score: 85, feedback: 'Gut erklärt.', expectedDecisionId: null })
  expect(graded.decision?.passed).toBe(true)
  expect((await decideAssignmentGrade(courseId, first.id, teacher, { requestId: 'grade-first', action: 'GRADED', score: 85, feedback: 'Gut erklärt.', expectedDecisionId: null })).unchanged).toBe(true)
  await failure(() => decideAssignmentGrade(courseId, first.id, teacher, { requestId: 'grade-first', action: 'GRADED', score: 10, feedback: 'Gut erklärt.', expectedDecisionId: null }), 409)
  expect((await prisma.$transaction(tx => completionState(tx, 'assignment-learner', courseId))).complete).toBe(true)
  expect((await prisma.courseContentProgress.count({ where: { contentId, userId: 'assignment-learner' } }))).toBe(1)
  const completedAt = (await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: 'assignment-learner', courseId } } })).completedAt
  expect(completedAt).not.toBeNull()
  const corrected = await decideAssignmentGrade(courseId, first.id, teacher, { requestId: 'grade-correction', action: 'GRADED', score: 40, expectedDecisionId: graded.decision?.id })
  expect((await prisma.$transaction(tx => completionState(tx, 'assignment-learner', courseId))).complete).toBe(false)
  expect(await prisma.courseContentProgress.count({ where: { contentId, userId: 'assignment-learner' } })).toBe(0)
  expect((await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: 'assignment-learner', courseId } } })).completedAt).toEqual(completedAt)
  await decideAssignmentGrade(courseId, first.id, teacher, { requestId: 'grade-withdraw', action: 'WITHDRAWN', expectedDecisionId: corrected.decision?.id })
  expect((await prisma.assignmentGradeDecision.findMany({ where: { submissionId: first.id }, orderBy: { sequence: 'asc' } })).map(row => row.action)).toEqual(['GRADED', 'GRADED', 'WITHDRAWN'])
  expect((await readAssignmentQueue(courseId, teacher)).submissions[0].id).toBe(first.id)
  const second = await submitAssignment(courseId, contentId, 'assignment-learner', { ...body, requestId: 'request-second', response: 'Überarbeiteter Lösungsweg.' })
  await failure(() => decideAssignmentGrade(courseId, first.id, teacher, { requestId: 'grade-old', action: 'GRADED', score: 100, expectedDecisionId: null }), 409)
  await decideAssignmentGrade(courseId, second.id, teacher, { requestId: 'grade-second', action: 'GRADED', score: 75, expectedDecisionId: null })
  expect((await prisma.$transaction(tx => completionState(tx, 'assignment-learner', courseId))).complete).toBe(true)
  expect((await readAssignmentQueue(courseId, teacher)).submissions).toHaveLength(0)
  expect((await readAssignmentQueue(courseId, teacher, null, 'all')).submissions).toHaveLength(2)
  const self = await prisma.assignmentSubmission.create({ data: { id: 'assignment-self-submission', userId: teacher.id, courseId, contentId,
    publicationId, revision: courseContentRevision({ type: 'ASSIGNMENT', content: prompt }), passingScore: 70, requestId: 'self-request', response: 'Eigene Antwort',
    responseDigest: 'self-digest', attemptNumber: 1 } })
  await failure(() => decideAssignmentGrade(courseId, self.id, teacher, { requestId: 'self-grade', action: 'GRADED', score: 100, expectedDecisionId: null }), 403)
})

test('grading API mirrors the first pass until withdrawal and preserves historical course completion', async () => {
  const learnerId = 'assignment-interval-learner'
  const initialPassAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  const goalStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  const goalEnd = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await prisma.user.create({ data: { id: learnerId, email: 'assignment-interval@example.invalid', role: 'USER' } })
  const enrollment = await prisma.enrollment.create({ data: { userId: learnerId, courseId } })
  await prisma.learningGoal.create({ data: { userId: learnerId, targetLeaves: 1, durationDays: 7,
    timezone: 'UTC', startedAt: goalStart, endsAt: goalEnd } })
  const content = await prisma.courseContent.findUniqueOrThrow({ where: { id: contentId } })
  const submitted = await submitAssignment(courseId, contentId, learnerId, { requestId: 'interval-submission',
    response: 'A timed solution.', publicationId, contentVersionToken: contentVersionToken(publicationId, content) })
  const first = await prisma.assignmentGradeDecision.create({ data: { id: 'assignment-interval-first-pass',
    submissionId: submitted.id, requestId: 'interval-first-grade', graderId: teacher.id,
    action: 'GRADED', score: 80, sequence: 1, createdAt: initialPassAt } })
  const goal = await prisma.learningGoal.findUniqueOrThrow({ where: { userId: learnerId } })
  const analyticsStatus = async () => {
    const result = await courseAnalytics(courseId, teacher, { page: 1, pageSize: 25, status: 'all', search: '' })
    return result.learners.find(row => row.enrollmentId === enrollment.id)?.currentStatus
  }
  const correction = await decideAssignmentGrade(courseId, submitted.id, teacher, { requestId: 'interval-pass-correction',
    action: 'GRADED', score: 90, feedback: 'Revised feedback.', expectedDecisionId: first.id })
  const laterCorrection = await decideAssignmentGrade(courseId, submitted.id, teacher, { requestId: 'interval-later-pass-correction',
    action: 'GRADED', score: 95, feedback: 'Further feedback.', expectedDecisionId: correction.decision?.id })
  expect((await prisma.courseContentProgress.findUniqueOrThrow({ where: { userId_contentId: { userId: learnerId, contentId } } })).completedAt)
    .toEqual(initialPassAt)
  expect(await countVerifiedGoalLeaves(prisma, goal, new Date())).toBe(0)
  expect(await analyticsStatus()).toBe('current-complete')
  const historicalCompletion = (await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: learnerId, courseId } } })).completedAt
  expect(historicalCompletion).not.toBeNull()

  const withdrawal = await decideAssignmentGrade(courseId, submitted.id, teacher, { requestId: 'interval-withdrawal',
    action: 'WITHDRAWN', expectedDecisionId: laterCorrection.decision?.id })
  expect(await prisma.courseContentProgress.count({ where: { userId: learnerId, contentId } })).toBe(0)
  expect(await countVerifiedGoalLeaves(prisma, goal, new Date())).toBe(0)
  expect(await analyticsStatus()).toBe('in-progress')
  const repass = await decideAssignmentGrade(courseId, submitted.id, teacher, { requestId: 'interval-repass',
    action: 'GRADED', score: 75, expectedDecisionId: withdrawal.decision?.id })
  expect((await prisma.courseContentProgress.findUniqueOrThrow({ where: { userId_contentId: { userId: learnerId, contentId } } })).completedAt)
    .toEqual(repass.decision?.createdAt)
  expect(await countVerifiedGoalLeaves(prisma, goal, new Date())).toBe(1)
  expect(await analyticsStatus()).toBe('current-complete')
  expect((await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: learnerId, courseId } } })).completedAt)
    .toEqual(historicalCompletion)
  expect((await prisma.courseCompletionRecord.findUniqueOrThrow({ where: { userId_courseId: { userId: learnerId, courseId } } })).completedAt)
    .toEqual(historicalCompletion)
})

test('pending review remains reachable beyond fifty recent graded submissions', async () => {
  const revision = courseContentRevision({ type: 'ASSIGNMENT', content: prompt })
  const users = Array.from({ length: 52 }, (_, index) => ({ id: `assignment-queue-user-${index}`, email: `assignment-queue-${index}@example.invalid`, role: 'USER' as const }))
  await prisma.user.createMany({ data: users })
  const rows = users.map((user, index) => ({ id: `assignment-queue-submission-${index}`, userId: user.id, courseId, contentId, publicationId,
    revision, passingScore: 70, requestId: `queue-request-${index}`, response: 'Antwort', responseDigest: `queue-digest-${index}`,
    attemptNumber: 1, submittedAt: new Date(Date.now() + 60_000 + index * 1000) }))
  await prisma.assignmentSubmission.createMany({ data: rows })
  await prisma.assignmentGradeDecision.createMany({ data: rows.map((row, index) => ({ id: `assignment-queue-decision-${index}`,
    submissionId: row.id, requestId: `queue-grade-${index}`, graderId: teacher.id, action: 'GRADED' as const, score: 90, sequence: 1 })) })
  const pending = await readAssignmentQueue(courseId, teacher)
  expect(pending.submissions.map(row => row.id)).toContain('assignment-self-submission')
  expect(pending.submissions).toHaveLength(1)
  expect(pending.nextCursor).toBeNull()
  expect((await readAssignmentQueue(courseId, teacher, null, 'all')).submissions).toHaveLength(50)
  const submittedUsers = await prisma.$transaction(tx => assignmentSubmittedUserIds(tx, courseId,
    [{ id: contentId, courseId, parentId: null, type: 'ASSIGNMENT', content: prompt }],
    ['assignment-learner', teacher.id, outsider.id]))
  expect(new Set(submittedUsers)).toEqual(new Set(['assignment-learner', teacher.id]))
})

test('grade decisions reject direct edits and deletions while submission and account cascades remain valid', async () => {
  const revision = courseContentRevision({ type: 'ASSIGNMENT', content: prompt })
  const fixtures = [
    { userId: 'assignment-audit-submission-user', submissionId: 'assignment-audit-submission', decisionId: 'assignment-audit-submission-decision' },
    { userId: 'assignment-audit-account-user', submissionId: 'assignment-audit-account', decisionId: 'assignment-audit-account-decision' },
  ]
  for (const [index, fixture] of fixtures.entries()) {
    await prisma.user.create({ data: { id: fixture.userId, email: `${fixture.userId}@example.invalid`, role: 'USER' } })
    await prisma.assignmentSubmission.create({ data: { id: fixture.submissionId, userId: fixture.userId, courseId, contentId,
      publicationId, revision, passingScore: 70, requestId: `audit-submit-${index}`, response: 'Antwort',
      responseDigest: `audit-digest-${index}`, attemptNumber: 1 } })
    await prisma.assignmentGradeDecision.create({ data: { id: fixture.decisionId, submissionId: fixture.submissionId,
      requestId: `audit-grade-${index}`, graderId: teacher.id, action: 'GRADED', score: 85, sequence: 1 } })
  }
  const directory = (jest.requireMock('@/lib/prisma') as { __directory: string }).__directory
  const db = new DatabaseSync(join(directory, 'test.db'))
  try {
    db.exec('PRAGMA foreign_keys = ON')
    const [bySubmission, byAccount] = fixtures
    expect(() => db.prepare('UPDATE "AssignmentGradeDecision" SET "feedback" = ? WHERE "id" = ?')
      .run('Changed outside the grading API', bySubmission.decisionId)).toThrow(/append-only/)
    expect(() => db.prepare('UPDATE "AssignmentGradeDecision" SET "feedback" = "feedback" WHERE "id" = ?')
      .run(bySubmission.decisionId)).toThrow(/append-only/)
    expect(() => db.prepare('UPDATE "AssignmentGradeDecision" SET "submissionId" = ? WHERE "id" = ?')
      .run(byAccount.submissionId, bySubmission.decisionId)).toThrow(/append-only/)
    expect(() => db.prepare('DELETE FROM "AssignmentGradeDecision" WHERE "id" = ?')
      .run(bySubmission.decisionId)).toThrow(/append-only/)
    const replace = db.prepare(`INSERT OR REPLACE INTO "AssignmentGradeDecision"
      ("id", "submissionId", "requestId", "graderId", "action", "score", "sequence")
      VALUES (?, ?, ?, ?, 'GRADED', 10, ?)`)
    for (const [id, requestId, sequence] of [
      [bySubmission.decisionId, 'audit-grade-new-id-conflict', 2],
      ['audit-decision-request-conflict', 'audit-grade-0', 2],
      ['audit-decision-sequence-conflict', 'audit-grade-new-sequence-conflict', 1],
    ] as const) {
      expect(() => replace.run(id, bySubmission.submissionId, requestId, teacher.id, sequence)).toThrow(/append-only/)
    }
    expect(() => db.prepare(`INSERT INTO "AssignmentGradeDecision"
      ("id", "submissionId", "requestId", "graderId", "action", "score", "sequence")
      VALUES (?, ?, ?, ?, 'GRADED', 10, 1)
      ON CONFLICT("id") DO UPDATE SET "score" = excluded."score"`)
      .run(bySubmission.decisionId, bySubmission.submissionId, 'audit-upsert', teacher.id)).toThrow(/append-only/)
    expect(db.prepare('SELECT "score" FROM "AssignmentGradeDecision" WHERE "id" = ?').get(bySubmission.decisionId))
      .toMatchObject({ score: 85 })
    const renamedId = `${bySubmission.submissionId}-renamed`
    db.prepare('UPDATE "AssignmentSubmission" SET "id" = ? WHERE "id" = ?').run(renamedId, bySubmission.submissionId)
    expect(db.prepare('SELECT "submissionId" FROM "AssignmentGradeDecision" WHERE "id" = ?').get(bySubmission.decisionId))
      .toMatchObject({ submissionId: renamedId })
    db.prepare('DELETE FROM "AssignmentSubmission" WHERE "id" = ?').run(renamedId)
    expect(db.prepare('SELECT COUNT(*) AS "count" FROM "AssignmentGradeDecision" WHERE "id" = ?').get(bySubmission.decisionId))
      .toMatchObject({ count: 0 })
    db.prepare('DELETE FROM "User" WHERE "id" = ?').run(byAccount.userId)
    expect(db.prepare('SELECT COUNT(*) AS "count" FROM "AssignmentSubmission" WHERE "id" = ?').get(byAccount.submissionId))
      .toMatchObject({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS "count" FROM "AssignmentGradeDecision" WHERE "id" = ?').get(byAccount.decisionId))
      .toMatchObject({ count: 0 })
  } finally {
    db.close()
  }
})

test('changed published assignment invalidates grade but preserves historical decisions and completion timestamp', async () => {
  const historicalCompletedAt = (await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: 'assignment-learner', courseId } } })).completedAt
  const changedPrompt = JSON.stringify({ prompt: 'Eine andere Aufgabe.', passingScore: 80 })
  await prisma.coursePublication.create({ data: { id: 'assignment-publication-2', courseId, sequence: 2, source: 'AUTHOR', payload: publicationPayload(changedPrompt), digest: 'changed', contentCount: 1 } })
  await prisma.courseContent.update({ where: { id: contentId }, data: { content: changedPrompt } })
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: 'assignment-publication-2' } })
  expect((await prisma.$transaction(tx => completionState(tx, 'assignment-learner', courseId))).complete).toBe(false)
  expect((await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: 'assignment-learner', courseId } } })).completedAt).toEqual(historicalCompletedAt)
  expect(await prisma.assignmentSubmission.count({ where: { userId: 'assignment-learner', courseId } })).toBe(2)
  const newest = await prisma.assignmentSubmission.findFirstOrThrow({ where: { userId: 'assignment-learner', courseId }, orderBy: { attemptNumber: 'desc' } })
  await failure(() => decideAssignmentGrade(courseId, newest.id, teacher, { requestId: 'grade-stale', action: 'GRADED', score: 100, expectedDecisionId: null }), 412)
  const current = await prisma.courseContent.findUniqueOrThrow({ where: { id: contentId } })
  const token = contentVersionToken('assignment-publication-2', current)
  const submitted = await submitAssignment(courseId, contentId, 'assignment-learner', { requestId: 'request-new-version', response: 'Neue Version.', publicationId: 'assignment-publication-2', contentVersionToken: token })
  expect(submitted.attemptNumber).toBe(3)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'USER' } })
  await failure(() => decideAssignmentGrade(courseId, submitted.id, admin, { requestId: 'grade-demoted', action: 'GRADED', score: 100, expectedDecisionId: null }), 403)
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: null } })
  await prisma.courseContent.update({ where: { id: contentId }, data: { type: 'TEXT' } })
  expect((await submitAssignment(courseId, contentId, 'assignment-learner', { requestId: 'request-new-version', response: 'Neue Version.', publicationId: 'assignment-publication-2', contentVersionToken: token })).id).toBe(submitted.id)
  await prisma.enrollment.delete({ where: { userId_courseId: { userId: 'assignment-learner', courseId } } })
  await failure(() => submitAssignment(courseId, contentId, 'assignment-learner', { requestId: 'request-new-version', response: 'Neue Version.', publicationId: 'assignment-publication-2', contentVersionToken: token }), 403)
})
