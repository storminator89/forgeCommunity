export type RewardHistoryEntry = {
  type: 'AWARDED' | 'REVOKED' | 'REINSTATED'
  reason: 'QUIZ_REVISED' | 'APPROVAL_WITHDRAWN' | 'LEARNING_CHANGED' | 'ACCOUNT_INELIGIBLE' | 'COURSE_REMOVED' | null
  pointsDelta: number
  at: string
  courseTitle: string
  /** Opaque immutable event identity; absent on older private responses. */
  eventKey?: string
  /** Confirmed against this event's current ledger version in one read. */
  activeAward?: boolean
}

export type CourseRewardMoment = { eventKey: string; points: 50 }

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

export function isRewardHistoryEntry(value: unknown): value is RewardHistoryEntry {
  if (!(isRecord(value) &&
    typeof value.type === 'string' && REWARD_CHANGE_TYPES.has(value.type) &&
    (value.reason === null || (typeof value.reason === 'string' && REWARD_CHANGE_REASONS.has(value.reason))) &&
    typeof value.pointsDelta === 'number' && Number.isSafeInteger(value.pointsDelta) &&
    typeof value.at === 'string' && ISO_TIMESTAMP.test(value.at) && Number.isFinite(Date.parse(value.at)) &&
    typeof value.courseTitle === 'string')) return false

  if ('eventKey' in value || 'activeAward' in value) {
    if (typeof value.eventKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.eventKey) ||
      typeof value.activeAward !== 'boolean') return false
    if (value.activeAward && (value.type !== 'AWARDED' || value.reason !== null || value.pointsDelta !== 50)) return false
  }
  return true
}

export function isRewardSummary(value: unknown): value is RewardSummary {
  if (!isRecord(value) ||
    !isNonnegativeSafeInteger(value.points) ||
    !isNonnegativeSafeInteger(value.completedCourses) ||
    typeof value.firstCourseCompleted !== 'boolean' ||
    value.firstCourseCompleted !== (value.completedCourses > 0)) return false

  if ('history' in value) {
    if (!Array.isArray(value.history) || value.history.length > 10) return false
    const keys = new Set<string>()
    for (const entry of value.history) {
      if (!isRewardHistoryEntry(entry)) return false
      if (entry.eventKey) {
        if (keys.has(entry.eventKey)) return false
        keys.add(entry.eventKey)
      }
    }
  }
  return true
}
