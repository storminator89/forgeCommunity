import { POST as sendMessage } from '@/app/api/chat/messages/route';
import { PATCH as editMessage } from '@/app/api/chat/messages/[messageId]/route';
import { GET as listNotifications, PATCH as updateNotification } from '@/app/api/notifications/route';
import { GET as notificationStream } from '@/app/api/notifications/sse/route';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });
    }
  }
  return { NextResponse: MockNextResponse };
});
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/api-input', () => ({
  readJsonObject: (req: Request) => req.json(),
  requestErrorResponse: () => null,
}));
jest.mock('@/lib/server/image-upload', () => ({ getChatUploadOwnerId: jest.fn(() => 'member') }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  chatChannel: { findFirst: jest.fn() },
  chatMessage: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  chatMember: { findMany: jest.fn() },
  notification: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
  $transaction: jest.fn(),
} }));

const db = prisma as unknown as {
  chatChannel: { findFirst: jest.Mock };
  chatMessage: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
  chatMember: { findMany: jest.Mock };
  notification: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock; updateMany: jest.Mock; createMany: jest.Mock };
  $transaction: jest.Mock;
};
const req = (body: unknown) => ({ json: async () => body }) as Request;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'member', role: 'USER' } } as never);
  db.$transaction.mockImplementation((callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  db.chatMember.findMany.mockResolvedValue([]);
});

it('blocks a removed author from editing an old private message', async () => {
  db.chatMessage.findUnique.mockResolvedValue({ id: 'message', authorId: 'member', channelId: 'private' });
  db.chatChannel.findFirst.mockResolvedValue(null);
  const result = await editMessage(req({ content: 'edited' }), { params: Promise.resolve({ messageId: 'message' }) });
  expect(result.status).toBe(403);
  expect(db.chatChannel.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    id: 'private', OR: expect.arrayContaining([{ members: { some: { userId: 'member' } } }]),
  }) }));
  expect(db.chatMessage.update).not.toHaveBeenCalled();
});

it('stores image-only messages with a string content and rejects malformed message fields', async () => {
  db.chatChannel.findFirst.mockResolvedValue({ id: 'public' });
  db.chatMessage.create.mockResolvedValue({ id: 'message' });
  const sent = await sendMessage(req({ channelId: 'public', imageUrl: '/api/chat/uploads/member-image', messageType: 'image' }));
  expect(sent.status).toBe(200);
  expect(db.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content: '' }) }));
  expect((await sendMessage(req({ channelId: { id: 'public' }, content: 'hi' }))).status).toBe(400);
  expect((await sendMessage(req({ channelId: 'public', content: 'hi', messageType: 'admin' }))).status).toBe(400);
});

it('notifies only explicit other channel members with a real message target', async () => {
  db.chatChannel.findFirst.mockResolvedValue({ id: 'private', name: 'room', isPrivate: true });
  db.chatMessage.create.mockResolvedValue({ id: 'message1', author: { name: 'Member' } });
  db.chatMember.findMany.mockResolvedValue([{ userId: 'recipient' }]);
  const result = await sendMessage(req({ channelId: 'private', content: 'Hello' }));
  expect(result.status).toBe(200);
  expect(db.chatMember.findMany).toHaveBeenCalledWith({ where: { channelId: 'private', userId: { not: 'member' } }, select: { userId: true } });
  expect(db.notification.createMany).toHaveBeenCalledWith({ data: [{
    userId: 'recipient', type: 'CHAT_MESSAGE', content: 'Member hat in #room geschrieben.',
    targetType: 'CHAT_MESSAGE', targetId: 'message1',
  }] });
});

it('pages notifications by an owned cursor and reports unread count across pages', async () => {
  db.notification.findFirst.mockResolvedValue({ id: 'cursor', createdAt: new Date('2026-01-02') });
  db.notification.findMany.mockResolvedValue([{ id: 'older', createdAt: new Date('2026-01-01') }]);
  db.notification.count.mockResolvedValue(72);
  const response = await listNotifications({ url: 'http://localhost/api/notifications?cursor=cursor' } as Request);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [{ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' }], nextCursor: null, unreadCount: 72 });
  expect(db.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51, where: expect.objectContaining({ userId: 'member' }) }));
  db.notification.findFirst.mockResolvedValue(null);
  expect((await listNotifications({ url: 'http://localhost/api/notifications?cursor=foreign' } as Request)).status).toBe(400);
});

it('validates notification updates and reports missing owned IDs without a server error', async () => {
  expect((await updateNotification(req({ id: 3, isRead: 'yes' }))).status).toBe(400);
  expect(db.notification.updateMany).not.toHaveBeenCalled();
  db.notification.updateMany.mockResolvedValue({ count: 0 });
  expect((await updateNotification(req({ id: 'missing', isRead: true }))).status).toBe(404);
  expect(db.notification.updateMany).toHaveBeenCalledWith({ where: { id: 'missing', userId: 'member' }, data: { isRead: true } });
});

it('does not open an inert notification stream', async () => {
  expect((await notificationStream()).status).toBe(501);
});
