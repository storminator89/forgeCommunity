/** @jest-environment node */
import { Settings } from 'luxon';
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

it('exports the same accepted wall-clock schedule across the spring offset change', () => {
  const ics = generateICS({ ...event, date: new Date('2030-03-31T00:30:00Z'), startTime: '01:30', endTime: '03:30' });
  expect(ics).toContain('DTSTART:20300331T003000Z');
  expect(ics).toContain('DTEND:20300331T013000Z');
});

it('keeps an early event-zone day consistent with the authoritative UTC start', () => {
  const ics = generateICS({ ...event, date: new Date('2029-12-31T15:30:00Z'), timezone: 'Asia/Tokyo', startTime: '00:30', endTime: '01:30' });
  expect(ics).toContain('DTSTART:20291231T153000Z');
  expect(ics).toContain('DTEND:20291231T163000Z');
});

it.each([
  ['2030-03-31T00:30:00Z', '02:30'],
  ['2030-10-27T00:30:00Z', '02:45'],
  ['2030-03-30T22:00:00Z', '02:30'],
])('refuses to guess a legacy ambiguous or nonexistent end: %s / %s', (date, endTime) => {
  expect(() => generateICS({ ...event, date: new Date(date), endTime })).toThrow();
});


it('keeps calendar machine properties ASCII with non-Latin locale defaults', () => {
  const locale = Settings.defaultLocale;
  const numberingSystem = Settings.defaultNumberingSystem;
  try {
    Settings.defaultLocale = 'ar';
    Settings.defaultNumberingSystem = 'arab';
    const ics = generateICS(event, new Date('2026-01-01T00:00:00Z'));
    expect(ics).toContain('DTSTAMP:20260101T000000Z');
    expect(ics).toContain('DTSTART:20260922T210000Z');
    expect(ics).toContain('DTEND:20260922T230000Z');
    const daytime = generateICS({ ...event, date: new Date('2026-09-22T08:00:00Z'), startTime: '10:00', endTime: '11:00' });
    expect(daytime).toContain('DTEND:20260922T090000Z');
  } finally {
    Settings.defaultLocale = locale;
    Settings.defaultNumberingSystem = numberingSystem;
  }
});
