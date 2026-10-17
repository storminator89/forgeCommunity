import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { advanceChatReadCursor, getUnreadChannelIds } from '@/lib/server/chat-unread';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100 && value.trim() === value;

export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

    const { channelId } = await params;
    if (!validId(channelId)) return new NextResponse('Invalid channel', { status: 400 });
    const body = await readJsonObject(req, 1024);
    if (!Object.hasOwn(body, 'messageId') || (body.messageId !== null && !validId(body.messageId))) {
      return new NextResponse('Invalid message', { status: 400 });
    }

    // Admins may list an unjoined private room, but cannot read it. This is
    // deliberately identical to the messages API authorization boundary.
    const channel = await prisma.chatChannel.findFirst({
      where: {
        id: channelId,
        OR: [
          { isPrivate: false },
          { members: { some: { userId: session.user.id } } },
        ],
      },
      select: { id: true },
    });
    if (!channel) return new NextResponse('Channel not found or access denied', { status: 403 });

    const position = body.messageId === null ? null : await prisma.chatMessage.findFirst({
      where: { id: body.messageId, channelId },
      select: { id: true, createdAt: true },
    });
    if (body.messageId !== null && !position) return new NextResponse('Message not found', { status: 404 });

    await advanceChatReadCursor(session.user.id, channelId, position);
    const unread = await getUnreadChannelIds(session.user.id);
    return NextResponse.json({ hasUnread: unread.has(channelId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const requestError = requestErrorResponse(error);
    if (requestError) return requestError;
    console.error('[CHAT_READ_POST]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
