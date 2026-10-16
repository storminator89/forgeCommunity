/** @jest-environment node */

import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { GET as listSpaces, POST as createSpace } from '@/app/api/spaces/route';
import { GET as getSpace } from '@/app/api/spaces/[spaceId]/route';
import { POST as joinSpace, DELETE as leaveSpace } from '@/app/api/spaces/[spaceId]/join/route';
import { GET as listMembers, POST as addMember } from '@/app/api/spaces/[spaceId]/members/route';
import { DELETE as removeMember } from '@/app/api/spaces/[spaceId]/members/[userId]/route';
import { GET as memberCandidates } from '@/app/api/spaces/[spaceId]/member-candidates/route';
import { GET as listDiscussions, POST as createDiscussion } from '@/app/api/spaces/[spaceId]/discussions/route';
import { GET as getDiscussion } from '@/app/api/spaces/[spaceId]/discussions/[discussionId]/route';
import { GET as listReplies, POST as createReply } from '@/app/api/spaces/[spaceId]/discussions/[discussionId]/replies/route';
import { GET as getReply } from '@/app/api/spaces/[spaceId]/discussions/[discussionId]/replies/[replyId]/route';
import { PATCH as moderateDiscussion } from '@/app/api/spaces/[spaceId]/discussions/[discussionId]/moderation/route';
import { PATCH as moderateReply } from '@/app/api/spaces/[spaceId]/discussions/[discussionId]/replies/[replyId]/moderation/route';
import { GET as listReports, POST as createReport } from '@/app/api/reports/route';
import { PATCH as reviewReport } from '@/app/api/reports/[reportId]/route';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  sanitizeHtmlPreviewServer: (value: string, length = 240) => value.replace(/<[^>]*>/g, '').slice(0, length),
}));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-spaces-api-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const session = (id: string | null, role = 'USER') =>
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
const req = (method: string, path: string, body?: object) => new Request(`http://localhost${path}`, {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
}) as never;
const spaceContext = (spaceId: string) => ({ params: Promise.resolve({ spaceId }) });
const discussionContext = (spaceId: string, discussionId: string) => ({ params: Promise.resolve({ spaceId, discussionId }) });
const replyContext = (spaceId: string, discussionId: string, replyId: string) =>
  ({ params: Promise.resolve({ spaceId, discussionId, replyId }) });
const reportContext = (reportId: string) => ({ params: Promise.resolve({ reportId }) });
const discussionInput = (requestId = 'discussion-request', content = 'A meaningful discussion body') =>
  ({ title: 'Useful discussion title', content, requestId });
const replyInput = (requestId = 'reply-request', content = 'A useful reply') => ({ content, requestId });

