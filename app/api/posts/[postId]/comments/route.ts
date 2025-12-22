import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

export async function POST(req: NextRequest, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { content } = await req.json()
    const { postId } = params

    if (!content) {
      return NextResponse.json({ error: 'Inhalt ist erforderlich' }, { status: 400 })
    }

    // Überprüfen, ob der Post existiert
    const post = await prisma.post.findUnique({
      where: { id: postId },
    })

    if (!post) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    const newComment = await prisma.comment.create({
      data: {
        content,
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
