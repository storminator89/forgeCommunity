import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]/options';
import { PrismaClient, ResourceType } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Schema für Ressourcenvalidierung
const resourceSchema = z.object({
  title: z.string().min(1),
  type: z.nativeEnum(ResourceType),
  category: z.string().min(1),
  url: z.string().url(),
  color: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '9');
    const search = searchParams.get('search') || '';

    const skip = (page - 1) * limit;

    const whereClause = search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { author: { name: { contains: search, mode: 'insensitive' } } }
      ]
    } : {};

    const resources = await prisma.resource.findMany({
      where: whereClause,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: skip,
    });

    const total = await prisma.resource.count({ where: whereClause });

    return NextResponse.json({
      resources,
      hasMore: skip + resources.length < total,
      total
    }, { status: 200 });
  } catch (error) {
    console.error('Error fetching resources:', error);
    return NextResponse.json(
      { error: 'Fehler beim Abrufen der Ressourcen.' }, 
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = resourceSchema.parse(body);

    const newResource = await prisma.resource.create({
      data: {
        title: parsed.title,
        type: parsed.type,
        category: parsed.category,
        url: parsed.url,
        color: parsed.color,
        author: {
          connect: { id: session.user.id }, // Verbindet mit dem aktuellen Benutzer
        },
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json(newResource, { status: 201 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error('Error creating resource:', error);
    return NextResponse.json({ error: 'Fehler beim Erstellen der Ressource.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, title, url } = body;

    if (!id || !title || !url) {
      return NextResponse.json({ error: 'ID, Titel und URL sind erforderlich.' }, { status: 400 });
    }

    const resource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!resource) {
      return NextResponse.json({ error: 'Ressource nicht gefunden.' }, { status: 404 });
    }

    if (resource.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    const updatedResource = await prisma.resource.update({
      where: { id },
      data: {
        title,
        url,
      },
    });

    return NextResponse.json(updatedResource, { status: 200 });
  } catch (error: any) {
    console.error('Error updating resource:', error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren der Ressource.' }, { status: 500 });
  }
}
