// app/api/chat/channels/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { name, isPrivate } = await req.json();

    if (!name) {
      return new NextResponse('Name is required', { status: 400 });
    }

    // Channel erstellen
    const channel = await prisma.chatChannel.create({
      data: {
        name,
        isPrivate: isPrivate || false,
        // Ersteller automatisch als Mitglied hinzufügen
        members: {
          create: {
            userId: session.user.id,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true,
                role: true,
              },
            },
          },
        },
        _count: {
          select: {
            messages: true,
            members: true,
          },
        },
      },
    });

    return NextResponse.json(channel);
  } catch (error) {
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
      where: {
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
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true,
                role: true,
              },
            },
          },
        },
        _count: {
          select: {
            messages: true,
            members: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(channels);
  } catch (error) {
    console.error('[CHANNELS_GET]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}