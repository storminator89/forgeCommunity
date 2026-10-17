/** Pure public DTOs only. Account/access fences stay server-private except the
 * caller's explicit send fence. No receiving preference is exposed to peers. */
export interface MissionInvitationPreference {
  enabled: boolean;
  revision: number;
}

export interface MissionInvitationSelection {
  validUntil: string;
  nonce: string;
  token: string;
}

export interface MissionInvitationPerson {
  id: string;
  name: string | null;
  image: string | null;
}

export interface MissionInvitationCandidates {
  items: { user: MissionInvitationPerson; selection: MissionInvitationSelection }[];
  senderEpoch: number;
  senderAccessEpoch: number;
}

export interface SendMissionInvitation {
  recipientId: string;
  senderEpoch: number;
  senderAccessEpoch: number;
  requestId: string;
  selection: MissionInvitationSelection;
}

/** Identical for delivery and every target-dependent suppression outcome. */
export interface MissionInvitationAcknowledgment {
  requestId: string;
  processed: true;
}

export interface PendingMissionInvitation {
  id: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
  mission: { id: string; title: string; space: { id: string; name: string } };
  sender: MissionInvitationPerson;
  canAccept: boolean;
  unavailableReason: 'FULL' | null;
}

export interface MissionInvitationList {
  items: PendingMissionInvitation[];
  nextCursor: string | null;
}

export interface MissionInvitationOutcome {
  id: string;
  state: 'ACCEPTED' | 'DECLINED';
  revision: number;
}

/** Unavailable carries no retained sender, mission title or decision reason. */
export type MissionInvitationDetail =
  | { state: 'PENDING'; invitation: PendingMissionInvitation }
  | { state: 'ACCEPTED' | 'DECLINED'; invitation: MissionInvitationOutcome }
  | { state: 'UNAVAILABLE'; invitation: null };

export interface DecideMissionInvitation {
  decision: 'ACCEPT' | 'DECLINE';
  expectedRevision: number;
}

export interface MissionInvitationDecisionResult<Mission> {
  invitation: MissionInvitationOutcome;
  mission: Mission;
}

export type MissionNextAction =
  | { kind: 'CLOSED' | 'CURRENT_GOAL_REACHED' | 'SHARE_INSIGHT' | 'LIMIT_REACHED' | 'WAIT_FOR_PEER' }
  | { kind: 'REVIEW_BUILD_ON'; contributionId: string }
  | { kind: 'BUILD_ON'; targetContributionId: string };

export const missionInvitationAcknowledgment = 'Einladungsanfrage verarbeitet. Ob die Person Einladungen erhält, bleibt privat.';
export const missionInvitationPreferencePrivacy = 'Missionseinladungen erhalten. Standardmäßig aus. Das ändert deine Teilnahme an Missionen nicht. Andere sehen diese Einstellung nicht.';
export const missionInvitationConsent = 'Diese Mission ist für aktuelle Mitglieder dieses privaten Spaces und Admins sichtbar. Die Einladung reserviert keinen Platz. Du entscheidest selbst, ob du teilnimmst.';
export const missionInvitationFull = 'Inzwischen sind alle fünf Plätze belegt. Die Einladung reserviert keinen Platz.';
