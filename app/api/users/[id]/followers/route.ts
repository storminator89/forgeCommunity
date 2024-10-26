import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/options';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const followers = await prisma.follow.findMany({
      where: {
        followingId: params.id,
      },
      include: {
        follower: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      users: followers.map(f => ({
        id: f.follower.id,
        name: f.follower.name,
        image: f.follower.image,
        followedAt: f.createdAt,
      })),
    });

  } catch (error) {
    console.error('Error fetching followers:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Follower' },
      { status: 500 }
    );
  }
}