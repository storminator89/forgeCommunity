// app/api/posts/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma' 
import { getServerSession } from '@/lib/sites-auth/server'
import { authOptions } from '@/lib/auth' 
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html'
import { readJsonObject, readPage, requestErrorResponse } from '@/lib/server/api-input'
import { afterCommunityCursor, COMMUNITY_ORDER, COMMUNITY_PAGE_SIZE, communityPage, communityPostInclude, communityVisibility, isCurrentCommunityAdmin, normalizeCommunityPost, readCommunityCursor } from '@/lib/server/community-feed'
import { InvalidTopicError, parsePostTopics, readTopicFilter } from '@/lib/community-topics'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { title, content, tags } = await readJsonObject(req)

    if (typeof title !== 'string' || typeof content !== 'string') {
      return NextResponse.json({ error: 'Titel und Inhalt sind erforderlich' }, { status: 400 })
    }
    const safeTitle = sanitizeTextServer(title)
    const safeContent = sanitizeRichHtmlServer(content)
    if (!safeTitle || !sanitizeTextServer(safeContent)) {
      return NextResponse.json({ error: 'Titel und Inhalt sind erforderlich' }, { status: 400 })
    }
    const topicNames = parsePostTopics(tags)
    if (!topicNames) return NextResponse.json({ error: 'Bis zu drei gültige Themen sind erlaubt' }, { status: 400 })

    const newPost = await prisma.post.create({
      data: {
        title: safeTitle,
        content: safeContent,
        // Community posts are immediately published. The schema also serves
        // draft-capable clients, so read routes still enforce draft privacy.
        published: true,
        authorId: session.user.id,
        tags: { connectOrCreate: topicNames.map(name => ({ where: { name }, create: { name } })) },
      },
      include: communityPostInclude(session.user.id),
    })

    return NextResponse.json(normalizeCommunityPost(newPost, session.user.id), { status: 201 })
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
    const tag = readTopicFilter(req)
    const cursor = feed ? readCommunityCursor(req, 'posts', undefined, tag) : null
    const page = feed ? { take: COMMUNITY_PAGE_SIZE + 1 } : readPage(req)
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    const isAdmin = await isCurrentCommunityAdmin(userId, session?.user?.role)
    const posts = await prisma.post.findMany({
      where: { AND: [communityVisibility(userId, isAdmin), afterCommunityCursor(cursor), ...(tag ? [{ tags: { some: { name: tag } } }] : [])] },
      ...page,
      // The feed renders discussions collapsed. Defer comment previews until
      // one is opened; detail and legacy responses keep their full contract.
      include: communityPostInclude(userId, feed ? 0 : undefined),
      orderBy: COMMUNITY_ORDER,
    })
    if (!feed) return NextResponse.json(posts.map(post => normalizeCommunityPost(post, userId)), { headers: { 'Cache-Control': 'private, no-store' } })
    const result = communityPage(posts, 'posts', undefined, tag)
    return NextResponse.json({ posts: result.items.map(post => normalizeCommunityPost(post, userId, true)), nextCursor: result.nextCursor }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error(error)
    const inputError = requestErrorResponse(error)
    if (inputError) return inputError
    if (error instanceof InvalidTopicError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: 'Fehler beim Abrufen der Beiträge' }, { status: 500 })
  }
}
