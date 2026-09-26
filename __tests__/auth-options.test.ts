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
  password: '$2b$12$first',
};

describe('NextAuth identity claims', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXTAUTH_SECRET = 'test-auth-secret';
    mockPrisma.user.update.mockResolvedValue(user);
  });

  it('ignores session update claims and refreshes role from the database', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const jwt = authOptions.callbacks?.jwt;
    const initial = await jwt?.({
      token: { sub: user.id },
      user: { id: user.id },
      account: { provider: 'credentials' },
    } as any);
    const token = await jwt?.({
      token: { ...initial, role: 'USER' },
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

  it('revokes existing credentials JWTs after a password update', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const jwt = authOptions.callbacks?.jwt;
    const oldToken = await jwt?.({
      token: { sub: user.id }, user: { id: user.id },
      account: { provider: 'credentials' },
    } as any);
    expect((oldToken as any).passwordFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(oldToken)).not.toContain(user.password);

    mockPrisma.user.findUnique.mockResolvedValue({ ...user, password: '$2b$12$changed' });
    expect(await jwt?.({ token: oldToken, trigger: 'session' } as any)).toEqual({});
  });

  it('preserves OAuth JWTs across password updates and rejects old unmarked JWTs', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const jwt = authOptions.callbacks?.jwt;
    const oauthToken = await jwt?.({
      token: { sub: user.id }, user: { id: user.id }, account: { provider: 'google' },
    } as any);
    mockPrisma.user.findUnique.mockResolvedValue({ ...user, password: '$2b$12$changed' });
    expect(await jwt?.({ token: oauthToken } as any)).toEqual(expect.objectContaining({ id: user.id }));
    expect(await jwt?.({ token: { sub: user.id, role: 'ADMIN' } } as any)).toEqual({});
  });
});
