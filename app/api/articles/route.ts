// app/api/articles/route.ts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // Korrigierter Pfad
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth'; // Passe den Pfad entsprechend an

export async function GET() {
  try {
    console.log('Prisma Article Model:', prisma.article); // Debugging: Überprüfe, ob prisma.article definiert ist

    const articles = await prisma.article.findMany({
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
        tags: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return NextResponse.json(articles, { status: 200 });
  } catch (error) {
    console.error('GET /api/articles Error:', error);
    return NextResponse.json({ error: 'Fehler beim Abrufen der Artikel.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  const { title, content, category, tags } = await req.json();

  if (!title || !content || !category) {
    return NextResponse.json({ error: 'Titel, Inhalt und Kategorie sind erforderlich.' }, { status: 400 });
  }

  try {
    console.log('Creating a new article with data:', { title, content, category, tags });

    // Verknüpfe Tags oder erstelle neue Tags, falls sie nicht existieren
    const tagConnectOrCreate = tags?.map((tagName: string) => ({
      where: { name: tagName },
      create: { name: tagName },
    }));

    const newArticle = await prisma.article.create({
      data: {
        title,
        content,
        category,
        author: { connect: { email: session.user.email } }, // Verknüpft den aktuellen Benutzer als Autor
        tags: {
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

    console.log('New article created:', newArticle);

    return NextResponse.json(newArticle, { status: 201 });
  } catch (error) {
    console.error('POST /api/articles Error:', error);
    return NextResponse.json({ error: 'Fehler beim Erstellen des Artikels.' }, { status: 500 });
  }
}
