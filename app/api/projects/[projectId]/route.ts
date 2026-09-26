// app/api/projects/[projectId]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { deleteUploadedImage, ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload'
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html'
import { HttpUrlValidationError, normalizeHttpUrl } from '@/lib/server/url-security'
import { getSafeHttpUrl } from '@/lib/security'
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';

const MAX_MULTIPART_REQUEST_BYTES = 5 * 1024 * 1024 + 256 * 1024;

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

    return NextResponse.json({
      ...project,
      link: typeof project.link === 'string' ? (getSafeHttpUrl(project.link) ?? '') : project.link,
    })
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
    const contentLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_REQUEST_BYTES) {
      return NextResponse.json({ error: 'Datei ist zu gross.' }, { status: 413 });
    }
    const limitedRequest = await requestWithBodyLimit(req, MAX_MULTIPART_REQUEST_BYTES)
    const formData = await limitedRequest.formData()
    const rawTitle = formData.get('title')
    const rawDescription = formData.get('description')
    const rawCategory = formData.get('category')
    const rawLink = formData.get('link')
    const rawTags = formData.get('tags')
    const image = formData.get('image')
    if (rawTitle == null || rawDescription == null || rawCategory == null || rawLink == null) {
      return NextResponse.json({ error: 'Titel, Beschreibung, Kategorie und Link sind erforderlich.' }, { status: 400 })
    }
    if (typeof rawTitle !== 'string' || typeof rawDescription !== 'string' || typeof rawCategory !== 'string' || typeof rawLink !== 'string' || (rawTags != null && typeof rawTags !== 'string') || (image != null && typeof image === 'string')) {
      return NextResponse.json({ error: 'Ungültige Projektdaten.' }, { status: 400 })
    }
    const title = sanitizeTextServer(rawTitle)
    const description = sanitizeRichHtmlServer(rawDescription)
    const category = sanitizeTextServer(rawCategory)
    const tags = (rawTags ?? '')
      .split(',')
      .map(tag => sanitizeTextServer(tag))
      .filter(tag => tag !== '')
    if (!title || !sanitizeTextServer(description) || !category || !rawLink.trim()) {
      return NextResponse.json({ error: 'Titel, Beschreibung, Kategorie und Link sind erforderlich.' }, { status: 400 })
    }
    if (title.length > 300 || description.length > 100_000 || category.length > 100 || tags.length > 20 || tags.some(tag => tag.length > 60)) {
      return NextResponse.json({ error: 'Projektdaten sind zu lang.' }, { status: 400 })
    }
    const link = normalizeHttpUrl(rawLink).toString()

    let imageUrl = project.imageUrl
    if (image) {
      try {
        imageUrl = await saveImageUpload(image as File, 'project')
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

    if (image && project.imageUrl) {
      try { await deleteUploadedImage(project.imageUrl) } catch (cleanupError) { console.error('Old project image cleanup failed:', cleanupError) }
    }

    return NextResponse.json(updatedProject, { status: 200 })
  } catch (error) {
    console.error('Error updating project:', error)
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: 'Datei ist zu gross.' }, { status: 413 })
    }
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

    // Lösche das Projekt (cascading delete übernimmt Likes und Kommentare)
    await prisma.project.delete({
      where: { id: projectId },
    })

    if (project.imageUrl) {
      try { await deleteUploadedImage(project.imageUrl) } catch (cleanupError) { console.error('Project image cleanup failed:', cleanupError) }
    }

    return NextResponse.json({ message: 'Projekt erfolgreich gelöscht.' }, { status: 200 })
  } catch (error) {
    console.error('Error deleting project:', error)
    return NextResponse.json({ error: 'Fehler beim Löschen des Projekts.' }, { status: 500 })
  }
}
