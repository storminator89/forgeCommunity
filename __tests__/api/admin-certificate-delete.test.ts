/** @jest-environment node */
import { DELETE } from '@/app/api/admin/users/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { deleteCourseDependencies } from '@/lib/server/course-deletion';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value), init); }
  },
}));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  user: { findUnique: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/course-deletion', () => ({ deleteCourseDependencies: jest.fn() }));
jest.mock('@/lib/server/skill-endorsements', () => ({ decrementSkillEndorsementsForDeletedUser: jest.fn() }));

const db = prisma as unknown as { user: { findUnique: jest.Mock }; $transaction: jest.Mock };
const user = { findUnique: jest.fn(), count: jest.fn(), delete: jest.fn() };
const course = { findMany: jest.fn(), deleteMany: jest.fn() };
const certificate = { findFirst: jest.fn(), deleteMany: jest.fn() };
const userSettings = { deleteMany: jest.fn() };
const endorsement = { findMany: jest.fn(), deleteMany: jest.fn() };
const otherDeleteMany = jest.fn();
const tx = new Proxy({ user, course, certificate, userSettings, endorsement }, {
  get(target, key) { return target[key as keyof typeof target] ?? { deleteMany: otherDeleteMany }; },
});
const request = () => new Request('http://localhost/api/admin/users/teacher', { method: 'DELETE' }) as never;
const params = { params: Promise.resolve({ id: 'teacher' }) };

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } } as never);
  db.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
  user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ role: where.id === 'admin' ? 'ADMIN' : 'INSTRUCTOR' }));
  user.count.mockResolvedValue(2);
  user.delete.mockResolvedValue({ id: 'teacher' });
  course.findMany.mockResolvedValue([{ id: 'course-1' }]);
  certificate.findFirst.mockResolvedValue(null);
  endorsement.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
});

test('blocks instructor deletion before any write if another learner has a certificate', async () => {
  certificate.findFirst.mockResolvedValue({ id: 'learner-certificate' });
  const response = await DELETE(request(), params);
  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/andere Mitglieder Zertifikate/);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  expect(certificate.findFirst).toHaveBeenCalledWith({
    where: { courseId: { in: ['course-1'] }, userId: { not: 'teacher' } }, select: { id: true },
  });
  expect(userSettings.deleteMany).not.toHaveBeenCalled();
  expect(certificate.deleteMany).not.toHaveBeenCalled();
  expect(course.deleteMany).not.toHaveBeenCalled();
  expect(deleteCourseDependencies).not.toHaveBeenCalled();
  expect(user.delete).not.toHaveBeenCalled();
});

test('does not block deletion for certificates belonging only to the deleted account', async () => {
  // The guard explicitly excludes the target account; its own certificates
  // are deleted by the existing account-erasure path.
  const response = await DELETE(request(), params);
  expect(response.status).toBe(200);
  expect(certificate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ userId: { not: 'teacher' } }),
  }));
  expect(certificate.deleteMany).toHaveBeenCalledWith({ where: { userId: 'teacher' } });
  expect(deleteCourseDependencies).toHaveBeenCalledTimes(1);
  expect(jest.mocked(deleteCourseDependencies).mock.calls[0][0]).toBe(tx);
  expect(jest.mocked(deleteCourseDependencies).mock.calls[0][1]).toEqual(['course-1']);
  expect(course.deleteMany).toHaveBeenCalledWith({ where: { instructorId: 'teacher' } });
  expect(user.delete).toHaveBeenCalledWith({ where: { id: 'teacher' } });
});

test('rechecks newly issued third-party certificates after a serialization conflict', async () => {
  certificate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'new-certificate' });
  user.delete.mockRejectedValueOnce({ code: 'P2034' });
  const response = await DELETE(request(), params);
  expect(response.status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(course.findMany).toHaveBeenCalledTimes(2);
  expect(certificate.findFirst).toHaveBeenCalledTimes(2);
  expect(user.delete).toHaveBeenCalledTimes(1);
});

test('preserves authentication and administrator boundaries', async () => {
  jest.mocked(getServerSession).mockResolvedValueOnce(null as never);
  expect((await DELETE(request(), params)).status).toBe(401);
  expect(db.$transaction).not.toHaveBeenCalled();

  db.user.findUnique.mockResolvedValue({ role: 'USER' });
  expect((await DELETE(request(), params)).status).toBe(403);
  expect(db.$transaction).not.toHaveBeenCalled();
});

test('returns 409 after bounded serialization failures without claiming deletion', async () => {
  db.$transaction.mockRejectedValue({ code: 'P2034' });
  const response = await DELETE(request(), params);
  expect(response.status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(4);
  expect(user.delete).not.toHaveBeenCalled();
});
