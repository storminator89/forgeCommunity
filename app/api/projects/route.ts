// app/api/projects/route.ts

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getRandomGradient } from '@/lib/utils'
import { ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload'
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html'
import { HttpUrlValidationError, normalizeHttpUrl } from '@/lib/server/url-security'
import { getSafeHttpUrl } from '@/lib/security'
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';
import { readPage, requestErrorResponse } from '@/lib/server/api-input';

const MAX_MULTIPART_REQUEST_BYTES = 5 * 1024 * 1024 + 256 * 1024;

export async function GET(request: Request) {
  try {
    const page = readPage(request)
    const projects = await prisma.project.findMany({
      ...page,
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
      orderBy: {
        createdAt: 'desc',
      },
    })
    return NextResponse.json(projects.map((project) => ({
      ...project,
      link: typeof project.link === 'string' ? (getSafeHttpUrl(project.link) ?? '') : project.link,
    })))
  } catch (error) {
    console.error('Error fetching projects:', error)
    const inputError = requestErrorResponse(error)
    if (inputError) return inputError
    return NextResponse.json({ error: 'Fehler beim Abrufen der Projekte.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401 })
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

    let imageUrl = ''
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

    // Generate random gradient colors
    const gradient = getRandomGradient()

    // Find or create tags
    const tagObjects = await Promise.all(
      tags.map(async (tagName) => {
        const existingTag = await prisma.tag.findUnique({
          where: { name: tagName },
        })
        if (existingTag) {
          return existingTag
        }
        return await prisma.tag.create({
          data: { name: tagName },
        })
      })
    )

    // Create project
    const newProject = await prisma.project.create({
      data: {
        title,
        description,
        category,
        link,
        imageUrl,
        gradientFrom: gradient.from,
        gradientTo: gradient.to,
        author: {
          connect: { id: session.user.id }
        },
        tags: {
          connect: tagObjects.map(tag => ({ id: tag.id }))
        }
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

    return NextResponse.json(newProject, { status: 201 })
  } catch (error) {
    console.error('Error creating project:', error)
    if (error instanceof RequestBodyLimitError) {
      return NextResponse.json({ error: 'Datei ist zu gross.' }, { status: 413 })
    }
    if (error instanceof HttpUrlValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Fehler beim Erstellen des Projekts.' }, { status: 500 })
  }
}
