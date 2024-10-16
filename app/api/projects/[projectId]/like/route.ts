// app/api/projects/[projectId]/like/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth' 

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { projectId } = params
    const userId = session.user.id

    // Überprüfen, ob das Projekt existiert
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })

    if (!project) {
      return NextResponse.json({ error: 'Projekt nicht gefunden' }, { status: 404 })
    }

    // Überprüfen, ob der Benutzer das Projekt bereits geliked hat
    const existingLike = await prisma.likeProject.findUnique({
      where: {
        user_project_unique: {
          userId,
          projectId,
        },
      },
    })

    if (existingLike) {
      // Like entfernen
      await prisma.likeProject.delete({
        where: {
          user_project_unique: {
            userId,
            projectId,
          },
        },
      })
      return NextResponse.json({ message: 'Like entfernt' }, { status: 200 })
    } else {
      // Like hinzufügen
      const newLike = await prisma.likeProject.create({
        data: {
          userId,
          projectId,
        },
      })
      return NextResponse.json(newLike, { status: 201 })
    }
  } catch (error) {
    console.error('Fehler beim Toggle-Like:', error)
    return NextResponse.json({ error: 'Fehler beim Toggle-Like' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    const { projectId } = params
    const userId = session.user.id

    // Überprüfen, ob das Projekt existiert
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })

    if (!project) {
      return NextResponse.json({ error: 'Projekt nicht gefunden' }, { status: 404 })
    }

    // Überprüfen, ob der Benutzer das Projekt bereits geliked hat
    const existingLike = await prisma.likeProject.findUnique({
      where: {
        user_project_unique: {
          userId,
          projectId,
        },
      },
    })

    if (!existingLike) {
      return NextResponse.json({ error: 'Like existiert nicht' }, { status: 400 })
    }

    // Like entfernen
    await prisma.likeProject.delete({
      where: {
        user_project_unique: {
          userId,
          projectId,
        },
      },
    })

    return NextResponse.json({ message: 'Like entfernt' }, { status: 200 })
  } catch (error) {
    console.error('Fehler beim Entfernen des Likes:', error)
    return NextResponse.json({ error: 'Fehler beim Entfernen des Likes' }, { status: 500 })
  }
}
