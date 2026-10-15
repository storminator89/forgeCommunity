/** A single current-eligibility badge, not a per-course or historical award. */
export const VERIFIED_COURSE_BADGE = {
  id: 'course-achievement-verified-v1',
  name: 'Verifiziertes Lernen',
  description: 'Mindestens ein aktuell gültiger, administrativ freigegebener Kursabschluss mit bestandenem aktuellem Quiz.',
  image: '',
} as const;

/** Existing unrelated badges retain their current public visibility. */
export function canShowBadgeToViewer(
  badgeId: string,
  owner: { id: string; role: string; isTestAccount: boolean; userSettings?: { publicRankingOptIn: boolean } | null },
  viewerId: string,
) {
  if (badgeId !== VERIFIED_COURSE_BADGE.id) return true;
  return owner.role === 'USER' && !owner.isTestAccount &&
    (owner.id === viewerId || owner.userSettings?.publicRankingOptIn === true);
}
