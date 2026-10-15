/** @jest-environment node */
import { GET as getPosts, POST as createPost } from '@/app/api/posts/route';
import { GET as getComments, POST as createComment } from '@/app/api/posts/[postId]/comments/route';
import { GET as getPost, PUT as editPost } from '@/app/api/posts/[postId]/route';
import { POST as likePost } from '@/app/api/posts/[postId]/like/route';
import { GET as getLinkedComment } from '@/app/api/posts/linked-comment/[commentId]/route';
import { GET as getStats } from '@/app/api/posts/me/stats/route';
import { GET as getTopics } from '@/app/api/posts/topics/route';
import { encodeCommunityCursor } from '@/lib/server/community-feed';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
// Sanitization has its own tests. Keep this real-DB suite focused on bounded
// query shapes, pagination, privacy, and complete mutation response shapes.
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').trim(),
  sanitizeRichHtmlServer: (value: string) => value,
}));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-community-feed-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const timestamp = new Date('2026-01-01T12:00:00.000Z');
const params = (postId: string) => ({ params: Promise.resolve({ postId }) });
const request = (path: string, body?: object, method = 'POST') => new Request(`http://localhost${path}`, body ? {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
} : undefined) as never;
const viewer = (id: string, role = 'USER') => jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
const makePosts = (count: number, authorId = 'author', published = true) => prisma.post.createMany({ data:
  Array.from({ length: count }, (_, index) => ({ id: `p${String(index + 1).padStart(3, '0')}`, authorId, title: `Post ${index + 1}`, content: 'Content', published, createdAt: timestamp })),
});
const makeComments = (postId: string, count: number, authorId = 'viewer') => prisma.comment.createMany({ data:
  Array.from({ length: count }, (_, index) => ({ id: `c${String(index + 1).padStart(3, '0')}`, postId, authorId, content: `Comment ${index + 1}`, createdAt: timestamp })),
});

beforeAll(async () => {
  await prisma.user.createMany({ data: ['author', 'viewer', 'stranger', 'admin', ...Array.from({ length: 64 }, (_, i) => `liker-${i}`)].map(id => ({
    id, email: `${id}@example.invalid`, role: id === 'admin' ? 'ADMIN' as const : 'USER' as const,
  })) });
});
beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.post.deleteMany();
  viewer('viewer');
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('keysets 75 tied posts into stable pages with only one bounded lookahead', async () => {
  await makePosts(75);
  const query = jest.spyOn(prisma.post, 'findMany');
  const firstResponse = await getPosts(request('/api/posts?feed=1'));
  const first = await firstResponse.json();
  expect(firstResponse.headers.get('Cache-Control')).toBe('private, no-store');
  expect(first.posts).toHaveLength(50);
  expect(first.posts.map((post: { id: string }) => post.id)).toEqual(Array.from({ length: 50 }, (_, i) => `p${String(75 - i).padStart(3, '0')}`));
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(query.mock.calls[0][0]).toMatchObject({ take: 51, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  expect(query.mock.calls[0][0]).not.toHaveProperty('skip');
  expect(query.mock.calls[0][0]).not.toHaveProperty('cursor');
  const second = await (await getPosts(request(`/api/posts?feed=1&cursor=${first.nextCursor}`))).json();
  expect(second.posts).toHaveLength(25);
  expect(second.posts[0].id).toBe('p025');
  expect(second.posts[24].id).toBe('p001');
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.posts, ...second.posts].map(post => post.id)).size).toBe(75);
});

test('a deleted boundary and new top-of-feed insert cannot skip the remaining older posts', async () => {
  await makePosts(55);
  const first = await (await getPosts(request('/api/posts?feed=1'))).json();
  expect(first.posts[49].id).toBe('p006');
  await prisma.post.delete({ where: { id: 'p006' } });
  await prisma.post.create({ data: { id: 'new-top', authorId: 'author', title: 'New', content: 'Content', published: true, createdAt: new Date('2026-01-02') } });
  const second = await (await getPosts(request(`/api/posts?feed=1&cursor=${first.nextCursor}`))).json();
  expect(second.posts.map((post: { id: string }) => post.id)).toEqual(['p005', 'p004', 'p003', 'p002', 'p001']);
  expect(second.nextCursor).toBeNull();
});

