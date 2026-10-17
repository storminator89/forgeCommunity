/** @jest-environment node */
import { PUT as selectSolution } from '@/app/api/posts/[postId]/solution/route';
import { GET as getPosts } from '@/app/api/posts/route';
import { GET as getPost } from '@/app/api/posts/[postId]/route';
import { GET as getComments, POST as createComment } from '@/app/api/posts/[postId]/comments/route';
import { GET as getLinkedComment } from '@/app/api/posts/linked-comment/[commentId]/route';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getServerSession } from '@/lib/sites-auth/server';
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
  const directory = mkdtempSync(join(tmpdir(), 'forge-solutions-'));
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


const params = (postId = 'public') => ({ params: Promise.resolve({ postId }) });
const request = (path: string, body?: object, headers: Record<string, string> = {}) => new Request(`http://localhost${path}`, body ? {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
} : undefined) as never;
const viewer = (id: string, role = 'USER') => jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
const choose = (commentId: string | null, expectedRevision: string | null = null, postId = 'public') =>
  selectSolution(request(`/api/posts/${postId}/solution`, { commentId, expectedRevision }), params(postId));
const current = () => prisma.acceptedSolution.findUnique({ where: { postId: 'public' } });

beforeAll(async () => {
  await prisma.user.createMany({ data: ['owner', 'reply-author', 'other', 'admin', 'moderator', 'test'].map(id => ({
    id, email: `${id}@example.invalid`, role: id === 'admin' ? 'ADMIN' as const : id === 'moderator' ? 'MODERATOR' as const : 'USER' as const,
    isTestAccount: id === 'test',
  })) });
});
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.post.deleteMany(); await prisma.acceptedSolutionChange.deleteMany();
  await prisma.user.updateMany({ data: { isTestAccount: false } });
  await prisma.user.update({ where: { id: 'test' }, data: { isTestAccount: true } });
  await prisma.post.createMany({ data: ['public', 'foreign', 'draft'].map(id => ({
    id, title: id, content: 'Content', authorId: 'owner', published: id !== 'draft',
  })) });
  await prisma.comment.createMany({ data: [
    { id: 'reply-a', postId: 'public', authorId: 'reply-author', content: 'Helpful reply', createdAt: new Date('2026-01-01') },
    { id: 'reply-b', postId: 'public', authorId: 'other', content: 'Other helpful reply', createdAt: new Date('2026-01-02') },
    { id: 'self', postId: 'public', authorId: 'owner', content: 'Self answer' },
    { id: 'test-reply', postId: 'public', authorId: 'test', content: 'Test answer' },
    { id: 'foreign-reply', postId: 'foreign', authorId: 'reply-author', content: 'Another discussion' },
    { id: 'draft-reply', postId: 'draft', authorId: 'reply-author', content: 'Private reply' },
  ] });
  viewer('owner');
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('owner selects exactly one reply, repeats idempotently, changes and reverses with server-created audit', async () => {
  const first = await choose('reply-a'); const body = await first.json();
  expect(first.status).toBe(200);
  expect(body).toMatchObject({ changed: true, post: { acceptedSolutionCount: 1, acceptedSolution: { comment: { id: 'reply-a' } } } });
  const revisionA = body.post.solutionRevision;
  expect(await prisma.acceptedSolutionChange.findMany()).toEqual([expect.objectContaining({
    id: revisionA, action: 'SELECTED', actorId: 'owner', postId: 'public', previousCommentId: null, commentId: 'reply-a',
  })]);
  const repeated = await (await choose('reply-a')).json();
  expect(repeated.changed).toBe(false); expect(repeated.post.solutionRevision).toBe(revisionA);
  const changed = await (await choose('reply-b', revisionA)).json();
  expect(changed.post.acceptedSolution.comment.id).toBe('reply-b');
  const revisionB = changed.post.solutionRevision;
  expect(revisionB).not.toBe(revisionA);
  expect(await prisma.acceptedSolution.count()).toBe(1);
  const clear = await (await choose(null, revisionB)).json();
  expect(clear).toMatchObject({ changed: true, post: { solutionRevision: null, acceptedSolution: null, acceptedSolutionCount: 0 } });
  expect((await (await choose(null, revisionB)).json()).changed).toBe(false);
  expect(await prisma.acceptedSolutionChange.count()).toBe(3);
  expect(await prisma.rewardLedger.count()).toBe(0);
});

