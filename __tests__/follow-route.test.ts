import { POST, DELETE } from '@/app/api/users/[id]/follow/route';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), init);
    }
  },
}));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    follow: { findUnique: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));

const db = prisma as unknown as {
  follow: { findUnique: jest.Mock; deleteMany: jest.Mock };
  $transaction: jest.Mock;
};
const context = { params: Promise.resolve({ id: 'target' }) };

describe('follow concurrency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'actor', name: 'Actor' } });
    db.follow.findUnique.mockResolvedValue(null);
  });

  it('reports a duplicate created by a concurrent request without a server error', async () => {
    db.$transaction.mockRejectedValue({ code: 'P2002' });
    const response = await POST({} as any, context);
    expect(response.status).toBe(400);
  });

  it('creates an actionable notification addressed only to the followed member', async () => {
    const createFollow = jest.fn().mockResolvedValue({ following: { name: 'Target' } });
    const createNotification = jest.fn();
    db.$transaction.mockImplementation(callback => callback({ follow: { create: createFollow }, notification: { create: createNotification } }));
    const response = await POST({} as any, context);
    expect(response.status).toBe(200);
    expect(createNotification).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'target', type: 'FOLLOW', targetType: 'USER', targetId: 'actor',
    }) });
  });

  it('makes repeat unfollows idempotent', async () => {
    db.follow.deleteMany.mockResolvedValue({ count: 0 });
    const response = await DELETE({} as any, context);
    expect(response.status).toBe(200);
    expect(db.follow.deleteMany).toHaveBeenCalledWith({
      where: { followerId: 'actor', followingId: 'target' },
    });
  });
});