test('timestamp ordering takes precedence over ID ordering', async () => {
  await prisma.post.createMany({ data: [
    { id: 'a-new', authorId: 'author', title: 'New', content: 'Content', published: true, createdAt: new Date('2026-01-02') },
    { id: 'z-old', authorId: 'author', title: 'Old', content: 'Content', published: true, createdAt: timestamp },
  ] });
  const body = await (await getPosts(request('/api/posts?feed=1'))).json();
  expect(body.posts.map((post: { id: string }) => post.id)).toEqual(['a-new', 'z-old']);
  expect(body.nextCursor).toBeNull();
});

test.each(['', '!', 'e30', 'not_base64', Buffer.from(JSON.stringify({ v: 1, scope: 'posts', id: 'x', createdAt: 'bad-date' })).toString('base64url')])(
  'rejects a malformed post cursor without executing a post query: %s', async cursor => {
    const query = jest.spyOn(prisma.post, 'findMany');
    const response = await getPosts(request(`/api/posts?feed=1&cursor=${cursor}`));
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  },
);

test('legacy page arrays stay bounded and use the same stable order', async () => {
  await makePosts(75);
  const first = await (await getPosts(request('/api/posts?page=1'))).json();
  const second = await (await getPosts(request('/api/posts?page=2'))).json();
  expect(Array.isArray(first)).toBe(true);
  expect(first).toHaveLength(50);
  expect(second).toHaveLength(25);
  expect(first[49].id).toBe('p026');
  expect(second[0].id).toBe('p025');
  expect((await getPosts(request('/api/posts?page=-1'))).status).toBe(400);
});

test('post payloads bound comment previews and return aggregate likes without exposing liker records', async () => {
  await makePosts(1);
  await makeComments('p001', 95);
  const likerIds = ['viewer', ...Array.from({ length: 64 }, (_, i) => `liker-${i}`)];
  await prisma.likePost.createMany({ data: likerIds.map(userId => ({ postId: 'p001', userId })) });
  await prisma.likeComment.createMany({ data: likerIds.map(userId => ({ commentId: 'c095', userId })) });
  const query = jest.spyOn(prisma.post, 'findMany');
  const body = await (await getPosts(request('/api/posts?feed=1'))).json();
  const post = body.posts[0];
  expect(post).toMatchObject({ votes: 65, isLiked: true, commentCount: 95, commentsNextCursor: expect.any(String) });
  expect(post.comments).toHaveLength(3);
  expect(post.comments[0]).toMatchObject({ id: 'c095', votes: 65, isLiked: true });
  expect(post.comments[2].id).toBe('c093');
  expect(post).not.toHaveProperty('likePosts');
  expect(post).not.toHaveProperty('_count');
  expect(post.comments[0]).not.toHaveProperty('likeComments');
  expect(JSON.stringify(post)).not.toContain('liker-');
  expect(query.mock.calls[0][0]).toMatchObject({ include: {
    _count: { select: { likePosts: true, comments: true } },
    likePosts: { where: { userId: 'viewer' }, take: 1 },
    comments: { take: 3, include: { likeComments: { where: { userId: 'viewer' }, take: 1 }, _count: { select: { likeComments: true } } } },
  } });
  const single = await (await getPost(request('/api/posts/p001'), params('p001'))).json();
  expect(single.comments).toHaveLength(3);
  expect(single.commentCount).toBe(95);
  const legacy = await (await getPosts(request('/api/posts?page=1'))).json();
  expect(Array.isArray(legacy)).toBe(true);
  expect(legacy[0].comments).toHaveLength(3);
  expect(legacy[0]).toMatchObject({ commentCount: 95, commentsNextCursor: post.commentsNextCursor, votes: 65, isLiked: true });
  const older = await (await getComments(request(`/api/posts/p001/comments?feed=1&cursor=${legacy[0].commentsNextCursor}`), params('p001'))).json();
  expect(older.comments).toHaveLength(50);
  expect(older.comments[0].id).toBe('c092');
  jest.mocked(getServerSession).mockResolvedValue(null);
  const anonymous = await (await getPosts(request('/api/posts?feed=1'))).json();
  expect(anonymous.posts[0]).toMatchObject({ votes: 65, isLiked: false });
  expect(anonymous.posts[0].comments[0]).toMatchObject({ votes: 65, isLiked: false });
  expect(query.mock.calls[2][0]).toMatchObject({ include: { likePosts: { take: 0 }, comments: { include: { likeComments: { take: 0 } } } } });
});