async function makeSpace(visibility: 'PUBLIC' | 'PRIVATE', name = `${visibility} space`) {
  session('admin', 'ADMIN');
  const response = await createSpace(req('POST', '/api/spaces', { name, description: 'A useful community space', visibility }));
  expect(response.status).toBe(201);
  return response.json();
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.contentReport.deleteMany();
  await prisma.spaceReply.deleteMany();
  await prisma.spaceDiscussion.deleteMany();
  await prisma.spaceMember.deleteMany();
  await prisma.space.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', name: 'Admin', email: 'admin@example.invalid', role: 'ADMIN' },
    { id: 'admin2', name: 'Second Admin', email: 'admin2@example.invalid', role: 'ADMIN' },
    { id: 'member', name: 'Member', email: 'member@example.invalid', role: 'USER' },
    { id: 'reader', name: 'Reader', email: 'reader@example.invalid', role: 'USER' },
    { id: 'moderator', name: 'Moderator', email: 'moderator@example.invalid', role: 'MODERATOR' },
  ] });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('private membership and admin picker remain bounded and current-role checked', async () => {
  const privateSpace = await makeSpace('PRIVATE');
  expect(privateSpace).toMatchObject({ visibility: 'PRIVATE', isMember: true, canWrite: true });
  const spaceId = privateSpace.id;
  session('admin2', 'ADMIN');
  const adminRead = await getSpace(req('GET', `/api/spaces/${spaceId}`), spaceContext(spaceId));
  expect(adminRead.status).toBe(200);
  expect(await adminRead.json()).toMatchObject({ canManage: true, canWrite: false, isMember: false });
  expect((await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput()), spaceContext(spaceId))).status).toBe(404);
  await prisma.user.update({ where: { id: 'admin2' }, data: { role: 'USER' } });
  // A stale ADMIN session cannot survive a committed database demotion.
  expect((await getSpace(req('GET', `/api/spaces/${spaceId}`), spaceContext(spaceId))).status).toBe(404);
  expect((await listSpaces(req('GET', '/api/spaces')).then(response => response.json())).items).toEqual([]);
  expect((await addMember(req('POST', `/api/spaces/${spaceId}/members`, { userId: 'reader' }), spaceContext(spaceId))).status).toBe(403);
  session('member');
  expect((await getSpace(req('GET', `/api/spaces/${spaceId}`), spaceContext(spaceId))).status).toBe(404);
  expect((await joinSpace(req('POST', `/api/spaces/${spaceId}/join`), spaceContext(spaceId))).status).toBe(404);
  expect((await memberCandidates(req('GET', `/api/spaces/${spaceId}/member-candidates?q=mem`), spaceContext(spaceId))).status).toBe(403);
  expect((await listMembers(req('GET', `/api/spaces/${spaceId}/members`), spaceContext(spaceId))).status).toBe(403);
  session('moderator', 'ADMIN');
  expect((await addMember(req('POST', `/api/spaces/${spaceId}/members`, { userId: 'member' }), spaceContext(spaceId))).status).toBe(403);
  session('admin', 'ADMIN');
  const candidates = await (await memberCandidates(req('GET', `/api/spaces/${spaceId}/member-candidates?q=mem`), spaceContext(spaceId))).json();
  expect(candidates.items).toEqual([{ id: 'member', name: 'Member', image: null }]);
  expect(JSON.stringify(candidates)).not.toContain('email');
  expect((await addMember(req('POST', `/api/spaces/${spaceId}/members`, { userId: 'member' }), spaceContext(spaceId))).status).toBe(201);
  expect((await addMember(req('POST', `/api/spaces/${spaceId}/members`, { userId: 'member' }), spaceContext(spaceId))).status).toBe(200);
  const listed = await (await listMembers(req('GET', `/api/spaces/${spaceId}/members`), spaceContext(spaceId))).json();
  expect(listed.items).toContainEqual({ id: 'member', name: 'Member', image: null });
  expect(JSON.stringify(listed)).not.toContain('email');
  session('member');
  expect((await getSpace(req('GET', `/api/spaces/${spaceId}`), spaceContext(spaceId))).status).toBe(200);
  const created = await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput()), spaceContext(spaceId));
  expect(created.status).toBe(201);
  const discussionId = (await created.json()).id;
  session('admin', 'ADMIN');
  expect((await removeMember(req('DELETE', `/api/spaces/${spaceId}/members/member`),
    { params: Promise.resolve({ spaceId, userId: 'member' }) })).status).toBe(200);
  session('member');
  const revoked = await getDiscussion(req('GET', `/api/spaces/${spaceId}/discussions/${discussionId}`), discussionContext(spaceId, discussionId));
  expect(revoked.status).toBe(404);
  expect(revoked.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput()), spaceContext(spaceId))).status).toBe(404);
  session('admin', 'ADMIN');
  expect((await getDiscussion(req('GET', `/api/spaces/${spaceId}/discussions/${discussionId}`), discussionContext(spaceId, discussionId))).status).toBe(200);
});

