/** @jest-environment node */
import { isPracticeRetentionHealthy, practiceReviewIntervalMs, projectPracticeSelection, PRACTICE_SESSION_LIMIT } from '@/lib/formative-practice-availability';

const now = new Date('2026-10-16T12:00:00.000Z');
const day = 86400_000;
const item = (itemId: string) => ({ itemId, itemRevision: 1 });
const at = (offset: number) => new Date(now.getTime() + offset);
const select = (extra: Partial<Parameters<typeof projectPracticeSelection>[0]> = {}) => projectPracticeSelection({
  items: [item('item-a')], states: [], recent: [], now, ...extra,
});

test('one-item pool uses effective 24h exclusion rather than raw five-minute due time', () => {
  const input = { states: [{ ...item('item-a'), dueAt: at(5 * 60_000) }], recent: [{ itemId: 'item-a', shownAt: now }] };
  expect(select(input)).toEqual({ candidates: [], nextAvailableAt: at(day + 1) });
  expect(select({ ...input, now: at(day) }).candidates).toEqual([]);
  expect(select({ ...input, now: at(day + 1) })).toEqual({ candidates: [item('item-a')], nextAvailableAt: at(day + 1) });
});

test('two-item pool waits for earliest of both effective eligibility times', () => {
  const input = { items: [item('item-a'), item('item-b')], states: [{ ...item('item-a'), dueAt: at(10 * 60_000) },
    { ...item('item-b'), dueAt: at(6 * 3600_000) }],
    recent: [{ itemId: 'item-b', shownAt: now }, { itemId: 'item-a', shownAt: at(-60_000) }] };
  expect(select(input)).toEqual({ candidates: [], nextAvailableAt: at(day - 60_000 + 1) });
});

test('only latest two recent reservations exclude: a larger pool retains stable due and id ordering', () => {
  const items = ['item-c', 'item-b', 'item-a', 'item-d', 'item-e'].map(item);
  const recent = [{ itemId: 'item-d', shownAt: now }, { itemId: 'item-e', shownAt: at(-1) }, { itemId: 'item-a', shownAt: at(-2) }];
  const states = [{ ...item('item-c'), dueAt: at(-100) }, { ...item('item-b'), dueAt: at(-100) }];
  expect(select({ items, states, recent }).candidates.map(row => row.itemId)).toEqual(['item-a', 'item-b', 'item-c']);
  expect(select({ items, states, recent }).nextAvailableAt).toEqual(now);
});

test('session-only exclusions persist past 24h until explicit close; the fresh session can select', () => {
  const input = { sessionItemIds: ['item-a'], recent: [{ itemId: 'item-a', shownAt: at(-day - 1) }] };
  expect(select(input)).toEqual({ candidates: [], nextAvailableAt: null });
  expect(select({ ...input, sessionItemIds: [] })).toEqual({ candidates: [item('item-a')], nextAvailableAt: now });
  expect(PRACTICE_SESSION_LIMIT).toBe(10);
});

test('revision mismatch and missing pool have no speculative next time; projection does not mutate inputs', () => {
  expect(select({ states: [{ itemId: 'item-a', itemRevision: 2, dueAt: at(-day) }] })).toEqual({ candidates: [], nextAvailableAt: null });
  expect(select({ items: [] })).toEqual({ candidates: [], nextAvailableAt: null });
  const items = Object.freeze([Object.freeze(item('item-a'))]);
  const recent = Object.freeze([Object.freeze({ itemId: 'item-a', shownAt: now })]);
  expect(select({ items: items as unknown as ReturnType<typeof item>[], recent: recent as unknown as Array<{ itemId: string; shownAt: Date }> }).nextAvailableAt).toEqual(at(day + 1));
  expect(items[0].itemId).toBe('item-a');
});

test.each([5, 10, 360])('a %s-minute raw due window remains subject to repeat exclusions', minutes => {
  expect(select({ states: [{ ...item('item-a'), dueAt: at(minutes * 60_000) }] }).nextAvailableAt).toEqual(at(minutes * 60_000));
  expect(select({ states: [{ ...item('item-a'), dueAt: at(minutes * 60_000) }], recent: [{ itemId: 'item-a', shownAt: now }] }).nextAvailableAt).toEqual(at(day + 1));
});

test('existing answer intervals remain 5/10min,6h and 1–30days without changing learning policy', () => {
  expect(practiceReviewIntervalMs(false, 'SURE', 0)).toBe(5 * 60_000);
  for (const confidence of [null, 'SOMEWHAT_SURE', 'UNSURE', 'GUESSED'] as const) expect(practiceReviewIntervalMs(false, confidence, 0)).toBe(10 * 60_000);
  for (const confidence of ['UNSURE', 'GUESSED'] as const) expect(practiceReviewIntervalMs(true, confidence, 1)).toBe(6 * 3600_000);
  for (const [index, days] of [1, 2, 4, 8, 16, 30].entries()) {
    for (const confidence of [null, 'SOMEWHAT_SURE'] as const) expect(practiceReviewIntervalMs(true, confidence, index + 1)).toBe(days * day);
    expect(practiceReviewIntervalMs(true, 'SURE', index + 1)).toBe(Math.min(days * 2, 30) * day);
    expect(select({ states: [{ ...item('item-a'), dueAt: at(days * day) }], recent: [{ itemId: 'item-a', shownAt: now }] }).nextAvailableAt).toEqual(at(Math.max(days * day, day + 1)));
  }
});

test('heartbeat fails closed when absent, stale, invalid or too far in future; exact bounds stay healthy', () => {
  for (const value of [null, undefined, at(-45 * 60_000 - 1), at(5 * 60_000 + 1), new Date('invalid')]) expect(isPracticeRetentionHealthy(value, now)).toBe(false);
  for (const value of [now, at(-45 * 60_000), at(5 * 60_000)]) expect(isPracticeRetentionHealthy(value, now)).toBe(true);
});
