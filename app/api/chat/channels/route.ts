// app/api/chat/channels/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { getUnreadChannelIds } from '@/lib/server/chat-unread';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { name, isPrivate = false } = await readJsonObject(req);

    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof isPrivate !== 'boolean') {
      return new NextResponse('Name is required', { status: 400 });
    }

    // Channel erstellen
    const channel = await prisma.chatChannel.create({
      data: {
        name: name.trim(),
        isPrivate,
        // Ersteller automatisch als Mitglied hinzufügen
        members: {
          create: {
            userId: session.user.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        isPrivate: true,
        _count: {
          select: {
            members: true,
          },
        },
      },
    });

    return NextResponse.json({ ...channel, hasUnread: false });
  } catch (error) {
    const requestError = requestErrorResponse(error);
    if (requestError) return requestError;
    console.error('[CHANNELS_POST]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Channels abrufen, zu denen der Benutzer Zugang hat
    const channels = await prisma.chatChannel.findMany({
      where: session.user.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { isPrivate: false },
              {
                members: {
                  some: {
                    userId: session.user.id,
                  },
                },
              },
            ],
          },
      select: {
        id: true,
        name: true,
        isPrivate: true,
        _count: {
          select: {
            members: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const unread = await getUnreadChannelIds(session.user.id);
    return NextResponse.json(channels.map(channel => ({
      ...channel,
      hasUnread: unread.has(channel.id),
    })), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[CHANNELS_GET]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