test('public reads, membership writes, scoped cursors and idempotent retries', async () => {
  const publicSpace = await makeSpace('PUBLIC');
  const privateSpace = await makeSpace('PRIVATE');
  const spaceId = publicSpace.id;
  session(null);
  expect((await listSpaces(req('GET', '/api/spaces'))).status).toBe(401);
  session('member');
  const directory = await (await listSpaces(req('GET', '/api/spaces'))).json();
  expect(directory.items.map((row: { id: string }) => row.id)).toEqual([spaceId]);
  const readable = await getSpace(req('GET', `/api/spaces/${spaceId}`), spaceContext(spaceId));
  expect(await readable.json()).toMatchObject({ canWrite: false, isMember: false });
  expect((await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput()), spaceContext(spaceId))).status).toBe(404);
  expect((await joinSpace(req('POST', `/api/spaces/${spaceId}/join`), spaceContext(spaceId))).status).toBe(200);
  const first = await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput()), spaceContext(spaceId));
  expect(first.status).toBe(201);
  const discussion = await first.json();
  expect(discussion).toMatchObject({ spaceId, replyCount: 0, hiddenAt: null });
  expect(JSON.stringify(discussion)).not.toContain('payloadDigest');
  const retry = await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput()), spaceContext(spaceId));
  expect(retry.status).toBe(200);
  expect((await retry.json()).id).toBe(discussion.id);
  expect((await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`,
    discussionInput('discussion-request', 'Changed payload content')), spaceContext(spaceId))).status).toBe(409);
  const reply = await createReply(req('POST', `/api/spaces/${spaceId}/discussions/${discussion.id}/replies`, replyInput()), discussionContext(spaceId, discussion.id));
  expect(reply.status).toBe(201);
  const replyId = (await reply.json()).id;
  const replyRetry = await createReply(req('POST', `/api/spaces/${spaceId}/discussions/${discussion.id}/replies`, replyInput()), discussionContext(spaceId, discussion.id));
  expect(replyRetry.status).toBe(200);
  expect((await replyRetry.json()).id).toBe(replyId);
  const wrongCursor = Buffer.from(JSON.stringify({ v: 1, kind: 'discussions', spaceId: privateSpace.id,
    createdAt: new Date().toISOString(), id: discussion.id })).toString('base64url');
  expect((await listDiscussions(req('GET', `/api/spaces/${spaceId}/discussions?cursor=${wrongCursor}`), spaceContext(spaceId))).status).toBe(400);
  expect((await listDiscussions(req('GET', `/api/spaces/${privateSpace.id}/discussions?cursor=${wrongCursor}`), spaceContext(privateSpace.id))).status).toBe(404);
  expect((await leaveSpace(req('DELETE', `/api/spaces/${spaceId}/join`), spaceContext(spaceId))).status).toBe(200);
  expect((await getReply(req('GET', `/api/spaces/${spaceId}/discussions/${discussion.id}/replies/${replyId}`), replyContext(spaceId, discussion.id, replyId))).status).toBe(200);
  expect((await createReply(req('POST', `/api/spaces/${spaceId}/discussions/${discussion.id}/replies`, replyInput()), discussionContext(spaceId, discussion.id))).status).toBe(404);
});

test('simultaneous discussion retries create one row without a server error', async () => {
  const { id: spaceId } = await makeSpace('PUBLIC');
  session('member');
  expect((await joinSpace(req('POST', `/api/spaces/${spaceId}/join`), spaceContext(spaceId))).status).toBe(200);
  const responses = await Promise.all(Array.from({ length: 3 }, () =>
    createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput('concurrent-discussion')),
      spaceContext(spaceId))));
  const statuses = responses.map(response => response.status);
  expect(statuses.filter(status => status === 201)).toHaveLength(1);
  expect(statuses.every(status => [200, 201, 409].includes(status))).toBe(true);
  expect(await prisma.spaceDiscussion.count({ where: { spaceId, authorId: 'member', requestId: 'concurrent-discussion' } })).toBe(1);
  const ids = await Promise.all(responses.filter(response => response.ok).map(async response => (await response.json()).id));
  expect(new Set(ids).size).toBe(1);
});

test('simultaneous reply retries create one row without a server error', async () => {
  const { id: spaceId } = await makeSpace('PUBLIC');
  session('member');
  await joinSpace(req('POST', `/api/spaces/${spaceId}/join`), spaceContext(spaceId));
  const discussion = await (await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`,
    discussionInput('reply-parent')), spaceContext(spaceId))).json();
  const responses = await Promise.all(Array.from({ length: 3 }, () =>
    createReply(req('POST', `/api/spaces/${spaceId}/discussions/${discussion.id}/replies`, replyInput('concurrent-reply')),
      discussionContext(spaceId, discussion.id))));
  const statuses = responses.map(response => response.status);
  expect(statuses.filter(status => status === 201)).toHaveLength(1);
  expect(statuses.every(status => [200, 201, 409].includes(status))).toBe(true);
  expect(await prisma.spaceReply.count({ where: { discussionId: discussion.id, authorId: 'member', requestId: 'concurrent-reply' } })).toBe(1);
  const ids = await Promise.all(responses.filter(response => response.ok).map(async response => (await response.json()).id));
  expect(new Set(ids).size).toBe(1);
});

