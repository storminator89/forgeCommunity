// app/api/chat/messages/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { getChatUploadOwnerId } from '@/lib/server/image-upload';

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

    if (imageUrl !== undefined && imageUrl !== null && imageUrl !== '') {
      if (typeof imageUrl !== 'string' || !imageUrl.startsWith('/api/chat/uploads/')) {
        return new NextResponse('Use an uploaded chat image', { status: 400 });
      }
      const uploadOwner = getChatUploadOwnerId(imageUrl.slice('/api/chat/uploads/'.length));
      if (!uploadOwner || uploadOwner !== session.user.id) {
        return new NextResponse('Image upload does not belong to the current user', { status: 403 });
      }
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
    const afterId = searchParams.get('afterId');
    const limit = 50;

    if (!channelId) {
      return new NextResponse('ChannelId is required', { status: 400 });
    }

    let afterDate: Date | undefined;
    if (after) {
      afterDate = new Date(after);
      if (Number.isNaN(afterDate.getTime())) {
        return new NextResponse('Invalid after cursor', { status: 400 });
      }
    }

    if (afterId && !afterDate) {
      return new NextResponse('afterId requires after', { status: 400 });
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
        ...(afterDate && afterId
          ? {
              OR: [
                { createdAt: { gt: afterDate } },
                { createdAt: afterDate, id: { gt: afterId } },
              ],
            }
          : afterDate
            ? { createdAt: { gt: afterDate } }
            : {}),
      },
      take: limit,
      orderBy: afterDate
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
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

    // Initial visits show the newest page in display order. Incremental
    // requests walk forward from the last delivered composite cursor.
    if (!afterDate) messages.reverse();

    return NextResponse.json({
      items: messages,
      nextCursor: messages.length > 0
        ? {
            after: messages[messages.length - 1].createdAt.toISOString(),
            afterId: messages[messages.length - 1].id,
          }
        : null,
    });
  } catch (error) {
    console.error('[MESSAGES_GET]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
