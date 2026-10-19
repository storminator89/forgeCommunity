import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import Link from "next/link"

interface LeaderboardUser {
  name: string
  image: string | null
  points: number
}

export type LeaderboardState =
  | { status: 'loading' }
  | { status: 'error'; isRetrying: boolean }
  | { status: 'success'; users: LeaderboardUser[] }

interface LeaderboardCardProps {
  users: LeaderboardUser[]
  isLoading: boolean
  error?: { isRetrying: boolean; onRetry: () => void }
}

export function LeaderboardCard({ users, isLoading, error }: LeaderboardCardProps) {
  return (
    <section aria-labelledby="community-leaderboard-title" className="border-t pt-5">
      <h2 id="community-leaderboard-title" className="text-base font-semibold tracking-tight">Rangliste</h2>
      <p className="mt-1 text-sm text-muted-foreground">Nur Mitglieder, die der öffentlichen Rangliste zugestimmt haben, erscheinen hier.</p>
      <div className="mt-4">
        {error ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">Die Rangliste konnte nicht geladen werden. Bitte versuche es erneut.</p>
            <Button type="button" variant="outline" aria-disabled={error.isRetrying} onClick={() => { if (!error.isRetrying) error.onRetry() }}>
              {error.isRetrying ? 'Erneuter Versuch läuft…' : 'Rangliste erneut laden'}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-4" aria-hidden="true">
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
              <li key={`${user.name}-${index}`} className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">
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
        ) : <p className="text-sm text-muted-foreground">Noch keine öffentlichen Einträge.</p>}
        <p role="status" aria-live="polite" className="sr-only">
          {error ? error.isRetrying ? 'Rangliste wird erneut geladen.' : 'Rangliste konnte nicht geladen werden. Erneut laden ist verfügbar.'
            : isLoading ? 'Rangliste wird geladen.'
              : users.length ? `Rangliste geladen. Öffentliche Einträge: ${users.length}.` : 'Rangliste geladen. Keine öffentlichen Einträge.'}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">Was zählt: Ein von Admins freigegebener Kurs mit gespeichertem gültigem Quiz und bestandenem Versuch für die aktuelle Kursversion. Beiträge, Kommentare und Likes bringen keine Punkte.</p>
        <Link href="/settings" className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline">Sichtbarkeit in den Einstellungen ändern</Link>
      </div>
    </section>
  )
}
