import { GET } from '@/app/api/users/[id]/activity/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { readPagination } from '@/lib/server/pagination';

jest.mock('next/server', () => ({ NextResponse: { json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  post: { findMany: jest.fn() }, comment: { findMany: jest.fn() },
  project: { findMany: jest.fn() }, course: { findMany: jest.fn() },
} }));
const db = prisma as unknown as Record<string, { findMany: jest.Mock }>;
beforeEach(() => {
  jest.clearAllMocks();
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'reader', role: 'USER' } });
  for (const model of Object.values(db)) model.findMany.mockResolvedValue([]);
});
it('paginates the merged chronological feed without skipping each source separately', async () => {
  const post = (id: string, day: number) => ({ id, createdAt: new Date(2026, 0, day), author: {}, _count: { comments: 0, likePosts: 0 } });
  db.post.findMany.mockResolvedValue([post('p6', 6), post('p3', 3), post('p1', 1)]);
  db.comment.findMany.mockResolvedValue([{ id: 'c5', createdAt: new Date(2026, 0, 5), post: {}, author: {} }]);
  db.project.findMany.mockResolvedValue([{ id: 'j4', createdAt: new Date(2026, 0, 4), author: {}, _count: {} }]);
  const response = await GET(new Request('http://localhost/api/users/u/activity?page=2&limit=2') as never, { params: Promise.resolve({ id: 'u' }) });
  const body = await response.json();
  expect(body.activities.map((a: { id: string }) => a.id)).toEqual(['j4', 'p3']);
  expect(body.pagination.hasMore).toBe(true);
  expect(db.post.findMany.mock.calls[0][0]).toMatchObject({ take: 5, where: { published: true } });
  expect(db.post.findMany.mock.calls[0][0].skip).toBeUndefined();
});
it.each(['page=0', 'page=-1', 'page=101', 'page=1x', 'limit=0', 'limit=51', 'limit=1.5'])('rejects invalid or unbounded pagination: %s', (query) => {
  expect(() => readPagination(new URLSearchParams(query))).toThrow();
});