test('comment cursor continues after the 3-comment preview in bounded 50-comment pages', async () => {
  await makePosts(1);
  await makeComments('p001', 95);
  const preview = (await (await getPosts(request('/api/posts?feed=1'))).json()).posts[0];
  const query = jest.spyOn(prisma.comment, 'findMany');
  const second = await (await getComments(request(`/api/posts/p001/comments?feed=1&cursor=${preview.commentsNextCursor}`), params('p001'))).json();
  expect(second.comments).toHaveLength(50);
  expect(second.comments[0].id).toBe('c092');
  expect(second.comments[49].id).toBe('c043');
  expect(query.mock.calls[0][0]).toMatchObject({ take: 51, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const third = await (await getComments(request(`/api/posts/p001/comments?feed=1&cursor=${second.nextCursor}`), params('p001'))).json();
  expect(third.comments).toHaveLength(42);
  expect(third.comments[0].id).toBe('c042');
  expect(third.nextCursor).toBeNull();
  expect(new Set([...preview.comments, ...second.comments, ...third.comments].map(comment => comment.id)).size).toBe(95);
  const legacy = await (await getComments(request('/api/posts/p001/comments?page=1'), params('p001'))).json();
  expect(Array.isArray(legacy)).toBe(true);
  expect(legacy).toHaveLength(50);
});

test('deleted comment boundaries and newer comments do not skip older replies', async () => {
  await makePosts(1);
  await makeComments('p001', 55);
  const first = await (await getComments(request('/api/posts/p001/comments?feed=1'), params('p001'))).json();
  await prisma.comment.delete({ where: { id: 'c006' } });
  await prisma.comment.create({ data: { id: 'new-comment', authorId: 'viewer', postId: 'p001', content: 'New', createdAt: new Date('2026-01-02') } });
  const second = await (await getComments(request(`/api/posts/p001/comments?feed=1&cursor=${first.nextCursor}`), params('p001'))).json();
  expect(second.comments.map((comment: { id: string }) => comment.id)).toEqual(['c005', 'c004', 'c003', 'c002', 'c001']);
});

test('cursors are scoped to the resource and comments parent post', async () => {
  await makePosts(2);
  const cursor = encodeCommunityCursor({ createdAt: timestamp, id: 'c001' }, 'comments', 'p001');
  expect((await getPosts(request(`/api/posts?feed=1&cursor=${cursor}`))).status).toBe(400);
  expect((await getComments(request(`/api/posts/p002/comments?feed=1&cursor=${cursor}`), params('p002'))).status).toBe(400);
  expect((await getComments(request('/api/posts/p001/comments?feed=1&cursor=!'), params('p001'))).status).toBe(400);
});

test('feed and comment routes enforce anonymous/owner/other draft visibility', async () => {
  await makePosts(1, 'author', false);
  await prisma.post.create({ data: { id: 'viewer-draft', authorId: 'viewer', title: 'Own draft', content: 'Private', createdAt: new Date('2026-01-02') } });
  await prisma.post.create({ data: { id: 'published', authorId: 'author', title: 'Public', content: 'Public', published: true, createdAt: new Date('2026-01-03') } });
  jest.mocked(getServerSession).mockResolvedValue(null);
  expect((await (await getPosts(request('/api/posts?feed=1'))).json()).posts.map((post: { id: string }) => post.id)).toEqual(['published']);
  expect((await getComments(request('/api/posts/p001/comments?feed=1'), params('p001'))).status).toBe(404);
  viewer('viewer');
  expect((await (await getPosts(request('/api/posts?feed=1'))).json()).posts.map((post: { id: string }) => post.id)).toEqual(['published', 'viewer-draft']);
  expect((await getComments(request('/api/posts/p001/comments?feed=1'), params('p001'))).status).toBe(404);
  expect((await getComments(request('/api/posts/viewer-draft/comments?feed=1'), params('viewer-draft'))).status).toBe(200);
  viewer('author');
  expect((await getComments(request('/api/posts/p001/comments?feed=1'), params('p001'))).status).toBe(200);
});

test('stale ADMIN session claims cannot read or mutate another author’s drafts', async () => {
  await makePosts(1, 'author', false);
  viewer('stranger', 'ADMIN');
  expect((await (await getPosts(request('/api/posts?feed=1'))).json()).posts).toEqual([]);
  expect((await getPost(request('/api/posts/p001'), params('p001'))).status).toBe(404);
  expect((await getComments(request('/api/posts/p001/comments?feed=1'), params('p001'))).status).toBe(404);
  expect((await createComment(request('/api/posts/p001/comments', { content: 'No' }), params('p001'))).status).toBe(404);
  expect((await likePost(request('/api/posts/p001/like', {}), params('p001'))).status).toBe(404);
  expect((await editPost(request('/api/posts/p001', { title: 'No', content: 'No' }, 'PUT'), params('p001'))).status).toBe(403);
  viewer('admin', 'ADMIN');
  expect((await (await getPosts(request('/api/posts?feed=1'))).json()).posts).toHaveLength(1);
  expect((await getComments(request('/api/posts/p001/comments?feed=1'), params('p001'))).status).toBe(200);
});

test('creating and editing posts return the complete normalized Post shape', async () => {
  const createdResponse = await createPost(request('/api/posts', { title: 'Created', content: '<p>Content</p>' }));
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created).toMatchObject({ published: true, author: { id: 'viewer' }, comments: [], commentCount: 0, commentsNextCursor: null, votes: 0, isLiked: false });
  await makeComments(created.id, 25);
  await prisma.likePost.create({ data: { postId: created.id, userId: 'viewer' } });
  const edited = await (await editPost(request(`/api/posts/${created.id}`, { title: 'Edited', content: '<p>Updated</p>' }, 'PUT'), params(created.id))).json();
  expect(edited).toMatchObject({ title: 'Edited', votes: 1, isLiked: true, commentCount: 25, commentsNextCursor: expect.any(String) });
  expect(edited.comments).toHaveLength(3);
});

test('post topic creation, reuse and replacement are bounded and do not mutate on invalid input', async () => {
  const invalid = await createPost(request('/api/posts', { title: 'Invalid', content: 'Content', tags: ['Valid', '<script>'] }));
  expect(invalid.status).toBe(400);
  expect(await prisma.post.count()).toBe(0);
  expect((await createPost(request('/api/posts', { title: 'Duplicate', content: 'Content', tags: ['Design', 'design'] }))).status).toBe(400);
  const created = await (await createPost(request('/api/posts', { title: 'Topic post', content: 'Content', tags: ['  Praxis  ', 'Next.js'] }))).json();
  expect(created.tags.map((tag: { name: string }) => tag.name)).toEqual(['Next.js', 'Praxis']);
  const repeated = await (await createPost(request('/api/posts', { title: 'Another', content: 'Content', tags: ['Praxis'] }))).json();
  expect(repeated.tags[0].id).toBe(created.tags.find((tag: { name: string }) => tag.name === 'Praxis').id);
  const rejected = await editPost(request(`/api/posts/${created.id}`, { title: 'No', content: 'Content', tags: ['one', 'two', 'three', 'four'] }, 'PUT'), params(created.id));
  expect(rejected.status).toBe(400);
  const edited = await (await editPost(request(`/api/posts/${created.id}`, { title: 'Edited', content: 'Content', tags: ['Design'] }, 'PUT'), params(created.id))).json();
  expect(edited.tags.map((tag: { name: string }) => tag.name)).toEqual(['Design']);
  expect((await prisma.post.findUnique({ where: { id: created.id }, include: { tags: true } }))?.tags.map(tag => tag.name)).toEqual(['Design']);
});

test('topic discovery excludes draft-only tags, and filtered cursors retain privacy and filter scope', async () => {
  await prisma.tag.create({ data: { name: 'Secret', posts: { create: { id: 'private-topic-draft', authorId: 'author', title: 'Hidden', content: 'Private', published: false } } } });
  await prisma.tag.create({ data: { name: 'PublicA', posts: { create: Array.from({ length: 55 }, (_, index) => ({ id: `topic-a-${String(index).padStart(2, '0')}`, authorId: 'author', title: 'A', content: 'Public', published: true, createdAt: timestamp })) } } });
  await prisma.tag.create({ data: { name: 'PublicB', posts: { create: { id: 'topic-b', authorId: 'author', title: 'B', content: 'Public', published: true } } } });
  jest.mocked(getServerSession).mockResolvedValue(null);
  const topics = await (await getTopics(request('/api/posts/topics?q=Public'))).json();
  expect(topics.topics.map((tag: { name: string }) => tag.name)).toEqual(['PublicA', 'PublicB']);
  expect((await (await getTopics(request('/api/posts/topics?q=public'))).json()).topics).toHaveLength(2);
  expect((await (await getTopics(request('/api/posts/topics?q=Secret'))).json()).topics).toEqual([]);
  const first = await (await getPosts(request('/api/posts?feed=1&tag=PublicA'))).json();
  expect(first.posts).toHaveLength(50);
  expect(first.posts.every((post: { tags: { name: string }[] }) => post.tags.some(tag => tag.name === 'PublicA'))).toBe(true);
  expect(first.nextCursor).toEqual(expect.any(String));
  expect((await getPosts(request(`/api/posts?feed=1&tag=PublicB&cursor=${first.nextCursor}`))).status).toBe(400);
  expect((await getPosts(request(`/api/posts?feed=1&cursor=${first.nextCursor}`))).status).toBe(400);
  const second = await (await getPosts(request(`/api/posts?feed=1&tag=PublicA&cursor=${first.nextCursor}`))).json();
  expect(second.posts).toHaveLength(5);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.posts, ...second.posts].map((post: { id: string }) => post.id)).size).toBe(55);
  expect((await (await getPosts(request('/api/posts?feed=1&tag=Secret'))).json()).posts).toEqual([]);
  viewer('viewer');
  expect((await (await getPosts(request('/api/posts?feed=1&tag=Secret'))).json()).posts).toEqual([]);
  viewer('author');
  expect((await (await getPosts(request('/api/posts?feed=1&tag=Secret'))).json()).posts.map((post: { id: string }) => post.id)).toEqual(['private-topic-draft']);
  expect((await getPosts(request('/api/posts?feed=1&tag=PublicA&tag=Secret'))).status).toBe(400);
});

