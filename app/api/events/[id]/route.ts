// app/api/events/[id]/route.ts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const event = await prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: event.id,
      title: event.title,
      date: event.date.toISOString(),
      description: event.description,
      location: event.location,
      time: event.time || '',
      category: event.category || '',
    });
  } catch (error) {
    console.error('Error fetching event:', error);
    return NextResponse.json({ error: 'Error fetching event' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'ADMIN') { // Annahme: Rolle ist im Session-Objekt verfügbar
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = params;
    const data = await request.json();
    const { title, date, description, location, time, category } = data;

    // Validierung (optional, aber empfohlen)
    if (!title || !date || !description || !location) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const updatedEvent = await prisma.event.update({
      where: { id },
      data: {
        title,
        date: new Date(date),
        description,
        location,
        time: time || null,
        category: category || null,
      },
    });

    return NextResponse.json({
      id: updatedEvent.id,
      title: updatedEvent.title,
      date: updatedEvent.date.toISOString(),
      description: updatedEvent.description,
      location: updatedEvent.location,
      time: updatedEvent.time || '',
      category: updatedEvent.category || '',
    });
  } catch (error) {
    console.error('Error updating event:', error);
    return NextResponse.json({ error: 'Error updating event' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'ADMIN') { // Annahme: Rolle ist im Session-Objekt verfügbar
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = params;

    // Überprüfen, ob das Event existiert
    const event = await prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    await prisma.event.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Event deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting event:', error);
    return NextResponse.json({ error: 'Error deleting event' }, { status: 500 });
  }
}
