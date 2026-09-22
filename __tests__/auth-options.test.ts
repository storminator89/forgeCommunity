jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock('@next-auth/prisma-adapter', () => ({
  PrismaAdapter: () => ({}),
}));
jest.mock('next-auth', () => ({}));
jest.mock('next-auth/providers/credentials', () => ({
  __esModule: true,
  default: (options: unknown) => options,
}));
jest.mock('next-auth/providers/google', () => ({
  __esModule: true,
  default: (options: unknown) => options,
}));
jest.mock('bcrypt', () => ({ compare: jest.fn() }));
jest.mock('@prisma/client', () => ({ Prisma: {} }));

import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';

const mockPrisma = prisma as unknown as {
  user: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const user = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Database Name',
  role: 'USER',
  image: null,
  title: null,
  bio: null,
  contact: null,
  endorsements: 0,
  emailVerified: null,
  lastLogin: null,
  userSettings: null,
};

describe('NextAuth identity claims', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores session update claims and refreshes role from the database', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const jwt = authOptions.callbacks?.jwt;
    const token = await jwt?.({
      token: { id: user.id, role: 'USER' },
      user: undefined,
      trigger: 'update',
      session: {
        user: { id: 'attacker-id', role: 'ADMIN', email: 'attacker@example.com' },
      },
    } as any);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: user.id } }),
    );
    expect(token).toEqual(expect.objectContaining({
      id: user.id,
      role: 'USER',
      email: user.email,
    }));
    expect(token).not.toEqual(expect.objectContaining({
      id: 'attacker-id',
      role: 'ADMIN',
    }));
  });

  it('invalidates a token for a deleted account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const jwt = authOptions.callbacks?.jwt;
    const token = await jwt?.({
      token: { id: user.id, role: 'ADMIN' },
      user: undefined,
      trigger: 'session',
    } as any);
    const session = await authOptions.callbacks?.session?.({
      session: { user: { id: user.id }, expires: '2099-01-01T00:00:00.000Z' },
      token: token as any,
    } as any);

    expect(token).toEqual({});
    expect(session).toBeNull();
  });
});
