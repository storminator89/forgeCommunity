/** @jest-environment node */

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  chatChannel: { findMany: jest.fn(), create: jest.fn() },
} }));
jest.mock('@/lib/server/chat-unread', () => ({ getUnreadChannelIds: jest.fn() }));

import { GET, POST } from '@/app/api/chat/channels/route';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';
import { getUnreadChannelIds } from '@/lib/server/chat-unread';

const db = prisma as unknown as { chatChannel: { findMany: jest.Mock; create: jest.Mock } };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'member', role: 'USER' } } as never);
  jest.mocked(getUnreadChannelIds).mockResolvedValue(new Set());
});

test('channel list checks private membership and projects only fields used by chat', async () => {
  db.chatChannel.findMany.mockResolvedValue([{ id: 'room', name: 'Room', isPrivate: true, _count: { members: 500 } }]);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([{ id: 'room', name: 'Room', isPrivate: true, hasUnread: false, _count: { members: 500 } }]);
  expect(getUnreadChannelIds).toHaveBeenCalledWith('member');
  expect(db.chatChannel.findMany).toHaveBeenCalledWith({
    where: { OR: [
      { isPrivate: false },
      { members: { some: { userId: 'member' } } },
    ] },
    select: { id: true, name: true, isPrivate: true, _count: { select: { members: true } } },
    orderBy: { createdAt: 'desc' },
  });
});

test('new channel response does not expand the channel-list payload', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } } as never);
  db.chatChannel.create.mockResolvedValue({ id: 'new', name: 'New', isPrivate: false, _count: { members: 1 } });
  const response = await POST(new Request('http://localhost/api/chat/channels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New', isPrivate: false }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'new', name: 'New', isPrivate: false, hasUnread: false, _count: { members: 1 } });
  expect(db.chatChannel.create).toHaveBeenCalledWith(expect.objectContaining({
    select: { id: true, name: true, isPrivate: true, _count: { select: { members: true } } },
  }));
});
