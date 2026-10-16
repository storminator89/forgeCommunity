// app/api/events/[id]/route.ts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { DateTime } from 'luxon';
import { EventTimeError, parseEventSchedule } from '@/lib/event-time';
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html';
import { generateICS } from '@/lib/icsGenerator';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { parseEventCapacity, ParticipationError, participationTransaction } from '@/lib/server/participation';
import { lockEventParticipation, promoteEventWaitlist, requireEventAccount } from '@/lib/server/event-participation';

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const event = await prisma.event.findUnique({
      where: { id: params.id },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    return new NextResponse(generateICS(event), {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="event.ics"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error generating ICS file:', error);
    return NextResponse.json({ error: 'Error generating ICS file' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
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
    const maxAttendees = data.maxAttendees === undefined ? undefined : parseEventCapacity(data.maxAttendees);

    // Überprüfen der erforderlichen Felder
    if (!title || typeof date !== 'string' || !date || !description || !location || typeof timezone !== 'string' || !timezone || typeof startTime !== 'string' || !startTime || typeof endTime !== 'string' || !endTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { start: eventStartDateTime, end: eventEndDateTime } = parseEventSchedule({ date, startTime, endTime, timezone });

    const updatedEvent = await participationTransaction(async tx => {
      await requireEventAccount(tx, session.user.id, true);
      const event = await lockEventParticipation(tx, params.id);
      const capacity = maxAttendees === undefined ? event.maxAttendees : maxAttendees;
      if (capacity !== null) {
        const registeredCount = await tx.eventAttendee.count({ where: { eventId: params.id, status: { not: 'CANCELLED' } } });
        if (registeredCount > capacity) throw new ParticipationError('Capacity is below current registrations', 409);
      }
      const updated = await tx.event.update({
        where: { id: params.id },
        data: {
          title,
          date: eventStartDateTime.toUTC().toJSDate(),
          description,
          location,
          startTime: eventStartDateTime.toFormat('HH:mm'),
          endTime: eventEndDateTime.toFormat('HH:mm'),
          category,
          timezone,
          ...(maxAttendees === undefined ? {} : { maxAttendees }),
        },
      });
      await promoteEventWaitlist(tx, updated);
      return updated;
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
      maxAttendees: updatedEvent.maxAttendees,
    }, { status: 200 });
  } catch (error) {
    if (error instanceof EventTimeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ParticipationError) return NextResponse.json({ error: error.message }, { status: error.status });
    const clientError = requestErrorResponse(error);
    if (clientError) return clientError;
    console.error('Error updating event:', error);
    return NextResponse.json({ error: 'Error updating event' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await participationTransaction(async tx => {
      await requireEventAccount(tx, session.user.id, true);
      await lockEventParticipation(tx, params.id);
      await tx.event.delete({ where: { id: params.id } });
    });

    return NextResponse.json({ message: 'Event deleted successfully' }, { status: 200 });
  } catch (error) {
    if (error instanceof ParticipationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error deleting event:', error);
    return NextResponse.json({ error: 'Error deleting event' }, { status: 500 });
  }
}
