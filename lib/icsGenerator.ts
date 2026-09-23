import type { Event } from '@prisma/client';
import { DateTime } from 'luxon';

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
  const start = DateTime.fromJSDate(event.date, { zone: event.timezone });
  if (!start.isValid) throw new Error('Invalid event date or timezone');
  let end = start.plus({ hours: 1 });
  if (event.endTime) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.endTime)) {
      throw new Error('Invalid event end time');
    }
    const [hour, minute] = event.endTime.split(':').map(Number);
    end = start.set({ hour, minute, second: 0, millisecond: 0 });
    if (end <= start) end = end.plus({ days: 1 });
  }
  const format = (date: DateTime) => date.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ForgeCommunity//Events//DE',
    'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${escapeICSText(event.id)}`,
    `DTSTAMP:${format(DateTime.fromJSDate(now))}`, `DTSTART:${format(start)}`,
    `DTEND:${format(end)}`, `SUMMARY:${escapeICSText(event.title)}`,
    `DESCRIPTION:${escapeICSText(event.description)}`,
    `LOCATION:${escapeICSText(event.location)}`, 'END:VEVENT', 'END:VCALENDAR',
  ].map(foldLine).join('\r\n') + '\r\n';
}
