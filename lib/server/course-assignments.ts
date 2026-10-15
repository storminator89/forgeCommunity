import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { courseSqlTable } from '@/lib/server/course-sql-tables'
import prisma from '@/lib/prisma'
import { MAX_ASSIGNMENT_FEEDBACK, MAX_ASSIGNMENT_RESPONSE, parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content'
import { contentVersionToken, courseContentRevision, matchesContentVersionToken, recordCourseCompletion } from '@/lib/server/course-progress'
import { assertCurrentPrerequisites } from '@/lib/server/course-prerequisites'

export class AssignmentError extends Error {
  constructor(message: string, public readonly status = 400) { super(message) }
}

type Actor = { id: string; role?: string | null }
type Tx = Prisma.TransactionClient
const idPattern = /^[A-Za-z0-9_-]{8,100}$/

async function assignmentTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 }) }
    catch (error) {
      if (attempt === 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error
    }
  }
  throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409)
}

async function learnerContext(tx: Tx, courseId: string, contentId: string, userId: string) {
  const [actor, course, enrollment, content] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
    tx.course.findUnique({ where: { id: courseId }, select: { activePublicationId: true } }),
    tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } }),
    tx.courseContent.findUnique({ where: { id: contentId }, select: { id: true, courseId: true, type: true, content: true, archivedAt: true,
      children: { where: { archivedAt: null }, select: { id: true }, take: 1 } } }),
  ])
  if (!actor) throw new AssignmentError('Unauthorized', 401)
  if (!course?.activePublicationId) throw new AssignmentError('Course not found', 404)
  if (!enrollment) throw new AssignmentError('Enrollment required', 403)
  if (!content || content.courseId !== courseId || content.archivedAt || content.type !== 'ASSIGNMENT' || content.children.length) {
    throw new AssignmentError('Assignment not found', 404)
  }
  const assignment = parseAssignmentContent(content.content)
  if (!assignment?.prompt.trim()) throw new AssignmentError('Assignment is not ready', 409)
  return { publicationId: course.activePublicationId, content, assignment, revision: courseContentRevision(content) }
}

async function staffContext(tx: Tx, courseId: string, actor: Actor) {
  const [account, course] = await Promise.all([
    tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }),
    tx.course.findUnique({ where: { id: courseId }, select: { instructorId: true, activePublicationId: true } }),
  ])
  if (!account) throw new AssignmentError('Unauthorized', 401)
  if (!course) throw new AssignmentError('Course not found', 404)
  if (course.instructorId !== actor.id && !(actor.role === 'ADMIN' && account.role === 'ADMIN')) {
    throw new AssignmentError('Unauthorized', 403)
  }
  return course
}

async function latestCurrentSubmission(tx: Tx, userId: string, courseId: string, contentId: string, revision: string) {
  return tx.assignmentSubmission.findFirst({ where: { userId, courseId, contentId, revision }, orderBy: [{ attemptNumber: 'desc' }] })
}

async function latestDecision(tx: Tx, submissionId: string) {
  return tx.assignmentGradeDecision.findFirst({ where: { submissionId }, orderBy: [{ sequence: 'desc' }] })
}

function decisionDto(decision: Awaited<ReturnType<typeof latestDecision>>, threshold: number) {
  if (!decision) return null
  return { id: decision.id, action: decision.action, score: decision.score, feedback: decision.feedback,
    passed: decision.action === 'GRADED' && decision.score !== null && decision.score >= threshold,
    createdAt: decision.createdAt, sequence: decision.sequence }
}

/** The progress row mirrors the current passing interval; completionState independently verifies it. */
async function syncAssignmentProgress(tx: Tx, userId: string, courseId: string, contentId: string,
  content: { type: string | null; content: string }, threshold: number) {
  const revision = courseContentRevision(content)
  const submission = await latestCurrentSubmission(tx, userId, courseId, contentId, revision)
  const decision = submission ? await latestDecision(tx, submission.id) : null
  const passed = decision?.action === 'GRADED' && decision.score !== null && decision.score >= threshold
  if (passed) {
    // Feedback/score corrections that remain passing must not move a learner's
    // original completion into a different learning-goal window. A failed or
    // withdrawn decision ends that interval, so a later pass starts a new one.
    const invalidation = await tx.assignmentGradeDecision.findFirst({
      where: { submissionId: submission!.id, OR: [{ action: 'WITHDRAWN' }, { score: { lt: threshold } }] },
      orderBy: { sequence: 'desc' }, select: { sequence: true },
    })
    const firstPass = await tx.assignmentGradeDecision.findFirst({
      where: { submissionId: submission!.id, sequence: { gt: invalidation?.sequence ?? 0 },
        action: 'GRADED', score: { gte: threshold } },
      orderBy: { sequence: 'asc' }, select: { createdAt: true },
    })
    if (!firstPass) throw new AssignmentError('Passing grade history is unavailable.', 409)
    await tx.courseContentProgress.upsert({ where: { userId_contentId: { userId, contentId } },
      create: { userId, courseId, contentId, revision, completedAt: firstPass.createdAt },
      update: { revision, completedAt: firstPass.createdAt } })
  } else {
    await tx.courseContentProgress.deleteMany({ where: { userId, courseId, contentId } })
  }
  await recordCourseCompletion(tx, userId, courseId)
}