test('stale changes return 409 and authoritative current state without an audit write', async () => {
  await choose('reply-a'); const before = await current();
  const response = await choose('reply-b');
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ post: { solutionRevision: before!.revision, acceptedSolution: { comment: { id: 'reply-a' } } } });
  expect(await prisma.acceptedSolutionChange.count()).toBe(1);
  expect((await choose(null)).status).toBe(409);
});

test.each(['other', 'reply-author', 'admin', 'moderator'])('stored %s cannot override an author decision, regardless of session ADMIN claim', async id => {
  viewer(id, 'ADMIN'); expect((await choose('reply-a')).status).toBe(403);
  expect(await current()).toBeNull(); expect(await prisma.acceptedSolutionChange.count()).toBe(0);
});

test('anonymous and deleted session users cannot select', async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  expect((await choose('reply-a')).status).toBe(401);
  viewer('deleted-owner', 'ADMIN'); expect((await choose('reply-a')).status).toBe(401);
});

test.each([['self', 400], ['test-reply', 400], ['foreign-reply', 404], ['missing', 404]])('rejects ineligible reply %s', async (id, status) => {
  expect((await choose(String(id))).status).toBe(status);
  expect(await prisma.acceptedSolutionChange.count()).toBe(0);
});

test('private discussions cannot create a signal; even staff cannot infer private existence through this API', async () => {
  expect((await choose('draft-reply', null, 'draft')).status).toBe(400);
  viewer('admin', 'ADMIN'); expect((await choose('draft-reply', null, 'draft')).status).toBe(404);
  expect(await prisma.acceptedSolutionChange.count()).toBe(0);
});

test('a hidden accepted discussion exposes zero public signal and author can clear it', async () => {
  await choose('reply-a'); const selection = await current();
  await prisma.post.update({ where: { id: 'public' }, data: { published: false } });
  const privatePost = await (await getPost(request('/api/posts/public'), params())).json();
  expect(privatePost).toMatchObject({ acceptedSolution: null, acceptedSolutionCount: 0, solutionRevision: selection!.revision });
  expect((await choose('reply-b', selection!.revision)).status).toBe(400);
  viewer('admin', 'ADMIN');
  const adminDraft = await (await getPost(request('/api/posts/public'), params())).json();
  expect(adminDraft).toMatchObject({ acceptedSolution: null, acceptedSolutionCount: 0, solutionRevision: null });
  const adminFeed = await (await getPosts(request('/api/posts?feed=1'))).json();
  expect(adminFeed.posts.find((row: { id: string }) => row.id === 'public')).toMatchObject({ solutionRevision: null, acceptedSolution: null });
  viewer('other', 'ADMIN'); // A stale ADMIN claim cannot read the private post.
  expect((await getPost(request('/api/posts/public'), params())).status).toBe(404);
  viewer('other'); expect((await getPost(request('/api/posts/public'), params())).status).toBe(404);
  const feed = await (await getPosts(request('/api/posts?feed=1'))).json();
  expect(feed.posts.some((post: { id: string }) => post.id === 'public')).toBe(false);
  viewer('owner'); expect((await choose(null, selection!.revision)).status).toBe(200);
  expect(await current()).toBeNull();
});

test('making the reply author a test account suppresses existing signal on every subsequent read', async () => {
  await choose('reply-a');
  await prisma.user.update({ where: { id: 'reply-author' }, data: { isTestAccount: true } });
  const post = await (await getPost(request('/api/posts/public'), params())).json();
  expect(post).toMatchObject({ acceptedSolution: null, acceptedSolutionCount: 0 });
  expect((await choose('reply-a', post.solutionRevision)).status).toBe(400);
  expect((await choose(null, post.solutionRevision)).status).toBe(200);
});

