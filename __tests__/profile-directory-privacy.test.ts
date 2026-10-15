import { GET } from '@/app/api/users/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), init);
    }
  },
}));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: { user: { findUnique: jest.fn() } } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));

const user = {
  id: 'author', name: 'Ada', email: 'private@example.org', password: 'private-hash',
  verificationToken: 'private-token', resetPasswordToken: 'reset-token',
  image: null, coverImage: '/images/uploads/cover.png', bio: 'Hallo', title: 'Designerin',
  contact: 'public@example.org', role: 'USER', endorsements: 3,
  createdAt: new Date('2026-01-01'), lastLogin: new Date('2026-05-01'), socialLinks: {},
  skills: [], badges: [], followers: [], endorsementsReceived: [{ id: 'endorsement-1' }],
  _count: { followers: 2, following: 1, posts: 4, courses: 0, projects: 3, articles: 0 },
};
const params = { params: Promise.resolve({ id: 'author' }) };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
});

it('requires sign-in before reading a member profile', async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  const response = await GET({} as never, params);
  expect(response.status).toBe(401);
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
});

it('keeps account email, last login, and recovery fields out of another member\'s response', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'viewer' } } as never);
  const response = await GET({} as never, params);
  const body = await response.json();
  expect(body).toEqual(expect.objectContaining({ id: 'author', coverImage: '/images/uploads/cover.png', hasEndorsed: true, isCurrentUser: false }));
  expect(body).not.toHaveProperty('email');
  expect(body).not.toHaveProperty('lastLogin');
  expect(body).not.toHaveProperty('password');
  expect(body).not.toHaveProperty('verificationToken');
  expect(body).not.toHaveProperty('resetPasswordToken');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    select: expect.objectContaining({
      email: false,
      lastLogin: false,
      _count: expect.objectContaining({ select: expect.objectContaining({
        posts: { where: { published: true } },
        articles: { where: { isPublished: true } },
      }) }),
    }),
  }));
  const selection = jest.mocked(prisma.user.findUnique).mock.calls[0][0].select as Record<string, unknown>;
  expect(selection).not.toHaveProperty('password');
  expect(selection).not.toHaveProperty('verificationToken');
  expect(selection).not.toHaveProperty('resetPasswordToken');
});

it('keeps account-owned fields available on the owner’s profile', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'author' } } as never);
  const response = await GET({} as never, params);
  const body = await response.json();
  expect(body.email).toBe('private@example.org');
  expect(body.lastLogin).toBe('2026-05-01T00:00:00.000Z');
  expect(body.isCurrentUser).toBe(true);
  expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ email: true, lastLogin: true }) }));
});
