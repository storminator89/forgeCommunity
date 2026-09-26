// app/api/notifications/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { NotificationType } from '@prisma/client';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';

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
    if (cursor !== null && !validId(cursor)) {
      return new NextResponse('Invalid cursor', { status: 400 });
    }
    const cursorNotification = cursor
      ? await prisma.notification.findFirst({
          where: { id: cursor, userId: session.user.id },
          select: { id: true, createdAt: true },
        })
      : null;
    if (cursor && !cursorNotification) {
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

    const items = notifications.slice(0, PAGE_SIZE);
    return NextResponse.json({ items, nextCursor: notifications.length > PAGE_SIZE ? items[items.length - 1].id : null, unreadCount });
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
      !Object.values(NotificationType).includes(type as NotificationType)
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
    const notification = await prisma.notification.findFirst({ where: { id, userId: session.user.id } });
    return NextResponse.json(notification);
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
