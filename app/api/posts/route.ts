// app/api/posts/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma' 
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth' 
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html'
import { readJsonObject, readPage, requestErrorResponse } from '@/lib/server/api-input'
import { afterCommunityCursor, COMMUNITY_ORDER, COMMUNITY_PAGE_SIZE, communityPage, communityPostInclude, communityVisibility, isCurrentCommunityAdmin, normalizeCommunityPost, readCommunityCursor } from '@/lib/server/community-feed'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { title, content } = await readJsonObject(req)

    if (typeof title !== 'string' || typeof content !== 'string') {
      return NextResponse.json({ error: 'Titel und Inhalt sind erforderlich' }, { status: 400 })
    }
    const safeTitle = sanitizeTextServer(title)
    const safeContent = sanitizeRichHtmlServer(content)
    if (!safeTitle || !sanitizeTextServer(safeContent)) {
      return NextResponse.json({ error: 'Titel und Inhalt sind erforderlich' }, { status: 400 })
    }

    const newPost = await prisma.post.create({
      data: {
        title: safeTitle,
        content: safeContent,
        // Community posts are immediately published. The schema also serves
        // draft-capable clients, so read routes still enforce draft privacy.
        published: true,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
      },
    })

    return NextResponse.json({ ...newPost, comments: [], commentCount: 0, commentsNextCursor: null, votes: 0, isLiked: false }, { status: 201 })
  } catch (error: any) {
    console.error(error)
    const inputError = requestErrorResponse(error)
    if (inputError) return inputError
    return NextResponse.json({ error: 'Fehler beim Erstellen des Beitrags' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const feed = new URL(req.url).searchParams.get('feed') === '1'
    const cursor = feed ? readCommunityCursor(req, 'posts') : null
    const page = feed ? { take: COMMUNITY_PAGE_SIZE + 1 } : readPage(req)
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    const isAdmin = await isCurrentCommunityAdmin(userId, session?.user?.role)
    const posts = await prisma.post.findMany({
      where: { AND: [communityVisibility(userId, isAdmin), afterCommunityCursor(cursor)] },
      ...page,
      include: communityPostInclude(userId),
      orderBy: COMMUNITY_ORDER,
    })
    if (!feed) return NextResponse.json(posts.map(normalizeCommunityPost), { headers: { 'Cache-Control': 'private, no-store' } })
    const result = communityPage(posts, 'posts')
    return NextResponse.json({ posts: result.items.map(normalizeCommunityPost), nextCursor: result.nextCursor }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error(error)
    const inputError = requestErrorResponse(error)
    if (inputError) return inputError
    return NextResponse.json({ error: 'Fehler beim Abrufen der Beiträge' }, { status: 500 })
  }
}
