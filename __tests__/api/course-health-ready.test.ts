import { GET } from '@/app/api/health/route';
import prisma from '@/lib/prisma';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) },
}));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { user: { count: jest.fn() }, course: { findFirst: jest.fn() } },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prisma.user.count).mockResolvedValue(0);
  jest.mocked(prisma.course.findFirst).mockResolvedValue(null);
});

test('reports ready for a fresh database and checks for unversioned courses', async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(prisma.course.findFirst).toHaveBeenCalledWith({
    where: { draft: { is: null } }, select: { id: true },
  });
});

test('fails readiness instead of silently hiding an old unversioned course', async () => {
  jest.mocked(prisma.course.findFirst).mockResolvedValue({ id: 'legacy' } as never);
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

test('fails readiness if the expected schema or database is unavailable', async () => {
  jest.mocked(prisma.course.findFirst).mockRejectedValue(new Error('Missing CourseDraft table'));
  expect((await GET()).status).toBe(503);
});
