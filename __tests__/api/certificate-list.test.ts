import { GET } from '@/app/api/user/certificates/route'
import prisma from '@/lib/prisma'
import { getServerSession } from '@/lib/sites-auth/server'

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
  user: { findUnique: jest.fn() },
  certificate: { findMany: jest.fn() },
} }))
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))

const db = prisma as unknown as {
  user: { findUnique: jest.Mock };
  certificate: { findMany: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'learner@example.test' } })
  db.user.findUnique.mockResolvedValue({ id: 'user-1' })
})

test('lists the latest certificate per course, newest first with a stable ID tie-breaker', async () => {
  // A provider can return distinct rows in a different order. The API response
  // must remain newest-first rather than inheriting course order.
  db.certificate.findMany.mockResolvedValue([
    { id: 'cert-b', courseId: '00000000-course', issuedAt: new Date('2023-06-01T00:00:00Z') },
    { id: 'cert-a', courseId: 'ffffffff-course', issuedAt: new Date('2024-01-01T00:00:00Z') },
    { id: 'cert-z', courseId: 'other-course', issuedAt: new Date('2024-01-01T00:00:00Z') },
  ])

  const response = await GET()
  expect(response.status).toBe(200)
  expect((await response.json()).map((certificate: { id: string }) => certificate.id)).toEqual([
    'cert-z', 'cert-a', 'cert-b',
  ])
  expect(db.certificate.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: 'user-1' },
    distinct: ['courseId'],
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
  }))
})
