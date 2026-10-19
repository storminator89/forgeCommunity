import type { MissionNextAction } from '@/types/space-mission-invitations';

export interface MissionQuestCandidate { id: string; spaceId: string }
export type MissionQuestAction = Exclude<MissionNextAction['kind'], 'CLOSED'>;
export interface MissionQuestProjection {
  insightAuthors: number;
  hasCrossPersonBuildOn: boolean;
  action: MissionQuestAction;
}
export type MissionQuestSnapshot = { candidate: MissionQuestCandidate } & (
  | { status: 'loading' | 'unknown' }
  | { status: 'ready'; progress: MissionQuestProjection }
);

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const boundedList = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 10;
function instant(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function isMissionQuestCandidate(candidate: MissionQuestCandidate): boolean {
  return validId(candidate.id) && validId(candidate.spaceId);
}

/** An explicit, matching loss of consent/open state requires fresh discovery.
 * Missing or malformed fields are unknown, not evidence of a state transition. */
export function missionQuestAccessChanged(value: unknown, candidate: MissionQuestCandidate): boolean {
  return record(value) && value.id === candidate.id && value.spaceId === candidate.spaceId
    && (instant(value.closedAt) || (record(value.participation) && value.participation.active === false));
}

/** The existing detail GET transports private content. Retain only these scalars;
 * never return the response, people, text, or action target IDs to the overview. */
export function projectMissionQuest(value: unknown, candidate: MissionQuestCandidate, viewerId: string): MissionQuestProjection | null {
  if (!isMissionQuestCandidate(candidate) || !validId(viewerId) || !record(value)
    || value.id !== candidate.id || value.spaceId !== candidate.spaceId || value.closedAt !== null) return null;
  const participation = value.participation;
  if (!record(participation) || participation.active !== true || participation.optedOutAt !== null
    || !Number.isInteger(participation.epoch) || (participation.epoch as number) < 1
    || (participation.epoch as number) > 2147483646 || !instant(participation.joinedAt)) return null;
  const progress = value.progress;
  if (!record(progress) || !exactKeys(progress, ['insightAuthors', 'hasCrossPersonBuildOn', 'complete'])
    || !Number.isInteger(progress.insightAuthors) || (progress.insightAuthors as number) < 0
    || (progress.insightAuthors as number) > 5 || typeof progress.hasCrossPersonBuildOn !== 'boolean'
    || typeof progress.complete !== 'boolean'
    || (progress.hasCrossPersonBuildOn && (progress.insightAuthors as number) < 1)
    || progress.complete !== ((progress.insightAuthors as number) >= 2 && progress.hasCrossPersonBuildOn)) return null;
  const action = value.myNextAction;
  if (!record(action) || typeof action.kind !== 'string') return null;
  if ((action.kind === 'CURRENT_GOAL_REACHED') !== progress.complete) return null;
  switch (action.kind) {
    case 'CURRENT_GOAL_REACHED':
    case 'SHARE_INSIGHT':
    case 'LIMIT_REACHED':
    case 'WAIT_FOR_PEER':
      if (!exactKeys(action, ['kind'])) return null;
      break;
    case 'BUILD_ON': {
      if (!exactKeys(action, ['kind', 'targetContributionId']) || !validId(action.targetContributionId)
        || !boundedList(value.contributions)) return null;
      const targets = value.contributions.filter(item => record(item) && item.id === action.targetContributionId);
      if (targets.length !== 1) return null;
      const target = targets[0];
      if (!record(target) || target.kind !== 'INSIGHT' || target.targetContributionId !== null
        || !record(target.author) || !validId(target.author.id) || target.author.id === viewerId) return null;
      break;
    }
    case 'REVIEW_BUILD_ON': {
      if (!exactKeys(action, ['kind', 'contributionId']) || !validId(action.contributionId)
        || !boundedList(value.ownContributions) || !boundedList(value.contributions)) return null;
      const own = value.ownContributions.filter(item => record(item) && item.id === action.contributionId);
      if (own.length !== 1) return null;
      const target = own[0];
      if (!record(target) || target.kind !== 'BUILD_ON' || target.hidden !== false
        || target.targetUnavailable !== true || target.canWithdraw !== true
        || value.contributions.some(item => record(item) && item.id === action.contributionId)) return null;
      break;
    }
    default: return null;
  }
  return {
    insightAuthors: progress.insightAuthors as number,
    hasCrossPersonBuildOn: progress.hasCrossPersonBuildOn,
    action: action.kind,
  };
}

export function missionQuestNextStep(action: MissionQuestAction): { text: string; label: string } {
  switch (action) {
    case 'SHARE_INSIGHT': return { text: 'Teile eine eigene Erkenntnis.', label: 'Mission fortsetzen' };
    case 'BUILD_ON': return { text: 'Baue auf der Erkenntnis einer anderen Person auf.', label: 'Mission fortsetzen' };
    case 'REVIEW_BUILD_ON': return { text: 'Prüfe deinen weiterführenden Gedanken.', label: 'Mission fortsetzen' };
    case 'CURRENT_GOAL_REACHED': return { text: 'Das aktuelle gemeinsame Ziel ist erreicht.', label: 'Gedanken lesen' };
    case 'LIMIT_REACHED': return { text: 'Deine Beitragsgrenze ist erreicht. Lies die Gedanken der Gruppe.', label: 'Gedanken lesen' };
    case 'WAIT_FOR_PEER': return { text: 'Gerade ist kein weiterer Beitragsschritt verfügbar. Lies die Gedanken der Gruppe.', label: 'Gedanken lesen' };
  }
}
