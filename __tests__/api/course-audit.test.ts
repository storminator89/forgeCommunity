import { POST as createCourse } from '@/app/api/courses/route'
import { POST as issueCertificate } from '@/app/api/courses/[courseId]/certificate/route'
import { GET as downloadCertificate } from '@/app/api/certificates/[certificateId]/download/route'
import { groupCourseContents } from '@/lib/server/group-course-contents'
import { certificatePdfResponse } from '@/lib/server/certificate-pdf'
import { deleteCourseDependencies } from '@/lib/server/course-deletion'
import prisma from '@/lib/prisma'
import { getServerSession as getNextSession } from 'next-auth/next'
import { getServerSession } from 'next-auth'

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

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  course: { create: jest.fn(), findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  enrollment: { findUnique: jest.fn() },
  certificate: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(),
} }))
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))
jest.mock('@/lib/server/request-body', () => ({
  requestWithBodyLimit: jest.fn(async (request) => request),
  RequestBodyLimitError: class RequestBodyLimitError extends Error {},
}))
jest.mock('@/lib/server/image-upload', () => ({
  saveImageUpload: jest.fn(),
  ImageUploadValidationError: class ImageUploadValidationError extends Error {},
}))
jest.mock('@/lib/server/certificate-pdf', () => ({ certificatePdfResponse: jest.fn(async () => new Response('PDF')) }))
jest.mock('uuid', () => ({ v4: jest.fn(() => 'new-cert-id') }))

const db = prisma as unknown as {
  course: { create: jest.Mock; findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  enrollment: { findUnique: jest.Mock };
  certificate: { findFirst: jest.Mock; create: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
}
const params = { params: Promise.resolve({ courseId: 'course-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  ;(getNextSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } })
  ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } })
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db))
})

test('course creation stores empty optional numbers as null', async () => {
  const form = new FormData()
  form.append('title', 'Course')
  form.append('description', 'Description')
  form.append('price', '')
  form.append('maxStudents', '')
  db.course.create.mockResolvedValue({ id: 'course-1' })
  const response = await createCourse({ headers: { get: () => null }, formData: async () => ({ get: (key: string) => form.get(key) ?? null }) } as never)
  expect(response.status).toBe(201)
  expect(db.course.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ price: null, maxStudents: null, startDate: null, endDate: null }),
  }))
})

test('course creation rejects malformed date and numbers before writes', async () => {
  for (const [key, value] of [['startDate', 'bad-date'], ['maxStudents', '12oops'], ['price', 'Infinity']]) {
    const form = new FormData()
    form.append('title', 'Course')
    form.append('description', 'Description')
    form.append(key, value)
    const response = await createCourse({ headers: { get: () => null }, formData: async () => ({ get: (key: string) => form.get(key) ?? null }) } as never)
    expect(response.status).toBe(400)
  }
  expect(db.course.create).not.toHaveBeenCalled()
})

test('certificate issuance reuses saved snapshot instead of current profile/course name', async () => {
  const saved = { id: 'cert-1', userId: 'user-1', courseId: 'course-1', userName: 'Old Name', courseName: 'Old Course', issuedAt: new Date('2020-01-01') }
  db.course.findUnique.mockResolvedValue({ title: 'Renamed Course' })
  db.user.findUnique.mockResolvedValue({ name: 'Renamed User', email: 'user@example.org' })
  db.enrollment.findUnique.mockResolvedValue({ completedAt: new Date('2020-01-01') })
  db.certificate.findFirst.mockResolvedValue(saved)
  const response = await issueCertificate(new Request('http://localhost/api/courses/course-1/certificate', { method: 'POST' }) as never, params)
  expect(response.status).toBe(200)
  expect(certificatePdfResponse).toHaveBeenCalledWith(saved)
  expect(db.certificate.create).not.toHaveBeenCalled()
})

test('certificate download uses saved snapshot and owner filter', async () => {
  const saved = { id: 'cert-1', userId: 'user-1', userName: 'Old Name', courseName: 'Old Course', issuedAt: new Date('2020-01-01') }
  db.certificate.findUnique.mockResolvedValue(saved)
  const response = await downloadCertificate(new Request('http://localhost/api/certificates/cert-1/download') as never,
    { params: Promise.resolve({ certificateId: 'cert-1' }) })
  expect(response.status).toBe(200)
  expect(db.certificate.findUnique).toHaveBeenCalledWith({ where: { id: 'cert-1', userId: 'user-1' } })
  expect(certificatePdfResponse).toHaveBeenCalledWith(saved)
})

test('grouping preserves descendants at every level', () => {
  const grouped = groupCourseContents([
    { id: 'third', parentId: 'second' },
    { id: 'first', parentId: null },
    { id: 'second', parentId: 'first' },
  ])
  expect(grouped[0].subContents[0].subContents[0].id).toBe('third')
})

test('course deletion removes descendants before their parents at arbitrary depth', async () => {
  const deletes: string[][] = []
  const tx = {
    certificate: { deleteMany: jest.fn() },
    enrollment: { deleteMany: jest.fn() },
    courseContent: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'root', parentId: null }, { id: 'child', parentId: 'root' }, { id: 'grandchild', parentId: 'child' },
      ]),
      deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => { deletes.push(where.id.in) }),
    },
    lesson: { deleteMany: jest.fn() },
  }
  await deleteCourseDependencies(tx as never, ['course-1'])
  expect(deletes).toEqual([['grandchild'], ['child'], ['root']])
})
