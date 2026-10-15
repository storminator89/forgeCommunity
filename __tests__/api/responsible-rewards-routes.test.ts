import { GET as getMyRewards } from '@/app/api/rewards/me/route'
import { GET as getLeaderboard } from '@/app/api/leaderboard/route'
import { PATCH as setCourseEligibility } from '@/app/api/admin/courses/[courseId]/reward-eligibility/route'
import { PATCH as setTestAccount } from '@/app/api/admin/users/[id]/test-account/route'
import { GET as getOwnProfile, PUT as updateOwnProfile } from '@/app/api/user/profile/route'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { courseApprovalFingerprint, courseHasRewardableQuiz, reconcileCourseRewards, reconcileUserRewards } from '@/lib/server/rewards'

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), {
        ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      })
    }
  }
  return { NextResponse: MockNextResponse }
})
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))
jest.mock('@/lib/server/request-body', () => ({
  requestWithBodyLimit: jest.fn(async request => request),
  RequestBodyLimitError: class RequestBodyLimitError extends Error {},
}))
jest.mock('@/app/api/courses/[courseId]/contents/content-mutations', () => ({
  contentTransaction: jest.fn(async callback => callback(prisma)),
}))
jest.mock('@/lib/server/rewards', () => ({
  courseApprovalFingerprint: jest.fn(), courseHasRewardableQuiz: jest.fn(), reconcileCourseRewards: jest.fn(), reconcileUserRewards: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  course: { findUnique: jest.fn(), update: jest.fn() },
  courseCompletionRecord: { count: jest.fn() },
  rewardLedger: { aggregate: jest.fn(), groupBy: jest.fn() },
  rewardLedgerChange: { findMany: jest.fn() },
} }))

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock }
  course: { findUnique: jest.Mock; update: jest.Mock }
  courseCompletionRecord: { count: jest.Mock }
  rewardLedger: { aggregate: jest.Mock; groupBy: jest.Mock }
  rewardLedgerChange: { findMany: jest.Mock }
}
const session = getServerSession as jest.Mock
const courseParams = { params: Promise.resolve({ courseId: 'course-1' }) }
const memberParams = { params: Promise.resolve({ id: 'member-1' }) }
function jsonRequest(body: unknown) {
  return { json: async () => body } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  session.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } })
  db.user.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === 'admin-1' ? { id: 'admin-1', role: 'ADMIN' } : { id: where.id })
  db.course.findUnique.mockResolvedValue({ id: 'course-1', activePublicationId: 'publication-1' })
  db.course.update.mockResolvedValue({})
  db.user.update.mockResolvedValue({})
  ;(courseHasRewardableQuiz as jest.Mock).mockResolvedValue(true)
  ;(courseApprovalFingerprint as jest.Mock).mockResolvedValue('reviewed-v1')
  db.rewardLedgerChange.findMany.mockResolvedValue([])
})

describe('private reward summary', () => {
  it('rejects anonymous requests without querying points', async () => {
    session.mockResolvedValue(null)
    expect((await getMyRewards()).status).toBe(401)
    expect(db.rewardLedger.aggregate).not.toHaveBeenCalled()
  })

  it('uses only the authenticated user and active ledger entries, returning no sources or identities', async () => {
    session.mockResolvedValue({ user: { id: 'member-1', role: 'USER' } })
    db.rewardLedger.aggregate.mockResolvedValue({ _sum: { points: 100 } })
    db.courseCompletionRecord.count.mockResolvedValue(2)
    db.rewardLedgerChange.findMany.mockResolvedValue([{ type: 'REVOKED', reason: 'QUIZ_REVISED', pointsDelta: -50,
      createdAt: new Date('2026-10-14T10:00:00Z'), ledger: { courseTitle: 'Learning course' } }])
    const response = await getMyRewards()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ points: 100, completedCourses: 2, firstCourseCompleted: true,
      history: [{ type: 'REVOKED', reason: 'QUIZ_REVISED', pointsDelta: -50, at: '2026-10-14T10:00:00.000Z', courseTitle: 'Learning course' }] })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 'member-1' }, select: { id: true } })
    expect(db.rewardLedger.aggregate).toHaveBeenCalledWith({ where: { userId: 'member-1', revokedAt: null }, _sum: { points: true } })
    expect(db.courseCompletionRecord.count).toHaveBeenCalledWith({ where: { userId: 'member-1' } })
    expect(db.rewardLedgerChange.findMany).toHaveBeenCalledWith({
      where: { ledger: { userId: 'member-1' } },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }, { id: 'desc' }], take: 10,
      select: { type: true, reason: true, pointsDelta: true, createdAt: true, ledger: { select: { courseTitle: true } } },
    })
  })

  it('returns zero when no active points or completions exist', async () => {
    db.rewardLedger.aggregate.mockResolvedValue({ _sum: { points: null } })
    db.courseCompletionRecord.count.mockResolvedValue(0)
    expect(await (await getMyRewards()).json()).toEqual({ points: 0, completedCourses: 0, firstCourseCompleted: false, history: [] })
  })
})