test('simultaneous private member additions create one row without a server error', async () => {
  const { id: spaceId } = await makeSpace('PRIVATE');
  session('admin', 'ADMIN');
  const responses = await Promise.all(Array.from({ length: 3 }, () =>
    addMember(req('POST', `/api/spaces/${spaceId}/members`, { userId: 'member' }), spaceContext(spaceId))));
  const statuses = responses.map(response => response.status);
  expect(statuses.filter(status => status === 201)).toHaveLength(1);
  expect(statuses.every(status => [200, 201, 409].includes(status))).toBe(true);
  expect(await prisma.spaceMember.count({ where: { spaceId, userId: 'member' } })).toBe(1);
});

test('scope-derived reports, reversible hiding, and admin-only review', async () => {
  const publicSpace = await makeSpace('PUBLIC');
  const spaceId = publicSpace.id;
  session('member');
  await joinSpace(req('POST', `/api/spaces/${spaceId}/join`), spaceContext(spaceId));
  const discussion = await (await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput()), spaceContext(spaceId))).json();
  const discussionId = discussion.id;
  const reply = await (await createReply(req('POST', `/api/spaces/${spaceId}/discussions/${discussionId}/replies`, replyInput()), discussionContext(spaceId, discussionId))).json();
  session('reader'); // Public readers can report without joining.
  const report = await createReport(req('POST', '/api/reports', { targetType: 'SPACE_REPLY', targetId: reply.id,
    reason: 'SPAM', scopeSpaceId: 'forged-scope' }));
  expect(report.status).toBe(201);
  const reportId = (await report.json()).id;
  expect(await prisma.contentReport.findUnique({ where: { id: reportId }, select: { scopeSpaceId: true } })).toEqual({ scopeSpaceId: spaceId });
  session('moderator', 'MODERATOR');
  expect((await listReports(req('GET', '/api/reports?status=OPEN&page=1')).then(response => response.json())).total).toBe(0);
  expect((await reviewReport(req('PATCH', `/api/reports/${reportId}`, { status: 'DISMISSED', resolutionNote: 'Not spam' }), reportContext(reportId))).status).toBe(404);
  session('admin', 'ADMIN');
  expect((await moderateReply(req('PATCH', `/api/spaces/${spaceId}/discussions/${discussionId}/replies/${reply.id}/moderation`, { hidden: true }), replyContext(spaceId, discussionId, reply.id))).status).toBe(200);
  session('member');
  expect((await listReplies(req('GET', `/api/spaces/${spaceId}/discussions/${discussionId}/replies`), discussionContext(spaceId, discussionId)).then(response => response.json())).items).toEqual([]);
  expect((await getDiscussion(req('GET', `/api/spaces/${spaceId}/discussions/${discussionId}`), discussionContext(spaceId, discussionId)).then(response => response.json())).replyCount).toBe(0);
  session('admin', 'ADMIN');
  expect((await moderateDiscussion(req('PATCH', `/api/spaces/${spaceId}/discussions/${discussionId}/moderation`, { hidden: true }), discussionContext(spaceId, discussionId))).status).toBe(200);
  const queue = await (await listReports(req('GET', '/api/reports?status=OPEN&page=1'))).json();
  expect(queue).toMatchObject({ total: 1 });
  expect(queue.items[0]).toMatchObject({ scopeSpaceId: spaceId, targetType: 'SPACE_REPLY', targetAvailable: true,
    targetHidden: true, targetDiscussionId: discussionId });
  session('member');
  expect((await listDiscussions(req('GET', `/api/spaces/${spaceId}/discussions`), spaceContext(spaceId)).then(response => response.json())).items).toEqual([]);
  expect((await getDiscussion(req('GET', `/api/spaces/${spaceId}/discussions/${discussionId}`), discussionContext(spaceId, discussionId))).status).toBe(404);
  expect((await getReply(req('GET', `/api/spaces/${spaceId}/discussions/${discussionId}/replies/${reply.id}`), replyContext(spaceId, discussionId, reply.id))).status).toBe(404);
  expect((await createReply(req('POST', `/api/spaces/${spaceId}/discussions/${discussionId}/replies`, replyInput('another')), discussionContext(spaceId, discussionId))).status).toBe(404);
  session('reader');
  const revokedReport = await createReport(req('POST', '/api/reports', { targetType: 'SPACE_REPLY', targetId: reply.id, reason: 'SPAM' }));
  expect(revokedReport.status).toBe(404);
  expect(revokedReport.headers.get('Cache-Control')).toBe('private, no-store');
  session('admin', 'ADMIN');
  expect((await reviewReport(req('PATCH', `/api/reports/${reportId}`, { status: 'DISMISSED', resolutionNote: 'Not spam' }), reportContext(reportId))).status).toBe(200);
  expect((await moderateDiscussion(req('PATCH', `/api/spaces/${spaceId}/discussions/${discussionId}/moderation`, { hidden: false }), discussionContext(spaceId, discussionId))).status).toBe(200);
  expect((await moderateReply(req('PATCH', `/api/spaces/${spaceId}/discussions/${discussionId}/replies/${reply.id}/moderation`, { hidden: false }), replyContext(spaceId, discussionId, reply.id))).status).toBe(200);
  session('reader');
  expect((await getDiscussion(req('GET', `/api/spaces/${spaceId}/discussions/${discussionId}`), discussionContext(spaceId, discussionId))).status).toBe(200);
  expect((await listReplies(req('GET', `/api/spaces/${spaceId}/discussions/${discussionId}/replies`), discussionContext(spaceId, discussionId)).then(response => response.json())).items).toHaveLength(1);
  expect((await createReport(req('POST', '/api/reports', { targetType: 'SPACE_REPLY', targetId: reply.id, reason: 'SPAM' }))).status).toBe(200);
});

