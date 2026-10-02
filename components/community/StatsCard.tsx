import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Statistik</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
          {values.map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
