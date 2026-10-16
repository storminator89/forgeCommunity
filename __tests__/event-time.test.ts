/** @jest-environment node */
import { DateTime, Settings } from 'luxon';
import { eventCalendarDate, eventDateKey, eventIsTodayOrLater, eventStartTime, parseEventSchedule } from '@/lib/event-time';
import { waitlistEventFixture } from '../e2e/events-waitlist-fixture';

const input = { date: '2030-05-21', startTime: '00:30', endTime: '01:30', timezone: 'Europe/Berlin' };

test.each(['2030-01-07', '2030-06-07', '2030-03-17', '2030-10-13'])('the browser fixture is valid in the supported event zone across seasons from %s', date => {
  const now = Date.parse(`${date}T00:00:00Z`);
  const fixture = waitlistEventFixture('schedule-regression', now);
  const { start, end } = parseEventSchedule(fixture);
  expect(start.zoneName).toBe('Europe/Berlin');
  expect(start.toISODate()).toBe(fixture.date);
  expect(start.toFormat('HH:mm')).toBe('12:00');
  expect(start.toMillis()).toBeGreaterThan(now);
  expect(end.toMillis() - start.toMillis()).toBe(60 * 60 * 1000);
});

test('resolves one event-zone schedule to UTC without changing its calendar date', () => {
  const { start, end } = parseEventSchedule(input);
  expect(start.toUTC().toISO()).toBe('2030-05-20T22:30:00.000Z');
  expect(end.toUTC().toISO()).toBe('2030-05-20T23:30:00.000Z');
  const event = { date: start.toUTC().toISO()!, timezone: input.timezone };
  expect(eventDateKey(event)).toBe('2030-05-21');
  expect(eventStartTime(event)).toBe('00:30');
  expect(eventCalendarDate(event).getDate()).toBe(21);
  expect(eventCalendarDate(event).getMonth()).toBe(4);
});

test.each([
  ['Europe/Berlin', '2030-03-31', '02:30', '03:30'],
  ['Europe/Berlin', '2030-10-27', '02:30', '03:30'],
  ['America/New_York', '2030-03-10', '02:30', '03:30'],
  ['America/New_York', '2030-11-03', '01:30', '02:30'],
  ['Australia/Sydney', '2030-10-06', '02:30', '03:30'],
  ['Australia/Sydney', '2030-04-07', '02:30', '03:30'],
  ['Europe/London', '2030-03-31', '01:30', '02:30'],
  ['Europe/London', '2030-10-27', '01:30', '02:30'],
])('rejects nonexistent or ambiguous starts and ends in %s on %s', (timezone, date, time, endTime) => {
  expect(() => parseEventSchedule({ timezone, date, startTime: time, endTime })).toThrow();
  expect(() => parseEventSchedule({ timezone, date, startTime: '00:01', endTime: time })).toThrow();
});

test.each([
  { date: '2030-02-30' }, { date: '2030-1-01' }, { date: '2030-05-21T00:30Z' },
  { startTime: '24:00' }, { startTime: '01:30:00' }, { endTime: '00:20' },
  { timezone: 'invalid' }, { timezone: 'UTC' },
])('rejects malformed or unsupported schedule input %j', change => {
  expect(() => parseEventSchedule({ ...input, ...change })).toThrow();
});

test('accepts unambiguous schedules across the spring offset change', () => {
  const { start, end } = parseEventSchedule({ ...input, date: '2030-03-31', startTime: '01:30', endTime: '03:30' });
  expect(end.toMillis() - start.toMillis()).toBe(60 * 60 * 1000);
});

test('ab heute uses each event-zone day while chronological comparisons keep UTC instants', () => {
  const berlin = { date: '2030-05-20T22:30:00Z', timezone: 'Europe/Berlin' };
  const newYork = { date: '2030-05-21T01:30:00Z', timezone: 'America/New_York' };
  expect(eventDateKey(berlin)).toBe('2030-05-21');
  expect(eventDateKey(newYork)).toBe('2030-05-20');
  // These starts are yesterday in their event zones at this later instant.
  const early = new Date('2030-05-21T01:00:00Z');
  expect(eventIsTodayOrLater(berlin, early)).toBe(true);
  expect(eventIsTodayOrLater({ date: '2030-05-20T05:00:00Z', timezone: 'America/New_York' }, early)).toBe(true);
  const now = new Date('2030-05-21T22:15:00Z');
  expect(eventIsTodayOrLater(berlin, now)).toBe(false);
  expect(eventIsTodayOrLater(newYork, now)).toBe(false);
  const earlierToday = { date: '2030-05-21T04:30:00Z', timezone: 'America/New_York' };
  expect(eventIsTodayOrLater(earlierToday, now)).toBe(true);
  expect(DateTime.fromISO(earlierToday.date).toMillis()).toBeLessThan(now.getTime());
});


test('machine dates and input clocks remain ASCII under a non-Latin default numbering system', () => {
  const locale = Settings.defaultLocale;
  const numberingSystem = Settings.defaultNumberingSystem;
  try {
    Settings.defaultLocale = 'ar';
    Settings.defaultNumberingSystem = 'arab';
    const { start } = parseEventSchedule(input);
    expect(start.toFormat('HH:mm')).toBe('00:30');
    const event = { date: start.toUTC().toISO()!, timezone: input.timezone };
    expect(eventDateKey(event)).toBe('2030-05-21');
    expect(eventStartTime(event)).toBe('00:30');
  } finally {
    Settings.defaultLocale = locale;
    Settings.defaultNumberingSystem = numberingSystem;
  }
});
