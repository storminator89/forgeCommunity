import { apiSpaceUrl, spaceUrl, SpaceHttpError, type SpaceAuthor } from './space-api';

export interface SpaceMission {
  id: string;
  spaceId: string;
  title: string;
  prompt: string;
  creator: SpaceAuthor | null;
  createdAt: string;
  closedAt: string | null;
  participants: (SpaceAuthor & { joinedAt: string })[];
  participantLimit: number;
  participation: { epoch: number; active: boolean; joinedAt: string | null; optedOutAt: string | null };
  canManage: boolean;
  canJoin: boolean;
  contributions: MissionContribution[];
  ownContributions: { id: string; kind: MissionContribution['kind']; hidden: boolean; targetUnavailable: boolean; canWithdraw: boolean }[];
  progress: { insightAuthors: number; hasCrossPersonBuildOn: boolean; complete: boolean };
}

export interface MissionContribution {
  id: string;
  kind: 'INSIGHT' | 'BUILD_ON';
  content: string;
  author: SpaceAuthor;
  createdAt: string;
  targetContributionId: string | null;
  canWithdraw: boolean;
}

export interface MissionAuditContribution extends Omit<MissionContribution, 'canWithdraw'> {
  hiddenAt: string | null;
  withdrawnAt: string | null;
}

export type MissionRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export function missionUrl(spaceId: string, missionId: string) {
  return `${spaceUrl(spaceId)}/missions/${encodeURIComponent(missionId)}`;
}

export function missionApiUrl(spaceId: string, missionId?: string) {
  return `${apiSpaceUrl(spaceId)}/missions${missionId ? `/${encodeURIComponent(missionId)}` : ''}`;
}

export function missionAccessDenied(error: unknown) {
  return error instanceof SpaceHttpError && [401, 403, 404].includes(error.status);
}

export const missionPrivacy = 'Dein Name und deine Beiträge sind für aktuelle Mitglieder dieses privaten Spaces und Admins sichtbar. Wenn du die Teilnahme beendest, werden deine Missionsbeiträge für Mitglieder verborgen und nicht mehr mitgezählt. Admins können sie zur Moderation aufbewahren.';
