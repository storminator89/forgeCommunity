import { DateTime, IANAZone } from 'luxon';

export const LEARNING_GOAL_TARGETS = [1, 3, 5] as const;
export const LEARNING_GOAL_DURATIONS = [7, 14, 28] as const;

export function validGoalTimezone(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && IANAZone.isValidZone(value);
}

/** Deadline is exclusive midnight after the selected number of local calendar days. */
export function goalDeadline(now: Date, timezone: string, durationDays: number): Date {
  return DateTime.fromJSDate(now, { zone: timezone }).startOf('day').plus({ days: durationDays }).toJSDate();
}

function localDayNumber(date: Date, timezone: string): number {
  const local = DateTime.fromJSDate(date, { zone: timezone });
  return Date.UTC(local.year, local.month - 1, local.day) / 86_400_000;
}

/** A pause moves the deadline by each local date boundary crossed, including DST. */
export function pausedCalendarDays(pausedAt: Date, now: Date, timezone: string): number {
  return Math.max(0, localDayNumber(now, timezone) - localDayNumber(pausedAt, timezone));
}

export function shiftGoalDeadline(endsAt: Date, timezone: string, days: number): Date {
  return DateTime.fromJSDate(endsAt, { zone: timezone }).plus({ days }).toJSDate();
}
