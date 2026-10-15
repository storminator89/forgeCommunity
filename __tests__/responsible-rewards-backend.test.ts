import {
  COURSE_COMPLETION_POINTS,
  courseQuizApprovalRevision,
  courseHasRewardableQuiz,
  reconcileCourseRewards,
  reconcileLearnerCourseReward,
  reconcileUserRewards,
} from '@/lib/server/rewards'
import { courseContentRevision } from '@/lib/server/course-progress'

const courseId = 'course-1'
const userId = 'learner-1'
const validQuiz = JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Answer?', options: ['Yes', 'No'], correctAnswers: [0] }] })
const draftQuiz = JSON.stringify({ questions: [] })
const invalidQuiz = JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Answer?', options: ['Yes', 'No'], correctAnswers: [] }] })

function content(id: string, value = validQuiz, parentId: string | null = null) {
  return { id, courseId, parentId, type: 'QUIZ', content: value, order: 1 }
}

type LedgerRow = { id: string; userId: string; eventType: string; sourceId: string; courseTitle: string; points: number; stateVersion: number; revokedAt: Date | null }
type ChangeRow = { ledgerId: string; version: number; type: string; reason: string | null; pointsDelta: number }

function fixture() {
  const state = {
    users: new Map([[userId, { role: 'USER', isTestAccount: false }]]),
    course: { title: 'Reward course', rewardEligible: true, rewardApprovalRevision: '' as string | null, instructorId: 'teacher-1' },
    enrollments: new Map([[userId, { id: 'enrollment-1', completedAt: new Date() }]]),
    contents: [content('quiz-1')],
    progress: new Map<string, string>(),
    attempts: [] as Array<{ userId: string; courseId: string; contentId: string; revision: string; passed: boolean }>,
    ledger: [] as LedgerRow[],
    changes: [] as ChangeRow[],
  }
  state.progress.set('quiz-1', courseContentRevision(state.contents[0]))
  state.course.rewardApprovalRevision = courseQuizApprovalRevision(state.contents)
  state.attempts.push({ userId, courseId, contentId: 'quiz-1', revision: courseContentRevision(state.contents[0]), passed: true })
  const tx = {
    user: { findUnique: jest.fn(async ({ where }: any) => state.users.get(where.id) ?? null) },
    course: {
      findUnique: jest.fn(async ({ where }: any) => where.id === courseId ? state.course : null),
      update: jest.fn(async ({ data }: any) => Object.assign(state.course, data)),
    },
    enrollment: {
      findUnique: jest.fn(async ({ where }: any) => state.enrollments.get(where.userId_courseId.userId) ?? null),
      findMany: jest.fn(async ({ where }: any) => [...state.enrollments.entries()].filter(([id, value]) =>
        (!where.userId || where.userId === id) && (!where.completedAt || value.completedAt)).map(([id]) => ({ userId: id, courseId }))),
    },
    courseContent: { findMany: jest.fn(async () => state.contents) },
    courseContentProgress: { findMany: jest.fn(async () => [...state.progress].map(([contentId, revision]) => ({ contentId, revision }))) },
    quizAttempt: { findFirst: jest.fn(async ({ where }: any) => state.attempts.find(row =>
      row.userId === where.userId && row.courseId === where.courseId && row.passed === where.passed &&
      where.OR.some((candidate: any) => candidate.contentId === row.contentId && candidate.revision === row.revision)) ?? null) },
    rewardLedger: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = where.userId_eventType_sourceId
        let row = state.ledger.find(item => item.userId === key.userId && item.eventType === key.eventType && item.sourceId === key.sourceId)
        if (row) Object.assign(row, update)
        else { row = { ...create, id: 'ledger-1', stateVersion: 1, revokedAt: null }; state.ledger.push(row!) }
        return row && { ...row }
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.userId_eventType_sourceId
        const row = state.ledger.find(item => item.userId === key.userId && item.eventType === key.eventType && item.sourceId === key.sourceId)
        return row ? { ...row } : null
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0
        for (const row of state.ledger) {
          const revokedMatches = where.revokedAt === null ? row.revokedAt === null :
            where.revokedAt?.not === null ? row.revokedAt !== null : true
          if ((!where.id || row.id === where.id) && (!where.stateVersion || row.stateVersion === where.stateVersion) && revokedMatches) {
            if (data.revokedAt !== undefined) row.revokedAt = data.revokedAt
            if (data.stateVersion?.increment) row.stateVersion += data.stateVersion.increment
            count++
          }
        }
        return { count }
      }),
      findMany: jest.fn(async ({ where }: any) => state.ledger.filter(row =>
        (!where.userId || where.userId === row.userId) &&
        (!where.sourceId || where.sourceId === row.sourceId || where.sourceId.in?.includes(row.sourceId)) &&
        (where.revokedAt !== null || row.revokedAt === null))
        .map(row => ({ userId: row.userId, sourceId: row.sourceId }))),
    },
    rewardLedgerChange: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = where.ledgerId_version
        let row = state.changes.find(item => item.ledgerId === key.ledgerId && item.version === key.version)
        if (row) Object.assign(row, update)
        else { row = { ...create }; state.changes.push(row!) }
        return row
      }),
    },
  }
  return { state, tx }
}

