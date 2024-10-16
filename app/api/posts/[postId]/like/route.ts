// app/api/posts/[postId]/like/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma' // Sicherstellen, dass dies korrekt ist
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth' // Import von lib/auth.ts

export async function POST(req: NextRequest, { params }: { params: { postId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { postId } = params
    const userId = session.user.id

    // Überprüfen, ob der Beitrag existiert
    const post = await prisma.post.findUnique({
      where: { id: postId },
    })

    if (!post) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    // Überprüfen, ob der Benutzer den Beitrag bereits geliked hat
    const existingLike = await prisma.likePost.findUnique({
      where: {
        user_post_unique: {
          userId,
          postId,
        },
      },
    })

    if (existingLike) {
      // Like entfernen
      await prisma.likePost.delete({
        where: {
          user_post_unique: {
            userId,
            postId,
          },
        },
      })
      return NextResponse.json({ message: 'Like entfernt' }, { status: 200 })
    } else {
      // Like hinzufügen
      const newLike = await prisma.likePost.create({
        data: {
          userId,
          postId,
        },
      })
      return NextResponse.json(newLike, { status: 201 })
    }
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Fehler beim Toggle-Like' }, { status: 500 })
  }
}
