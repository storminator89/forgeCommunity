/** Read-only projection of the existing private review policy. No clock or writes. */
export const PRACTICE_SESSION_LIMIT = 10;
const REPEAT_WINDOW_MS = 24 * 3600_000;
export type PracticeAvailability = 'notOptedIn' | 'paused' | 'ready' | 'resume' | 'waiting' | 'sessionComplete' | 'unavailable';
type Item = { itemId: string; itemRevision: number };
type Schedule = Item & { dueAt: Date };
type Recent = { itemId: string; shownAt: Date };

export function projectPracticeSelection<T extends Item>({ items, states, recent, sessionItemIds = [], now }: {
  items: T[]; states: Schedule[]; recent: Recent[]; sessionItemIds?: string[]; now: Date;
}): { candidates: T[]; nextAvailableAt: Date | null } {
  const clock = now.getTime();
  const stateByItem = new Map(states.map(state => [state.itemId, state]));
  // The caller supplies the existing shownAt/id descending order. Keep its tie
  // order; only the latest two reservations inside the inclusive window count.
  const lastTwo = recent.filter(row => row.shownAt.getTime() >= clock - REPEAT_WINDOW_MS).slice(0, 2);
  const inSession = new Set(sessionItemIds);
  let next: number | null = null;
  const candidates = items.filter(item => {
    const state = stateByItem.get(item.itemId);
    if (inSession.has(item.itemId) || (state && state.itemRevision !== item.itemRevision)) return false;
    let eligibleAt = Math.max(clock, state?.dueAt.getTime() ?? clock);
    for (const row of lastTwo) {
      // Existing SQL uses >=, so equality at exactly 24h remains excluded.
      if (row.itemId === item.itemId) eligibleAt = Math.max(eligibleAt, row.shownAt.getTime() + REPEAT_WINDOW_MS + 1);
    }
    if (Number.isFinite(eligibleAt)) next = next === null ? eligibleAt : Math.min(next, eligibleAt);
    return eligibleAt <= clock;
  }).sort((a, b) => {
    const aDue = stateByItem.get(a.itemId)?.dueAt.getTime() ?? 0;
    const bDue = stateByItem.get(b.itemId)?.dueAt.getTime() ?? 0;
    return aDue - bDue || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
  });
  return { candidates, nextAvailableAt: next === null ? null : new Date(next) };
}

export function isPracticeRetentionHealthy(lastSuccessAt: Date | null | undefined, now: Date) {
  const latest = lastSuccessAt?.getTime();
  return latest !== undefined && Number.isFinite(latest) && latest >= now.getTime() - 45 * 60_000 && latest <= now.getTime() + 5 * 60_000;
}

/** Exact existing confidence timing, shared for deterministic clock tests. */
export function practiceReviewIntervalMs(correct: boolean, confidence: 'SURE' | 'SOMEWHAT_SURE' | 'UNSURE' | 'GUESSED' | null, streak: number) {
  const baseDays = correct ? Math.min(1 << (streak - 1), 30) : 0;
  return !correct ? (confidence === 'SURE' ? 5 : 10) * 60_000
    : confidence === 'UNSURE' || confidence === 'GUESSED' ? 6 * 3600_000
    : confidence === 'SURE' ? Math.min(baseDays * 2, 30) * 86400_000
    : baseDays * 86400_000;
}
