// app/api/chat/members/route.ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/options'
import prisma from '@/lib/prisma'
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100 && value.trim() === value

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Channels do not have a separate owner field; they are created by
    // administrators.  Requiring an administrator here prevents any member
    // from adding arbitrary users to private channels.
    if (session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 403 })
    }

    const { userId, channelId } = await readJsonObject(req)

    if (!validId(userId) || !validId(channelId)) {
      return new NextResponse('UserId and channelId are required', { status: 400 })
    }

    const channel = await prisma.chatChannel.findUnique({
      where: { id: channelId },
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
    const requestError = requestErrorResponse(error)
    if (requestError) return requestError
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

    if (!validId(userId) || !validId(channelId)) {
      return new NextResponse('UserId and channelId are required', { status: 400 })
    }

    const channel = await prisma.chatChannel.findUnique({
      where: { id: channelId },
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

    if (!validId(channelId)) {
      return new NextResponse('ChannelId is required', { status: 400 })
    }

    // Membership lists for private channels are private as well. Public
    // channels remain discoverable to authenticated users, matching the
    // channel list endpoint.
    const channel = await prisma.chatChannel.findFirst({
      where: session.user.role === 'ADMIN'
        ? { id: channelId }
        : {
            id: channelId,
            OR: [
              { isPrivate: false },
              { members: { some: { userId: session.user.id } } },
            ],
          },
      select: { id: true },
    })

    if (!channel) {
      return new NextResponse('Channel not found or access denied', { status: 403 })
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
