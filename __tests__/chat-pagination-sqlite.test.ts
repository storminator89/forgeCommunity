/** @jest-environment node */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GET } from '@/app/api/chat/messages/route';
import { GET as getChannels } from '@/app/api/chat/channels/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

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
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-chat-pagination-'));
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

const timestamp = new Date('2026-10-15T12:00:00.000Z');
function request(channelId: string, cursor?: { before: string; beforeId: string }) {
  return new Request(`http://localhost/api/chat/messages?${new URLSearchParams({ channelId, ...cursor })}`);
}
function actor(id: string) {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id, role: 'USER' } } as never);
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: 'chat-member', email: 'chat-member@example.invalid' },
    { id: 'chat-outsider', email: 'chat-outsider@example.invalid' },
  ] });
  await prisma.chatChannel.createMany({ data: [
    { id: 'private-room', name: 'Private', isPrivate: true },
    { id: 'public-room', name: 'Public', isPrivate: false },
  ] });
  await prisma.chatMember.create({ data: { channelId: 'private-room', userId: 'chat-member' } });
  await prisma.chatMessage.createMany({ data: [
    ...Array.from({ length: 130 }, (_, index) => ({
      id: `private-${String(index).padStart(3, '0')}`,
      channelId: 'private-room', authorId: 'chat-member', content: `secret-${index}`,
      createdAt: timestamp,
    })),
    { id: 'public-001', channelId: 'public-room', authorId: 'chat-member', content: 'public', createdAt: timestamp },
  ] });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('SQLite keyset history crosses tied timestamps without duplicates and stays room-scoped', async () => {
  actor('chat-member');
  const channelList = await getChannels();
  expect(channelList.status).toBe(200);
  expect(channelList.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await channelList.json()).toEqual(expect.arrayContaining([
    { id: 'private-room', name: 'Private', isPrivate: true, _count: { members: 1 } },
  ]));
  const ids: string[] = [];
  let cursor: { before: string; beforeId: string } | undefined;
  for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
    const response = await GET(request('private-room', cursor));
    expect(response.status).toBe(200);
    const body = await response.json();
    ids.unshift(...body.items.map((item: { id: string }) => item.id));
    cursor = body.hasMore ? body.previousCursor : undefined;
  }
  expect(ids).toEqual(Array.from({ length: 130 }, (_, index) => `private-${String(index).padStart(3, '0')}`));
  expect(cursor).toBeUndefined();
  const publicResponse = await GET(request('public-room', { before: timestamp.toISOString(), beforeId: 'private-100' }));
  expect((await publicResponse.json()).items).toEqual([]);
});

test('raw SQLite browser fixture returns real 50/50/20 history pages without a false live update', async () => {
  const channelId = 'raw-fixture-room';
  await prisma.chatChannel.create({ data: {
    id: channelId, name: 'Raw fixture', isPrivate: true,
    members: { create: { userId: 'chat-member' } },
  } });
  const db = new DatabaseSync(join(jest.requireMock('@/lib/prisma').__tempDirectory, 'chat.db'));
  try {
    db.exec('PRAGMA foreign_keys = ON; BEGIN');
    const insert = db.prepare(`INSERT INTO "ChatMessage" ("id", "channelId", "authorId", "content", "createdAt", "updatedAt")
      VALUES (?, ?, 'chat-member', ?, '2020-01-01T12:00:00.000+00:00', '2020-01-01T12:00:00.000+00:00')`);
    for (let index = 0; index < 120; index++) {
      const order = String(index).padStart(3, '0');
      insert.run(`raw-${order}`, channelId, `message ${order}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }

  actor('chat-member');
  const expectedIds = Array.from({ length: 120 }, (_, index) => `raw-${String(index).padStart(3, '0')}`);
  let cursor: { before: string; beforeId: string } | undefined;
  const expectedPages: Array<[number, number, boolean]> = [
    [70, 120, true], [20, 70, true], [0, 20, false],
  ];
  for (const [start, end, hasMore] of expectedPages) {
    const response = await GET(request(channelId, cursor));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(expectedIds.slice(start, end));
    expect(body.hasMore).toBe(hasMore);
    expect(body.previousCursor?.beforeId).toBe(expectedIds[start]);
    cursor = body.previousCursor;
  }
  const newer = await GET(new Request(`http://localhost/api/chat/messages?${new URLSearchParams({
    channelId, after: '2020-01-01T12:00:00.000Z', afterId: 'raw-119',
  })}`));
  expect(newer.status).toBe(200);
  expect((await newer.json()).items).toEqual([]);
  await prisma.chatChannel.delete({ where: { id: channelId } });
});

test('SQLite history denies outsiders and revoked members before querying message content', async () => {
  actor('chat-outsider');
  expect((await GET(request('private-room', { before: timestamp.toISOString(), beforeId: 'private-100' }))).status).toBe(403);
  await prisma.chatMember.delete({ where: { userId_channelId: { userId: 'chat-member', channelId: 'private-room' } } });
  actor('chat-member');
  expect((await GET(request('private-room', { before: timestamp.toISOString(), beforeId: 'private-100' }))).status).toBe(403);
  expect(await (await getChannels()).json()).toEqual([
    { id: 'public-room', name: 'Public', isPrivate: false, _count: { members: 0 } },
  ]);
});
