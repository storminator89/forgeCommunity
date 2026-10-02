import { GET, POST } from '@/app/api/courses/[courseId]/contents/route';
import { PUT, DELETE } from '@/app/api/courses/[courseId]/contents/[contentId]/route';
import { PUT as reorder } from '@/app/api/courses/[courseId]/contents/[contentId]/reorder/route';
import { PUT as move } from '@/app/api/courses/[courseId]/contents/[contentId]/move/route';
import { groupCourseContents } from '@/lib/server/group-course-contents';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/request-body', () => ({ requestWithBodyLimit: async (request: Request) => request, RequestBodyLimitError: class extends Error {} }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  course: { findUnique: jest.fn() }, enrollment: { findUnique: jest.fn() },
  courseContent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  $transaction: jest.fn(),
} }));

type Node = { id: string; courseId: string; parentId: string | null; title: string; content: string; type: string | null; order: number };
let nodes: Node[];
const db = prisma as unknown as {
  course: { findUnique: jest.Mock }; enrollment: { findUnique: jest.Mock };
  courseContent: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
  $transaction: jest.Mock;
};
function node(id: string, parentId: string | null = null, order = 1, extra: Partial<Node> = {}): Node {
  return { id, parentId, order, courseId: 'course-1', title: id, content: '<p>Content</p>', type: 'TEXT', ...extra };
}
function request(body?: unknown) { return { json: async () => body } as never; }
const courseParams = { params: Promise.resolve({ courseId: 'course-1' }) };
function params(contentId: string) { return { params: Promise.resolve({ courseId: 'course-1', contentId }) }; }

beforeEach(() => {
  jest.clearAllMocks();
  nodes = [];
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'teacher', role: 'INSTRUCTOR' } } as never);
  db.course.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'course-1' ? { instructorId: 'teacher' } : null);
  db.enrollment.findUnique.mockResolvedValue(null);
  db.courseContent.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const found = nodes.find(item => item.id === where.id);
    return found ? { ...found, course: { instructorId: 'teacher' } } : null;
  });
  db.courseContent.findMany.mockImplementation(async ({ where }: { where: { courseId?: string; parentId?: string | null } }) => nodes.filter(item =>
    (where.courseId === undefined || item.courseId === where.courseId) && (where.parentId === undefined || item.parentId === where.parentId),
  ).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(item => ({ ...item })));
  db.courseContent.create.mockImplementation(async ({ data }: { data: Omit<Node, 'id'> }) => {
    const created = { ...data, id: 'new-content' }; nodes.push(created); return { ...created };
  });
  db.courseContent.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Node> }) => {
    const existing = nodes.find(item => item.id === where.id)!; Object.assign(existing, data); return { ...existing };
  });
  db.courseContent.deleteMany.mockImplementation(async ({ where }: { where: { id: { in: string[] }; courseId: string } }) => {
    nodes = nodes.filter(item => item.courseId !== where.courseId || !where.id.in.includes(item.id));
  });
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => {
    const saved = nodes.map(item => ({ ...item }));
    try { return await work(db); } catch (error) { nodes = saved; throw error; }
  });
});

test('learner reads enrolled contents but cannot mutate any content endpoint', async () => {
  nodes = [node('root')];
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'student', role: 'USER' } } as never);
  expect((await GET(request(), courseParams)).status).toBe(403);
  db.enrollment.findUnique.mockResolvedValue({ id: 'enrollment' });
  expect((await GET(request(), courseParams)).status).toBe(200);
  for (const response of [
    await POST(request({ title: 'New' }), courseParams),
    await PUT(request({ title: 'New' }), params('root')),
    await DELETE(request(), params('root')),
    await reorder(request({ mainContentId: null, direction: 'up' }), params('root')),
    await move(request({ targetId: 'target', position: 'inside' }), params('root')),
  ]) expect(response.status).toBe(403);
  expect(nodes[0].title).toBe('root');
  expect(db.courseContent.update).not.toHaveBeenCalled();
  expect(db.courseContent.deleteMany).not.toHaveBeenCalled();
});

