// app/api/resources/route.ts

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

export async function GET() {
  try {
    const resources = await prisma.resource.findMany({
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
    });
    return NextResponse.json(resources, { status: 200 });
  } catch (error) {
    console.error('Error fetching resources:', error);
    return NextResponse.json({ error: 'Fehler beim Abrufen der Ressourcen.' }, { status: 500 });
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
