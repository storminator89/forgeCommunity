import { DateTime, IANAZone } from 'luxon';
import type { MissionNextAction } from '@/types/space-mission-invitations';
import { apiSpaceUrl, spaceUrl, SpaceHttpError, type SpaceAuthor } from './space-api';

export interface MissionWeek {
  startDate: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
}

export interface OwnBookmark {
  saved: boolean;
  revision: number;
  accessEpoch: number;
}

/** Fail closed on incomplete or malformed private bookmark projections. */
export function isOwnBookmark(value: unknown): value is OwnBookmark {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return Object.keys(state).length === 3 && typeof state.saved === 'boolean'
    && Number.isInteger(state.revision) && (state.revision as number) >= 0 && (state.revision as number) <= 2147483647
    && Number.isInteger(state.accessEpoch) && (state.accessEpoch as number) >= 0 && (state.accessEpoch as number) <= 2147483647;
}

export const missionBookmarkPrivacy = 'Nur für dich. Du findest die Mission hier wieder. Es wird keine Erinnerung verschickt.';

/** Minimal self-only discovery projection. Participation stays on the detail page. */
export interface SpaceMissionOverview {
  id: string;
  title: string;
  space: { id: string; name: string };
  week: MissionWeek | null;
  windowState: 'self-paced' | 'current' | 'past';
  participationActive: boolean;
  ownBookmark: OwnBookmark;
}

export interface SpaceMission {
  myNextAction?: MissionNextAction | null;
  id: string;
  spaceId: string;
  title: string;
  prompt: string;
  creator: SpaceAuthor | null;
  createdAt: string;
  closedAt: string | null;
  ownBookmark: OwnBookmark | null;
  week: MissionWeek | null;
  windowState: 'self-paced' | 'current' | 'past';
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

/** Form suggestions only. The server validates the selected week before insertion. */
export function missionCurrentMonday(timezone: string, now = Date.now()): string {
  if (!IANAZone.isValidZone(timezone)) return '';
  return DateTime.fromMillis(now, { zone: timezone }).startOf('week').toISODate() ?? '';
}

export function missionWeekPreview(startDate: string, timezone: string): string {
  if (!IANAZone.isValidZone(timezone) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return '';
  const start = DateTime.fromISO(startDate, { zone: timezone, locale: 'de', numberingSystem: 'latn' });
  if (!start.isValid || start.toISODate() !== startDate || start.weekday !== 1) return '';
  return `${start.toFormat('d. MMMM')} – ${start.plus({ days: 6 }).toFormat('d. MMMM yyyy')} · ${timezone}`;
}

/** Stored instants and the mission's zone, never the viewer's current calendar. */
export function missionWeekDates(week: MissionWeek): string {
  const options = { zone: week.timezone, locale: 'de', numberingSystem: 'latn' };
  const start = DateTime.fromISO(week.startsAt, options);
  const lastDay = DateTime.fromISO(week.endsAt, options).minus({ days: 1 });
  return `${start.toFormat('d. MMMM')} – ${lastDay.toFormat('d. MMMM yyyy')} · ${week.timezone}`;
}

export function missionWindowLabel(mission: Pick<SpaceMission, 'week' | 'windowState' | 'closedAt'>): string {
  if (!mission.week) return '';
  return mission.windowState === 'past'
    ? `Lernwoche vorbei${mission.closedAt ? '' : ' · Mission bleibt offen'}`
    : 'Diese Lernwoche';
}

export const missionPrivacy = 'Dein Name und deine Beiträge sind für aktuelle Mitglieder dieses privaten Spaces und Admins sichtbar. Teilnahme ist freiwillig. Wenn du die Teilnahme beendest, werden deine Missionsbeiträge für Mitglieder verborgen und nicht mehr mitgezählt. Admins können sie zur Moderation aufbewahren. In einer kleinen Gruppe können Änderungen Rückschlüsse auf einzelne Personen erlauben. Bereits Gesehenes lässt sich nicht zurückholen.';