test('personal totals span all owned posts without loading records or accepting arbitrary target IDs', async () => {
  await makePosts(75, 'viewer');
  await prisma.post.createMany({ data: [
    { id: 'my-draft', authorId: 'viewer', title: 'Mine', content: 'Private', published: false },
    { id: 'other-draft', authorId: 'author', title: 'Other', content: 'Private', published: false },
    { id: 'other-public', authorId: 'author', title: 'Public', content: 'Public', published: true, createdAt: new Date('2026-01-03') },
  ] });
  await prisma.likePost.createMany({ data: [
    { userId: 'author', postId: 'p001' }, { userId: 'stranger', postId: 'my-draft' },
    { userId: 'viewer', postId: 'other-public' },
  ] });
  await prisma.comment.createMany({ data: [
    { id: 'own-public-comment', authorId: 'viewer', postId: 'other-public', content: 'Public' },
    { id: 'own-draft-comment', authorId: 'viewer', postId: 'my-draft', content: 'Own draft' },
    { id: 'hidden-comment', authorId: 'viewer', postId: 'other-draft', content: 'Hidden' },
    { id: 'someone-else-comment', authorId: 'author', postId: 'p001', content: 'Not own' },
  ] });
  const postQuery = jest.spyOn(prisma.post, 'findMany');
  const commentQuery = jest.spyOn(prisma.comment, 'findMany');
  const likeQuery = jest.spyOn(prisma.likePost, 'findMany');
  const commentCount = jest.spyOn(prisma.comment, 'count');
  const statsRequest = getStats as unknown as (request: Request) => Promise<Response>;
  const response = await statsRequest(new Request('http://localhost/api/posts/me/stats?userId=author&id=author'));
  expect(await response.json()).toEqual({ posts: 76, receivedLikes: 2, comments: 2 });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(postQuery).not.toHaveBeenCalled();
  expect(commentQuery).not.toHaveBeenCalled();
  expect(likeQuery).not.toHaveBeenCalled();
  expect(commentCount).toHaveBeenCalledWith({ where: { authorId: 'viewer', post: { OR: [{ published: true }, { authorId: 'viewer' }] } } });
});