describe('responsible course rewards', () => {
  it('awards exactly once, revokes when eligibility changes, and reactivates the same ledger key', async () => {
    const { state, tx } = fixture()
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(true)
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(true)
    expect(state.ledger).toEqual([{ id: 'ledger-1', userId, eventType: 'COURSE_COMPLETED', sourceId: courseId,
      courseTitle: 'Reward course', points: COURSE_COMPLETION_POINTS, stateVersion: 1, revokedAt: null }])
    expect(state.changes).toEqual([{ ledgerId: 'ledger-1', version: 1, type: 'AWARDED', reason: null, pointsDelta: 50 }])
    state.course.rewardEligible = false
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(false)
    expect(state.ledger[0].revokedAt).toBeInstanceOf(Date)
    expect(state.changes).toContainEqual({ ledgerId: 'ledger-1', version: 2, type: 'REVOKED', reason: 'APPROVAL_WITHDRAWN', pointsDelta: -50 })
    state.course.rewardEligible = true
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(true)
    expect(state.ledger).toHaveLength(1)
    expect(state.ledger[0].revokedAt).toBeNull()
    expect(state.ledger[0].stateVersion).toBe(3)
    expect(state.changes).toContainEqual({ ledgerId: 'ledger-1', version: 3, type: 'REINSTATED', reason: null, pointsDelta: 50 })
    expect(state.changes).toHaveLength(3)
  })

  it.each([['draft', draftQuiz], ['invalid', invalidQuiz], ['malformed', '{"questions":oops']])('%s quizzes cannot be approved or rewarded', async (_, quiz) => {
    const { state, tx } = fixture()
    state.contents = [content('quiz-1', quiz)]
    state.progress.set('quiz-1', courseContentRevision(state.contents[0]))
    state.attempts = [{ userId, courseId, contentId: 'quiz-1', revision: courseContentRevision(state.contents[0]), passed: true }]
    expect(await courseHasRewardableQuiz(tx as never, courseId)).toBe(false)
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(false)
    expect(tx.rewardLedger.upsert).not.toHaveBeenCalled()
  })

  it('rejects passed attempts from an older quiz revision, even when current progress is complete', async () => {
    const { state, tx } = fixture()
    state.contents = [content('quiz-1', JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'New question?', options: ['Yes', 'No'], correctAnswers: [1] }] }))]
    state.progress.set('quiz-1', courseContentRevision(state.contents[0]))
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(false)
    expect(state.ledger).toHaveLength(0)
  })

  it('revokes a prior award after a quiz edit until current progress and a new passed attempt exist', async () => {
    const { state, tx } = fixture()
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(true)
    state.contents = [content('quiz-1', JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Updated?', options: ['Yes', 'No'], correctAnswers: [0] }] }))]
    await reconcileCourseRewards(tx as never, courseId)
    expect(state.course).toMatchObject({ rewardEligible: false, rewardApprovalRevision: null })
    expect(state.ledger[0].revokedAt).toBeInstanceOf(Date)
    expect(state.changes).toContainEqual({ ledgerId: 'ledger-1', version: 2, type: 'REVOKED', reason: 'QUIZ_REVISED', pointsDelta: -50 })
    state.course.rewardEligible = true
    state.course.rewardApprovalRevision = courseQuizApprovalRevision(state.contents)
    await reconcileCourseRewards(tx as never, courseId)
    expect(state.ledger[0].revokedAt).toBeInstanceOf(Date)
    state.progress.set('quiz-1', courseContentRevision(state.contents[0]))
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(false)
    state.attempts.push({ userId, courseId, contentId: 'quiz-1', revision: courseContentRevision(state.contents[0]), passed: true })
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(true)
    expect(state.ledger).toHaveLength(1)
    expect(state.ledger[0].revokedAt).toBeNull()
    expect(state.changes).toContainEqual({ ledgerId: 'ledger-1', version: 3, type: 'REINSTATED', reason: null, pointsDelta: 50 })
    expect(state.changes).toHaveLength(3)
  })

  it('keeps approval for cosmetic title or order changes to a quiz', async () => {
    const { state, tx } = fixture()
    ;(state.contents[0] as typeof state.contents[0] & { title: string }).title = 'New title'
    state.contents[0].order = 7
    await reconcileCourseRewards(tx as never, courseId)
    expect(state.course.rewardEligible).toBe(true)
    expect(tx.course.update).not.toHaveBeenCalled()
    expect(state.ledger).toHaveLength(1)
  })

  it('invalidates approval if a quiz ceases to be a leaf', async () => {
    const { state, tx } = fixture()
    await reconcileLearnerCourseReward(tx as never, userId, courseId)
    state.contents.push({ ...content('child-1', 'Reading', 'quiz-1'), type: 'TEXT' })
    await reconcileCourseRewards(tx as never, courseId)
    expect(state.course.rewardEligible).toBe(false)
    expect(state.ledger[0].revokedAt).toBeInstanceOf(Date)
  })

  it('concurrent reconciliation calls retain one unique event key', async () => {
    const { state, tx } = fixture()
    const results = await Promise.all(Array.from({ length: 8 }, () => reconcileLearnerCourseReward(tx as never, userId, courseId)))
    expect(results).toEqual(Array(8).fill(true))
    expect(state.ledger).toHaveLength(1)
    expect(state.ledger[0]).toMatchObject({ userId, eventType: 'COURSE_COMPLETED', sourceId: courseId, points: COURSE_COMPLETION_POINTS, revokedAt: null })
    expect(state.changes).toEqual([{ ledgerId: 'ledger-1', version: 1, type: 'AWARDED', reason: null, pointsDelta: 50 }])
  })

  it('repeat and concurrent calls create one change per state version', async () => {
    const { state, tx } = fixture()
    await Promise.all(Array.from({ length: 8 }, () => reconcileLearnerCourseReward(tx as never, userId, courseId)))
    state.course.rewardEligible = false
    await Promise.all(Array.from({ length: 8 }, () => reconcileLearnerCourseReward(tx as never, userId, courseId)))
    await reconcileLearnerCourseReward(tx as never, userId, courseId)
    expect(state.ledger[0]).toMatchObject({ stateVersion: 2 })
    expect(state.changes.filter(change => change.type === 'REVOKED')).toEqual([
      { ledgerId: 'ledger-1', version: 2, type: 'REVOKED', reason: 'APPROVAL_WITHDRAWN', pointsDelta: -50 },
    ])
    state.course.rewardEligible = true
    await Promise.all(Array.from({ length: 8 }, () => reconcileLearnerCourseReward(tx as never, userId, courseId)))
    await reconcileLearnerCourseReward(tx as never, userId, courseId)
    expect(state.ledger).toHaveLength(1)
    expect(state.ledger[0]).toMatchObject({ stateVersion: 3, revokedAt: null })
    expect(state.changes.map(change => [change.version, change.type, change.pointsDelta])).toEqual([
      [1, 'AWARDED', 50], [2, 'REVOKED', -50], [3, 'REINSTATED', 50],
    ])
  })

  it('requires enrollment and every leaf to be complete', async () => {
    const { state, tx } = fixture()
    state.enrollments.clear()
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(false)
    state.enrollments.set(userId, { id: 'enrollment-1', completedAt: new Date() })
    state.contents.push({ ...content('text-1', 'Reading'), type: 'TEXT' })
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(false)
    state.progress.set('text-1', courseContentRevision(state.contents[1]))
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(true)
  })

  it('does not count a valid parent quiz when its leaf is ordinary content', async () => {
    const { state, tx } = fixture()
    state.contents = [content('quiz-1'), { ...content('child-1', 'ordinary text', 'quiz-1'), type: 'TEXT' }]
    expect(await courseHasRewardableQuiz(tx as never, courseId)).toBe(false)
  })

  it.each([
    ['administrator', { role: 'ADMIN', isTestAccount: false }, 'teacher-1', true],
    ['moderator', { role: 'MODERATOR', isTestAccount: false }, 'teacher-1', true],
    ['test account', { role: 'USER', isTestAccount: true }, 'teacher-1', true],
    ['instructor', { role: 'USER', isTestAccount: false }, userId, true],
    ['unapproved course', { role: 'USER', isTestAccount: false }, 'teacher-1', false],
  ])('excludes %s from points', async (_, member, instructorId, eligible) => {
    const { state, tx } = fixture()
    state.users.set(userId, member)
    state.course.instructorId = instructorId as string
    state.course.rewardEligible = eligible as boolean
    expect(await reconcileLearnerCourseReward(tx as never, userId, courseId)).toBe(false)
    expect(state.ledger).toHaveLength(0)
  })

  it('bulk reconciliations revoke active points when approval or test status changes', async () => {
    const { state, tx } = fixture()
    await reconcileLearnerCourseReward(tx as never, userId, courseId)
    state.course.rewardEligible = false
    await reconcileCourseRewards(tx as never, courseId)
    expect(state.ledger[0].revokedAt).toBeInstanceOf(Date)
    state.course.rewardEligible = true
    state.users.get(userId)!.isTestAccount = true
    await reconcileUserRewards(tx as never, userId)
    expect(state.ledger).toHaveLength(1)
    expect(state.ledger[0].revokedAt).toBeInstanceOf(Date)
  })
})