test('removed private reporter cannot recover a duplicate report ID or an old reply ID', async () => {
  const space = await makeSpace('PRIVATE');
  const spaceId = space.id;
  session('admin', 'ADMIN');
  for (const userId of ['member', 'reader']) {
    expect((await addMember(req('POST', `/api/spaces/${spaceId}/members`, { userId }), spaceContext(spaceId))).status).toBe(201);
  }
  session('member');
  const discussion = await (await createDiscussion(req('POST', `/api/spaces/${spaceId}/discussions`, discussionInput()), spaceContext(spaceId))).json();
  const reply = await (await createReply(req('POST', `/api/spaces/${spaceId}/discussions/${discussion.id}/replies`, replyInput()), discussionContext(spaceId, discussion.id))).json();
  session('reader');
  const reported = await createReport(req('POST', '/api/reports', { targetType: 'SPACE_REPLY', targetId: reply.id, reason: 'SPAM' }));
  expect(reported.status).toBe(201);
  session('admin', 'ADMIN');
  await removeMember(req('DELETE', `/api/spaces/${spaceId}/members/reader`), { params: Promise.resolve({ spaceId, userId: 'reader' }) });
  await removeMember(req('DELETE', `/api/spaces/${spaceId}/members/member`), { params: Promise.resolve({ spaceId, userId: 'member' }) });
  session('reader');
  expect((await createReport(req('POST', '/api/reports', { targetType: 'SPACE_REPLY', targetId: reply.id, reason: 'SPAM' }))).status).toBe(404);
  session('member');
  expect((await getReply(req('GET', `/api/spaces/${spaceId}/discussions/${discussion.id}/replies/${reply.id}`), replyContext(spaceId, discussion.id, reply.id))).status).toBe(404);
});