test('personal statistics grant no staff-role draft privilege and require authentication', async () => {
  await makePosts(1, 'author', false);
  await prisma.comment.create({ data: { authorId: 'admin', postId: 'p001', content: 'Staff draft comment' } });
  viewer('admin', 'ADMIN');
  expect(await (await getStats()).json()).toEqual({ posts: 0, receivedLikes: 0, comments: 0 });
  jest.mocked(getServerSession).mockResolvedValue(null);
  const count = jest.spyOn(prisma.post, 'count');
  expect((await getStats()).status).toBe(401);
  expect(count).not.toHaveBeenCalled();
});


test('resolves an older comment directly in one bounded parent payload without shifting the preview cursor', async () => {
  await makePosts(1);
  await makeComments('p001', 95);
  await prisma.likeComment.create({ data: { commentId: 'c001', userId: 'viewer' } });
  const preview = (await (await getPosts(request('/api/posts?feed=1'))).json()).posts[0];
  const parentQuery = jest.spyOn(prisma.post, 'findUnique');
  const commentQuery = jest.spyOn(prisma.comment, 'findUnique');
  const scan = jest.spyOn(prisma.comment, 'findMany');
  const response = await getLinkedComment(request('/api/posts/linked-comment/c001'), { params: Promise.resolve({ commentId: 'c001' }) });
  const post = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(post).toMatchObject({ id: 'p001', commentCount: 95, commentsNextCursor: preview.commentsNextCursor });
  expect(post.comments).toHaveLength(4);
  expect(post.comments[3]).toMatchObject({ id: 'c001', votes: 1, isLiked: true });
  expect(post.comments[3]).not.toHaveProperty('post');
  expect(parentQuery).toHaveBeenCalledTimes(1);
  expect(parentQuery.mock.calls[0][0]).toMatchObject({ include: { comments: { take: 3 } } });
  expect(commentQuery).toHaveBeenCalledTimes(1);
  expect(scan).not.toHaveBeenCalled();
  const intervening = await (await getComments(request(`/api/posts/p001/comments?feed=1&cursor=${post.commentsNextCursor}`), params('p001'))).json();
  expect(intervening.comments).toHaveLength(50);
  expect(intervening.comments[0].id).toBe('c092');
  expect(intervening.comments[49].id).toBe('c043');
});

