// app/api/events/route.ts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { DateTime } from 'luxon';

// Unterstützte Zeitzonen
const TIMEZONES = [
  'Europe/Berlin',
  'America/New_York',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  // Weitere nach Bedarf hinzufügen
];

// GET-Handler zum Abrufen von Events
export async function GET() {
  try {
    const events = await prisma.event.findMany({
      orderBy: {
        date: 'asc',
      },
    });

    const formattedEvents = events.map(event => {
      // Konvertiere UTC-Zeit in die jeweilige Zeitzone
      const zonedStartDate = DateTime.fromJSDate(event.date, { zone: 'utc' }).setZone(event.timezone);
      return {
        id: event.id,
        title: event.title,
        date: zonedStartDate.toISO(), // ISO-String mit Zeitzoneninformationen
        description: event.description,
        location: event.location,
        startTime: event.startTime || '',
        endTime: event.endTime || '',
        category: event.category || '',
        timezone: event.timezone, // Zeitzone einschließen
      };
    });

    return NextResponse.json(formattedEvents);
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json({ error: 'Error fetching events' }, { status: 500 });
  }
}

// POST-Handler zum Erstellen eines neuen Events
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json();
    console.log('Received event data:', data); // Protokollierung der empfangenen Daten
    const { title, date, description, location, startTime, endTime, category, timezone } = data;

    // Überprüfen der erforderlichen Felder
    if (!title || !date || !description || !location || !timezone || !startTime || !endTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Überprüfen der Zeitzone
    if (!TIMEZONES.includes(timezone)) {
      return NextResponse.json({ error: 'Invalid timezone selected' }, { status: 400 });
    }

    // Kombinieren von Datum und Uhrzeit und Konvertierung in UTC
    const eventStartDateTime = DateTime.fromISO(`${date}T${startTime}`, { zone: timezone });
    const eventEndDateTime = DateTime.fromISO(`${date}T${endTime}`, { zone: timezone });

    if (!eventStartDateTime.isValid || !eventEndDateTime.isValid) {
      console.error('Invalid date format:', { date, startTime, endTime });
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    if (eventEndDateTime <= eventStartDateTime) {
      return NextResponse.json({ error: 'Endzeit muss nach der Startzeit liegen' }, { status: 400 });
    }

    const utcStartDateTime = eventStartDateTime.toUTC();
    const utcEndDateTime = eventEndDateTime.toUTC();

    const newEvent = await prisma.event.create({
      data: {
        title,
        date: utcStartDateTime.toJSDate(),
        description,
        location,
        startTime: eventStartDateTime.toFormat('HH:mm'),
        endTime: eventEndDateTime.toFormat('HH:mm'),
        category: category || null,
        timezone,
      },
    });

    const formattedZonedStartDate = DateTime.fromJSDate(newEvent.date, { zone: 'utc' }).setZone(newEvent.timezone);

    return NextResponse.json({
      id: newEvent.id,
      title: newEvent.title,
      date: formattedZonedStartDate.toISO(),
      description: newEvent.description,
      location: newEvent.location,
      startTime: newEvent.startTime || '',
      endTime: newEvent.endTime || '',
      category: newEvent.category || '',
      timezone: newEvent.timezone,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating event:', error);
    return NextResponse.json({ error: 'Error creating event' }, { status: 500 });
  }
}