describe('opt-in public ranking', () => {
  it('aggregates only active rewards for consenting real learners and bounds identity reads', async () => {
    db.rewardLedger.groupBy.mockResolvedValue([
      { userId: 'a', _sum: { points: 100 } },
      { userId: 'b', _sum: { points: 100 } },
    ])
    db.user.findMany.mockResolvedValueOnce([
      { id: 'b', name: 'B', image: null },
      { id: 'a', name: null, image: null },
    ]).mockResolvedValueOnce([])
    const response = await getLeaderboard()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const eligible = { role: 'USER', isTestAccount: false, userSettings: { is: { publicRankingOptIn: true } } }
    expect(db.rewardLedger.groupBy).toHaveBeenCalledWith({
      by: ['userId'], where: { revokedAt: null, user: eligible }, _sum: { points: true },
      orderBy: [{ _sum: { points: 'desc' } }, { userId: 'asc' }], take: 10,
    })
    expect(db.user.findMany).toHaveBeenNthCalledWith(1, {
      where: { ...eligible, id: { in: ['a', 'b'] } },
      select: { id: true, name: true, image: true },
    })
    expect(db.user.findMany).toHaveBeenNthCalledWith(2, {
      where: { ...eligible, id: { notIn: ['a', 'b'] }, rewardLedger: { none: { revokedAt: null } } },
      orderBy: { id: 'asc' }, take: 8, select: { name: true, image: true },
    })
    expect(await response.json()).toEqual([
      { name: 'Anonymous', image: null, points: 100 },
      { name: 'B', image: null, points: 100 },
    ])
  })

  it('fills only remaining places with opted-in zero-point learners', async () => {
    db.rewardLedger.groupBy.mockResolvedValue([{ userId: 'b', _sum: { points: 50 } }])
    db.user.findMany.mockResolvedValueOnce([{ id: 'b', name: 'B', image: null }])
      .mockResolvedValueOnce([{ name: 'A', image: null }, { name: 'C', image: null }])
    expect(await (await getLeaderboard()).json()).toEqual([
      { name: 'B', image: null, points: 50 },
      { name: 'A', image: null, points: 0 },
      { name: 'C', image: null, points: 0 },
    ])
  })

  it('does not expose an account that revokes consent between aggregate and identity lookup', async () => {
    db.rewardLedger.groupBy.mockResolvedValue([{ userId: 'removed', _sum: { points: 50 } }])
    db.user.findMany.mockResolvedValueOnce([])
    expect(await (await getLeaderboard()).json()).toEqual([])
    expect(db.user.findMany).toHaveBeenCalledTimes(1)
    expect(db.user.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ userSettings: { is: { publicRankingOptIn: true } } }),
    }))
  })
})

describe('ranking consent in own profile', () => {
  it('lets a member explicitly opt in and returns only selected profile fields', async () => {
    session.mockResolvedValue({ user: { id: 'member-1', role: 'USER' } })
    db.user.update.mockResolvedValue({
      id: 'member-1', name: 'Member', email: 'member@example.com', image: null,
      userSettings: { publicRankingOptIn: true }, password: 'should never be returned',
    })
    const response = await updateOwnProfile(jsonRequest({ publicRankingOptIn: true }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'member-1', name: 'Member', email: 'member@example.com', image: null,
      userSettings: { publicRankingOptIn: true },
    })
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'member-1' },
      data: expect.objectContaining({ userSettings: { upsert: {
        create: expect.objectContaining({ publicRankingOptIn: true }),
        update: expect.objectContaining({ publicRankingOptIn: true }),
      } } }),
      select: expect.objectContaining({ userSettings: { select: expect.objectContaining({ publicRankingOptIn: true }) } }),
    }))
  })

  it('rejects non-boolean consent and does not update the profile', async () => {
    expect((await updateOwnProfile(jsonRequest({ publicRankingOptIn: 'true' }))).status).toBe(400)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('reads the member consent setting only through the authenticated profile', async () => {
    session.mockResolvedValue({ user: { id: 'member-1', role: 'USER' } })
    db.user.findUnique.mockResolvedValue({ id: 'member-1', userSettings: { publicRankingOptIn: false } })
    const response = await getOwnProfile()
    expect(response.status).toBe(200)
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'member-1' },
      select: expect.objectContaining({ userSettings: { select: expect.objectContaining({ publicRankingOptIn: true }) } }),
    }))
  })
})

