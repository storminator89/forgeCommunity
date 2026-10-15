export type PathwayHistory = {
  type: 'AWARDED' | 'REVOKED' | 'REINSTATED';
  reason: 'REWARD_INVALIDATED' | 'OPTED_OUT' | 'ACCOUNT_INELIGIBLE' | null;
  at: string;
};

export type MemberPathway = {
  id: string;
  title: string;
  description: string;
  badgeLabel: string;
  courses: { courseId: string; title: string; order: number; creditActive: boolean; available: boolean; isEnrolled: boolean }[];
  unavailable: boolean;
  participation: null | {
    joinedAt: string;
    optedOutAt: string | null;
    badgeActive: boolean;
    badgeFirstAwardedAt: string | null;
  };
  creditedCount: number;
  requiredCount: number;
  history: PathwayHistory[];
};

export type AdminPathway = {
  id: string;
  title: string;
  description: string;
  badgeLabel: string;
  courses: { courseId: string; title: string; order: number }[];
  createdAt: string;
  unavailable: boolean;
};

export function pathwayStatus(pathway: MemberPathway) {
  const participation = pathway.participation;
  if (pathway.unavailable) return 'Nicht mehr verfügbar';
  if (!participation) return 'Noch nicht begonnen';
  if (participation.optedOutAt) return 'Teilnahme beendet';
  if (participation.badgeActive) return 'Abzeichen aktiv';
  if (latestRelevantRevocation(pathway)) return 'Erneute Bestätigung nötig';
  if (pathway.creditedCount >= pathway.requiredCount) return 'Bestätigung wird geprüft';
  return 'In Arbeit';
}

export function latestRelevantRevocation(pathway: MemberPathway): PathwayHistory | null {
  const latest = [...pathway.history].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (latest?.type !== 'REVOKED') return null;
  // An opt-out explanation describes a previous membership, not a lapsed
  // course reward after the learner has joined again.
  if (latest.reason === 'OPTED_OUT' && pathway.participation?.joinedAt &&
      pathway.participation.joinedAt > latest.at) return null;
  return latest;
}

export function pathwayReason(reason: PathwayHistory['reason']) {
  switch (reason) {
    case 'REWARD_INVALIDATED': return 'Eine Kursfreigabe oder ein Kursabschluss ist nicht mehr aktuell.';
    case 'ACCOUNT_INELIGIBLE': return 'Die Teilnahmeberechtigung wurde neu geprüft.';
    case 'OPTED_OUT': return 'Du hast deine Teilnahme beendet.';
    default: return 'Der aktuelle Stand wurde neu geprüft.';
  }
}
