/** @jest-environment node */
import { rmSync } from 'node:fs'
import prisma from '@/lib/prisma'
import { completionState, contentVersionToken } from '@/lib/server/course-progress'
import { decideAssignmentGrade, readAssignmentQueue, submitAssignment } from '@/lib/server/course-assignments'

jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const { DatabaseSync } = require('node:sqlite')
  const { PrismaClient } = jest.requireActual('@prisma/client')
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3')
  const directory = mkdtempSync(join(tmpdir(), 'forge-grade-cas-'))
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

const teacher = { id: 'cas-grade-teacher', role: 'INSTRUCTOR' }
const admin = { id: 'cas-grade-admin', role: 'ADMIN' }
const learnerId = 'cas-grade-learner'
const courseId = 'cas-grade-course'
const contentId = 'cas-grade-content'
const publicationId = 'cas-grade-publication'
const assignment = JSON.stringify({ prompt: 'Explain your reasoning.', passingScore: 70 })

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = 'test-only-grade-cas-version-secret'
  await prisma.user.createMany({ data: [
    { id: teacher.id, email: 'cas-grade-teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: admin.id, email: 'cas-grade-admin@example.invalid', role: 'ADMIN' },
    { id: learnerId, email: 'cas-grade-learner@example.invalid', role: 'USER' },
  ] })
  await prisma.course.create({ data: { id: courseId, title: 'CAS grading', description: '', instructorId: teacher.id } })
  await prisma.coursePublication.create({ data: { id: publicationId, courseId, sequence: 1, source: 'AUTHOR', digest: 'cas-grade-digest', contentCount: 1,
    payload: JSON.stringify({ schemaVersion: 1, title: 'CAS grading', description: '', startDate: null, endDate: null, imageUrl: null,
      contents: [{ id: contentId, parentId: null, title: 'Assignment', type: 'ASSIGNMENT', content: assignment, order: 1 }] }) } })
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: publicationId } })
  await prisma.courseContent.create({ data: { id: contentId, courseId, title: 'Assignment', type: 'ASSIGNMENT', content: assignment, order: 1 } })
  await prisma.enrollment.create({ data: { userId: learnerId, courseId } })
})

afterAll(async () => {
  await prisma.$disconnect()
  rmSync((jest.requireMock('@/lib/prisma') as { __directory: string }).__directory, { recursive: true, force: true })
})

test('two staff snapshots cannot overwrite a newer grade; corrections, withdrawal and receipt replays still work', async () => {
  const content = await prisma.courseContent.findUniqueOrThrow({ where: { id: contentId } })
  const submitted = await submitAssignment(courseId, contentId, learnerId, {
    requestId: 'cas-submit-first', response: 'My reasoning.', publicationId,
    contentVersionToken: contentVersionToken(publicationId, content),
  })
  const teacherSnapshot = (await readAssignmentQueue(courseId, teacher, null, 'all')).submissions[0]
  const adminSnapshot = (await readAssignmentQueue(courseId, admin, null, 'all')).submissions[0]
  expect(teacherSnapshot.id).toBe(submitted.id)
  expect(adminSnapshot.id).toBe(submitted.id)
  expect(teacherSnapshot.decisions).toEqual([])
  expect(adminSnapshot.decisions).toEqual([])

  await expect(decideAssignmentGrade(courseId, submitted.id, teacher, {
    requestId: 'cas-missing-expected', action: 'GRADED', score: 80,
  })).rejects.toMatchObject({ status: 428 })

  const firstBody = { requestId: 'cas-admin-first', action: 'GRADED', score: 85, feedback: 'Good work.', expectedDecisionId: adminSnapshot.decisions[0]?.id ?? null }
  const first = await decideAssignmentGrade(courseId, submitted.id, admin, firstBody)
  expect(first.unchanged).toBe(false)
  expect(first.decision?.passed).toBe(true)
  await expect(decideAssignmentGrade(courseId, submitted.id, teacher, {
    requestId: 'cas-teacher-stale', action: 'GRADED', score: 20, expectedDecisionId: teacherSnapshot.decisions[0]?.id ?? null,
  })).rejects.toMatchObject({ status: 409 })
  expect(await prisma.assignmentGradeDecision.count({ where: { submissionId: submitted.id } })).toBe(1)
  expect((await prisma.$transaction(tx => completionState(tx, learnerId, courseId))).complete).toBe(true)

  const refreshed = (await readAssignmentQueue(courseId, teacher, null, 'all')).submissions[0]
  expect(refreshed.decisions[0]?.id).toBe(first.decision?.id)
  expect(refreshed.decisions[0]).not.toHaveProperty('graderId')
  expect(JSON.stringify(refreshed)).not.toContain('graderId')
  const correctionBody = { requestId: 'cas-teacher-corrected', action: 'GRADED', score: 40, expectedDecisionId: refreshed.decisions[0]!.id }
  const corrected = await decideAssignmentGrade(courseId, submitted.id, teacher, correctionBody)
  expect(corrected.decision?.passed).toBe(false)
  expect((await prisma.$transaction(tx => completionState(tx, learnerId, courseId))).complete).toBe(false)

  await expect(decideAssignmentGrade(courseId, submitted.id, admin, {
    requestId: 'cas-admin-stale-withdraw', action: 'WITHDRAWN', expectedDecisionId: first.decision?.id,
  })).rejects.toMatchObject({ status: 409 })
  expect(await decideAssignmentGrade(courseId, submitted.id, admin, firstBody)).toEqual({ decision: first.decision, unchanged: true })
  expect(await decideAssignmentGrade(courseId, submitted.id, teacher, correctionBody)).toEqual({ decision: corrected.decision, unchanged: true })

  const withdrawn = await decideAssignmentGrade(courseId, submitted.id, admin, {
    requestId: 'cas-admin-fresh-withdraw', action: 'WITHDRAWN', expectedDecisionId: corrected.decision?.id,
  })
  expect(withdrawn.decision?.action).toBe('WITHDRAWN')
  expect((await prisma.assignmentGradeDecision.findMany({ where: { submissionId: submitted.id }, orderBy: { sequence: 'asc' } })).map(row => row.sequence)).toEqual([1, 2, 3])
  expect((await prisma.$transaction(tx => completionState(tx, learnerId, courseId))).complete).toBe(false)
})
