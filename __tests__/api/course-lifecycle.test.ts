import { enrollInCourse, getCourseProgress, markCourseContent, progressSummary, isLearningContent, ensureCourseCertificate, courseTransaction } from '@/lib/server/course-lifecycle'
import { POST as enroll } from '@/app/api/courses/[courseId]/enroll/route'
import { POST as grantAccess, GET as listEnrollments } from '@/app/api/courses/[courseId]/enrollments/route'
import { PUT as markProgress } from '@/app/api/courses/[courseId]/contents/[contentId]/progress/route'
import { GET as getProgress } from '@/app/api/courses/[courseId]/progress/route'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { v4 as uuidv4 } from 'uuid'

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } })
    }
  }
  return { NextResponse: MockNextResponse }
})
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  course: { findUnique: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn() },
  enrollment: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  courseContent: { findUnique: jest.fn(), findMany: jest.fn() },
  contentProgress: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  certificate: { findFirst: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
} }))
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))
jest.mock('uuid', () => ({ v4: jest.fn(() => 'new-cert-id') }))

const db = prisma as unknown as {
  course: Record<'findUnique' | 'update', jest.Mock>;
  user: Record<'findUnique', jest.Mock>;
  enrollment: Record<'findUnique' | 'count' | 'create' | 'update' | 'findMany', jest.Mock>;
  courseContent: Record<'findUnique' | 'findMany', jest.Mock>;
  contentProgress: Record<'findMany' | 'upsert' | 'deleteMany', jest.Mock>;
  certificate: Record<'findFirst' | 'create', jest.Mock>;
  $transaction: jest.Mock;
}
const date = new Date('2026-09-30T00:00:00Z')
const course = { id: 'course-1', title: 'Course', instructorId: 'owner-1', price: null, maxStudents: null, updatedAt: date }
const enrollment = { id: 'enrollment-1', courseId: 'course-1', userId: 'user-1', enrolledAt: date, completedAt: null }
const required = { id: 'content-1', courseId: 'course-1', type: 'TEXT', content: '<p>Learning material</p>', isRequired: true }
const optional = { ...required, id: 'content-2', isRequired: false }
const params = { params: Promise.resolve({ courseId: 'course-1' }) }
const contentParams = { params: Promise.resolve({ courseId: 'course-1', contentId: 'content-1' }) }
const request = (body: unknown = {}) => ({ url: 'http://localhost/api/courses/course-1/enrollments', headers: new Map(), json: async () => body }) as never

beforeEach(() => {
  jest.resetAllMocks()
  ;(uuidv4 as jest.Mock).mockReturnValue('new-cert-id')
  ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1', role: 'USER' } })
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => unknown) => work(db))
  db.course.findUnique.mockResolvedValue(course)
  db.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'Learner', email: 'learner@example.test' })
  db.enrollment.findUnique.mockResolvedValue(enrollment)
  db.enrollment.create.mockResolvedValue(enrollment)
  db.enrollment.update.mockImplementation(async ({ data }) => ({ ...enrollment, ...data }))
  db.enrollment.count.mockResolvedValue(0)
  db.courseContent.findUnique.mockResolvedValue(required)
  db.courseContent.findMany.mockResolvedValue([required, optional])
  db.contentProgress.findMany.mockResolvedValue([])
  db.certificate.findFirst.mockResolvedValue(null)
  db.certificate.create.mockImplementation(async ({ data }) => data)
})

test('only non-empty supported learning contents count, never chapter shells', () => {
  for (const content of ['', '<p><br></p>', '<p>&nbsp; &#160; &#xA0;\u200b</p>', '<!-- comment -->']) {
    expect(isLearningContent({ type: 'TEXT', content })).toBe(false)
  }
  expect(isLearningContent({ type: null, content: 'Legacy text lesson' })).toBe(true)
  expect(isLearningContent({ type: null, content: '<p></p>' })).toBe(false)
  expect(isLearningContent({ type: 'QUIZ', content: 'unsupported quiz' })).toBe(false)
  expect(isLearningContent({ type: 'TEXT', content: '<p><img src="/image.png"></p>' })).toBe(true)
  expect(isLearningContent({ type: 'VIDEO', content: 'https://example.test/video' })).toBe(true)
  expect(isLearningContent({ type: 'TEXT', content: '{"questions":[]}' })).toBe(true)
})

