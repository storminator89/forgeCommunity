import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface StatsCardProps {
  stats: {
    posts: number
    receivedLikes: number
    comments: number
  }
  rewards: {
    points: number
    completedCourses: number
    firstCourseCompleted: boolean
    history?: Array<{
      type: 'AWARDED' | 'REVOKED' | 'REINSTATED'
      reason: 'QUIZ_REVISED' | 'APPROVAL_WITHDRAWN' | 'LEARNING_CHANGED' | 'ACCOUNT_INELIGIBLE' | 'COURSE_REMOVED' | null
      pointsDelta: number
      at: string
      courseTitle: string
    }>
  } | null
  rewardsLoading: boolean
  rewardsError: boolean
  isSignedIn: boolean
}

const changeReason = {
  QUIZ_REVISED: 'Das Kursquiz wurde überarbeitet. Für neue Punkte sind die aktuelle Leistung und eine erneute Adminfreigabe nötig.',
  APPROVAL_WITHDRAWN: 'Die Adminfreigabe für Kursbelohnungen wurde zurückgenommen.',
  LEARNING_CHANGED: 'Der aktuelle Lernstand erfüllt die Belohnungsbedingungen nicht mehr.',
  ACCOUNT_INELIGIBLE: 'Dieses Konto ist derzeit nicht für Kursbelohnungen berechtigt.',
  COURSE_REMOVED: 'Der Kurs wurde entfernt.',
} as const

export function StatsCard({ stats, rewards, rewardsLoading, rewardsError, isSignedIn }: StatsCardProps) {
  const values = [
    { label: 'Beiträge', value: stats.posts },
    { label: 'Likes', value: stats.receivedLikes },
    { label: 'Kommentare', value: stats.comments },
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
        <div className="mt-6 border-t pt-5">
          <h3 className="font-medium">Meine Kursbelohnungen</h3>
          <p className="mt-1 text-sm text-muted-foreground">Deine Punkte und Meilensteine bleiben für dich sichtbar, auch wenn du nicht in der öffentlichen Rangliste stehst.</p>
          {!isSignedIn ? <p className="mt-3 text-sm">Melde dich an, um deine Punkte zu sehen.</p>
            : rewardsLoading ? <p className="mt-3 text-sm" role="status">Belohnungen werden geladen…</p>
            : rewardsError || !rewards ? <p className="mt-3 text-sm text-destructive" role="alert">Belohnungen konnten nicht geladen werden.</p>
            : <><dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
                <div>
                  <dt className="text-sm text-muted-foreground">Meine Punkte</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{rewards.points}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Mindestens einmal abgeschlossene Kurse</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{rewards.completedCourses}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-sm text-muted-foreground">Meilenstein: Erster abgeschlossener Kurs</dt>
                  <dd className="mt-1 text-sm font-medium">{rewards.firstCourseCompleted ? 'Erreicht' : 'Noch nicht erreicht'}</dd>
                </div>
              </dl>
              {rewards.history && rewards.history.length > 0 && <div className="mt-5 border-t pt-4">
                <h4 className="text-sm font-medium">Punkteverlauf</h4>
                <ol className="mt-2 space-y-3">
                  {rewards.history.map((change, index) => <li key={`${change.at}-${index}`} className="text-xs">
                    <div className="flex justify-between gap-3"><span className="font-medium">{change.courseTitle}</span><span className="tabular-nums">{change.pointsDelta > 0 ? '+' : ''}{change.pointsDelta} Punkte</span></div>
                    <p className="text-muted-foreground">{change.type === 'REVOKED' && change.reason ? changeReason[change.reason] : change.type === 'REINSTATED' ? 'Punkte nach erneuter Prüfung wiederhergestellt.' : 'Kursbelohnung erworben.'}</p>
                    <time dateTime={change.at} className="text-muted-foreground">{new Date(change.at).toLocaleDateString('de-DE')}</time>
                  </li>)}
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">Einmal erreichte Lernmeilensteine und ausgestellte Zertifikate bleiben bestehen.</p>
              </div>}
              </>}
        </div>
      </CardContent>
    </Card>
  )
}
