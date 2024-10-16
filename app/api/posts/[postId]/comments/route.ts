// app/api/posts/[postId]/comments/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'// Korrigierter Pfad

const prisma = new PrismaClient()

export async function POST(req: NextRequest, { params }: { params: { postId: string } }) {
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
        postId: postId,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
      },
    })

    return NextResponse.json(newComment, { status: 201 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Fehler beim Hinzufügen des Kommentars' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: { postId: string } }) {
  try {
    const { postId } = params

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

    // Füge die Like-Informationen hinzu
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id

    const mappedComments = comments.map(comment => ({
      ...comment,
      votes: comment.likeComments.length,
      isLiked: userId ? comment.likeComments.some(like => like.userId === userId) : false,
    }))

    return NextResponse.json(mappedComments)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Fehler beim Abrufen der Kommentare' }, { status: 500 })
  }
}
