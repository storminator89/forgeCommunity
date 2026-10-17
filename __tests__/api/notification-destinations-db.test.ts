/** @jest-environment node */
import { GET as listNotifications, POST as createLegacy } from '@/app/api/notifications/route';
import { POST as openNotification } from '@/app/api/notifications/[id]/open/route';
import { GET as getLinkedChatMessage } from '@/app/api/chat/messages/[messageId]/route';
import { GET as getLinkedComment } from '@/app/api/posts/linked-comment/[commentId]/route';
import { POST as createComment } from '@/app/api/posts/[postId]/comments/route';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(body: unknown, init?: ResponseInit) { return new Response(JSON.stringify(body), init); }
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({ sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').trim() }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-notification-targets-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      database.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { database.close(); }
  return { __esModule: true, __tempDirectory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const viewer = (id: string) => jest.mocked(getServerSession).mockResolvedValue({ user: { id, role: 'USER' } } as never);
const open = (id: string) => openNotification({} as Request, { params: Promise.resolve({ id }) });
const list = () => listNotifications(new Request('http://localhost/api/notifications'));

beforeAll(async () => {
  await prisma.user.createMany({ data: ['alice', 'bob', 'charlie', 'dave'].map(id => ({ id, email: `${id}@example.invalid` })) });
  await prisma.post.create({ data: { id: 'post1', title: 'A post', content: 'Content', published: true, authorId: 'alice' } });
  await prisma.comment.create({ data: { id: 'comment1', postId: 'post1', content: 'Reply', authorId: 'bob' } });
  await prisma.chatChannel.create({ data: { id: 'room1', name: 'Private', isPrivate: true,
    members: { create: [{ userId: 'alice' }, { userId: 'bob' }] } } });
  await prisma.chatMessage.create({ data: { id: 'message1', content: 'Private chat', channelId: 'room1', authorId: 'bob' } });
  await prisma.notification.createMany({ data: [
    { id: 'commentnotice', userId: 'alice', type: 'COMMENT', content: 'Old private excerpt', targetType: 'COMMENT', targetId: 'comment1' },
    { id: 'chatnotice', userId: 'alice', type: 'CHAT_MESSAGE', content: 'Old private chat', targetType: 'CHAT_MESSAGE', targetId: 'message1' },
    { id: 'forgednotice', userId: 'charlie', type: 'COMMENT', content: 'Forbidden private comment', targetType: 'COMMENT', targetId: 'comment1' },
    { id: 'follownotice', userId: 'alice', type: 'FOLLOW', content: 'A follower', targetType: 'USER', targetId: 'dave' },
  ] });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('returns and opens only currently visible targets belonging to the recipient', async () => {
  viewer('alice');
  const response = await list();
  const data = await response.json();
  expect(data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'commentnotice', targetState: 'available', actionLabel: 'Kommentar ansehen' }),
    expect.objectContaining({ id: 'chatnotice', targetState: 'available', actionLabel: 'Nachricht ansehen' }),
  ]));
  expect((await open('forgednotice')).status).toBe(404);
  expect((await open('commentnotice')).status).toBe(200);
  expect(await (await open('chatnotice')).json()).toEqual({ href: '/chat?channelId=room1&messageId=message1', label: 'Nachricht ansehen' });
  expect((await getLinkedChatMessage({} as Request, { params: Promise.resolve({ messageId: 'message1' }) })).status).toBe(200);
});

test('hides another user’s private target even if its notification row is forged', async () => {
  await prisma.post.update({ where: { id: 'post1' }, data: { published: false } });
  viewer('charlie');
  const data = await (await list()).json();
  expect(data.items.find((item: { id: string }) => item.id === 'forgednotice')).toMatchObject({
    content: 'Das zugehörige Ziel ist nicht mehr verfügbar.', targetState: 'unavailable', actionLabel: null,
  });
  expect((await open('forgednotice')).status).toBe(404);
  expect((await getLinkedChatMessage({} as Request, { params: Promise.resolve({ messageId: 'message1' }) })).status).toBe(404);
});

test('deletion and revoked membership leave safe inbox fallbacks', async () => {
  await prisma.comment.delete({ where: { id: 'comment1' } });
  await prisma.chatMember.delete({ where: { userId_channelId: { userId: 'alice', channelId: 'room1' } } });
  await prisma.user.delete({ where: { id: 'dave' } });
  viewer('alice');
  const data = await (await list()).json();
  for (const id of ['commentnotice', 'chatnotice', 'follownotice']) {
    expect(data.items.find((item: { id: string }) => item.id === id)).toMatchObject({
      content: 'Das zugehörige Ziel ist nicht mehr verfügbar.', targetState: 'unavailable', actionLabel: null,
    });
    expect((await open(id)).status).toBe(404);
  }
  expect((await getLinkedChatMessage({} as Request, { params: Promise.resolve({ messageId: 'message1' }) })).status).toBe(404);
});

test('rejects client-authored external destinations even with an authenticated account', async () => {
  viewer('alice');
  const request = new Request('http://localhost/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'SYSTEM', content: 'Click me', href: '//attacker.example' }) });
  expect((await createLegacy(request)).status).toBe(400);
});

test('keyset pagination survives deleting its cursor row and stays account-bound', async () => {
  await prisma.notification.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
    id: `batch${String(index).padStart(3, '0')}`, userId: 'alice', type: 'SYSTEM' as const, content: `Notice ${index}`,
  })) });
  viewer('alice');
  const first = await (await list()).json();
  expect(first.items).toHaveLength(50);
  expect(first.nextCursor).toMatch(/^v1\./);
  await prisma.notification.delete({ where: { id: first.items[49].id } });
  const secondResponse = await listNotifications(new Request(`http://localhost/api/notifications?cursor=${encodeURIComponent(first.nextCursor)}`));
  expect(secondResponse.status).toBe(200);
  const second = await secondResponse.json();
  const delivered = [...first.items, ...second.items].filter((item: { id: string }) => item.id.startsWith('batch')).map((item: { id: string }) => item.id);
  expect(new Set(delivered).size).toBe(55);
  viewer('charlie');
  expect((await listNotifications(new Request(`http://localhost/api/notifications?cursor=${encodeURIComponent(first.nextCursor)}`))).status).toBe(400);
});

