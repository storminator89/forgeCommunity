// app/api/projects/[projectId]/comments/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  const { projectId } = params

  try {
    const comments = await prisma.projectComment.findMany({
      where: { projectId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(comments)
  } catch (error) {
    console.error('Error fetching comments:', error)
    return NextResponse.json({ error: 'Fehler beim Abrufen der Kommentare.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401 })
  }

  const { projectId } = params
  const body = await req.json()
  const { content } = body

  if (!content) {
    return NextResponse.json({ error: 'Inhalt ist erforderlich.' }, { status: 400 })
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })

    if (!project) {
      return NextResponse.json({ error: 'Projekt nicht gefunden.' }, { status: 404 })
    }

    const comment = await prisma.projectComment.create({
      data: {
        content,
        project: { connect: { id: projectId } },
        author: { connect: { id: session.user.id } },
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    })

    return NextResponse.json(comment, { status: 201 })
  } catch (error) {
    console.error('Error creating comment:', error)
    return NextResponse.json({ error: 'Fehler beim Erstellen des Kommentars.' }, { status: 500 })
  }
}
