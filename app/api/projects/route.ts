// app/api/projects/route.ts

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getRandomGradient } from '@/lib/utils'
import { ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload'
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html'
import { HttpUrlValidationError, normalizeHttpUrl } from '@/lib/server/url-security'

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
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
    return NextResponse.json(projects)
  } catch (error) {
    console.error('Error fetching projects:', error)
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

    let imageUrl = ''
    if (image) {
      try {
        imageUrl = await saveImageUpload(image, 'project')
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
    if (error instanceof HttpUrlValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Fehler beim Erstellen des Projekts.' }, { status: 500 })
  }
}
