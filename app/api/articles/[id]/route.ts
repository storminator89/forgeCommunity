import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { writeFile } from 'fs/promises';
import path from 'path';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    console.log('GET request for article ID:', params.id); // Debug log

    const article = await prisma.article.findUnique({
      where: { id: params.id },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
        tags: true,
      },
    });

    if (!article) {
      console.log('Article not found'); // Debug log
      return NextResponse.json({ error: 'Artikel nicht gefunden' }, { status: 404 });
    }

    console.log('Found article:', article); // Debug log
    return NextResponse.json(article);
  } catch (error) {
    console.error('Error fetching article:', error);
    return NextResponse.json(
      { error: 'Fehler beim Abrufen des Artikels' },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const title = formData.get('title') as string;
    const content = formData.get('content') as string;
    const category = formData.get('category') as string;
    const tags = formData.getAll('tags') as string[];
    const featuredImage = formData.get('featuredImage') as File | null;
    const deleteImage = formData.get('deleteImage') === 'true';

    if (!title || !content || !category) {
      return NextResponse.json({ error: 'Titel, Inhalt und Kategorie sind erforderlich.' }, { status: 400 });
    }

    // Überprüfe, ob der Artikel existiert
    const existingArticle = await prisma.article.findUnique({ where: { id } });
    if (!existingArticle) {
      return NextResponse.json({ error: 'Artikel nicht gefunden.' }, { status: 404 });
    }

    // Überprüfe, ob der aktuelle Benutzer der Autor ist
    if (existingArticle.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Du bist nicht berechtigt, diesen Artikel zu bearbeiten.' }, { status: 403 });
    }

    let featuredImagePath = existingArticle.featuredImage;

    // Wenn das Bild gelöscht werden soll, setze den Pfad auf null
    if (deleteImage) {
      featuredImagePath = null;
    } 
    // Ansonsten, wenn ein neues Bild hochgeladen wurde, speichere es
    else if (featuredImage) {
      const bytes = await featuredImage.arrayBuffer();
      const buffer = new Uint8Array(bytes);

      const fileName = `${Date.now()}_${featuredImage.name}`;
      const filePath = path.join(process.cwd(), 'public', 'images', 'uploads', fileName);
      await writeFile(filePath, buffer);
      featuredImagePath = `/images/uploads/${fileName}`;
    }

    // Verknüpfe Tags oder erstelle neue Tags, falls sie nicht existieren
    const tagConnectOrCreate = tags.map((tagName: string) => ({
      where: { name: tagName },
      create: { name: tagName },
    }));

    const updatedArticle = await prisma.article.update({
      where: { id },
      data: {
        title,
        content,
        category,
        featuredImage: featuredImagePath,
        tags: {
          set: [], // Entfernt alle bestehenden Tags
          connectOrCreate: tagConnectOrCreate,
        },
      },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
        tags: true,
      },
    });

    return NextResponse.json(updatedArticle, { status: 200 });
  } catch (error) {
    console.error(`PUT /api/articles/${id} Error:`, error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren des Artikels.' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    // Überprüfe, ob der Artikel existiert
    const existingArticle = await prisma.article.findUnique({ where: { id } });
    if (!existingArticle) {
      return NextResponse.json({ error: 'Artikel nicht gefunden.' }, { status: 404 });
    }

    // Überprüfe, ob der aktuelle Benutzer der Autor ist
    if (existingArticle.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Du bist nicht berechtigt, diesen Artikel zu löschen.' }, { status: 403 });
    }

    // Lösche den Artikel
    await prisma.article.delete({ where: { id } });

    return NextResponse.json({ message: 'Artikel erfolgreich gelöscht.' }, { status: 200 });
  } catch (error) {
    console.error(`DELETE /api/articles/${id} Error:`, error);
    return NextResponse.json({ error: 'Fehler beim Löschen des Artikels.' }, { status: 500 });
  }
}