// app/api/chat/messages/[messageId]/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';

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

    const { content } = await req.json();
    const messageId = params.messageId;

    if (!content) {
      return new NextResponse('Content is required', { status: 400 });
    }

    // Nachricht finden und prüfen, ob der Benutzer der Autor ist
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: { author: true },
    });

    if (!message) {
      return new NextResponse('Message not found', { status: 404 });
    }

    if (message.author.id !== session.user.id && session.user.role !== 'ADMIN') {
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
    console.error('[MESSAGE_PATCH]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}