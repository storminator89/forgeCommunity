export type RewardHistoryEntry = {
  type: 'AWARDED' | 'REVOKED' | 'REINSTATED'
  reason: 'QUIZ_REVISED' | 'APPROVAL_WITHDRAWN' | 'LEARNING_CHANGED' | 'ACCOUNT_INELIGIBLE' | 'COURSE_REMOVED' | null
  pointsDelta: number
  at: string
  courseTitle: string
}

/** Active ledger points and historical course completions are independent totals. */
export type RewardSummary = {
  points: number
  completedCourses: number
  firstCourseCompleted: boolean
  history?: RewardHistoryEntry[]
}

const REWARD_CHANGE_TYPES = new Set(['AWARDED', 'REVOKED', 'REINSTATED'])
const REWARD_CHANGE_REASONS = new Set(['QUIZ_REVISED', 'APPROVAL_WITHDRAWN', 'LEARNING_CHANGED', 'ACCOUNT_INELIGIBLE', 'COURSE_REMOVED'])
const ISO_TIMESTAMP = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRewardHistoryEntry(value: unknown): value is RewardHistoryEntry {
  return isRecord(value) &&
    typeof value.type === 'string' && REWARD_CHANGE_TYPES.has(value.type) &&
    (value.reason === null || (typeof value.reason === 'string' && REWARD_CHANGE_REASONS.has(value.reason))) &&
    typeof value.pointsDelta === 'number' && Number.isSafeInteger(value.pointsDelta) &&
    typeof value.at === 'string' && ISO_TIMESTAMP.test(value.at) && Number.isFinite(Date.parse(value.at)) &&
    typeof value.courseTitle === 'string'
}

export function isRewardSummary(value: unknown): value is RewardSummary {
  if (!isRecord(value) ||
    !isNonnegativeSafeInteger(value.points) ||
    !isNonnegativeSafeInteger(value.completedCourses) ||
    typeof value.firstCourseCompleted !== 'boolean' ||
    value.firstCourseCompleted !== (value.completedCourses > 0)) return false

  if ('history' in value) {
    if (!Array.isArray(value.history) || value.history.length > 10) return false
    for (const entry of value.history) {
      if (!isRewardHistoryEntry(entry)) return false
    }
  }
  return true
}