test('a separately included old accepted reply keeps the 3-comment preview and 50-comment page bounds', async () => {
  await prisma.comment.createMany({ data: Array.from({ length: 70 }, (_, i) => ({
    id: `new-${i}`, postId: 'public', authorId: 'other', content: `Reply ${i}`, createdAt: new Date('2026-02-01'),
  })) });
  await choose('reply-a'); viewer('other');
  const post = await (await getPost(request('/api/posts/public'), params())).json();
  expect(post.comments).toHaveLength(3); expect(post.commentCount).toBe(74);
  expect(post.acceptedSolution.comment.id).toBe('reply-a');
  const feedPost = (await (await getPosts(request('/api/posts?feed=1'))).json()).posts.find((row: { id: string }) => row.id === 'public');
  expect(feedPost).toMatchObject({ comments: [], commentsDeferred: true, commentCount: 74, acceptedSolution: { comment: { id: 'reply-a' } } });
  expect(post.acceptedSolution.comment.author).not.toHaveProperty('isTestAccount');
  const page = await (await getComments(request('/api/posts/public/comments?feed=1'), params())).json();
  expect(page.comments).toHaveLength(50);
  const linked = await (await getLinkedComment(request('/api/posts/linked-comment/reply-a'), { params: Promise.resolve({ commentId: 'reply-a' }) })).json();
  expect(linked.comments).toHaveLength(4); expect(linked.acceptedSolution.comment.id).toBe('reply-a');
  expect(linked.commentsNextCursor).toBe(post.commentsNextCursor);
});

test('reply deletion removes current state, anonymizes target audit, and next acceptance uses a new revision', async () => {
  await choose('reply-a'); const first = await current();
  await prisma.comment.delete({ where: { id: 'reply-a' } });
  expect(await current()).toBeNull();
  expect(await prisma.acceptedSolutionChange.findUnique({ where: { id: first!.revision } })).toMatchObject({ action: 'SELECTED', commentId: null });
  const response = await (await choose('reply-b')).json();
  expect(response.post.solutionRevision).not.toBe(first!.revision);
  expect(await prisma.acceptedSolutionChange.count()).toBe(2);
});

test('post deletion removes the signal and anonymizes audit targets without erasing the decision record', async () => {
  await choose('reply-a');
  await prisma.post.delete({ where: { id: 'public' } });
  expect(await current()).toBeNull();
  expect(await prisma.acceptedSolutionChange.findFirst()).toMatchObject({ postId: null, commentId: null, actorId: 'owner' });
});

test('account deletion retains no actor identity in audit', async () => {
  await prisma.user.create({ data: { id: 'temporary-owner', email: 'temporary@example.invalid' } });
  await prisma.post.update({ where: { id: 'public' }, data: { authorId: 'temporary-owner' } });
  viewer('temporary-owner'); await choose('reply-a');
  await prisma.user.delete({ where: { id: 'temporary-owner' } });
  expect(await prisma.acceptedSolutionChange.findFirst()).toMatchObject({ actorId: null, postId: null, commentId: null });
  expect(await current()).toBeNull();
});

test('concurrent conflicting selections retain at most one signal and one first-decision audit', async () => {
  const results = await Promise.all([choose('reply-a'), choose('reply-b')]);
  expect(results.map(response => response.status).sort()).toEqual([200, 409]);
  expect(await prisma.acceptedSolution.count()).toBe(1);
  expect(await prisma.acceptedSolutionChange.count()).toBe(1);
});

test('concurrent identical selections are idempotent', async () => {
  const results = await Promise.all([choose('reply-a'), choose('reply-a')]);
  expect(results.map(response => response.status)).toEqual([200, 200]);
  expect(await prisma.acceptedSolutionChange.count()).toBe(1);
});