describe('administrator reward controls', () => {
  it.each([
    ['anonymous', null, 401],
    ['ordinary member', { user: { id: 'member-1', role: 'USER' } }, 403],
  ])('blocks %s before writes', async (_, identity, expected) => {
    session.mockResolvedValue(identity)
    expect((await setCourseEligibility(jsonRequest({ eligible: true }), courseParams)).status).toBe(expected)
    expect((await setTestAccount(jsonRequest({ isTestAccount: true }), memberParams)).status).toBe(expected)
    expect(db.course.update).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('rechecks the administrator role inside the transaction', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'USER' })
    expect((await setCourseEligibility(jsonRequest({ eligible: true }), courseParams)).status).toBe(403)
    expect((await setTestAccount(jsonRequest({ isTestAccount: true }), memberParams)).status).toBe(403)
    expect(db.course.update).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it.each([{ eligible: 'true' }, { eligible: true, points: 999 }, {}, []])('rejects invalid approval input %j', async body => {
    expect((await setCourseEligibility(jsonRequest(body), courseParams)).status).toBe(400)
    expect(db.course.update).not.toHaveBeenCalled()
  })

  it('requires a valid published quiz before enabling points', async () => {
    ;(courseHasRewardableQuiz as jest.Mock).mockResolvedValue(false)
    expect((await setCourseEligibility(jsonRequest({ eligible: true }), courseParams)).status).toBe(409)
    expect(db.course.update).not.toHaveBeenCalled()
    expect(reconcileCourseRewards).not.toHaveBeenCalled()
  })

  it('never approves points on an unpublished course', async () => {
    db.course.findUnique.mockResolvedValue({ id: 'course-1', activePublicationId: null })
    expect((await setCourseEligibility(jsonRequest({ eligible: true }), courseParams)).status).toBe(409)
    expect(courseHasRewardableQuiz).not.toHaveBeenCalled()
    expect(db.course.update).not.toHaveBeenCalled()
  })

  it('binds an enabled approval to the current quiz fingerprint', async () => {
    const response = await setCourseEligibility(jsonRequest({ eligible: true }), courseParams)
    expect(response.status).toBe(200)
    expect(courseApprovalFingerprint).toHaveBeenCalledWith(prisma, 'course-1')
    expect(db.course.update).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: { rewardEligible: true, rewardApprovalRevision: 'reviewed-v1' },
    })
    expect(reconcileCourseRewards).toHaveBeenCalledWith(prisma, 'course-1')
  })

  it('reconciles awards after approval changes, but disabling does not require a quiz', async () => {
    ;(courseHasRewardableQuiz as jest.Mock).mockResolvedValue(false)
    const response = await setCourseEligibility(jsonRequest({ eligible: false }), courseParams)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(db.course.update).toHaveBeenCalledWith({ where: { id: 'course-1' }, data: { rewardEligible: false, rewardApprovalRevision: null } })
    expect(reconcileCourseRewards).toHaveBeenCalledWith(prisma, 'course-1')
  })

  it.each([{ isTestAccount: 'true' }, { isTestAccount: true, role: 'ADMIN' }, {}])('rejects invalid test-account input %j', async body => {
    expect((await setTestAccount(jsonRequest(body), memberParams)).status).toBe(400)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('reconciles existing rewards when a user becomes a test account', async () => {
    const response = await setTestAccount(jsonRequest({ isTestAccount: true }), memberParams)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'member-1' }, data: { isTestAccount: true } })
    expect(reconcileUserRewards).toHaveBeenCalledWith(prisma, 'member-1')
  })
})
