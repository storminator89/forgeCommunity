// app/api/resources/[id]/route.ts

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/options';
import { PrismaClient, ResourceType } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Schema für Ressourcenvalidierung bei Updates
const resourceUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  type: z.nativeEnum(ResourceType).optional(),
  category: z.string().min(1).optional(),
  url: z.string().url().optional(),
  color: z.string().min(1).optional(),
});

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  try {
    const resource = await prisma.resource.findUnique({
      where: { id },
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

    if (!resource) {
      return NextResponse.json({ error: 'Ressource nicht gefunden.' }, { status: 404 });
    }

    return NextResponse.json(resource, { status: 200 });
  } catch (error) {
    console.error('Error fetching resource:', error);
    return NextResponse.json({ error: 'Fehler beim Abrufen der Ressource.' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = resourceUpdateSchema.parse(body);

    // Überprüfen, ob die Ressource existiert und dem aktuellen Benutzer gehört
    const existingResource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!existingResource) {
      return NextResponse.json({ error: 'Ressource nicht gefunden.' }, { status: 404 });
    }

    if (existingResource.authorId !== session.user.id && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Nicht autorisiert, diese Ressource zu bearbeiten.' }, { status: 403 });
    }

    const updatedResource = await prisma.resource.update({
      where: { id },
      data: parsed,
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

    return NextResponse.json(updatedResource, { status: 200 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error('Error updating resource:', error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren der Ressource.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const existingResource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!existingResource) {
      return NextResponse.json({ error: 'Ressource nicht gefunden.' }, { status: 404 });
    }

    if (existingResource.authorId !== session.user.id && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Nicht autorisiert, diese Ressource zu löschen.' }, { status: 403 });
    }

    await prisma.resource.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Ressource gelöscht.' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting resource:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen der Ressource.' }, { status: 500 });
  }
}