export async function readOwnAssignment(courseId: string, contentId: string, userId: string) {
  return assignmentTransaction(async tx => {
    const context = await learnerContext(tx, courseId, contentId, userId)
    await assertCurrentPrerequisites(tx, userId, courseId, contentId, context.publicationId)
    const rows = await tx.assignmentSubmission.findMany({ where: { userId, courseId, contentId },
      orderBy: [{ attemptNumber: 'desc' }], take: 25,
      include: { decisions: { orderBy: [{ sequence: 'desc' }], take: 10 } } })
    const current = await tx.assignmentSubmission.findFirst({ where: { userId, courseId, contentId, revision: context.revision },
      orderBy: [{ attemptNumber: 'desc' }], include: { decisions: { orderBy: [{ sequence: 'desc' }], take: 10 } } })
    const currentDecision = current?.decisions[0] ?? null
    return { publicationId: context.publicationId, contentVersionToken: contentVersionToken(context.publicationId, context.content),
      revision: context.revision, passingScore: context.assignment.passingScore,
      maySubmit: !current || Boolean(currentDecision && (currentDecision.action === 'WITHDRAWN' || (currentDecision.score !== null && currentDecision.score < context.assignment.passingScore))),
      submissions: (current && !rows.some(row => row.id === current.id) ? [current, ...rows].slice(0, 25) : rows).map(row => ({ id: row.id, response: row.response, attemptNumber: row.attemptNumber,
        submittedAt: row.submittedAt, currentRevision: row.revision === context.revision,
        decisions: row.decisions.map(decision => decisionDto(decision, row.passingScore)) })) }
  })
}

export async function submitAssignment(courseId: string, contentId: string, userId: string, body: Record<string, unknown>) {
  const { requestId, response, publicationId, contentVersionToken: token } = body
  if (typeof requestId !== 'string' || !idPattern.test(requestId) || typeof response !== 'string' || !response.trim() ||
      response.length > MAX_ASSIGNMENT_RESPONSE || typeof publicationId !== 'string' || typeof token !== 'string') {
    throw new AssignmentError('Ungültige Abgabe.', 400)
  }
  const digest = createHash('sha256').update(JSON.stringify([publicationId, response])).digest('hex')
  return assignmentTransaction(async tx => {
    // A committed retry remains a receipt even if a later publication removes
    // the assignment. Recheck account and enrollment before any history lookup.
    const [account, enrollment] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
      tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } }),
    ])
    if (!account) throw new AssignmentError('Unauthorized', 401)
    if (!enrollment) throw new AssignmentError('Enrollment required', 403)
    const receipt = await tx.assignmentSubmission.findUnique({ where: { userId_contentId_requestId: { userId, contentId, requestId } } })
    if (receipt) {
      if (receipt.courseId !== courseId || receipt.responseDigest !== digest || receipt.publicationId !== publicationId) throw new AssignmentError('Anforderungs-ID wurde anders verwendet.', 409)
      return { id: receipt.id, attemptNumber: receipt.attemptNumber, submittedAt: receipt.submittedAt, unchanged: true }
    }
    const context = await learnerContext(tx, courseId, contentId, userId)
    if (context.publicationId !== publicationId || !matchesContentVersionToken(token, context.publicationId, context.content)) {
      throw new AssignmentError('Die veröffentlichte Aufgabe wurde geändert. Bitte neu laden.', 412)
    }
    // A committed receipt above remains stable; only new submissions require
    // the current learning-path gate.
    await assertCurrentPrerequisites(tx, userId, courseId, contentId, context.publicationId)
    const current = await latestCurrentSubmission(tx, userId, courseId, contentId, context.revision)
    const currentGrade = current ? await latestDecision(tx, current.id) : null
    if (current && !currentGrade) throw new AssignmentError('Diese Abgabe wartet noch auf eine Bewertung.', 409)
    if (currentGrade?.action === 'GRADED' && currentGrade.score !== null && currentGrade.score >= context.assignment.passingScore) {
      throw new AssignmentError('Diese Aufgabe ist bereits bestanden.', 409)
    }
    const newest = await tx.assignmentSubmission.findFirst({ where: { userId, contentId }, orderBy: [{ attemptNumber: 'desc' }], select: { attemptNumber: true } })
    const created = await tx.assignmentSubmission.create({ data: { id: randomUUID(), userId, courseId, contentId,
      publicationId, revision: context.revision, passingScore: context.assignment.passingScore, requestId, response, responseDigest: digest,
      attemptNumber: (newest?.attemptNumber ?? 0) + 1 } })
    await syncAssignmentProgress(tx, userId, courseId, contentId, context.content, context.assignment.passingScore)
    return { id: created.id, attemptNumber: created.attemptNumber, submittedAt: created.submittedAt, unchanged: false }
  })
}