test('does not duplicate a linked comment which is already in the newest preview', async () => {
  await makePosts(1);
  await makeComments('p001', 25);
  const post = await (await getLinkedComment(request('/api/posts/linked-comment/c025'), { params: Promise.resolve({ commentId: 'c025' }) })).json();
  expect(post.comments).toHaveLength(3);
  expect(post.comments.filter((comment: { id: string }) => comment.id === 'c025')).toHaveLength(1);
  expect(post.comments[0].id).toBe('c025');
  expect(post.commentsNextCursor).toEqual(expect.any(String));
});

test('linked comments on private drafts stay unavailable to anonymous and stale staff viewers', async () => {
  await makePosts(1, 'author', false);
  await makeComments('p001', 1);
  const context = { params: Promise.resolve({ commentId: 'c001' }) };
  const parentQuery = jest.spyOn(prisma.post, 'findUnique');
  jest.mocked(getServerSession).mockResolvedValue(null);
  const anonymous = await getLinkedComment(request('/api/posts/linked-comment/c001'), context);
  expect(anonymous.status).toBe(404);
  expect(await anonymous.json()).toEqual({ error: 'Beitrag nicht gefunden' });
  viewer('stranger', 'ADMIN');
  const staleAdmin = await getLinkedComment(request('/api/posts/linked-comment/c001'), context);
  expect(staleAdmin.status).toBe(404);
  expect(await staleAdmin.json()).toEqual({ error: 'Beitrag nicht gefunden' });
  expect(parentQuery).not.toHaveBeenCalled();
  viewer('author');
  expect((await getLinkedComment(request('/api/posts/linked-comment/c001'), context)).status).toBe(200);
  viewer('admin', 'ADMIN');
  expect((await getLinkedComment(request('/api/posts/linked-comment/c001'), context)).status).toBe(200);
  expect((await getLinkedComment(request('/api/posts/linked-comment/missing'), { params: Promise.resolve({ commentId: 'missing' }) })).status).toBe(404);
});
