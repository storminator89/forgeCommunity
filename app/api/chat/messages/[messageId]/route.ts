// app/api/chat/messages/[messageId]/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';

export async function PATCH(
  req: Request,
  props: { params: Promise<{ messageId: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { content } = await readJsonObject(req);
    const messageId = params.messageId;

    if (typeof content !== 'string' || !content.trim() || content.length > 4000 ||
      !messageId || messageId.length > 100) {
      return new NextResponse('Content is required', { status: 400 });
    }

    // Nachricht finden und prüfen, ob der Benutzer der Autor ist
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, authorId: true, channelId: true },
    });

    if (!message) {
      return new NextResponse('Message not found', { status: 404 });
    }

    const channel = await prisma.chatChannel.findFirst({
      where: {
        id: message.channelId,
        OR: [
          { isPrivate: false },
          { members: { some: { userId: session.user.id } } },
        ],
      },
      select: { id: true },
    });
    if (!channel) {
      return new NextResponse('Channel not found or access denied', { status: 403 });
    }

    if (message.authorId !== session.user.id && session.user.role !== 'ADMIN') {
      return new NextResponse('Not authorized to edit this message', { status: 403 });
    }

    // Nachricht aktualisieren
    const updatedMessage = await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        content,
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

    return NextResponse.json(updatedMessage);
  } catch (error) {
    const requestError = requestErrorResponse(error);
    if (requestError) return requestError;
    console.error('[MESSAGE_PATCH]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
