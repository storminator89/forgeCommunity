/** @jest-environment node */
import { GET } from '@/app/api/skills/directory/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    }
  }
  return { NextResponse: MockNextResponse };
});
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: { skill: { findMany: jest.fn() }, user: { findMany: jest.fn() } } }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

const database = prisma as unknown as { skill: { findMany: jest.Mock }; user: { findMany: jest.Mock } };

beforeEach(() => { jest.clearAllMocks(); });

it('requires an authenticated viewer before querying the directory', async () => {
  (getServerSession as jest.Mock).mockResolvedValue(null);
  const response = await GET();
  expect(response.status).toBe(401);
  expect(database.user.findMany).not.toHaveBeenCalled();
  expect(database.skill.findMany).not.toHaveBeenCalled();
});

it('returns compatible skill and endorsement data without contact or credentials', async () => {
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'viewer' } });
  database.skill.findMany.mockResolvedValue([{ id: 'skill-1', name: 'TypeScript', category: 'Technik' }]);
  database.user.findMany.mockResolvedValue([{
    id: 'member-1', name: 'Ada', image: null, title: 'Entwicklerin', endorsements: 2,
    email: 'private@example.test', password: 'private-hash', contact: 'private-contact',
    skills: [{ level: 70, skill: { name: 'TypeScript' } }], endorsementsReceived: [{ id: 'endorsement-1' }],
  }]);
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(body).toEqual({
    skills: [{ id: 'skill-1', name: 'TypeScript', category: 'Technik' }],
    members: [{ id: 'member-1', name: 'Ada', avatar: '', title: 'Entwicklerin', endorsements: 2, hasEndorsed: true, skills: [{ skillName: 'TypeScript', level: 70 }] }],
  });
  expect(database.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    select: expect.not.objectContaining({ email: true, password: true, contact: true, bio: true }),
  }));
  expect(database.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    select: expect.objectContaining({ endorsementsReceived: expect.objectContaining({ where: { endorserId: 'viewer' } }) }),
  }));
});
