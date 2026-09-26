import { POST } from '@/app/api/admin/users/route';
import { DELETE, PUT } from '@/app/api/admin/users/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcrypt';

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
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('bcrypt', () => ({ __esModule: true, default: { hash: jest.fn() } }));

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
};
const tx = {
  user: { findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
};
function request(body: unknown): any {
  return {
    headers: { get: () => null }, body: null,
    json: async () => body,
  };
}

const valid = {
  name: 'Admin', email: 'admin@example.com',
  password: 'SufficientPass1!', role: 'ADMIN',
};

describe('admin account mutations', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    db.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    db.user.findFirst.mockResolvedValue(null);
    (bcrypt.hash as jest.Mock).mockResolvedValue('bcrypt-hash');
    db.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    tx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === 'admin-1' ? { role: 'ADMIN' } : { role: 'ADMIN' }));
    tx.user.count.mockResolvedValue(1);
    tx.user.update.mockResolvedValue({ id: 'admin-1', password: 'hash', role: 'ADMIN' });
  });

  it('rejects weak and bcrypt-truncated passwords before hashing', async () => {
    for (const password of ['short', `${'é'.repeat(37)}Aa1!`]) {
      const result = await POST(request({ ...valid, password }));
      expect(result.status).toBe(400);
    }
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('keeps the last admin when a role edit would demote them', async () => {
    db.user.findUnique.mockResolvedValue({ role: 'ADMIN', email: valid.email });
    const result = await PUT(request({ ...valid, role: 'USER', password: undefined }), {
      params: Promise.resolve({ id: 'admin-1' }),
    });
    expect(result.status).toBe(400);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('returns a conflict when serializable transactions detect concurrent admin edits', async () => {
    db.user.findUnique.mockResolvedValue({ role: 'ADMIN', email: valid.email });
    db.$transaction.mockRejectedValue({ code: 'P2034' });
    const result = await PUT(request({ ...valid, role: 'USER', password: undefined }), {
      params: Promise.resolve({ id: 'admin-1' }),
    });
    expect(result.status).toBe(409);
  });

  it('decrements recipients before removing a departing user’s endorsements', async () => {
    const order: string[] = [];
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const user = {
      findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
      count: jest.fn().mockResolvedValue(2),
      updateMany: jest.fn().mockImplementation(async () => { order.push('decrement'); return { count: 1 }; }),
      delete: jest.fn().mockResolvedValue({ id: 'user-2' }),
    };
    const endorsement = {
      findMany: jest.fn().mockResolvedValue([{ endorsedId: 'user-3' }]),
      deleteMany: jest.fn().mockImplementation(async () => { order.push('delete'); return { count: 1 }; }),
    };
    const client = new Proxy({}, {
      get: (_target, property) => {
        if (property === 'user') return user;
        if (property === 'endorsement') return endorsement;
        if (property === 'skillEndorsement') return { groupBy: async () => [] };
        if (property === 'course') return { findMany: async () => [], deleteMany };
        return { deleteMany };
      },
    });
    db.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(client));
    const response = await DELETE(request({}), { params: Promise.resolve({ id: 'user-2' }) });
    expect(response.status).toBe(200);
    expect(user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-3', endorsements: { gte: 1 } },
      data: { endorsements: { decrement: 1 } },
    });
    expect(order).toEqual(['decrement', 'delete']);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
});
