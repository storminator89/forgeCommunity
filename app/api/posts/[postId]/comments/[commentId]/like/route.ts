import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ postId: string; commentId: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { postId, commentId } = params
    const userId = session.user.id

    // Überprüfen, ob der Kommentar existiert
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        post: {
          select: { published: true, authorId: true },
        },
      },
    })

    if (!comment) {
      return NextResponse.json({ error: 'Kommentar nicht gefunden' }, { status: 404 })
    }

    // The nested URL identifies the parent post. Verify that relationship so
    // a caller cannot operate on an unrelated comment by swapping IDs.
    if (comment.postId !== postId) {
      return NextResponse.json({ error: 'Kommentar nicht gefunden' }, { status: 404 })
    }

    if (!comment.post.published && comment.post.authorId !== userId && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Kommentar nicht gefunden' }, { status: 404 })
    }

    // Überprüfen, ob der Benutzer den Kommentar bereits geliked hat
    const existingLike = await prisma.likeComment.findUnique({
      where: {
        user_comment_unique: {
          userId,
          commentId,
        },
      },
    })

    if (existingLike) {
      // Like entfernen
      await prisma.likeComment.delete({
        where: {
          user_comment_unique: {
            userId,
            commentId,
          },
        },
      })
      return NextResponse.json({ message: 'Like entfernt', isLiked: false })
    } else {
      // Like hinzufügen
      await prisma.likeComment.create({
        data: {
          userId,
          commentId,
        },
      })
      return NextResponse.json({ message: 'Like hinzugefügt', isLiked: true })
    }
  } catch (error) {
    console.error('Fehler beim Like/Unlike des Kommentars:', error)
    return NextResponse.json({ error: 'Fehler beim Like/Unlike des Kommentars' }, { status: 500 })
  }
}