export async function readAssignmentQueue(courseId: string, actor: Actor, cursor?: string | null, filter: 'pending' | 'all' = 'pending') {
  if (cursor !== undefined && cursor !== null && !idPattern.test(cursor)) throw new AssignmentError('Ungültiger Seitenzeiger.', 400)
  return assignmentTransaction(async tx => {
    const course = await staffContext(tx, courseId, actor)
    if (!course.activePublicationId) return { submissions: [], nextCursor: null }
    const contents = await tx.courseContent.findMany({ where: { courseId, archivedAt: null, type: 'ASSIGNMENT' },
      select: { id: true, title: true, type: true, content: true, children: { where: { archivedAt: null }, select: { id: true }, take: 1 } } })
    const available = contents.filter(item => item.children.length === 0 && parseAssignmentContent(item.content)?.prompt.trim())
    if (!available.length) return { submissions: [], nextCursor: null }
    const conditions = available.map(item => ({ contentId: item.id, revision: courseContentRevision(item) }))
    const anchor = cursor ? await tx.assignmentSubmission.findUnique({ where: { id: cursor }, select: { courseId: true, submittedAt: true, id: true } }) : null
    if (cursor && anchor?.courseId !== courseId) throw new AssignmentError('Ungültiger Seitenzeiger.', 400)
    let ids: string[] | null = null
    if (filter === 'pending') {
      const currentRevisions = conditions.map(item => Prisma.sql`(s."contentId" = ${item.contentId} AND s."revision" = ${item.revision})`)
      const before = anchor ? Prisma.sql`AND (latest."submittedAt" < ${anchor.submittedAt} OR (latest."submittedAt" = ${anchor.submittedAt} AND latest."id" < ${anchor.id}))` : Prisma.empty
      const submissions = courseSqlTable('AssignmentSubmission')
      const decisions = courseSqlTable('AssignmentGradeDecision')
      const page = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH latest AS (
          SELECT s."id", s."submittedAt", ROW_NUMBER() OVER (PARTITION BY s."userId", s."contentId" ORDER BY s."attemptNumber" DESC) AS attempt_rank
          FROM ${submissions} s WHERE s."courseId" = ${courseId} AND (${Prisma.join(currentRevisions, ' OR ')})
        )
        SELECT latest."id" FROM latest WHERE latest.attempt_rank = 1 ${before}
          AND (SELECT g."action" FROM ${decisions} g WHERE g."submissionId" = latest."id" ORDER BY g."sequence" DESC LIMIT 1) IS DISTINCT FROM 'GRADED'
        ORDER BY latest."submittedAt" DESC, latest."id" DESC LIMIT 51
      `)
      ids = page.map(item => item.id)
    }
    const rows = await tx.assignmentSubmission.findMany({ where: filter === 'pending' ? { id: { in: ids ?? [] } } : { courseId, OR: conditions },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], cursor: filter === 'all' && cursor ? { id: cursor } : undefined,
      skip: filter === 'all' && cursor ? 1 : 0, take: filter === 'all' ? 51 : undefined,
      include: { user: { select: { id: true, name: true } }, decisions: { orderBy: [{ sequence: 'desc' }], take: 20 } } })
    const page = rows.slice(0, 50)
    const submissions = await Promise.all(page.map(async row => {
      const content = available.find(item => item.id === row.contentId)!
      const latest = await latestCurrentSubmission(tx, row.userId, courseId, row.contentId, row.revision)
      const threshold = row.passingScore
      return { id: row.id, contentId: row.contentId, title: content.title, learner: row.user,
        response: row.response, submittedAt: row.submittedAt, attemptNumber: row.attemptNumber,
        isLatest: latest?.id === row.id, passingScore: threshold,
        decisions: row.decisions.map(decision => decisionDto(decision, threshold)) }
    }))
    return { submissions, nextCursor: (filter === 'pending' ? (ids?.length ?? 0) > 50 : rows.length > 50) ? page.at(-1)!.id : null }
  })
}

export async function decideAssignmentGrade(courseId: string, submissionId: string, actor: Actor, body: Record<string, unknown>) {
  const { requestId, action, score, feedback, expectedDecisionId } = body
  if (!Object.hasOwn(body, 'expectedDecisionId')) throw new AssignmentError('Erwartete Bewertung fehlt.', 428)
  if (typeof requestId !== 'string' || !idPattern.test(requestId) ||
      (expectedDecisionId !== null && (typeof expectedDecisionId !== 'string' || !idPattern.test(expectedDecisionId))) ||
      (action !== 'GRADED' && action !== 'WITHDRAWN') ||
      (action === 'GRADED' && (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 100)) ||
      (action === 'WITHDRAWN' && score !== undefined && score !== null) ||
      (feedback !== undefined && (typeof feedback !== 'string' || feedback.length > MAX_ASSIGNMENT_FEEDBACK))) {
    throw new AssignmentError('Ungültige Bewertung.', 400)
  }
  const normalizedScore = action === 'GRADED' ? score as number : null
  const normalizedFeedback = typeof feedback === 'string' && feedback.trim() ? feedback : null
  return assignmentTransaction(async tx => {
    const course = await staffContext(tx, courseId, actor)
    const submission = await tx.assignmentSubmission.findUnique({ where: { id: submissionId } })
    if (!submission || submission.courseId !== courseId) throw new AssignmentError('Abgabe nicht gefunden.', 404)
    if (submission.userId === actor.id) throw new AssignmentError('Eigene Abgaben können nicht bewertet werden.', 403)
    const receipt = await tx.assignmentGradeDecision.findUnique({ where: { submissionId_requestId: { submissionId, requestId } } })
    if (receipt) {
      if (receipt.graderId !== actor.id || receipt.action !== action || receipt.score !== normalizedScore || receipt.feedback !== normalizedFeedback) {
        throw new AssignmentError('Anforderungs-ID wurde anders verwendet.', 409)
      }
      return { decision: decisionDto(receipt, submission.passingScore), unchanged: true }
    }
    if (!course.activePublicationId) throw new AssignmentError('Aufgabe nicht veröffentlicht.', 412)
    const content = await tx.courseContent.findUnique({ where: { id: submission.contentId }, select: { id: true, courseId: true, type: true,
      content: true, archivedAt: true, children: { where: { archivedAt: null }, select: { id: true }, take: 1 } } })
    const assignment = content?.type === 'ASSIGNMENT' ? parseAssignmentContent(content.content) : null
    if (!content || content.courseId !== courseId || content.archivedAt || content.children.length || !assignment?.prompt.trim() ||
        submission.revision !== courseContentRevision(content)) throw new AssignmentError('Aufgabe wurde geändert. Bitte neu laden.', 412)
    const latest = await latestCurrentSubmission(tx, submission.userId, courseId, submission.contentId, submission.revision)
    if (latest?.id !== submission.id) throw new AssignmentError('Nur die neueste Abgabe dieser Aufgabe kann bewertet werden.', 409)
    const previous = await latestDecision(tx, submission.id)
    if ((previous?.id ?? null) !== expectedDecisionId) {
      throw new AssignmentError('Die Bewertung wurde zwischenzeitlich geändert. Bitte neu laden.', 409)
    }
    const created = await tx.assignmentGradeDecision.create({ data: { id: randomUUID(), submissionId,
      requestId, graderId: actor.id, action, score: normalizedScore, feedback: normalizedFeedback,
      sequence: (previous?.sequence ?? 0) + 1 } })
    await syncAssignmentProgress(tx, submission.userId, courseId, submission.contentId, content, assignment.passingScore)
    return { decision: decisionDto(created, assignment.passingScore), unchanged: false }
  })
}
