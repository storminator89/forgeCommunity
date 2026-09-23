import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { sanitizeTextServer } from '@/lib/server/sanitize-html'

export async function POST(req: NextRequest, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { content } = await req.json()
    const { postId } = params

    const sanitizedContent = typeof content === 'string' ? sanitizeTextServer(content) : ''
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

    if (!post.published && post.authorId !== session.user.id && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    const newComment = await prisma.comment.create({
      data: {
        content: sanitizedContent,
        postId,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
        likeComments: true
      },
    })

    // Format comment for response
    const formattedComment = {
      ...newComment,
      votes: 0,
      isLiked: false
    }

    return NextResponse.json(formattedComment)
  } catch (error) {
    console.error('Fehler beim Erstellen des Kommentars:', error)
    return NextResponse.json({ error: 'Fehler beim Erstellen des Kommentars' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  try {
    const { postId } = params
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true, published: true },
    })

    if (!post || (!post.published && post.authorId !== userId && session?.user?.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    const comments = await prisma.comment.findMany({
      where: { postId },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
        likeComments: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const formattedComments = comments.map(comment => ({
      ...comment,
      votes: comment.likeComments.length,
      isLiked: userId ? comment.likeComments.some(like => like.userId === userId) : false,
    }))

    return NextResponse.json(formattedComments)
  } catch (error) {
    console.error('Fehler beim Abrufen der Kommentare:', error)
    return NextResponse.json({ error: 'Fehler beim Abrufen der Kommentare' }, { status: 500 })
  }
}
