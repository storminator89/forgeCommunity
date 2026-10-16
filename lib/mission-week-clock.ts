import { DateTime, IANAZone } from 'luxon';

export type MissionWeekInput = { startDate: string; timezone: string };
export class MissionWeekError extends Error {}

/** Validate immutable input separately from insertion-time eligibility. This
 * lets an authorized same-key replay survive rollover and timezone-db changes. */
export function parseMissionWeek(value: unknown): MissionWeekInput {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !Object.hasOwn(value, 'startDate') || !Object.hasOwn(value, 'timezone')) {
    throw new MissionWeekError('Ungültige Lernwoche');
  }
  const { startDate, timezone } = value as Record<string, unknown>;
  if (typeof timezone !== 'string' || !timezone.length || timezone.length > 100 || !IANAZone.isValidZone(timezone)) {
    throw new MissionWeekError('Bitte wähle eine gültige IANA-Zeitzone');
  }
  if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new MissionWeekError('Bitte wähle einen Montag im Format JJJJ-MM-TT');
  }
  // Calendar validation in UTC intentionally does not resolve the local window.
  const date = DateTime.fromISO(startDate, { zone: 'UTC' });
  if (!date.isValid || date.toISODate() !== startDate || date.weekday !== 1) {
    throw new MissionWeekError('Die Lernwoche muss an einem gültigen Montag beginnen');
  }
  return { startDate, timezone };
}

export function currentMissionWeekStartDate(now: Date, timezone: string): string {
  if (!IANAZone.isValidZone(timezone) || !Number.isFinite(now.getTime())) throw new MissionWeekError('Ungültige Lernwoche');
  const local = DateTime.fromJSDate(now, { zone: timezone });
  return local.minus({ days: local.weekday - 1 }).toISODate()!;
}

/** Never accept Luxon's guess for a skipped or repeated local midnight. */
function midnight(date: string, timezone: string): DateTime {
  const local = DateTime.fromISO(`${date}T00:00`, { zone: timezone, locale: 'en-US', numberingSystem: 'latn' });
  if (!local.isValid || local.toFormat('yyyy-MM-dd HH:mm') !== `${date} 00:00` || local.getPossibleOffsets().length !== 1) {
    throw new MissionWeekError('Die Wochengrenze ist in dieser Zeitzone nicht eindeutig verfügbar');
  }
  return local;
}

/** New missions can use only the current local Monday-to-Monday week. Resolve
 * both wall-time boundaries independently, never by adding 168 elapsed hours. */
export function resolveMissionWeek(input: MissionWeekInput, now: Date) {
  const week = parseMissionWeek(input);
  if (week.startDate !== currentMissionWeekStartDate(now, week.timezone)) {
    throw new MissionWeekError('Bitte wähle die aktuelle Lernwoche in dieser Zeitzone');
  }
  const nextMonday = DateTime.fromISO(week.startDate, { zone: 'UTC' }).plus({ days: 7 }).toISODate()!;
  const startsAt = midnight(week.startDate, week.timezone).toJSDate();
  const endsAt = midnight(nextMonday, week.timezone).toJSDate();
  if (endsAt <= startsAt) throw new MissionWeekError('Ungültige Wochengrenzen');
  return { weekStartsOn: week.startDate, weekTimezone: week.timezone, weekStartsAt: startsAt, weekEndsAt: endsAt };
}

/** Descriptive only: a past soft window never closes or resets the mission. */
export function missionWindowState(endsAt: Date | null, now: Date): 'self-paced' | 'current' | 'past' {
  return endsAt === null ? 'self-paced' : now >= endsAt ? 'past' : 'current';
}
