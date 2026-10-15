/** @jest-environment node */
import { Prisma } from '@prisma/client';
import { DELETE } from '@/app/api/courses/[courseId]/route';
import { deleteCourseDependencies } from '@/lib/server/course-deletion';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), {
        ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      });
    }
  }
  return { NextResponse: MockNextResponse };
});
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  course: { findUnique: jest.fn(), delete: jest.fn() },
  user: { findUnique: jest.fn() },
  certificate: { findFirst: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/course-deletion', () => ({ deleteCourseDependencies: jest.fn() }));

const db = prisma as unknown as {
  course: { findUnique: jest.Mock; delete: jest.Mock };
  user: { findUnique: jest.Mock };
  certificate: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};
const params = { params: Promise.resolve({ courseId: 'course-1' }) };
const request = () => new Request('http://localhost/api/courses/course-1', { method: 'DELETE' }) as never;
const conflict = () => new Prisma.PrismaClientKnownRequestError('serialization conflict', { code: 'P2034', clientVersion: 'test' });

beforeEach(() => {
  jest.resetAllMocks();
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'owner', role: 'INSTRUCTOR' } });
  db.course.findUnique.mockResolvedValue({ instructorId: 'owner' });
  db.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
  db.certificate.findFirst.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => unknown) => work(db));
});

test('owner deletion checks the current course and revokes rewards in a serializable transaction', async () => {
  const response = await DELETE(request(), params);
  expect(response.status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
  expect(db.course.findUnique).toHaveBeenCalledWith({ where: { id: 'course-1' }, select: { instructorId: true } });
  expect(deleteCourseDependencies).toHaveBeenCalledWith(db, ['course-1']);
  expect(db.course.delete).toHaveBeenCalledWith({ where: { id: 'course-1' } });
  expect(db.user.findUnique).not.toHaveBeenCalled();
});

test('rejects a stranger and a stale admin role before touching rewards', async () => {
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'other', role: 'USER' } });
  expect((await DELETE(request(), params)).status).toBe(403);
  expect(deleteCourseDependencies).not.toHaveBeenCalled();

  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'former-admin', role: 'ADMIN' } });
  db.user.findUnique.mockResolvedValue({ role: 'USER' });
  expect((await DELETE(request(), params)).status).toBe(403);
  expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 'former-admin' }, select: { role: true } });
  expect(deleteCourseDependencies).not.toHaveBeenCalled();
});

test('still permits a current admin to delete another instructor’s course', async () => {
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } });
  const response = await DELETE(request(), params);
  expect(response.status).toBe(200);
  expect(deleteCourseDependencies).toHaveBeenCalledTimes(1);
});

test('rejects issued certificates without running the cascade', async () => {
  db.certificate.findFirst.mockResolvedValue({ id: 'issued' });
  const response = await DELETE(request(), params);
  expect(response.status).toBe(409);
  expect(deleteCourseDependencies).not.toHaveBeenCalled();
  expect(db.course.delete).not.toHaveBeenCalled();
});

test('retries a serialization failure from the first course and permission read', async () => {
  db.course.delete.mockRejectedValueOnce(conflict());
  const response = await DELETE(request(), params);
  expect(response.status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(db.course.findUnique).toHaveBeenCalledTimes(2);
  expect(db.certificate.findFirst).toHaveBeenCalledTimes(2);
  expect(db.course.delete).toHaveBeenCalledTimes(2);
});

test('a course removed before the retry returns 404 rather than deleting stale data', async () => {
  db.course.delete.mockRejectedValueOnce(conflict());
  db.course.findUnique.mockResolvedValueOnce({ instructorId: 'owner' }).mockResolvedValueOnce(null);
  const response = await DELETE(request(), params);
  expect(response.status).toBe(404);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(deleteCourseDependencies).toHaveBeenCalledTimes(1);
  expect(db.course.delete).toHaveBeenCalledTimes(1);
});

test('a changed owner or newly issued certificate blocks a conflicted retry', async () => {
  db.course.delete.mockRejectedValueOnce(conflict());
  db.course.findUnique.mockResolvedValueOnce({ instructorId: 'owner' }).mockResolvedValueOnce({ instructorId: 'other' });
  expect((await DELETE(request(), params)).status).toBe(403);
  expect(deleteCourseDependencies).toHaveBeenCalledTimes(1);

  jest.clearAllMocks();
  db.course.findUnique.mockResolvedValue({ instructorId: 'owner' });
  db.certificate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'issued' });
  db.course.delete.mockRejectedValueOnce(conflict());
  expect((await DELETE(request(), params)).status).toBe(409);
  expect(deleteCourseDependencies).toHaveBeenCalledTimes(1);
  expect(db.course.delete).toHaveBeenCalledTimes(1);
});

test('returns retryable 409 after bounded serialization conflicts', async () => {
  db.$transaction.mockRejectedValue(conflict());
  const response = await DELETE(request(), params);
  expect(response.status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(4);
  expect(deleteCourseDependencies).not.toHaveBeenCalled();
});
