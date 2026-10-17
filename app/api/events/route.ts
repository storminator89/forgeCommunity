// app/api/events/route.ts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { DateTime } from 'luxon';
import { EventTimeError, parseEventSchedule } from '@/lib/event-time';
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { parseEventCapacity, ParticipationError } from '@/lib/server/participation';

// GET-Handler zum Abrufen von Events
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const events = await prisma.event.findMany({
      orderBy: {
        date: 'asc',
      },
      include: {
        _count: { select: { attendees: { where: { status: { not: 'CANCELLED' } } } } },
        attendees: { where: { userId: session?.user?.id ?? '' }, select: { status: true } },
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
        maxAttendees: event.maxAttendees,
        attendeeCount: event._count.attendees,
        isAttending: event.attendees.some(attendee => attendee.status !== 'CANCELLED'),
        canCancelRsvp: event.attendees.some(attendee => attendee.status === 'REGISTERED' || attendee.status === 'CONFIRMED'),
      };
    });

    return NextResponse.json(formattedEvents, { headers: { 'Cache-Control': 'private, no-store' } });
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
    const data = await readJsonObject(request);
    const title = sanitizeTextServer(typeof data.title === 'string' ? data.title : '');
    const description = sanitizeRichHtmlServer(typeof data.description === 'string' ? data.description : '');
    const location = sanitizeTextServer(typeof data.location === 'string' ? data.location : '');
    const category = sanitizeTextServer(typeof data.category === 'string' ? data.category : '') || 'Allgemein';
    const { date, startTime, endTime, timezone } = data;
    const maxAttendees = parseEventCapacity(data.maxAttendees);

    // Überprüfen der erforderlichen Felder
    if (!title || typeof date !== 'string' || !date || !description || !location || typeof timezone !== 'string' || !timezone || typeof startTime !== 'string' || !startTime || typeof endTime !== 'string' || !endTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { start: eventStartDateTime, end: eventEndDateTime } = parseEventSchedule({ date, startTime, endTime, timezone });

    const newEvent = await prisma.event.create({
      data: {
        title,
        date: eventStartDateTime.toUTC().toJSDate(),
        description,
        location,
        startTime: eventStartDateTime.toFormat('HH:mm'),
        endTime: eventEndDateTime.toFormat('HH:mm'),
        category,
        timezone,
        maxAttendees,
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
      maxAttendees: newEvent.maxAttendees,
      attendeeCount: 0,
      isAttending: false,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof EventTimeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ParticipationError) return NextResponse.json({ error: error.message }, { status: error.status });
    const clientError = requestErrorResponse(error);
    if (clientError) return clientError;
    console.error('Error creating event:', error);
    return NextResponse.json({ error: 'Error creating event' }, { status: 500 });
  }
}