test('summary ignores optional, removed and duplicate marks in required percentage', () => {
  const summary = progressSummary([required, optional, { ...required, id: 'shell', content: '<p></p>' }], [
    { contentId: optional.id }, { contentId: required.id }, { contentId: required.id }, { contentId: 'removed' },
  ])
  expect(summary).toEqual({ learningContentIds: ['content-1', 'content-2'], requiredContentIds: ['content-1'],
    completedContentIds: ['content-2', 'content-1'], completedCount: 1, requiredCount: 1, percentage: 100 })
  expect(progressSummary([], []).percentage).toBe(0)
})

test('self enrollment is idempotent even when an enrolled paid course is now full', async () => {
  db.course.findUnique.mockResolvedValue({ ...course, price: 20, maxStudents: 1 })
  const result = await enrollInCourse('course-1', { id: 'user-1' })
  expect(result.enrollment.id).toBe('enrollment-1')
  expect(db.enrollment.create).not.toHaveBeenCalled()
  expect(db.course.update).not.toHaveBeenCalled()
})

test('free self enrollment creates only the authenticated user and locks capacity', async () => {
  db.enrollment.findUnique.mockResolvedValue(null)
  await enrollInCourse('course-1', { id: 'user-1' })
  expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { id: true } })
  expect(db.course.update).toHaveBeenCalledWith({ where: { id: 'course-1' }, data: { updatedAt: date } })
  expect(db.enrollment.create).toHaveBeenCalledWith({ data: { userId: 'user-1', courseId: 'course-1' } })
})

test('paid self enrollment is forbidden before a capacity check or write', async () => {
  db.enrollment.findUnique.mockResolvedValue(null)
  db.course.findUnique.mockResolvedValue({ ...course, price: 20 })
  await expect(enrollInCourse('course-1', { id: 'user-1' })).rejects.toMatchObject({ status: 403, code: 'PAID_COURSE_REQUIRES_ACCESS' })
  expect(db.enrollment.create).not.toHaveBeenCalled()
  expect(db.course.update).not.toHaveBeenCalled()
})

test.each([{ id: 'owner-1' }, { id: 'admin-1', role: 'ADMIN' }])('owner/admin may explicitly grant paid access: %j', async (actor) => {
  db.enrollment.findUnique.mockResolvedValue(null)
  db.course.findUnique.mockResolvedValue({ ...course, price: 20 })
  const result = await enrollInCourse('course-1', actor, { email: 'learner@example.test' })
  expect(result.enrollment.id).toBe('enrollment-1')
  expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'learner@example.test' }, select: { id: true } })
})

test('other members cannot look up or grant another learner access', async () => {
  await expect(enrollInCourse('course-1', { id: 'outsider' }, { userId: 'user-1' })).rejects.toMatchObject({ status: 403 })
  expect(db.user.findUnique).not.toHaveBeenCalled()
  expect(db.enrollment.create).not.toHaveBeenCalled()
})

test('participant cap also applies to an owner grant', async () => {
  db.course.findUnique.mockResolvedValue({ ...course, maxStudents: 1 })
  db.enrollment.findUnique.mockResolvedValue(null)
  db.enrollment.count.mockResolvedValue(1)
  await expect(enrollInCourse('course-1', { id: 'owner-1' }, { userId: 'user-1' })).rejects.toMatchObject({ status: 409, code: 'COURSE_FULL' })
  expect(db.enrollment.create).not.toHaveBeenCalled()
})

