// app/api/posts/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma' 
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth' 

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { title, content } = await req.json()

    if (!title || !content) {
      return NextResponse.json({ error: 'Titel und Inhalt sind erforderlich' }, { status: 400 })
    }

    const newPost = await prisma.post.create({
      data: {
        title,
        content,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
      },
    })

    return NextResponse.json(newPost, { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Fehler beim Erstellen des Beitrags' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const posts = await prisma.post.findMany({
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
      orderBy: { createdAt: 'desc' },
    })

    // Füge die Like-Informationen hinzu
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id

    const mappedPosts = posts.map(post => ({
      ...post,
      votes: post.likePosts.length,
      isLiked: userId ? post.likePosts.some(like => like.userId === userId) : false,
      comments: post.comments.map(comment => ({
        ...comment,
        votes: comment.likeComments.length,
        isLiked: userId ? comment.likeComments.some(like => like.userId === userId) : false,
      })),
    }))

    return NextResponse.json(mappedPosts)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Fehler beim Abrufen der Beiträge' }, { status: 500 })
  }
}