test('creation rejects empty sanitized titles, enum coercion and out-of-range order', async () => {
  for (const invalid of [
    { title: '<script>bad</script>' }, { title: 'New', type: ['TEXT'] },
    { title: 'New', order: 2_147_483_648 }, { title: 'New', parentId: '' },
  ]) expect((await POST(request(invalid), courseParams)).status).toBe(400);
  expect(db.courseContent.create).not.toHaveBeenCalled();
});

test('creation inserts into its sibling list and resolves existing order collisions', async () => {
  nodes = [node('a'), node('b')];
  const response = await POST(request({ title: 'Inserted', order: 2 }), courseParams);
  expect(response.status).toBe(201);
  expect(nodes.find(item => item.id === 'a')?.order).toBe(1);
  expect(nodes.find(item => item.id === 'new-content')?.order).toBe(2);
  expect(nodes.find(item => item.id === 'b')?.order).toBe(3);
});

test('quiz drafts roundtrip with logical QUIZ type while preserving TEXT database storage', async () => {
  const response = await POST(request({ title: 'Quiz', type: 'QUIZ', content: '' }), courseParams);
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ type: 'QUIZ', content: '{"questions":[]}' });
  expect(nodes[0]).toMatchObject({ type: 'TEXT', content: '{"questions":[]}' });
  expect(await (await GET(request(), courseParams)).json()).toEqual([expect.objectContaining({ type: 'QUIZ' })]);
  const invalid = await PUT(request({ type: 'QUIZ', content: '{broken' }), params('new-content'));
  expect(invalid.status).toBe(400);
  expect(nodes[0].content).toBe('{"questions":[]}');
});

test('updates preserve unspecified fields and reject moving below descendants or foreign parents', async () => {
  nodes = [node('root'), node('child', 'root'), node('foreign', null, 1, { courseId: 'course-2' })];
  expect((await PUT(request({ title: 'Renamed' }), params('root'))).status).toBe(200);
  expect(nodes[0]).toMatchObject({ title: 'Renamed', content: '<p>Content</p>', parentId: null });
  expect((await PUT(request({ parentId: 'child' }), params('root'))).status).toBe(400);
  expect((await PUT(request({ parentId: 'foreign' }), params('root'))).status).toBe(400);
  expect(nodes[0].parentId).toBeNull();
});

test('changing a parent appends after destination siblings and normalizes both lists', async () => {
  nodes = [node('root'), node('destination', null, 2), node('moved', 'root', 5), node('old-sibling', 'root', 7), node('destination-child', 'destination', 9)];
  const response = await PUT(request({ parentId: 'destination' }), params('moved'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ parentId: 'destination', order: 2 });
  expect(nodes.find(item => item.id === 'old-sibling')?.order).toBe(1);
  expect(nodes.find(item => item.id === 'destination-child')?.order).toBe(1);
});