test.each([{ commentId: 1, expectedRevision: null }, { commentId: 'reply-a' }, { commentId: 'reply-a', expectedRevision: {} }, { commentId: '', expectedRevision: null }])('malformed state requests do not write: %j', async body => {
  expect((await selectSolution(request('/api/posts/public/solution', body), params())).status).toBe(400);
  expect(await prisma.acceptedSolutionChange.count()).toBe(0);
});

test('cross-origin and malformed JSON requests do not write', async () => {
  const response = await selectSolution(request('/api/posts/public/solution', { commentId: 'reply-a', expectedRevision: null }, { origin: 'https://other.example.invalid' }), params());
  expect(response.status).toBe(403);
  const malformed = new Request('http://localhost/api/posts/public/solution', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' }) as never;
  expect((await selectSolution(malformed, params())).status).toBe(400);
  expect(await prisma.acceptedSolutionChange.count()).toBe(0);
});


test('non-authors never receive raw test classification or the author-only eligibility hint', async () => {
  await choose('reply-a'); viewer('other');
  const publicFeed = await (await getPosts(request('/api/posts?feed=1'))).json();
  const publicPost = publicFeed.posts.find((row: { id: string }) => row.id === 'public');
  expect(publicPost.acceptedSolution.comment).not.toHaveProperty('solutionEligible');
  expect(publicPost.acceptedSolution.comment.author).not.toHaveProperty('isTestAccount');
  for (const row of publicFeed.posts) for (const reply of row.comments) {
    expect(reply).not.toHaveProperty('solutionEligible'); expect(reply.author).not.toHaveProperty('isTestAccount');
  }
  const postResponse = await (await getPost(request('/api/posts/public'), params())).json();
  for (const reply of postResponse.comments) {
    expect(reply).not.toHaveProperty('solutionEligible'); expect(reply.author).not.toHaveProperty('isTestAccount');
  }
  const comments = await (await getComments(request('/api/posts/public/comments?feed=1'), params())).json();
  for (const reply of comments.comments) {
    expect(reply).not.toHaveProperty('solutionEligible'); expect(reply.author).not.toHaveProperty('isTestAccount');
  }
  const linked = await (await getLinkedComment(request('/api/posts/linked-comment/test-reply'), { params: Promise.resolve({ commentId: 'test-reply' }) })).json();
  expect(linked.comments.find((reply: { id: string }) => reply.id === 'test-reply')).not.toHaveProperty('solutionEligible');
  const created = await (await createComment(request('/api/posts/public/comments', { content: 'New reply' }), params())).json();
  expect(created).not.toHaveProperty('solutionEligible'); expect(created.author).not.toHaveProperty('isTestAccount');
  viewer('owner');
  const ownerComments = await (await getComments(request('/api/posts/public/comments?feed=1'), params())).json();
  expect(ownerComments.comments.find((reply: { id: string }) => reply.id === 'test-reply')).toMatchObject({ solutionEligible: false });
  expect(ownerComments.comments.find((reply: { id: string }) => reply.id === 'reply-a')).toMatchObject({ solutionEligible: true });
});


test('a deleted selection returns refreshed zero state on an unavailable-reply retry', async () => {
  await choose('reply-a'); const first = await current();
  await prisma.comment.delete({ where: { id: 'reply-a' } });
  const response = await choose('reply-a', first!.revision);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ post: { acceptedSolution: null, acceptedSolutionCount: 0, solutionRevision: null } });
});

test('a failed audit insertion rolls back the live selection; unrelated invariant errors remain failures', async () => {
  const transact = prisma.$transaction.bind(prisma);
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) =>
    transact(async tx => {
      jest.spyOn(tx.acceptedSolutionChange, 'create').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unexpected FK invariant', { code: 'P2003', clientVersion: '7.10.0' }));
      return work(tx);
    }, options as never)) as never);
  expect((await choose('reply-a')).status).toBe(500);
  expect(await current()).toBeNull(); expect(await prisma.acceptedSolutionChange.count()).toBe(0);
});
