// app/api/articles/[id]/route.ts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // Passe den Pfad entsprechend an
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth'; // Passe den Pfad entsprechend an

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    const article = await prisma.article.findUnique({
      where: { id },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
        tags: true,
      },
    });

    if (!article) {
      return NextResponse.json({ error: 'Artikel nicht gefunden.' }, { status: 404 });
    }

    return NextResponse.json(article, { status: 200 });
  } catch (error) {
    console.error(`GET /api/articles/${id} Error:`, error);
    return NextResponse.json({ error: 'Fehler beim Abrufen des Artikels.' }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  const { title, content, category, tags } = await req.json();

  if (!title || !content || !category) {
    return NextResponse.json({ error: 'Titel, Inhalt und Kategorie sind erforderlich.' }, { status: 400 });
  }

  try {
    // Überprüfe, ob der Artikel existiert
    const existingArticle = await prisma.article.findUnique({ where: { id } });
    if (!existingArticle) {
      return NextResponse.json({ error: 'Artikel nicht gefunden.' }, { status: 404 });
    }

    // Überprüfe, ob der aktuelle Benutzer der Autor ist
    if (existingArticle.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Du bist nicht berechtigt, diesen Artikel zu bearbeiten.' }, { status: 403 });
    }

    // Verknüpfe Tags oder erstelle neue Tags, falls sie nicht existieren
    const tagConnectOrCreate = tags?.map((tagName: string) => ({
      where: { name: tagName },
      create: { name: tagName },
    }));

    const updatedArticle = await prisma.article.update({
      where: { id },
      data: {
        title,
        content,
        category,
        tags: {
          set: [], // Entfernt alle bestehenden Tags
          connectOrCreate: tagConnectOrCreate || [],
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