test('root reorder swaps tied legacy ranks and returns the complete authoritative tree', async () => {
  nodes = [node('a'), node('b'), node('child', 'b')];
  const response = await reorder(request({ direction: 'up', mainContentId: null }), params('b'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.contents.map((item: Node) => item.id)).toEqual(['b', 'a']);
  expect(body.contents[0].subContents[0].id).toBe('child');
  expect(nodes.find(item => item.id === 'b')?.order).toBe(1);
  expect(nodes.find(item => item.id === 'a')?.order).toBe(2);
});

test('reorder validates actual parent, course and boundaries without writes', async () => {
  nodes = [node('parent'), node('child', 'parent'), node('foreign', null, 1, { courseId: 'course-2' })];
  expect((await reorder(request({ direction: 'up', mainContentId: 'wrong-parent' }), params('child'))).status).toBe(404);
  expect((await reorder(request({ direction: 'up', mainContentId: 'parent' }), params('child'))).status).toBe(400);
  expect((await reorder(request({ direction: 'up', mainContentId: null }), params('foreign'))).status).toBe(404);
  expect(db.courseContent.update).not.toHaveBeenCalled();
});

test('deletion removes a complete nested branch leaf-first and normalizes remaining siblings', async () => {
  nodes = [node('root'), node('child', 'root'), node('grandchild', 'child'), node('other', null, 8)];
  const response = await DELETE(request(), params('root'));
  expect(response.status).toBe(200);
  expect(nodes).toEqual([expect.objectContaining({ id: 'other', order: 1 })]);
  expect(db.courseContent.deleteMany.mock.calls.map(([args]) => args.where.id.in)).toEqual([['grandchild'], ['child'], ['root']]);
});

test('deletion refuses corrupt cyclic hierarchy atomically instead of partially deleting', async () => {
  nodes = [node('a', 'b'), node('b', 'a'), node('leaf', 'a')];
  const response = await DELETE(request(), params('a'));
  expect(response.status).toBe(409);
  expect(nodes.map(item => item.id)).toEqual(['a', 'b', 'leaf']);
});

test('tree grouping keeps every orphan/cyclic record visible, nested descendants attached and order deterministic', () => {
  const result = groupCourseContents([node('z', null, 9), node('b', 'a'), node('a', 'b'), node('child', 'a'), node('orphan', 'gone', 3)]);
  expect(result.map(item => item.id)).toEqual(['a', 'b', 'orphan', 'z']);
  expect(result[0].subContents[0].id).toBe('child');
  expect(() => JSON.stringify(result)).not.toThrow();
});


test('cross-course update/delete cannot access a record even for an admin', async () => {
  nodes = [node('foreign', null, 1, { courseId: 'course-2' })];
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } } as never);
  expect((await PUT(request({ title: 'Wrong course' }), params('foreign'))).status).toBe(404);
  expect((await DELETE(request(), params('foreign'))).status).toBe(404);
  expect(nodes[0].title).toBe('foreign');
});

test('serialization conflicts retry and exhausted retries return a recoverable conflict', async () => {
  nodes = [node('root')];
  const conflict = new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' });
  db.$transaction.mockRejectedValueOnce(conflict);
  expect((await PUT(request({ title: 'Renamed' }), params('root'))).status).toBe(200);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(nodes[0].title).toBe('Renamed');
  db.$transaction.mockClear().mockRejectedValue(conflict);
  const response = await PUT(request({ title: 'Not saved' }), params('root'));
  expect(response.status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(4);
  expect(nodes[0].title).toBe('Renamed');
});

test('moving across parents preserves descendants and normalizes origin and destination ranks', async () => {
  nodes = [node('root'), node('target', null, 2), node('moved', 'root', 8), node('old-sibling', 'root', 9), node('grandchild', 'moved'), node('target-child', 'target', 5)];
  const response = await move(request({ targetId: 'target', position: 'inside' }), params('moved'));
  expect(response.status).toBe(200);
  expect(nodes.find(item => item.id === 'moved')).toMatchObject({ parentId: 'target', order: 2 });
  expect(nodes.find(item => item.id === 'old-sibling')?.order).toBe(1);
  const body = await response.json();
  expect(body.find((item: Node) => item.id === 'target').subContents[1].subContents[0].id).toBe('grandchild');
});


test('media URLs retain query separators and H5P iframe imports keep only their safe source', async () => {
  nodes = [node('audio', null, 1, { type: 'AUDIO', content: '' }), node('h5p', null, 2, { type: 'H5P', content: '' })];
  const url = 'https://soundcloud.com/artist/track?token=a&expires=123';
  expect((await PUT(request({ content: url }), params('audio'))).status).toBe(200);
  expect(nodes[0].content).toBe(url);
  const embed = '<iframe src="https://example.org/h5p/embed/12?token=a&expires=123" onload="alert(1)"></iframe>';
  expect((await PUT(request({ content: embed }), params('h5p'))).status).toBe(200);
  expect(nodes[1].content).toBe('https://example.org/h5p/embed/12?token=a&expires=123');
  expect((await PUT(request({ content: '<iframe src="javascript:alert(1)"></iframe>' }), params('h5p'))).status).toBe(400);
  expect((await PUT(request({ content: 'javascript:alert(1)' }), params('audio'))).status).toBe(400);
});


test('legacy nullable content type presents ordinary rich text as TEXT without rewriting data', async () => {
  nodes = [node('legacy', null, 1, { type: null })];
  const response = await GET(request(), courseParams);
  expect(await response.json()).toEqual([expect.objectContaining({ type: 'TEXT' })]);
  expect(nodes[0].type).toBeNull();
});
