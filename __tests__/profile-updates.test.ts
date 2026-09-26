import { PUT as putPublicProfile } from '@/app/api/users/[id]/profile/route';
import { PUT as putSocial } from '@/app/api/users/[id]/social/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getServerSession as getNextAuthSession } from 'next-auth/next';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), init);
    }
  },
}));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { $transaction: jest.fn(), user: { update: jest.fn() } },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));

const db = prisma as unknown as { $transaction: jest.Mock; user: { update: jest.Mock } };
const tx = {
  user: { update: jest.fn() },
  userSkill: { findMany: jest.fn(), deleteMany: jest.fn(), upsert: jest.fn() },
  skill: { findMany: jest.fn() },
};
const context = { params: Promise.resolve({ id: 'user-1' }) };
function request(body: unknown): any {
  return { headers: { get: () => null }, body: null, json: async () => body };
}

describe('profile mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });
    (getNextAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });
    db.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    tx.user.update.mockResolvedValue({ id: 'user-1', socialLinks: { github: 'https://github.com/user' } });
    tx.userSkill.findMany.mockResolvedValue([{ id: 'user-skill-1', skillId: 'skill-1' }]);
    tx.skill.findMany.mockResolvedValue([{ id: 'skill-1' }]);
  });

  it('writes profile social links together with other fields and returns the saved state', async () => {
    const response = await putPublicProfile(request({
      name: ' Updated ', socialLinks: { github: 'https://github.com/user' },
    }), context);
    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Updated', socialLinks: { github: 'https://github.com/user' } }),
    }));
    expect((await response.json()).user.socialLinks.github).toBe('https://github.com/user');
  });

  it('rejects malformed profile and social URLs before mutation', async () => {
    const profile = await putPublicProfile(request({ socialLinks: { website: 'javascript:alert(1)' } }), context);
    const social = await putSocial(request({ github: 'https://user:password@example.com' }), context);
    expect(profile.status).toBe(400);
    expect(social.status).toBe(400);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('accepts an owned UserSkill.id alias and preserves its endorsement-bearing row', async () => {
    const response = await putPublicProfile(request({
      skills: [{ id: 'user-skill-1', level: 66 }],
    }), context);
    expect(response.status).toBe(200);
    expect(tx.userSkill.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', skillId: { notIn: ['skill-1'] } },
    });
    expect(tx.userSkill.upsert).toHaveBeenCalledWith({
      where: { userId_skillId: { userId: 'user-1', skillId: 'skill-1' } },
      update: { level: 66 },
      create: { userId: 'user-1', skillId: 'skill-1', level: 66 },
    });
  });

  it('accepts a Skill.id and rejects missing skills before deleting or saving anything', async () => {
    const accepted = await putPublicProfile(request({ skills: [{ id: 'skill-1', level: 80 }] }), context);
    expect(accepted.status).toBe(200);
    expect(tx.userSkill.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_skillId: { userId: 'user-1', skillId: 'skill-1' } },
    }));
    jest.clearAllMocks();
    tx.userSkill.findMany.mockResolvedValue([{ id: 'user-skill-1', skillId: 'skill-1' }]);
    tx.skill.findMany.mockResolvedValue([]);
    db.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    const invalid = await putPublicProfile(request({ skills: [{ id: 'missing', level: 5 }] }), context);
    expect(invalid.status).toBe(400);
    expect(tx.userSkill.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
