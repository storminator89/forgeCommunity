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

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === 'ADMIN';
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, url } = body;
    const { id } = params;

    if (!title || !url) {
      return NextResponse.json({ error: 'Titel und URL sind erforderlich.' }, { status: 400 });
    }

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

    // Prüfen ob User Admin ist oder Autor der Ressource
    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin && resource.author.id !== session.user.id) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    const updatedResource = await prisma.resource.update({
      where: { id },
      data: {
        title,
        url,
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

    return NextResponse.json(updatedResource, { status: 200 });
  } catch (error) {
    console.error('Error updating resource:', error);
    return NextResponse.json(
      { error: 'Fehler beim Aktualisieren der Ressource.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const { id } = params;
    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!resource) {
      return NextResponse.json({ error: 'Ressource nicht gefunden.' }, { status: 404 });
    }

    // Prüfen ob User Admin ist oder Autor der Ressource
    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin && resource.author.id !== session.user.id) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    await prisma.resource.delete({
      where: { id },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting resource:', error);
    return NextResponse.json(
      { error: 'Fehler beim Löschen der Ressource.' },
      { status: 500 }
    );
  }
}
