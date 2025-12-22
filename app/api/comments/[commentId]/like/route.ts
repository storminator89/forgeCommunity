// app/api/comments/[commentId]/like/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma' // Sicherstellen, dass dies korrekt ist
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth' // Import von lib/auth.ts

export async function POST(req: NextRequest, props: { params: Promise<{ commentId: string }> }) {
  const params = await props.params;
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
      return NextResponse.json({ message: 'Like entfernt' }, { status: 200 })
    } else {
      // Like hinzufügen
      const newLike = await prisma.likeComment.create({
        data: {
          userId,
          commentId,
        },
      })
      return NextResponse.json(newLike, { status: 201 })
    }
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Fehler beim Toggle-Like' }, { status: 500 })
  }
}
