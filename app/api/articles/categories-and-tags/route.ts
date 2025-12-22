import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    // Verwenden von groupBy, um eindeutige Kategorien zu erhalten und `null` oder leere Kategorien auszuschließen
    const categoriesData = await prisma.article.groupBy({
      by: ['category'],
      where: {
        category: {
          notIn: ['', null as any],
        },
      },
      _count: {
        category: true,
      },
    });

    // Holen aller Tags, sicherstellen, dass nur gültige Namen zurückgegeben werden
    const tagsData = await prisma.tag.findMany({
      select: {
        name: true,
      },
    });

    // Extrahieren und Bereinigen der Kategorienamen
    const categoryNames = categoriesData
      .map(c => c.category)
      .filter((c): c is string => typeof c === 'string' && c.trim() !== '');

    // Extrahieren und Bereinigen der Tag-Namen
    const tagNames = tagsData
      .map(t => t.name)
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '');

    return NextResponse.json({
      categories: categoryNames,
      tags: tagNames,
    });
  } catch (error) {
    console.error('Error fetching categories and tags:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