test('an actionable older comment resolves the exact linked comment beyond the feed preview', async () => {
  await prisma.post.create({ data: { id: 'post2', title: 'Second post', content: 'Content', published: true, authorId: 'alice' } });
  await prisma.comment.create({ data: { id: 'oldreply', postId: 'post2', content: 'An older reply', authorId: 'bob', createdAt: new Date('2026-01-01T00:00:00Z') } });
  await prisma.comment.createMany({ data: Array.from({ length: 5 }, (_, index) => ({
    id: `newreply${index}`, postId: 'post2', content: `Newer ${index}`, authorId: 'bob',
    createdAt: new Date(`2026-01-0${index + 2}T00:00:00Z`),
  })) });
  await prisma.notification.create({ data: { id: 'oldreplynotice', userId: 'alice', type: 'COMMENT',
    content: 'Ein Mitglied hat deinen Beitrag kommentiert.', targetType: 'COMMENT', targetId: 'oldreply' } });
  viewer('alice');
  expect(await (await open('oldreplynotice')).json()).toEqual({ href: '/community#comment-oldreply', label: 'Kommentar ansehen' });
  const post = await (await getLinkedComment(new Request('http://localhost/api/posts/linked-comment/oldreply') as never,
    { params: Promise.resolve({ commentId: 'oldreply' }) })).json();
  expect(post.comments.map((comment: { id: string }) => comment.id)).toContain('oldreply');
});

test('comment creation addresses one notification to the post author', async () => {
  await prisma.post.create({ data: { id: 'post3', title: 'Third post', content: 'Content', published: true, authorId: 'alice' } });
  viewer('bob');
  const response = await createComment(new Request('http://localhost/api/posts/post3/comments', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'A real reply' }),
  }) as never, { params: Promise.resolve({ postId: 'post3' }) });
  expect(response.status).toBe(200);
  const comment = await response.json();
  expect(await prisma.notification.findFirst({ where: { userId: 'alice', targetType: 'COMMENT', targetId: comment.id } })).toMatchObject({ type: 'COMMENT' });
  expect(await prisma.notification.count({ where: { userId: 'bob', targetId: comment.id } })).toBe(0);
});
