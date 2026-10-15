// app/api/notifications/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { NotificationType } from '@prisma/client';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { notificationTargetState, resolveNotificationTargets } from '@/lib/server/notification-target';
import { decodeNotificationCursor, encodeNotificationCursor, type NotificationCursor } from '@/lib/server/notification-cursor';

const PAGE_SIZE = 50;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100 && value.trim() === value;

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const cursor = new URL(req.url).searchParams.get('cursor');
    let cursorNotification: NotificationCursor | null = null;
    if (cursor?.startsWith('v1.')) {
      cursorNotification = decodeNotificationCursor(cursor, session.user.id);
    } else if (cursor !== null && validId(cursor)) {
      // Accept old row-ID cursors during a rolling client upgrade.
      cursorNotification = await prisma.notification.findFirst({
        where: { id: cursor, userId: session.user.id },
        select: { id: true, createdAt: true },
      });
    }
    if (cursor !== null && !cursorNotification) {
      return new NextResponse('Invalid cursor', { status: 400 });
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId: session.user.id,
          ...(cursorNotification ? {
            OR: [
              { createdAt: { lt: cursorNotification.createdAt } },
              { createdAt: cursorNotification.createdAt, id: { lt: cursorNotification.id } },
            ],
          } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
      }),
      prisma.notification.count({ where: { userId: session.user.id, isRead: false } }),
    ]);

    const page = notifications.slice(0, PAGE_SIZE);
    const actions = await resolveNotificationTargets(page, session.user.id);
    const items = page.map((notification, index) => {
      const { targetType, targetId, ...publicNotification } = notification;
      if (!targetType && !targetId) return publicNotification;
      const action = actions[index];
      const targetState = notificationTargetState(notification, action);
      return {
        ...publicNotification,
        content: targetState === 'unavailable' ? 'Das zugehörige Ziel ist nicht mehr verfügbar.' : notification.content,
        targetState,
        actionLabel: action?.label ?? null,
      };
    });
    return NextResponse.json({ items, nextCursor: notifications.length > PAGE_SIZE ? encodeNotificationCursor(page[page.length - 1], session.user.id) : null, unreadCount }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[NOTIFICATIONS_GET]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const body = await readJsonObject(req);
    const { type, content } = body;

    if (
      typeof content !== 'string' ||
      !content.trim() ||
      content.length > 2000 ||
      typeof type !== 'string' ||
      !Object.values(NotificationType).includes(type as NotificationType) ||
      !['SYSTEM', 'CHAT_MESSAGE', 'MENTION'].includes(type) ||
      ['targetType', 'targetId', 'href', 'url', 'destination', 'action'].some(key => Object.prototype.hasOwnProperty.call(body, key))
    ) {
      return new NextResponse('Invalid notification', { status: 400 });
    }

    const notification = await prisma.notification.create({
      data: {
        type: type as NotificationType,
        content: content.trim(),
        // Clients may create local notifications, but they must not choose
        // another recipient. Server-side domain events use Prisma directly.
        userId: session.user.id,
      },
    });

    return NextResponse.json(notification);
  } catch (error) {
    const requestError = requestErrorResponse(error);
    if (requestError) return requestError;
    console.error('[NOTIFICATIONS_POST]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const body = await readJsonObject(req);
    const { id, isRead } = body;

    if (!validId(id) || typeof isRead !== 'boolean') {
      return new NextResponse('Invalid notification update', { status: 400 });
    }

    const result = await prisma.notification.updateMany({
      where: {
        id,
        userId: session.user.id,
      },
      data: {
        isRead,
      },
    });

    if (result.count === 0) return new NextResponse('Notification not found', { status: 404 });
    // A read-state mutation must not re-expose stale content from a target
    // which has since been deleted or made private.
    return NextResponse.json({ id, isRead });
  } catch (error) {
    const requestError = requestErrorResponse(error);
    if (requestError) return requestError;
    console.error('[NOTIFICATIONS_PATCH]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!validId(id)) {
      return new NextResponse('ID is required', { status: 400 });
    }

    const result = await prisma.notification.deleteMany({
      where: {
        id,
        userId: session.user.id,
      },
    });

    return new NextResponse(null, { status: result.count > 0 ? 204 : 404 });
  } catch (error) {
    console.error('[NOTIFICATIONS_DELETE]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
