import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { getChatUploadOwnerId, getPrivateChatUploadPath } from '@/lib/server/image-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(
  _request: Request,
  props: { params: Promise<{ filename: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { filename } = await props.params;
  const filePath = getPrivateChatUploadPath(filename);
  const ownerId = getChatUploadOwnerId(filename);
  if (!filePath || !ownerId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    let authorized = ownerId === session.user.id;
    if (!authorized) {
      const message = await prisma.chatMessage.findFirst({
        where: {
          imageUrl: `/api/chat/uploads/${filename}`,
          authorId: ownerId,
          channel: {
            OR: [
              { isPrivate: false },
              { members: { some: { userId: session.user.id } } },
            ],
          },
        },
        select: { id: true },
      });
      authorized = Boolean(message);
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const bytes = await readFile(filePath);
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