test('absent course and unknown grant recipient are 404', async () => {
  db.course.findUnique.mockResolvedValueOnce(null)
  await expect(enrollInCourse('missing', { id: 'user-1' })).rejects.toMatchObject({ status: 404 })
  db.user.findUnique.mockResolvedValueOnce(null)
  await expect(enrollInCourse('course-1', { id: 'owner-1' }, { email: 'missing@example.test' })).rejects.toMatchObject({ status: 404 })
})

test('a progress read never infers completion or writes progress', async () => {
  db.contentProgress.findMany.mockResolvedValue([{ contentId: 'content-1' }])
  const result = await getCourseProgress('course-1', 'user-1')
  expect(result.percentage).toBe(100)
  expect(result.enrollment.completedAt).toBeNull()
  expect(db.enrollment.update).not.toHaveBeenCalled()
  expect(db.certificate.create).not.toHaveBeenCalled()
})

test('the final explicit mandatory mark completes and issues a snapshot atomically', async () => {
  db.contentProgress.findMany.mockResolvedValue([{ contentId: 'content-1' }])
  const result = await markCourseContent('course-1', 'content-1', 'user-1', true)
  expect(result.percentage).toBe(100)
  expect(result.enrollment.completedAt).toBeInstanceOf(Date)
  expect(result.certificate?.id).toBe('new-cert-id')
  expect(db.contentProgress.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: { enrollmentId: 'enrollment-1', contentId: 'content-1' }, update: {},
  }))
  expect(db.certificate.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    userId: 'user-1', courseId: 'course-1', userName: 'Learner', courseName: 'Course',
  }) })
  expect(db.$transaction).toHaveBeenCalledTimes(1)
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }))
})

test('optional-only and empty courses never become completed', async () => {
  db.courseContent.findMany.mockResolvedValue([optional])
  db.courseContent.findUnique.mockResolvedValue(optional)
  db.contentProgress.findMany.mockResolvedValue([{ contentId: 'content-2' }])
  const result = await markCourseContent('course-1', 'content-2', 'user-1', true)
  expect(result.requiredCount).toBe(0)
  expect(result.percentage).toBe(0)
  expect(result.enrollment.completedAt).toBeNull()
  expect(db.certificate.create).not.toHaveBeenCalled()
  db.courseContent.findMany.mockResolvedValue([])
  expect((await getCourseProgress('course-1', 'user-1')).requiredCount).toBe(0)
})

test('an incomplete learner can remove their explicit mark', async () => {
  const result = await markCourseContent('course-1', 'content-1', 'user-1', false)
  expect(db.contentProgress.deleteMany).toHaveBeenCalledWith({ where: { enrollmentId: 'enrollment-1', contentId: 'content-1' } })
  expect(result.enrollment.completedAt).toBeNull()
  expect(db.certificate.create).not.toHaveBeenCalled()
})

test('completion and historical certificates stay immutable on repeated marks or syllabus changes', async () => {
  db.enrollment.findUnique.mockResolvedValue({ ...enrollment, completedAt: date })
  db.certificate.findFirst.mockResolvedValue({ id: 'old-certificate', issuedAt: date, courseName: 'Old course', userName: 'Old name' })
  const result = await markCourseContent('course-1', 'content-1', 'user-1', true)
  expect(result.enrollment.completedAt).toBe(date)
  expect(result.certificate?.id).toBe('old-certificate')
  expect(db.contentProgress.upsert).not.toHaveBeenCalled()
  expect(db.certificate.create).not.toHaveBeenCalled()
  await expect(markCourseContent('course-1', 'content-1', 'user-1', false)).rejects.toMatchObject({ status: 409 })
  expect(db.contentProgress.deleteMany).not.toHaveBeenCalled()
})

test('progress rejects other-course IDs and empty chapter marks before any writes', async () => {
  db.courseContent.findUnique.mockResolvedValueOnce({ ...required, courseId: 'course-2' })
  await expect(markCourseContent('course-1', 'content-1', 'user-1', true)).rejects.toMatchObject({ status: 404 })
  db.courseContent.findUnique.mockResolvedValueOnce({ ...required, content: '<p><br></p>' })
  await expect(markCourseContent('course-1', 'content-1', 'user-1', true)).rejects.toMatchObject({ status: 400 })
  expect(db.contentProgress.upsert).not.toHaveBeenCalled()
})

