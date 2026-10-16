import { DateTime } from 'luxon';

export const EVENT_TIMEZONES = [
  'Europe/Berlin', 'America/New_York', 'Asia/Tokyo',
  'Australia/Sydney', 'Europe/London',
];

export class EventTimeError extends Error {}

/** A wall time must identify one real instant, never Luxon's DST guess. */
export function eventWallTime(date: string, time: string, timezone: string): DateTime {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new EventTimeError('Ungültiges Datums- oder Zeitformat');
  }
  const result = DateTime.fromISO(`${date}T${time}`, { zone: timezone, locale: 'en-US', numberingSystem: 'latn' });
  if (!result.isValid || result.toFormat('yyyy-MM-dd HH:mm') !== `${date} ${time}`) {
    throw new EventTimeError('Diese Uhrzeit existiert in der gewählten Zeitzone nicht. Bitte wähle eine andere Uhrzeit.');
  }
  if (result.getPossibleOffsets().length !== 1) {
    throw new EventTimeError('Diese Uhrzeit ist wegen der Zeitumstellung mehrdeutig. Bitte wähle eine andere Uhrzeit.');
  }
  return result;
}

export function parseEventSchedule(input: { date: string; startTime: string; endTime: string; timezone: string }) {
  if (!EVENT_TIMEZONES.includes(input.timezone)) throw new EventTimeError('Invalid timezone selected');
  const start = eventWallTime(input.date, input.startTime, input.timezone);
  const end = eventWallTime(input.date, input.endTime, input.timezone);
  if (end <= start) throw new EventTimeError('Endzeit muss nach der Startzeit liegen');
  return { start, end };
}

type ZonedEvent = { date: string; timezone: string };
const eventStart = (event: ZonedEvent) => DateTime.fromISO(event.date, { setZone: true, locale: 'en-US', numberingSystem: 'latn' }).setZone(event.timezone);

export const eventDateKey = (event: ZonedEvent): string => eventStart(event).toISODate() ?? '';
export const eventStartTime = (event: ZonedEvent): string => eventStart(event).toFormat('HH:mm');

/** Calendar-only Date: its local fields represent the event's day, not its instant. */
export function eventCalendarDate(event: ZonedEvent): Date {
  const date = eventDateKey(event);
  return date ? new Date(`${date}T12:00:00`) : new Date(NaN);
}

export function eventIsTodayOrLater(event: ZonedEvent, now = new Date()): boolean {
  const start = eventStart(event);
  return start.isValid && start >= DateTime.fromJSDate(now, { zone: event.timezone }).startOf('day');
}
