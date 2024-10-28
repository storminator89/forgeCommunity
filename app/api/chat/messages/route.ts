// app/api/chat/messages/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { content, channelId, imageUrl, messageType = 'text' } = await req.json();

    if (!content && !imageUrl) {
      return new NextResponse('Content or image is required', { status: 400 });
    }
    if (!channelId) {
      return new NextResponse('ChannelId is required', { status: 400 });
    }

    // Überprüfen, ob der Benutzer Zugang zum Channel hat
    const channel = await prisma.chatChannel.findFirst({
      where: {
        id: channelId,
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
    });

    if (!channel) {
      return new NextResponse('Channel not found or access denied', { status: 403 });
    }

    const message = await prisma.chatMessage.create({
      data: {
        content,
        channelId,
        authorId: session.user.id,
        imageUrl,
        messageType,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error('[MESSAGES_POST]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const channelId = searchParams.get('channelId');
    const after = searchParams.get('after');
    const limit = 50;

    if (!channelId) {
      return new NextResponse('ChannelId is required', { status: 400 });
    }

    // Überprüfen, ob der Benutzer Zugang zum Channel hat
    const channel = await prisma.chatChannel.findFirst({
      where: {
        id: channelId,
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
    });

    if (!channel) {
      return new NextResponse('Channel not found or access denied', { status: 403 });
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        channelId,
        ...(after && {
          createdAt: {
            gt: new Date(after),
          },
        }),
      },
      take: limit,
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return NextResponse.json({
      items: messages,
    });
  } catch (error) {
    console.error('[MESSAGES_GET]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}