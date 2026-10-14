interface StatsCardProps {
  stats: {
    posts: number
    receivedLikes: number
    comments: number
    totalPoints: number
  }
}

export function StatsCard({ stats }: StatsCardProps) {
  const values = [
    { label: 'Beiträge', value: stats.posts },
    { label: 'Likes', value: stats.receivedLikes },
    { label: 'Kommentare', value: stats.comments },
    { label: 'Punkte', value: stats.totalPoints },
  ]

  return (
    <section aria-labelledby="community-stats-title" className="border-t pt-5">
      <h2 id="community-stats-title" className="text-base font-semibold tracking-tight">Deine Aktivität</h2>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
        {values.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
