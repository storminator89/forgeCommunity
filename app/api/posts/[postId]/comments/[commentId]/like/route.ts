import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: { commentId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { commentId } = params
    const userId = session.user.id

    // Überprüfen, ob der Kommentar existiert
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    })

    if (!comment) {
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