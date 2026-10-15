/** A private, current-state summary. Five is a display cap, not an exact total. */
export interface ContributionSummary {
  eligible: boolean
  selectedByAuthors: number
  saturated: boolean
}

export const CONTRIBUTION_TARGETS = [1, 3, 5] as const

export function isContributionSummary(value: unknown): value is ContributionSummary {
  if (!value || typeof value !== 'object') return false
  const summary = value as ContributionSummary
  return typeof summary.eligible === 'boolean' &&
    Number.isSafeInteger(summary.selectedByAuthors) && summary.selectedByAuthors >= 0 && summary.selectedByAuthors <= 5 &&
    summary.saturated === (summary.selectedByAuthors === 5) &&
    (summary.eligible || summary.selectedByAuthors === 0)
}
