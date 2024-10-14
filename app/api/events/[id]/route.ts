// app/api/events/[id]/route.ts

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

// Hilfsfunktionen zur Bereinigung der Daten für ICS
function escapeICS(text: string): string {
  return text.replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

function sanitizeFilename(name: string): string {
  return name.replace(/\s+/g, '_').replace(/[<>:"\/\\|?*]+/g, '');
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    console.log(`Generating ICS for event ID: ${params.id}`);

    const event = await prisma.event.findUnique({
      where: { id: params.id },
    });

    if (!event) {
      console.error(`Event with ID ${params.id} not found.`);
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    console.log('Event data:', event);

    // Annahme: event.date ist in UTC gespeichert
    const zonedStartDate = DateTime.fromJSDate(event.date, { zone: 'utc' }).setZone(event.timezone);
    let zonedEndDate = zonedStartDate.plus({ hours: 1 }); // Standarddauer 1 Stunde

    if (event.endTime) {
      const endDateTime = DateTime.fromISO(`${zonedStartDate.toISODate()}T${event.endTime}`, { zone: event.timezone });
      if (endDateTime.isValid) {
        zonedEndDate = endDateTime; // Jetzt gültig, da zonedEndDate mit `let` deklariert
      } else {
        console.error(`Invalid end time for event ID ${params.id}.`);
        return NextResponse.json({ error: 'Invalid end time format' }, { status: 500 });
      }
    }

    console.log('Start Date (Event Timezone):', zonedStartDate.toISO());
    console.log('End Date (Event Timezone):', zonedEndDate.toISO());

    if (!zonedStartDate.isValid || !zonedEndDate.isValid) {
      console.error(`Invalid date conversion for event ID ${params.id}.`);
      return NextResponse.json({ error: 'Invalid date format' }, { status: 500 });
    }

    // Formatierung der Datumsangaben für ICS
    const formatDate = (date: DateTime) => {
      return date.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    };

    // Erstellen des ICS-Inhalts
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//YourOrganization//YourProduct//EN
BEGIN:VEVENT
UID:${event.id}
DTSTAMP:${formatDate(DateTime.utc())}
DTSTART:${formatDate(zonedStartDate)}
DTEND:${formatDate(zonedEndDate)}
SUMMARY:${escapeICS(event.title)}
DESCRIPTION:${escapeICS(event.description)}
LOCATION:${escapeICS(event.location)}
END:VEVENT
END:VCALENDAR`;

    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar',
        'Content-Disposition': `attachment; filename="${sanitizeFilename(event.title)}.ics"`,
      },
    });
  } catch (error) {
    console.error('Error generating ICS file:', error);
    return NextResponse.json({ error: 'Error generating ICS file' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: params.id },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const data = await request.json();
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

    const updatedEvent = await prisma.event.update({
      where: { id: params.id },
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

    const formattedZonedStartDate = DateTime.fromJSDate(updatedEvent.date, { zone: 'utc' }).setZone(updatedEvent.timezone);

    return NextResponse.json({
      id: updatedEvent.id,
      title: updatedEvent.title,
      date: formattedZonedStartDate.toISO(),
      description: updatedEvent.description,
      location: updatedEvent.location,
      startTime: updatedEvent.startTime || '',
      endTime: updatedEvent.endTime || '',
      category: updatedEvent.category || '',
      timezone: updatedEvent.timezone,
    }, { status: 200 });
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

  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: params.id },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    await prisma.event.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ message: 'Event deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting event:', error);
    return NextResponse.json({ error: 'Error deleting event' }, { status: 500 });
  }
}
