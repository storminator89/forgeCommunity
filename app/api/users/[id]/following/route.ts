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

    const following = await prisma.follow.findMany({
      where: {
        followerId: params.id,
      },
      include: {
        following: {
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
      users: following.map(f => ({
        id: f.following.id,
        name: f.following.name,
        image: f.following.image,
        followedAt: f.createdAt,
      })),
    });

  } catch (error) {
    console.error('Error fetching following:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der gefolgten Benutzer' },
      { status: 500 }
    );
  }
}