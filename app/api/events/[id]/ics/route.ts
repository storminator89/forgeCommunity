// app/api/events/[id]/ics/route.ts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { DateTime } from 'luxon';

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
        zonedEndDate = endDateTime;
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

    console.log('ICS Content:', icsContent);

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