test('progress needs the authenticated learner enrollment, even for a course manager', async () => {
  db.enrollment.findUnique.mockResolvedValue(null)
  await expect(markCourseContent('course-1', 'content-1', 'owner-1', true)).rejects.toMatchObject({ status: 403 })
  await expect(getCourseProgress('course-1', 'owner-1')).rejects.toMatchObject({ status: 403 })
  expect(db.enrollment.update).not.toHaveBeenCalled()
})

test('legacy certificate issuance reuses existing history and locks before creating new history', async () => {
  const saved = { id: 'legacy-cert', issuedAt: date, courseName: 'Old course', userName: 'Old name' }
  db.certificate.findFirst.mockResolvedValueOnce(saved)
  expect(await ensureCourseCertificate(db as never, { ...enrollment, completedAt: date }, { courseName: 'New', userName: 'New' })).toBe(saved)
  expect(db.enrollment.update).not.toHaveBeenCalled()
  await ensureCourseCertificate(db as never, { ...enrollment, completedAt: date }, { courseName: 'New', userName: 'New' })
  expect(db.enrollment.update).toHaveBeenCalledWith({ where: { id: 'enrollment-1' }, data: { completedAt: date } })
  expect(db.certificate.create).toHaveBeenCalledTimes(1)
})

test('serialization and unique-key conflicts retry the whole transaction', async () => {
  db.$transaction.mockRejectedValueOnce({ code: 'P2034' }).mockRejectedValueOnce({ code: 'P2002' })
  const result = await courseTransaction(async () => 'ok')
  expect(result).toBe('ok')
  expect(db.$transaction).toHaveBeenCalledTimes(3)
})

test('non-concurrency errors do not retry or hide failure', async () => {
  db.$transaction.mockRejectedValueOnce(new Error('unavailable'))
  await expect(courseTransaction(async () => 'ok')).rejects.toThrow('unavailable')
  expect(db.$transaction).toHaveBeenCalledTimes(1)
})

test('all lifecycle routes require authentication before database work', async () => {
  ;(getServerSession as jest.Mock).mockResolvedValue(null)
  for (const response of [await enroll(request(), params), await grantAccess(request(), params),
    await listEnrollments(request(), params), await getProgress(request(), params), await markProgress(request(), contentParams)]) {
    expect(response.status).toBe(401)
  }
  expect(db.$transaction).not.toHaveBeenCalled()
  expect(db.course.findUnique).not.toHaveBeenCalled()
})

test('progress rejects malformed payloads and user identity spoofing', async () => {
  for (const body of [null, [], { completed: 'true' }, { completed: true, userId: 'other' }, { percentage: 100 }]) {
    expect((await markProgress(request(body), contentParams)).status).toBe(400)
  }
  expect(db.contentProgress.upsert).not.toHaveBeenCalled()
})

test('grant requests reject ambiguous or empty identities', async () => {
  for (const body of [{}, { userId: '' }, { email: '' }, { userId: 'user', email: 'email@example.test' }, { email: 42 }]) {
    expect((await grantAccess(request(body), params)).status).toBe(400)
  }
  expect(db.$transaction).not.toHaveBeenCalled()
})

test('grant accepts and normalizes one email only for an authorized manager', async () => {
  ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'owner-1', role: 'USER' } })
  expect((await grantAccess(request({ email: '  LEARNER@EXAMPLE.TEST ' }), params)).status).toBe(200)
  expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'learner@example.test' }, select: { id: true } })
})

test('other learners cannot see the enrollment roster or private email addresses', async () => {
  expect((await listEnrollments(request(), params)).status).toBe(403)
  expect(db.enrollment.findMany).not.toHaveBeenCalled()
})
