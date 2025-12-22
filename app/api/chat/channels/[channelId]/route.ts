// app/api/chat/channels/[channelId]/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';

export async function DELETE(
  req: Request,
  props: { params: Promise<{ channelId: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const channelId = params.channelId;

    // Channel löschen (Nachrichten und Mitgliedschaften werden automatisch durch onDelete: Cascade gelöscht)
    await prisma.chatChannel.delete({
      where: { id: channelId },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[CHANNEL_DELETE]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}