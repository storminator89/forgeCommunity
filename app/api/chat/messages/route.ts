// app/api/chat/messages/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getChatUploadOwnerId } from '@/lib/server/image-upload';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';

const MAX_MESSAGE_LENGTH = 4000;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100 && value.trim() === value;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { content, channelId, imageUrl, messageType = 'text' } = await readJsonObject(req);

    if ((content !== undefined && typeof content !== 'string') ||
      (typeof content === 'string' && content.length > MAX_MESSAGE_LENGTH) ||
      (!content && !imageUrl) ||
      (typeof content === 'string' && !content.trim() && !imageUrl)) {
      return new NextResponse('Content or image is required', { status: 400 });
    }
    if (!validId(channelId)) {
      return new NextResponse('ChannelId is required', { status: 400 });
    }
    if (messageType !== 'text' && messageType !== 'image') {
      return new NextResponse('Invalid message type', { status: 400 });
    }
    if (imageUrl !== undefined && imageUrl !== null && imageUrl !== '' &&
      (messageType !== 'image' || typeof imageUrl !== 'string' || imageUrl.length > 500)) {
      return new NextResponse('Invalid image message', { status: 400 });
    }
    if (messageType === 'image' && !imageUrl) {
      return new NextResponse('Image is required', { status: 400 });
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

    const message = await prisma.$transaction(async tx => {
      const created = await tx.chatMessage.create({
        data: {
          content: content ?? '', channelId, authorId: session.user.id,
          imageUrl, messageType,
        },
        include: { author: { select: { id: true, name: true, image: true } } },
      });
      // A channel's explicit members are the only durable notification
      // audience. Public-channel visitors still get the existing local
      // desktop alert while viewing chat, without a global inbox fan-out.
      const members = await tx.chatMember.findMany({
        where: { channelId, userId: { not: session.user.id } },
        select: { userId: true },
      });
      if (members.length) {
        await tx.notification.createMany({ data: members.map(member => ({
          userId: member.userId,
          type: 'CHAT_MESSAGE',
          content: `${created.author.name || 'Ein Mitglied'} hat in #${channel.name} geschrieben.`,
          targetType: 'CHAT_MESSAGE', targetId: created.id,
        })) });
      }
      return created;
    });

    return NextResponse.json(message);
  } catch (error) {
    const requestError = requestErrorResponse(error);
    if (requestError) return requestError;
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
    const before = searchParams.get('before');
    const beforeId = searchParams.get('beforeId');
    const limit = 50;

    if (!validId(channelId)) {
      return new NextResponse('ChannelId is required', { status: 400 });
    }

    let afterDate: Date | undefined;
    if (after !== null) {
      afterDate = new Date(after);
      if (Number.isNaN(afterDate.getTime())) {
        return new NextResponse('Invalid after cursor', { status: 400 });
      }
    }

    if (afterId !== null && (!afterDate || !validId(afterId))) {
      return new NextResponse('afterId requires after', { status: 400 });
    }

    // History and live-update cursors have opposite sort directions. Mixing
    // them can skip rows, so a request must choose one direction.
    if ((before !== null || beforeId !== null) && (after !== null || afterId !== null)) {
      return new NextResponse('Choose before or after', { status: 400 });
    }
    let beforeDate: Date | undefined;
    if (before !== null) {
      beforeDate = new Date(before);
      if (Number.isNaN(beforeDate.getTime())) {
        return new NextResponse('Invalid before cursor', { status: 400 });
      }
    }
    if (beforeId !== null && (!beforeDate || !validId(beforeId))) {
      return new NextResponse('beforeId requires before', { status: 400 });
    }
    if (beforeDate && !beforeId) {
      return new NextResponse('before requires beforeId', { status: 400 });
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
        ...(beforeDate && beforeId
          ? {
              OR: [
                { createdAt: { lt: beforeDate } },
                { createdAt: beforeDate, id: { lt: beforeId } },
              ],
            }
          : afterDate && afterId
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
      take: limit + 1,
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

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();
    // Initial and history pages are queried newest first for bounded index
    // access, then displayed oldest first. Incremental pages move forward.
    if (!afterDate) messages.reverse();

    return NextResponse.json({
      items: messages,
      hasMore,
      previousCursor: messages.length > 0
        ? { before: messages[0].createdAt.toISOString(), beforeId: messages[0].id }
        : null,
      nextCursor: messages.length > 0
        ? {
            after: messages[messages.length - 1].createdAt.toISOString(),
            afterId: messages[messages.length - 1].id,
          }
        : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[MESSAGES_GET]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
