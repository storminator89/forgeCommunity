/** @jest-environment node */
import { Settings } from 'luxon';
import { currentMissionWeekStartDate, missionWindowState, parseMissionWeek, resolveMissionWeek } from '@/lib/mission-week-clock';

const week = (startDate = '2026-10-19', timezone = 'Europe/Berlin') => ({ startDate, timezone });

test.each([
  ['2026-03-23', '2026-03-25T12:00:00Z', '2026-03-22T23:00:00.000Z', '2026-03-29T22:00:00.000Z', 167],
  ['2026-10-19', '2026-10-21T12:00:00Z', '2026-10-18T22:00:00.000Z', '2026-10-25T23:00:00.000Z', 169],
])('resolves independent local boundaries for %s across DST', (startDate, now, start, end, hours) => {
  const result = resolveMissionWeek(week(startDate), new Date(now));
  expect(result.weekStartsAt.toISOString()).toBe(start);
  expect(result.weekEndsAt.toISOString()).toBe(end);
  expect((+result.weekEndsAt - +result.weekStartsAt) / 3600000).toBe(hours);
});

test('current week follows the selected IANA zone, ISO Monday, exact rollover and year boundary', () => {
  const now = new Date('2026-10-18T22:30:00Z');
  expect(currentMissionWeekStartDate(now, 'Europe/Berlin')).toBe('2026-10-19');
  expect(currentMissionWeekStartDate(now, 'America/New_York')).toBe('2026-10-12');
  expect(currentMissionWeekStartDate(new Date('2026-01-01T12:00:00Z'), 'UTC')).toBe('2025-12-29');
  expect(() => resolveMissionWeek(week(), new Date('2026-10-18T21:59:59.999Z'))).toThrow(/aktuelle/);
  expect(resolveMissionWeek(week(), new Date('2026-10-18T22:00:00Z')).weekStartsOn).toBe('2026-10-19');
  expect(() => resolveMissionWeek(week(), new Date('2026-10-25T23:00:00Z'))).toThrow(/aktuelle/);
});

test.each([
  null, [], {}, { startDate: '2026-10-19' }, { timezone: 'UTC' },
  { ...week(), endsAt: 'supplied' }, { ...week(), timezone: null },
  { ...week(), timezone: 'UTC+2' }, { ...week(), timezone: 'Europe/Invalid' },
  { ...week(), timezone: 'a'.repeat(101) }, { ...week(), timezone: ' Europe/Berlin' },
  week('2026-10-20'), week('2026-02-30'), week('2026-1-05'), week('2026-10-19T00:00'),
])('rejects malformed, partial or non-Monday week input %j', value => {
  expect(() => parseMissionWeek(value)).toThrow();
});

test('input parsing is stable after rollover; current-week eligibility is a separate insertion check', () => {
  expect(parseMissionWeek(week())).toEqual(week());
  expect(() => resolveMissionWeek(week(), new Date('2026-10-27T00:00:00Z'))).toThrow(/aktuelle/);
  expect(resolveMissionWeek(week('2026-10-19', 'UTC'), new Date('2026-10-22T00:00:00Z')).weekStartsAt.toISOString()).toBe('2026-10-19T00:00:00.000Z');
});

test.each([
  ['2010-03-22', 'Asia/Tehran', '2010-03-23T12:00:00Z'],
  ['2010-03-15', 'Asia/Tehran', '2010-03-16T12:00:00Z'],
  ['2001-09-24', 'Asia/Jerusalem', '2001-09-25T12:00:00Z'],
  ['2001-09-17', 'Asia/Jerusalem', '2001-09-18T12:00:00Z'],
])('rejects skipped or ambiguous start/end Monday boundaries %s %s', (startDate, timezone, now) => {
  expect(() => resolveMissionWeek(week(startDate, timezone), new Date(now))).toThrow(/Wochengrenze/);
});

test('server/default zone never moves selected UTC boundaries', () => {
  const original = Settings.defaultZone;
  try {
    for (const zone of ['Pacific/Honolulu', 'Asia/Tokyo', 'UTC']) {
      Settings.defaultZone = zone;
      expect(resolveMissionWeek(week(), new Date('2026-10-22T00:00:00Z')).weekEndsAt.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    }
  } finally { Settings.defaultZone = original; }
});

test('exclusive end is descriptive, independent of close or completion', () => {
  const end = new Date('2026-10-25T23:00:00Z');
  expect(missionWindowState(null, end)).toBe('self-paced');
  expect(missionWindowState(end, new Date(+end - 1))).toBe('current');
  expect(missionWindowState(end, end)).toBe('past');
});
