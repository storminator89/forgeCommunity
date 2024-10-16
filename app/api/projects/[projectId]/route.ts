// app/api/projects/[projectId]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth' 
import fs from 'fs'
import path from 'path'

export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
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

export async function PUT(req: NextRequest, { params }: { params: { projectId: string } }) {
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

    let imageUrl = project.imageUrl
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

        // Lösche das alte Bild, falls vorhanden
        if (project.imageUrl) {
          const oldImagePath = path.join(process.cwd(), 'public', project.imageUrl)
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath)
          }
        }

        // Setze die neue Bild-URL
        imageUrl = `/images/uploads/${fileName}`
      } catch (error) {
        console.error('Error saving image:', error)
        return NextResponse.json({ error: 'Fehler beim Speichern des Bildes.' }, { status: 500 })
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
    return NextResponse.json({ error: 'Fehler beim Aktualisieren des Projekts.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { projectId: string } }) {
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
      const imagePath = path.join(process.cwd(), 'public', project.imageUrl)
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath)
      }
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
