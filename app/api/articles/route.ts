// app/api/articles/route.ts

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload';
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html';

export async function GET() {
  try {
    const articles = await prisma.article.findMany({
      where: {
        isPublished: true  // Only fetch published articles
      },
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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const title = sanitizeTextServer(formData.get('title') as string);
    const content = sanitizeRichHtmlServer(formData.get('content') as string);
    const category = sanitizeTextServer(formData.get('category') as string);
    const tags = (formData.getAll('tags') as string[])
      .map((tag) => sanitizeTextServer(tag))
      .filter(Boolean);
    const featuredImage = formData.get('featuredImage') as File | null;
    const isPublished = formData.get('isPublished') === 'true'; // Neues Feld

    if (!title || !content || !category) {
      return NextResponse.json({ error: 'Titel, Inhalt und Kategorie sind erforderlich.' }, { status: 400 });
    }

    let featuredImagePath = '';
    if (featuredImage) {
      featuredImagePath = await saveImageUpload(featuredImage, 'article');
    }

    const tagConnectOrCreate = tags.map((tagName: string) => ({
      where: { name: tagName },
      create: { name: tagName },
    }));

    const newArticle = await prisma.article.create({
      data: {
        title,
        content,
        category,
        isPublished, // Neues Feld
        featuredImage: featuredImagePath,
        author: { connect: { email: session.user.email as string } },
        tags: {
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

    console.log('New article created:', newArticle);
    return NextResponse.json(newArticle, { status: 201 });
  } catch (error) {
    console.error('POST /api/articles Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Fehler beim Erstellen des Artikels.' },
      { status: error instanceof ImageUploadValidationError ? 400 : 500 }
    );
  }
}
