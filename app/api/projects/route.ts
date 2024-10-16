// app/api/projects/route.ts

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import fs from 'fs'
import path from 'path'

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
  const session = await getServerSession(authOptions)
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401 })
  }

  // Parse form data
  const formData = await req.formData()
  const title = formData.get('title') as string
  const description = formData.get('description') as string
  const category = formData.get('category') as string
  const tags = (formData.get('tags') as string).split(',').map(tag => tag.trim()).filter(tag => tag !== '')
  const link = formData.get('link') as string
  const image = formData.get('image') as File | null

  // Validierung
  if (!title || !description || !category || !link) {
    return NextResponse.json({ error: 'Titel, Beschreibung, Kategorie und Link sind erforderlich.' }, { status: 400 })
  }

  let imageUrl = ''
  if (image) {
    try {
      // Sicherstellen, dass der Upload-Ordner existiert
      const uploadDir = path.join(process.cwd(), 'public', 'images', 'uploads')
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }

      // Generiere einen einzigartigen Dateinamen
      const fileExtension = path.extname(image.name)
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${fileExtension}`
      const filePath = path.join(uploadDir, fileName)

      // Speichere die Datei
      const arrayBuffer = await image.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      fs.writeFileSync(filePath, buffer)

      // Setze die Bild-URL
      imageUrl = `/images/uploads/${fileName}`
    } catch (error) {
      console.error('Error saving image:', error)
      return NextResponse.json({ error: 'Fehler beim Speichern des Bildes.' }, { status: 500 })
    }
  }

  try {
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

    // Erstelle das Projekt
    const newProject = await prisma.project.create({
      data: {
        title,
        description,
        link,
        imageUrl,
        gradientFrom: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
        gradientTo: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
        author: {
          connect: { id: session.user.id },
        },
        tags: {
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

    return NextResponse.json(newProject, { status: 201 })
  } catch (error) {
    console.error('Error creating project:', error)
    return NextResponse.json({ error: 'Fehler beim Erstellen des Projekts.' }, { status: 500 })
  }
}
