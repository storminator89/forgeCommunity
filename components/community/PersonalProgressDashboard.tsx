import { LockKeyhole } from 'lucide-react'
import { PersonalProgressCard } from './PersonalProgressCard'
import { ContributionMilestonesCard } from './ContributionMilestonesCard'
import type { RewardSummary } from '@/lib/rewards'
import type { ContributionSummary } from '@/lib/contributions'

type ReadState<T> = { summary: T | null; loading: boolean; error: boolean; refresh: () => void }

/** Compose the page's existing private reads; no additional requests or cache. */
export function PersonalProgressDashboard({ rewards, contributions, isSignedIn, role }: {
  rewards: ReadState<RewardSummary>
  contributions: ReadState<ContributionSummary>
  isSignedIn: boolean
  role?: string | null
}) {
  return <section aria-labelledby="personal-progress-dashboard-title" className="fc-surface mb-4 overflow-hidden">
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-3 sm:px-5">
      <h2 id="personal-progress-dashboard-title" className="text-lg font-semibold tracking-tight">Deine Meilensteine</h2>
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />Nur für dich</p>
    </header>
    <div className="grid min-w-0 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
      <PersonalProgressCard summary={rewards.summary} loading={rewards.loading} error={rewards.error}
        isSignedIn={isSignedIn} role={role} onRefresh={rewards.refresh} />
      <ContributionMilestonesCard summary={contributions.summary} loading={contributions.loading} error={contributions.error}
        isSignedIn={isSignedIn} onRefresh={contributions.refresh} />
    </div>
  </section>
}
