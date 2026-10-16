import { GET as inbox, POST as createLegacy } from '@/app/api/notifications/route';
import { POST as open } from '@/app/api/notifications/[id]/open/route';
import { resolveNotificationTarget } from '@/lib/server/notification-target';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

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
jest.mock('@/lib/server/api-input', () => ({ readJsonObject: (request: Request) => request.json(), requestErrorResponse: () => null }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  notification: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  comment: { findFirst: jest.fn(), findMany: jest.fn() },
  chatMessage: { findFirst: jest.fn(), findMany: jest.fn() },
  event: { findFirst: jest.fn(), findMany: jest.fn() },
} }));

const db = prisma as unknown as {
  notification: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
  user: { findUnique: jest.Mock; findMany: jest.Mock };
  comment: { findFirst: jest.Mock; findMany: jest.Mock };
  chatMessage: { findFirst: jest.Mock; findMany: jest.Mock };
  event: { findFirst: jest.Mock; findMany: jest.Mock };
};
const notification = (overrides: Record<string, unknown> = {}) => ({
  id: 'notification1', userId: 'alice', type: 'COMMENT', content: 'A comment',
  targetType: 'COMMENT', targetId: 'comment1', isRead: false, createdAt: new Date('2026-10-01T00:00:00Z'),
  ...overrides,
});
const request = (value: unknown) => ({ json: async () => value }) as Request;
const openRequest = (id = 'notification1') => open({} as Request, { params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'alice', role: 'USER' } } as never);
  db.notification.count.mockResolvedValue(1);
  db.notification.updateMany.mockResolvedValue({ count: 1 });
  db.user.findMany.mockResolvedValue([]);
  db.comment.findMany.mockResolvedValue([]);
  db.chatMessage.findMany.mockResolvedValue([]);
  db.event.findMany.mockResolvedValue([]);
});

test('rejects a forged destination, external URL, and client-created FOLLOW', async () => {
  for (const body of [
    { type: 'CHAT_MESSAGE', content: 'forged', targetType: 'CHAT_MESSAGE', targetId: 'message1' },
    { type: 'SYSTEM', content: 'forged', href: 'https://attacker.example' },
    { type: 'SYSTEM', content: 'forged', url: '//attacker.example' },
    { type: 'FOLLOW', content: 'forged' },
  ]) {
    expect((await createLegacy(request(body))).status).toBe(400);
  }
  expect(db.notification.create).not.toHaveBeenCalled();
  expect(await resolveNotificationTarget(notification({ type: 'SYSTEM', targetType: 'URL', targetId: '//attacker.example' }) as never, 'alice')).toBeNull();
});

test('hides deleted or newly private targets and their old content', async () => {
  db.notification.findMany.mockResolvedValue([notification({ content: 'Old private excerpt' })]);
  db.comment.findMany.mockResolvedValue([]);
  const response = await inbox({ url: 'http://localhost/api/notifications' } as Request);
  const data = await response.json();
  expect(data.items[0]).toMatchObject({ targetState: 'unavailable', content: 'Das zugehörige Ziel ist nicht mehr verfügbar.', actionLabel: null });
  expect(JSON.stringify(data)).not.toContain('Old private excerpt');
  expect(JSON.stringify(data)).not.toContain('targetId');
  expect(db.comment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    id: { in: ['comment1'] }, post: { OR: [{ published: true }, { authorId: 'alice' }] },
  }) }));
  db.notification.findFirst.mockResolvedValue(notification());
  expect((await openRequest()).status).toBe(404);
  expect(db.notification.updateMany).not.toHaveBeenCalled();
});

test('an account cannot open another recipient’s notification even with a known ID', async () => {
  db.notification.findFirst.mockResolvedValue(null);
  expect((await openRequest('bobnotification')).status).toBe(404);
  expect(db.notification.findFirst).toHaveBeenCalledWith({ where: { id: 'bobnotification', userId: 'alice' } });
  expect(db.comment.findFirst).not.toHaveBeenCalled();
  expect(db.notification.updateMany).not.toHaveBeenCalled();
});

test('opening a verified comment returns only an internal link and marks only its recipient read', async () => {
  db.notification.findFirst.mockResolvedValue(notification());
  db.comment.findFirst.mockResolvedValue({ id: 'comment1' });
  const response = await openRequest();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ href: '/community#comment-comment1', label: 'Kommentar ansehen' });
  expect(db.notification.updateMany).toHaveBeenCalledWith({ where: { id: 'notification1', userId: 'alice' }, data: { isRead: true } });
});

test('chat target lookup requires current membership for private channels', async () => {
  const target = notification({ type: 'CHAT_MESSAGE', targetType: 'CHAT_MESSAGE', targetId: 'message1' });
  db.chatMessage.findFirst.mockResolvedValue(null);
  expect(await resolveNotificationTarget(target as never, 'alice')).toBeNull();
  expect(db.chatMessage.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
    id: 'message1', channel: { OR: [{ isPrivate: false }, { members: { some: { userId: 'alice' } } }] },
  } }));
  db.chatMessage.findFirst.mockResolvedValue({ id: 'message1', channelId: 'private1' });
  expect(await resolveNotificationTarget(target as never, 'alice')).toEqual({
    href: '/chat?channelId=private1&messageId=message1', label: 'Nachricht ansehen',
  });
});


test('EVENT targets require the recipient’s current active registration, and forged EVENT creation is rejected', async () => {
  const target = notification({ type: 'EVENT', targetType: 'EVENT', targetId: 'event1' });
  db.event.findFirst.mockResolvedValue({ id: 'event1' });
  expect(await resolveNotificationTarget(target as never, 'alice')).toEqual({ href: '/events#event-event1', label: 'Event ansehen' });
  expect(db.event.findFirst).toHaveBeenCalledWith({ where: { id: 'event1', attendees: { some: { userId: 'alice', status: { not: 'CANCELLED' } } } }, select: { id: true } });
  db.event.findFirst.mockResolvedValue(null);
  expect(await resolveNotificationTarget(target as never, 'alice')).toBeNull();
  expect((await createLegacy(request({ type: 'EVENT', content: 'Forged' }))).status).toBe(400);
  db.notification.findMany.mockResolvedValue([target]);
  const data = await (await inbox({ url: 'http://localhost/api/notifications' } as Request)).json();
  expect(data.items[0]).toMatchObject({ targetState: 'unavailable', actionLabel: null });
  expect(db.event.findMany).toHaveBeenCalledWith({ where: { id: { in: ['event1'] }, attendees: { some: { userId: 'alice', status: { not: 'CANCELLED' } } } }, select: { id: true } });
});
