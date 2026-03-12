// app/api/projects/[projectId]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { deleteUploadedImage, ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload'
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html'
import { HttpUrlValidationError, normalizeHttpUrl } from '@/lib/server/url-security'

export async function GET(req: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  const { projectId } = params

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        tags: {
          select: {
            id: true,
            name: true,
          },
        },
        likes: true,
        comments: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Projekt nicht gefunden.' }, { status: 404 })
    }

    return NextResponse.json(project)
  } catch (error) {
    console.error('Error fetching project:', error)
    return NextResponse.json({ error: 'Fehler beim Abrufen des Projekts.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  const { projectId } = params
  const session = await getServerSession(authOptions)

  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401 })
  }

  try {
    // Überprüfen, ob das Projekt existiert
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })

    if (!project) {
      return NextResponse.json({ error: 'Projekt nicht gefunden.' }, { status: 404 })
    }

    // Überprüfen, ob der aktuelle Benutzer der Ersteller des Projekts ist
    if (project.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 })
    }

    // Parse form data
    const formData = await req.formData()
    const rawTitle = formData.get('title') as string
    const rawDescription = formData.get('description') as string
    const rawCategory = formData.get('category') as string
    const rawLink = (formData.get('link') as string)?.trim()
    const title = sanitizeTextServer(rawTitle)
    const description = sanitizeRichHtmlServer(rawDescription)
    const category = sanitizeTextServer(rawCategory)
    const tags = (formData.get('tags') as string)
      .split(',')
      .map(tag => sanitizeTextServer(tag))
      .filter(tag => tag !== '')
    if (!rawTitle || !rawDescription || !rawCategory || !rawLink) {
      return NextResponse.json({ error: 'Titel, Beschreibung, Kategorie und Link sind erforderlich.' }, { status: 400 })
    }
    const link = normalizeHttpUrl(rawLink)
    const image = formData.get('image') as File | null

    let imageUrl = project.imageUrl
    if (image) {
      try {
        imageUrl = await saveImageUpload(image, 'project')

        if (project.imageUrl) {
          await deleteUploadedImage(project.imageUrl)
        }
      } catch (error) {
        console.error('Error saving image:', error)
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Fehler beim Speichern des Bildes.' },
          { status: error instanceof ImageUploadValidationError ? 400 : 500 }
        )
      }
    }

    // Erstelle oder finde Tags
    const tagRecords = await Promise.all(
      tags.map(async (tag) => {
        const existingTag = await prisma.tag.findUnique({ where: { name: tag } })
        if (existingTag) {
          return existingTag
        }
        return await prisma.tag.create({ data: { name: tag } })
      })
    )

    // Aktualisiere das Projekt
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        title,
        description,
        category,
        link,
        imageUrl,
        tags: {
          set: [], // Entferne bestehende Tags
          connect: tagRecords.map(tag => ({ id: tag.id })),
        },
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        tags: {
          select: {
            id: true,
            name: true,
          },
        },
        likes: true,
        comments: true,
      },
    })

    return NextResponse.json(updatedProject, { status: 200 })
  } catch (error) {
    console.error('Error updating project:', error)
    if (error instanceof HttpUrlValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Fehler beim Aktualisieren des Projekts.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  const { projectId } = params
  const session = await getServerSession(authOptions)

  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401 })
  }

  try {
    // Überprüfen, ob das Projekt existiert
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })

    if (!project) {
      return NextResponse.json({ error: 'Projekt nicht gefunden.' }, { status: 404 })
    }

    // Überprüfen, ob der aktuelle Benutzer der Ersteller des Projekts ist
    if (project.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 })
    }

    // Lösche das Bild, falls vorhanden
    if (project.imageUrl) {
      await deleteUploadedImage(project.imageUrl)
    }

    // Lösche das Projekt (cascading delete übernimmt Likes und Kommentare)
    await prisma.project.delete({
      where: { id: projectId },
    })

    return NextResponse.json({ message: 'Projekt erfolgreich gelöscht.' }, { status: 200 })
  } catch (error) {
    console.error('Error deleting project:', error)
    return NextResponse.json({ error: 'Fehler beim Löschen des Projekts.' }, { status: 500 })
  }
}
