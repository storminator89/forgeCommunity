// app/api/posts/[postId]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html'
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'
import { communityPostInclude, communityVisibility, isCurrentCommunityAdmin, normalizeCommunityPost } from '@/lib/server/community-feed'

export async function GET(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await params
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    const isAdmin = await isCurrentCommunityAdmin(userId, session?.user?.role)

    const post = await prisma.post.findUnique({
      // Apply visibility before materializing even the bounded preview.
      where: { id: postId, AND: [communityVisibility(userId, isAdmin)] },
      include: communityPostInclude(userId),
    })

    if (!post) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    if (!post.published && post.authorId !== userId && !isAdmin) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 })
    }

    return NextResponse.json(normalizeCommunityPost(post, userId), { headers: { 'Cache-Control': 'private, no-store' } })
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
    if (post.authorId !== userId && !await isCurrentCommunityAdmin(userId, session.user.role)) {
      return NextResponse.json({ error: 'Nicht autorisiert, diesen Beitrag zu bearbeiten' }, { status: 403 })
    }

    const data = await readJsonObject(req)
    const { title, content } = data

    if (typeof title !== 'string' || typeof content !== 'string') {
      return NextResponse.json({ error: 'Titel und Inhalt sind erforderlich' }, { status: 400 })
    }
    const safeTitle = sanitizeTextServer(title)
    const safeContent = sanitizeRichHtmlServer(content)
    if (!safeTitle || !sanitizeTextServer(safeContent)) {
      return NextResponse.json({ error: 'Titel und Inhalt sind erforderlich' }, { status: 400 })
    }

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        title: safeTitle,
        content: safeContent,
      },
      include: communityPostInclude(userId),
    })

    return NextResponse.json(normalizeCommunityPost(updatedPost, userId), { status: 200 })
  } catch (error: any) {
    console.error('Fehler beim Bearbeiten des Beitrags:', error)
    const inputError = requestErrorResponse(error)
    if (inputError) return inputError
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
    if (post.authorId !== userId && !await isCurrentCommunityAdmin(userId, session.user.role)) {
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
