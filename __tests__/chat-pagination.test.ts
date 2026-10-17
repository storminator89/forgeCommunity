/** @jest-environment node */

jest.mock('next/server', () => ({
  NextResponse: class MockNextResponse extends Response {
    static json(body: unknown, init: ResponseInit = {}) {
      return new MockNextResponse(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    }
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    chatChannel: { findFirst: jest.fn() },
    chatMessage: { findMany: jest.fn() },
  },
}));

import { GET } from '@/app/api/chat/messages/route';
import { getServerSession } from '@/lib/sites-auth/server';
import prisma from '@/lib/prisma';

const db = prisma as unknown as {
  chatChannel: { findFirst: jest.Mock };
  chatMessage: { findMany: jest.Mock };
};
const at = new Date('2026-10-15T12:00:00.000Z');
const fixture = Array.from({ length: 130 }, (_, index) => ({
  id: `m${String(index).padStart(3, '0')}`,
  channelId: 'private-room',
  createdAt: at,
  content: String(index),
  author: { id: 'author', name: 'Member', image: null },
}));

function request(params: Record<string, string | undefined>) {
  const query = new URLSearchParams({ channelId: 'private-room' });
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  return new Request(`http://localhost/api/chat/messages?${query}`);
}

type Message = (typeof fixture)[number];
function matches(message: Message, where: Record<string, unknown>): boolean {
  if (message.channelId !== where.channelId) return false;
  const terms = where.OR as { createdAt: { gt?: Date; lt?: Date } | Date; id?: { gt?: string; lt?: string } }[] | undefined;
  if (!terms) return true;
  return terms.some(term => {
    const time = message.createdAt.getTime();
    const createdAt = term.createdAt;
    if (createdAt instanceof Date && time !== createdAt.getTime()) return false;
    if (!(createdAt instanceof Date) && createdAt.gt && time <= createdAt.gt.getTime()) return false;
    if (!(createdAt instanceof Date) && createdAt.lt && time >= createdAt.lt.getTime()) return false;
    if (term.id?.gt && message.id <= term.id.gt) return false;
    if (term.id?.lt && message.id >= term.id.lt) return false;
    return true;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'member', role: 'USER' } } as never);
  db.chatChannel.findFirst.mockResolvedValue({ id: 'private-room' });
  db.chatMessage.findMany.mockImplementation(({ where, orderBy, take }) => {
    const direction = orderBy[0].createdAt === 'asc' ? 1 : -1;
    return Promise.resolve(fixture.filter(message => matches(message, where))
      .sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)))
      .slice(0, take));
  });
});

it('pages the same-timestamp history without omissions or duplicates', async () => {
  const found: string[] = [];
  let cursor: { before: string; beforeId: string } | null = null;
  do {
    const response = await GET(request(cursor ?? {}));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const page = await response.json();
    expect(page.items.length).toBeLessThanOrEqual(50);
    found.unshift(...page.items.map((item: Message) => item.id));
    cursor = page.hasMore ? page.previousCursor : null;
  } while (cursor);
  expect(found).toEqual(fixture.map(message => message.id));
  expect(db.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
});

it('drains forward through a same-timestamp burst', async () => {
  const found: string[] = [];
  let cursor = { after: at.toISOString(), afterId: 'm009' };
  for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
    const response = await GET(request(cursor));
    const page = await response.json();
    found.push(...page.items.map((item: Message) => item.id));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  expect(found).toEqual(fixture.slice(10).map(message => message.id));
});

it('rejects malformed and mixed cursors before accessing private data', async () => {
  for (const params of [
    { after: '' },
    { after: at.toISOString(), afterId: '' },
    { before: 'bad', beforeId: 'm001' },
    { before: at.toISOString() },
    { beforeId: 'm001' },
    { before: at.toISOString(), beforeId: 'm001', after: at.toISOString(), afterId: 'm002' },
  ]) {
    expect((await GET(request(params))).status).toBe(400);
  }
  expect(db.chatChannel.findFirst).not.toHaveBeenCalled();
  expect(db.chatMessage.findMany).not.toHaveBeenCalled();
});

it('checks channel membership for history and live-update cursors', async () => {
  db.chatChannel.findFirst.mockResolvedValue(null);
  for (const params of [
    { before: at.toISOString(), beforeId: 'm100' },
    { after: at.toISOString(), afterId: 'm001' },
  ]) {
    expect((await GET(request(params))).status).toBe(403);
  }
  expect(db.chatChannel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: 'private-room', OR: expect.arrayContaining([
      { members: { some: { userId: 'member' } } },
    ]) }),
  }));
  expect(db.chatMessage.findMany).not.toHaveBeenCalled();
});
