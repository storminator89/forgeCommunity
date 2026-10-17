import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from '@/lib/sites-auth/server'
import { authOptions } from '@/lib/auth'
import { sanitizeCommentTextServer } from '@/lib/server/sanitize-html'
import { readJsonObject, readPage, requestErrorResponse } from '@/lib/server/api-input'
import { afterCommunityCursor, COMMUNITY_COMMENT_PREVIEW_SIZE, COMMUNITY_ORDER, COMMUNITY_PAGE_SIZE, communityCommentInclude, communityPage, isCurrentCommunityAdmin, normalizeCommunityComment, readCommunityCursor } from '@/lib/server/community-feed'
import { createD1PostComment } from '@/lib/server/d1-post-comments'

export async function POST(req: NextRequest, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { content } = await readJsonObject(req)
    const { postId } = params

    const sanitizedContent = typeof content === 'string' ? sanitizeCommentTextServer(content) : ''
    if (!sanitizedContent) {
      return NextResponse.json({ error: 'Inhalt ist erforderlich' }, { status: 400 })
    }

    // Überprüfen, ob der Post existiert
    const post = await prisma.post.findUnique({
      where: { id: postId },
    })

    if (!post) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    if (!post.published && post.authorId !== session.user.id && !await isCurrentCommunityAdmin(session.user.id, session.user.role)) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    const created = await createD1PostComment({
      content: sanitizedContent, postId, authorId: session.user.id, sessionRole: session.user.role,
    })
    if (!created) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    // Format comment for response
    const formattedComment = normalizeCommunityComment(created.comment, created.canSelectSolution)

    return NextResponse.json(formattedComment)
  } catch (error) {
    console.error('Fehler beim Erstellen des Kommentars:', error)
    const inputError = requestErrorResponse(error)
    if (inputError) return inputError
    return NextResponse.json({ error: 'Fehler beim Erstellen des Kommentars' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ postId: string }> }) {
  const { postId } = await props.params
  try {
    const searchParams = new URL(req.url).searchParams
    const feed = searchParams.get('feed') === '1'
    const cursor = feed ? readCommunityCursor(req, 'comments', postId) : null
    const preview = feed && searchParams.get('preview') === '1'
    const pageSize = preview ? COMMUNITY_COMMENT_PREVIEW_SIZE : COMMUNITY_PAGE_SIZE
    const page = feed ? { take: pageSize + 1 } : readPage(req)
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true, published: true } })
    if (!post || (!post.published && post.authorId !== userId && !await isCurrentCommunityAdmin(userId, session?.user?.role))) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }
    const comments = await prisma.comment.findMany({
      where: { AND: [{ postId }, afterCommunityCursor(cursor)] },
      ...page,
      include: communityCommentInclude(userId),
      orderBy: COMMUNITY_ORDER,
    })
    if (!feed) return NextResponse.json(comments.map(comment => normalizeCommunityComment(comment, post.published && post.authorId === userId)), { headers: { 'Cache-Control': 'private, no-store' } })
    const result = communityPage(comments, 'comments', postId, undefined, pageSize)
    return NextResponse.json({ comments: result.items.map(comment => normalizeCommunityComment(comment, post.published && post.authorId === userId)), nextCursor: result.nextCursor }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Fehler beim Abrufen der Kommentare:', error)
    const inputError = requestErrorResponse(error)
    if (inputError) return inputError
    return NextResponse.json({ error: 'Fehler beim Abrufen der Kommentare' }, { status: 500 })
  }
}
