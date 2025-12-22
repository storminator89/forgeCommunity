// app/api/posts/[postId]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await params

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
        likePosts: true,
        comments: {
          include: {
            author: {
              select: { id: true, name: true, image: true },
            },
            likeComments: true,
          },
        },
      },
    })

    if (!post) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    // Optional: Like-Informationen hinzufügen, ähnlich wie in der `app/api/posts/route.ts`
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id

    const mappedPost = {
      ...post,
      votes: post.likePosts.length,
      isLiked: userId ? post.likePosts.some(like => like.userId === userId) : false,
      comments: post.comments.map(comment => ({
        ...comment,
        votes: comment.likeComments.length,
        isLiked: userId ? comment.likeComments.some(like => like.userId === userId) : false,
      })),
    }

    return NextResponse.json(mappedPost)
  } catch (error) {
    console.error('Fehler beim Abrufen des Beitrags:', error)
    return NextResponse.json({ error: 'Fehler beim Abrufen des Beitrags' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const session = await getServerSession(authOptions)

  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
  }

  const { postId } = await params
  const userId = session.user.id

  try {
    // Überprüfen, ob der Beitrag existiert
    const post = await prisma.post.findUnique({
      where: { id: postId },
    })

    if (!post) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    // Überprüfen, ob der aktuelle Benutzer der Autor des Beitrags ist
    if (post.authorId !== userId) {
      return NextResponse.json({ error: 'Nicht autorisiert, diesen Beitrag zu bearbeiten' }, { status: 403 })
    }

    const data = await req.json()
    const { title, content } = data

    if (!title || !content) {
      return NextResponse.json({ error: 'Titel und Inhalt sind erforderlich' }, { status: 400 })
    }

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        title,
        content,
      },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
      },
    })

    return NextResponse.json(updatedPost, { status: 200 })
  } catch (error: any) {
    console.error('Fehler beim Bearbeiten des Beitrags:', error)
    return NextResponse.json({ error: 'Fehler beim Bearbeiten des Beitrags' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const session = await getServerSession(authOptions)

  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
  }

  const { postId } = await params
  const userId = session.user.id

  try {
    // Überprüfen, ob der Beitrag existiert
    const post = await prisma.post.findUnique({
      where: { id: postId },
    })

    if (!post) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    // Überprüfen, ob der aktuelle Benutzer der Autor des Beitrags ist oder ein Admin (optional)
    // Angenommen, du hast ein `role` Feld im User-Model
    if (post.authorId !== userId /* && session.user.role !== 'ADMIN' */) {
      return NextResponse.json({ error: 'Nicht autorisiert, diesen Beitrag zu löschen' }, { status: 403 })
    }

    await prisma.post.delete({
      where: { id: postId },
    })

    return NextResponse.json({ message: 'Beitrag erfolgreich gelöscht' }, { status: 200 })
  } catch (error) {
    console.error('Fehler beim Löschen des Beitrags:', error)
    return NextResponse.json({ error: 'Fehler beim Löschen des Beitrags' }, { status: 500 })
  }
}
