import { GET } from '@/app/api/search/route';
import prisma from '@/lib/prisma';
import { containsInsensitive } from '@/lib/server/database-query';
import { getServerSession } from 'next-auth';
import { VERIFIED_COURSE_BADGE } from '@/lib/course-achievement-badge';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findMany: jest.fn(), count: jest.fn() },
    course: { findMany: jest.fn() },
    event: { findMany: jest.fn() },
    post: { findMany: jest.fn() },
    resource: { findMany: jest.fn() },
    article: { findMany: jest.fn() },
    project: { findMany: jest.fn() },
  },
}));
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.trim(),
  sanitizeHtmlPreviewServer: (value: string) => value,
}));

const userFindMany = prisma.user.findMany as jest.Mock;
const userCount = prisma.user.count as jest.Mock;

function request(query: string, type = 'member') {
  return { nextUrl: new URL(`http://localhost/api/search?query=${encodeURIComponent(query)}&type=${type}`) } as never;
}

describe('member search privacy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member-1', role: 'USER' } });
    userFindMany.mockResolvedValue([]);
    userCount.mockResolvedValue(0);
    (prisma.course.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.event.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.resource.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.article.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.project.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('does not run a member lookup without authentication', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);

    const response = await GET(request('private@example.com'));

    expect(response.status).toBe(401);
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it.each(['member', 'all'])('never uses email as a member match for %s search', async (type) => {
    const query = 'private@example.com';

    const response = await GET(request(query, type));

    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([]);
    expect(userFindMany).toHaveBeenCalledTimes(1);
    const memberWhere = userFindMany.mock.calls[0][0].where;
    expect(memberWhere.OR).toEqual(expect.arrayContaining([
      { name: containsInsensitive(query) },
      { bio: containsInsensitive(query) },
      { title: containsInsensitive(query) },
      { skills: { some: { skill: { name: containsInsensitive(query) } } } },
    ]));
    expect(memberWhere.OR.some((clause: Record<string, unknown>) => 'email' in clause)).toBe(false);
    expect(userFindMany.mock.calls[0][0].select).not.toHaveProperty('email');
    if (type === 'member') {
      expect(userCount).toHaveBeenCalledWith({ where: memberWhere });
    }
  });

  it('returns a public skill match without leaking a selected email field', async () => {
    userFindMany.mockResolvedValue([{
      id: 'member-2',
      name: 'Ada',
      email: 'ada.private@example.com',
      bio: null,
      title: null,
      image: null,
      role: 'USER',
      endorsements: 0,
      lastLogin: null,
      createdAt: new Date('2026-01-01'),
      _count: { followers: 0, following: 0, posts: 0, courses: 0, projects: 0 },
      skills: [{ level: 80, endorsements: 2, skill: { name: 'TypeScript' } }],
      badges: [],
    }]);
    userCount.mockResolvedValue(1);

    const response = await GET(request('TypeScript'));
    const body = await response.json();

    expect(body.results).toHaveLength(1);
    expect(body.results[0].skills).toEqual([{ name: 'TypeScript', level: 80, endorsements: 2 }]);
    expect(JSON.stringify(body)).not.toContain('ada.private@example.com');
  });

  it('filters only the opted-out course achievement, preserving unrelated badges in search', async () => {
    const badges = [
      { badgeId: VERIFIED_COURSE_BADGE.id, awardedAt: new Date('2026-01-02'), badge: { name: VERIFIED_COURSE_BADGE.name } },
      { badgeId: 'existing-badge', awardedAt: new Date('2026-01-01'), badge: { name: 'Community badge' } },
    ];
    const member = { id: 'member-2', name: 'Ada', bio: null, title: null, image: null, role: 'USER',
      isTestAccount: false, userSettings: { publicRankingOptIn: false }, endorsements: 0,
      lastLogin: null, createdAt: new Date('2026-01-01'),
      _count: { followers: 0, following: 0, posts: 0, courses: 0, projects: 0 },
      skills: [], badges };
    userFindMany.mockResolvedValue([member]);
    userCount.mockResolvedValue(1);

    const privateResponse = await GET(request('Ada'));
    expect((await privateResponse.json()).results[0].badges).toEqual([
      { name: 'Community badge', awardedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(privateResponse.headers.get('Cache-Control')).toBe('private, no-store');
    expect(userFindMany.mock.calls[0][0].select.badges).toMatchObject({ take: 4 });

    userFindMany.mockResolvedValue([{ ...member, userSettings: { publicRankingOptIn: true } }]);
    const publicResponse = await GET(request('Ada'));
    expect((await publicResponse.json()).results[0].badges).toHaveLength(2);

    userFindMany.mockResolvedValue([member]);
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member-2', role: 'USER' } });
    const ownResponse = await GET(request('Ada'));
    expect((await ownResponse.json()).results[0].badges).toHaveLength(2);
  });
});
