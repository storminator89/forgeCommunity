/** @jest-environment node */

import { rmSync } from 'node:fs';
import { GET as getChannels } from '@/app/api/chat/channels/route';
import { POST as markRead } from '@/app/api/chat/channels/[channelId]/read/route';
import { getUnreadChannelIds } from '@/lib/server/chat-unread';
import { getServerSession } from '@/lib/sites-auth/server';
import prisma from '@/lib/prisma';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(value), {
      ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  }
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  // CI uses the generated client from db:generate. A local developer can
  // point this at an isolated generated output without altering shared deps.
  const { PrismaClient } = jest.requireActual(process.env.CHAT_UNREAD_CLIENT_PATH || '@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-chat-unread-'));
  const path = join(directory, 'chat.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => item.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const at = new Date('2026-10-15T12:00:00.000Z');
function actor(id: string, role = 'USER') {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
}
function request(channelId: string, messageId: string | null) {
  return markRead(new Request(`http://localhost/api/chat/channels/${channelId}/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId }),
  }), { params: Promise.resolve({ channelId }) });
}
async function unreadMap() {
  const response = await getChannels();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  return new Map((await response.json()).map((channel: { id: string; hasUnread: boolean }) => [channel.id, channel.hasUnread]));
}

beforeAll(async () => {
  process.env.DATABASE_PROVIDER = 'sqlite';
  for (const id of ['reader', 'other', 'admin']) {
    await prisma.user.create({ data: { id, email: `${id}@example.invalid` } });
  }
  await prisma.chatChannel.createMany({ data: [
    { id: 'public-room', name: 'Public' },
    { id: 'empty-room', name: 'Empty' },
    { id: 'private-room', name: 'Private', isPrivate: true },
  ] });
  await prisma.chatMember.create({ data: { channelId: 'private-room', userId: 'reader' } });
  await prisma.chatMessage.createMany({ data: [
    { id: 'a', channelId: 'public-room', authorId: 'other', content: 'old', createdAt: at },
    { id: 'private-a', channelId: 'private-room', authorId: 'other', content: 'secret', createdAt: at },
  ] });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('unvisited history has no dots; a visible empty-room read initializes unread tracking', async () => {
  actor('reader');
  expect(await unreadMap()).toEqual(new Map([
    ['private-room', false], ['empty-room', false], ['public-room', false],
  ]));
  expect((await request('empty-room', null)).status).toBe(200);
  await prisma.chatMessage.create({ data: { id: 'empty-new', channelId: 'empty-room', authorId: 'other', content: 'new' } });
  expect((await unreadMap()).get('empty-room')).toBe(true);
});

test('another author becomes unread after a real cursor, tied IDs order correctly, and older device cannot regress', async () => {
  actor('reader');
  expect((await request('public-room', 'a')).status).toBe(200);
  await prisma.chatMessage.create({ data: { id: 'b', channelId: 'public-room', authorId: 'other', content: 'same time', createdAt: at } });
  expect((await unreadMap()).get('public-room')).toBe(true);
  await prisma.chatMessage.create({ data: { id: 'c', channelId: 'public-room', authorId: 'reader', content: 'mine', createdAt: new Date(at.getTime() + 1000) } });
  expect((await unreadMap()).get('public-room')).toBe(true);
  expect((await request('public-room', 'c')).status).toBe(200);
  expect((await unreadMap()).get('public-room')).toBe(false);
  expect((await request('public-room', 'a')).status).toBe(200);
  expect(await prisma.chatReadCursor.findUnique({ where: { userId_channelId: { userId: 'reader', channelId: 'public-room' } } }))
    .toMatchObject({ lastReadId: 'c' });
  expect((await unreadMap()).get('public-room')).toBe(false);
  actor('admin', 'ADMIN');
  expect((await unreadMap()).get('public-room')).toBe(false);
});

test('simultaneous older and newer device advances retain the newer position', async () => {
  actor('reader');
  await prisma.chatChannel.create({ data: { id: 'race-room', name: 'Race' } });
  await prisma.chatMessage.createMany({ data: [
    { id: 'race-old', channelId: 'race-room', authorId: 'other', content: 'old', createdAt: at },
    { id: 'race-new', channelId: 'race-room', authorId: 'other', content: 'new', createdAt: new Date(at.getTime() + 1000) },
    { id: 'race-later', channelId: 'race-room', authorId: 'other', content: 'later', createdAt: new Date(at.getTime() + 2000) },
  ] });
  const cursor = () => prisma.chatReadCursor.findUniqueOrThrow({
    where: { userId_channelId: { userId: 'reader', channelId: 'race-room' } },
  });
  // First exercise competing inserts for a previously unopened room.
  expect((await Promise.all([request('race-room', 'race-new'), request('race-room', 'race-old')]))
    .map(response => response.status)).toEqual([200, 200]);
  expect((await cursor()).lastReadId).toBe('race-new');
  // Then exercise competing conditional updates against an existing row.
  expect((await Promise.all([request('race-room', 'race-old'), request('race-room', 'race-later')]))
    .map(response => response.status)).toEqual([200, 200]);
  expect((await cursor()).lastReadId).toBe('race-later');
});

test('private list visibility never grants unread or mark-read access to an unjoined admin', async () => {
  await prisma.chatReadCursor.create({ data: { userId: 'admin', channelId: 'private-room' } });
  actor('admin', 'ADMIN');
  expect((await unreadMap()).get('private-room')).toBe(false);
  expect((await request('private-room', 'private-a')).status).toBe(403);
  actor('reader');
  expect((await request('private-room', 'public-room')).status).toBe(404);
  expect((await request('private-room', 'private-a')).status).toBe(200);
  expect((await unreadMap()).get('private-room')).toBe(false);
});

test('cursor rows cascade with accounts and channels', async () => {
  actor('reader');
  expect((await prisma.chatReadCursor.count()).valueOf()).toBeGreaterThan(0);
  await prisma.chatChannel.delete({ where: { id: 'empty-room' } });
  expect(await prisma.chatReadCursor.count({ where: { channelId: 'empty-room' } })).toBe(0);
  await prisma.user.delete({ where: { id: 'admin' } });
  expect(await prisma.chatReadCursor.count({ where: { userId: 'admin' } })).toBe(0);
});

test('PostgreSQL raw query uses a safely quoted custom schema rather than public', async () => {
  const oldProvider = process.env.DATABASE_PROVIDER;
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_PROVIDER = 'postgresql';
  process.env.DATABASE_URL = 'postgresql://invalid.example/forge?schema=team%22space';
  const query = jest.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([]);
  try {
    await getUnreadChannelIds('reader');
    const statement = query.mock.calls[0][0] as { sql: string; values: string[] };
    expect(statement.sql).toContain('"team""space"."ChatReadCursor"');
    expect(statement.sql).toContain('"team""space"."ChatMessage"');
    expect(statement.values).toEqual(['reader', 'reader', 'reader', 'reader', 'reader']);
  } finally {
    query.mockRestore();
    process.env.DATABASE_PROVIDER = oldProvider;
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
  }
});
