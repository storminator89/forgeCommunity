/** Public fields from the existing private goal endpoint; never infer progress. */
export type LearningGoalView = {
  targetLeaves: 1 | 3 | 5;
  durationDays: 7 | 14 | 28;
  timezone: string;
  startedAt: string;
  endsAt: string;
  pausedAt: string | null;
  completedLeaves: number;
  status: 'active' | 'paused' | 'achieved' | 'ended';
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function readLearningGoal(value: unknown): LearningGoalView | null {
  if (!object(value) || Object.keys(value).length !== 1 || !('goal' in value)) throw new Error('Unverified learning goal');
  if (value.goal === null) return null;
  const goal = value.goal;
  const keys = ['targetLeaves', 'durationDays', 'timezone', 'startedAt', 'endsAt', 'pausedAt', 'completedLeaves', 'status'];
  if (!object(goal) || Object.keys(goal).length !== keys.length || Object.keys(goal).some(key => !keys.includes(key)) ||
      (goal.targetLeaves !== 1 && goal.targetLeaves !== 3 && goal.targetLeaves !== 5) ||
      (goal.durationDays !== 7 && goal.durationDays !== 14 && goal.durationDays !== 28) ||
      typeof goal.timezone !== 'string' || !goal.timezone || goal.timezone.length > 100 ||
      !date(goal.startedAt) || !date(goal.endsAt) || Date.parse(goal.endsAt) <= Date.parse(goal.startedAt) ||
      (goal.pausedAt !== null && (!date(goal.pausedAt) || Date.parse(goal.pausedAt) < Date.parse(goal.startedAt))) ||
      typeof goal.completedLeaves !== 'number' || !Number.isSafeInteger(goal.completedLeaves) || goal.completedLeaves < 0 ||
      (goal.status !== 'active' && goal.status !== 'paused' && goal.status !== 'achieved' && goal.status !== 'ended') ||
      (goal.status === 'achieved') !== (goal.completedLeaves >= goal.targetLeaves) ||
      (goal.status !== 'achieved' && (goal.status === 'paused') !== (goal.pausedAt !== null))) throw new Error('Unverified learning goal');
  // A valid IANA zone is required before formatting the server's own deadline.
  new Intl.DateTimeFormat('de-DE', { timeZone: goal.timezone }).format(new Date(goal.endsAt));
  return {
    targetLeaves: goal.targetLeaves,
    durationDays: goal.durationDays,
    timezone: goal.timezone,
    startedAt: goal.startedAt,
    endsAt: goal.endsAt,
    pausedAt: goal.pausedAt,
    completedLeaves: goal.completedLeaves,
    status: goal.status,
  };
}

export function learningGoalDeadline(goal: LearningGoalView): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: goal.timezone })
    .format(new Date(Date.parse(goal.endsAt) - 1));
}
