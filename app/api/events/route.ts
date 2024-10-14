// app/api/events/route.ts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function GET() {
  try {
    const events = await prisma.event.findMany({
      orderBy: {
        date: 'asc',
      },
    });

    // Formatieren der Ereignisse für das Frontend
    const formattedEvents = events.map(event => ({
      id: event.id,
      title: event.title,
      date: event.date.toISOString(),
      description: event.description,
      location: event.location,
      time: event.time || '',         // Optionales Feld
      category: event.category || '', // Optionales Feld
    }));

    return NextResponse.json(formattedEvents);
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json({ error: 'Error fetching events' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'ADMIN') { // Annahme: Rolle ist im Session-Objekt verfügbar
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json();
    const { title, date, description, location, time, category } = data;

    // Validierung (optional, aber empfohlen)
    if (!title || !date || !description || !location) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const newEvent = await prisma.event.create({
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
      id: newEvent.id,
      title: newEvent.title,
      date: newEvent.date.toISOString(),
      description: newEvent.description,
      location: newEvent.location,
      time: newEvent.time || '',
      category: newEvent.category || '',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating event:', error);
    return NextResponse.json({ error: 'Error creating event' }, { status: 500 });
  }
}
