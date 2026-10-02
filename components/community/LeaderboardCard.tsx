import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"

interface LeaderboardUser {
  id: string
  name: string
  image: string | null
  points: number
}

interface LeaderboardCardProps {
  users: LeaderboardUser[]
  isLoading: boolean
}

export function LeaderboardCard({ users, isLoading }: LeaderboardCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Rangliste</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-4" role="status" aria-label="Rangliste wird geladen">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : users.length ? (
          <ol className="divide-y divide-border">
            {users.map((user, index) => (
              <li key={user.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="w-4 shrink-0 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={user.image || ''} alt={user.name} />
                  <AvatarFallback>{user.name?.slice(0, 1) || '?'}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{user.name}</span>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-semibold tabular-nums">{user.points}</span>
                  <span className="ml-1 text-xs text-muted-foreground">Punkte</span>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted-foreground">Keine Einträge.</p>}
      </CardContent>
    </Card>
  )
}
