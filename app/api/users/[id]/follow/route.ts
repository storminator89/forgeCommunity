import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";

// POST zum Folgen eines Benutzers
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const followerId = session.user.id;
    const followingId = params.id;

    // Prüfe, ob der Benutzer sich selbst folgen möchte
    if (followerId === followingId) {
      return NextResponse.json(
        { error: 'Sie können sich nicht selbst folgen' },
        { status: 400 }
      );
    }

    // Prüfe, ob der Follow bereits existiert
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });

    if (existingFollow) {
      return NextResponse.json(
        { error: 'Sie folgen diesem Benutzer bereits' },
        { status: 400 }
      );
    }

    // Erstelle den Follow
    const follow = await prisma.follow.create({
      data: {
        follower: { connect: { id: followerId } },
        following: { connect: { id: followingId } },
      },
      include: {
        following: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    // Optional: Erstelle eine Benachrichtigung für den gefolgten Benutzer
    await prisma.notification.create({
      data: {
        userId: followingId,
        type: 'FOLLOW',
        content: `${session.user.name} folgt Ihnen jetzt`,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Sie folgen jetzt ${follow.following.name}`,
    });

  } catch (error) {
    console.error('Error following user:', error);
    return NextResponse.json(
      { error: 'Fehler beim Folgen des Benutzers' },
      { status: 500 }
    );
  }
}

// DELETE zum Entfolgen eines Benutzers
export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const followerId = session.user.id;
    const followingId = params.id;

    // Lösche den Follow
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Benutzer erfolgreich entfolgt',
    });

  } catch (error) {
    console.error('Error unfollowing user:', error);
    return NextResponse.json(
      { error: 'Fehler beim Entfolgen des Benutzers' },
      { status: 500 }
    );
  }
}

// GET zum Abrufen des Follow-Status
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const followerId = session.user.id;
    const followingId = params.id;

    // Prüfe, ob der Follow existiert
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });

    return NextResponse.json({
      isFollowing: !!follow,
      followedAt: follow?.createdAt,
    });

  } catch (error) {
    console.error('Error checking follow status:', error);
    return NextResponse.json(
      { error: 'Fehler beim Abrufen des Follow-Status' },
      { status: 500 }
    );
  }
}