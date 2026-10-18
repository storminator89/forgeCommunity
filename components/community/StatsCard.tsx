import { FileText, Heart, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StatsCardProps {
  stats: {
    posts: number
    receivedLikes: number
    comments: number
  } | null
  activityLoading?: boolean
  activityError?: boolean
  onRetryActivity?: () => void
  isSignedIn: boolean
}

export function StatsCard({ stats, activityLoading = false, activityError = false, onRetryActivity, isSignedIn }: StatsCardProps) {
  const values = [
    { label: 'Beiträge', value: stats?.posts, icon: FileText },
    { label: 'Likes', value: stats?.receivedLikes, icon: Heart },
    { label: 'Kommentare', value: stats?.comments, icon: MessageSquare },
  ]

  return <section aria-labelledby="community-stats-title" className="fc-surface p-5">
    <h2 id="community-stats-title" className="text-base font-semibold tracking-tight">Deine Aktivität</h2>
    <div className="mt-2">
      {!isSignedIn ? <p className="text-sm text-muted-foreground">Melde dich an, um deine Aktivität zu sehen.</p>
        : activityLoading ? <p className="text-sm text-muted-foreground" role="status">Aktivität wird geladen…</p>
        : activityError || !stats ? <div>
          <p className="text-sm text-destructive" role="alert">Aktivität konnte nicht geladen werden.</p>
          {onRetryActivity && <Button type="button" variant="outline" className="mt-3 h-auto min-h-11 max-w-full whitespace-normal" onClick={onRetryActivity}>Aktivität erneut laden</Button>}
        </div> : <details className="text-sm text-muted-foreground">
          <summary className="min-h-11 cursor-pointer rounded-sm py-3 text-sm text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Aktivitätszahlen ansehen</summary>
          <dl className="fc-stat-grid mt-2">
            {values.map(({ label, value, icon: Icon }) => <div key={label} className="fc-stat min-w-0 [overflow-wrap:anywhere]">
              <Icon aria-hidden="true" />
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
            </div>)}
          </dl>
          <p className="mt-3 text-xs leading-relaxed">Alle deine Beiträge. Likes auf deine Beiträge, einschließlich eigener Likes. Kommentare in veröffentlichten und deinen eigenen Beiträgen.</p>
        </details>}
    </div>
  </section>
}
