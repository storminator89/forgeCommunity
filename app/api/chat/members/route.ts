// app/api/chat/members/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/options'
import prisma from '@/lib/prisma'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { userId, channelId } = await req.json()

    if (!userId || !channelId) {
      return new NextResponse('UserId and channelId are required', { status: 400 })
    }

    // Überprüfen, ob der anfragende Benutzer Admin ist oder der Channel-Ersteller
    const channel = await prisma.chatChannel.findUnique({
      where: { id: channelId },
      include: {
        members: true,
      },
    })

    if (!channel) {
      return new NextResponse('Channel not found', { status: 404 })
    }

    // Prüfen, ob der Benutzer bereits Mitglied ist
    const existingMembership = await prisma.chatMember.findFirst({
      where: {
        userId,
        channelId,
      },
    })

    if (existingMembership) {
      return new NextResponse('User is already a member', { status: 400 })
    }

    const member = await prisma.chatMember.create({
      data: {
        userId,
        channelId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    })

    return NextResponse.json(member)
  } catch (error) {
    console.error('[MEMBERS_POST]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const channelId = searchParams.get('channelId')

    if (!userId || !channelId) {
      return new NextResponse('UserId and channelId are required', { status: 400 })
    }

    // Überprüfen, ob der anfragende Benutzer Admin ist oder der Channel-Ersteller
    const channel = await prisma.chatChannel.findUnique({
      where: { id: channelId },
      include: {
        members: true,
      },
    })

    if (!channel) {
      return new NextResponse('Channel not found', { status: 404 })
    }

    if (session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    await prisma.chatMember.deleteMany({
      where: {
        userId,
        channelId,
      },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[MEMBERS_DELETE]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const channelId = searchParams.get('channelId')

    if (!channelId) {
      return new NextResponse('ChannelId is required', { status: 400 })
    }

    const members = await prisma.chatMember.findMany({
      where: {
        channelId,
      },
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
    })

    return NextResponse.json(members)
  } catch (error) {
    console.error('[MEMBERS_GET]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}