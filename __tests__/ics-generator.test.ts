/** @jest-environment node */
import type { Event } from '@prisma/client';
import { generateICS } from '@/lib/icsGenerator';

const event: Event = {
  id: 'event-1', title: 'Abendtermin', description: 'Test', location: 'Mannheim',
  date: new Date('2026-09-22T21:00:00Z'), timezone: 'Europe/Berlin',
  startTime: '23:00', endTime: '01:00', category: 'Meetup', maxAttendees: null,
  createdAt: new Date(), updatedAt: new Date(),
};

it('escapes injected calendar properties and uses CRLF delimiters', () => {
  const ics = generateICS({ ...event, title: 'Hi\r\nBEGIN:VEVENT\rATTENDEE:evil', location: 'A;B,C\\D' });
  expect(ics.match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(1);
  expect(ics).toContain('SUMMARY:Hi\\nBEGIN:VEVENT\\nATTENDEE:evil\r\n');
  expect(ics).toContain('LOCATION:A\\;B\\,C\\\\D');
});

it('exports an overnight event with an end after its start', () => {
  const ics = generateICS(event);
  expect(ics).toContain('DTSTART:20260922T210000Z');
  expect(ics).toContain('DTEND:20260922T230000Z');
});

it('folds Unicode lines at 75 bytes without losing text', () => {
  const title = 'Grüße 🌍 '.repeat(30);
  const ics = generateICS({ ...event, title });
  for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`);
});

it('rejects invalid timezones and malformed end times', () => {
  expect(() => generateICS({ ...event, timezone: 'invalid' })).toThrow();
  expect(() => generateICS({ ...event, endTime: '25:99' })).toThrow();
});
