import type { Event } from '@prisma/client';
import { DateTime } from 'luxon';
import { eventWallTime } from '@/lib/event-time';

export function escapeICSText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,');
}

// RFC 5545: 75 octets per line without splitting a UTF-8 character.
function foldLine(line: string): string {
  let result = '';
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += character;
    bytes += size;
  }
  return result;
}

export function generateICS(event: Event, now = new Date()): string {
  const start = DateTime.fromJSDate(event.date, { zone: event.timezone }).reconfigure({ locale: 'en-US', numberingSystem: 'latn' });
  if (!start.isValid) throw new Error('Invalid event date or timezone');
  let end = start.plus({ hours: 1 });
  if (event.endTime) {
    // Choose the local end day before resolving its wall time. Resolving first
    // could silently normalize a DST gap or pick one side of a repeated hour.
    const endDay = event.endTime <= start.toFormat('HH:mm') ? start.plus({ days: 1 }) : start;
    end = eventWallTime(endDay.toISODate()!, event.endTime, event.timezone);
  }
  const format = (date: DateTime) => date.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'", { locale: 'en-US', numberingSystem: 'latn' });
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ForgeCommunity//Events//DE',
    'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${escapeICSText(event.id)}`,
    `DTSTAMP:${format(DateTime.fromJSDate(now))}`, `DTSTART:${format(start)}`,
    `DTEND:${format(end)}`, `SUMMARY:${escapeICSText(event.title)}`,
    `DESCRIPTION:${escapeICSText(event.description)}`,
    `LOCATION:${escapeICSText(event.location)}`, 'END:VEVENT', 'END:VCALENDAR',
  ].map(foldLine).join('\r\n') + '\r\n';
}
