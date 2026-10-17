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

export function StatsCard({ stats, activityLoading = false, activityError = false, onRetryActivity, rewards, rewardsLoading, rewardsError, isSignedIn }: StatsCardProps) {
  const values = [
    { label: 'Beiträge', value: stats?.posts },
    { label: 'Likes', value: stats?.receivedLikes },
    { label: 'Kommentare', value: stats?.comments },
  ]

  return (
    <section aria-labelledby="community-stats-title" className="border-t pt-5">
      <h2 id="community-stats-title" className="text-base font-semibold tracking-tight">Deine Aktivität</h2>
      <div className="mt-5">
        {!isSignedIn ? <p className="text-sm text-muted-foreground">Melde dich an, um deine Aktivität zu sehen.</p>
          : activityLoading ? <p className="text-sm text-muted-foreground" role="status">Aktivität wird geladen…</p>
          : activityError || !stats ? <div>
            <p className="text-sm text-destructive" role="alert">Aktivität konnte nicht geladen werden.</p>
            {onRetryActivity && <Button type="button" variant="outline" className="mt-3" onClick={onRetryActivity}>Aktivität erneut laden</Button>}
          </div> : <>
        <details className="mb-4 text-xs text-muted-foreground">
          <summary className="min-h-11 cursor-pointer rounded-sm py-3 text-sm text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">So wird gezählt</summary>
          <p className="mt-1">Alle deine Beiträge. Likes auf deine Beiträge, einschließlich eigener Likes. Kommentare in veröffentlichten und deinen eigenen Beiträgen.</p>
        </details>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
          {values.map(({ label, value }) => (
            <div key={label} className="min-w-0 [overflow-wrap:anywhere]">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        </>}
        <div className="mt-6 border-t pt-5">
          <h3 className="font-medium">Meine Kursbelohnungen</h3>
          <details className="mt-1 text-sm text-muted-foreground">
            <summary aria-label="Sichtbarkeit meiner Kursbelohnungen" className="min-h-11 cursor-pointer rounded-sm py-3 text-sm text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Sichtbarkeit</summary>
            <p className="mt-1">Deine Punkte und Meilensteine bleiben für dich sichtbar, auch wenn du nicht in der öffentlichen Rangliste stehst.</p>
          </details>
          {!isSignedIn ? <p className="mt-3 text-sm">Melde dich an, um deine Punkte zu sehen.</p>
            : rewardsLoading ? <p className="mt-3 text-sm" role="status">Belohnungen werden geladen…</p>
            : rewardsError || !rewards ? <p className="mt-3 text-sm text-destructive" role="alert">Belohnungen konnten nicht geladen werden.</p>
            : <><dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <dt className="text-sm text-muted-foreground">Meine Punkte</dt>
                  <dd className={`mt-1 text-2xl font-semibold tabular-nums ${rewards.points > 0 ? "text-reward-ink" : "text-foreground"}`}>{rewards.points}</dd>
                </div>
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <dt className="text-sm text-muted-foreground">Mindestens einmal abgeschlossene Kurse</dt>
                  <dd className={`mt-1 text-2xl font-semibold tabular-nums ${rewards.completedCourses > 0 ? "text-reward-ink" : "text-foreground"}`}>{rewards.completedCourses}</dd>
                </div>
                <div className="col-span-2 min-w-0 [overflow-wrap:anywhere]">
                  <dt className="text-sm text-muted-foreground">Meilenstein: Erster abgeschlossener Kurs</dt>
                  <dd className={`mt-1 text-sm font-medium ${rewards.firstCourseCompleted ? "text-reward-ink" : "text-muted-foreground"}`}>{rewards.firstCourseCompleted ? 'Erreicht' : 'Noch nicht erreicht'}</dd>
                </div>
              </dl>
              <LearningMilestoneProgress completedCourses={rewards.completedCourses} />
              {rewards.history && rewards.history.length > 0 && <div className="mt-5 border-t pt-4">
                <h4 className="text-sm font-medium">Punkteverlauf</h4>
                <ol className="mt-2 space-y-3">
                  {rewards.history.map((change, index) => <li key={`${change.at}-${index}`} className="text-xs">
                    <div className="flex justify-between gap-3"><span className="font-medium">{change.courseTitle}</span><span className={change.pointsDelta > 0 ? "tabular-nums text-reward-ink" : "tabular-nums text-muted-foreground"}>{change.pointsDelta > 0 ? '+' : ''}{change.pointsDelta} Punkte</span></div>
                    <p className="text-muted-foreground">{change.type === 'REVOKED' && change.reason ? changeReason[change.reason] : change.type === 'REINSTATED' ? 'Punkte nach erneuter Prüfung wiederhergestellt.' : 'Kursbelohnung erworben.'}</p>
                    <time dateTime={change.at} className="text-muted-foreground">{new Date(change.at).toLocaleDateString('de-DE')}</time>
                  </li>)}
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">Einmal erreichte Lernmeilensteine und ausgestellte Zertifikate bleiben bestehen.</p>
              </div>}
              </>}
        </div>
      </div>
    </section>
  )
}
import Link from 'next/link'


function LearningMilestoneProgress({ completedCourses }: { completedCourses: number }) {
  const nextTarget = [1, 3, 5].find(target => completedCourses < target)
  const courseNoun = nextTarget === 1 ? 'Kurs' : 'Kursen'
  return <div className="mt-5 border-t pt-4">
    <h4 className="text-sm font-medium">Dein nächster Lernmeilenstein</h4>
    {nextTarget ? <>
      <p className="mt-1 text-sm text-muted-foreground">{nextTarget === 1 ? 'Einen Kurs abschließen' : `${nextTarget} unterschiedliche Kurse abschließen`}</p>
      <p className="mt-2 text-sm font-medium tabular-nums">{completedCourses} von {nextTarget} {courseNoun}</p>
      <progress
        value={completedCourses}
        max={nextTarget}
        aria-label={`Lernmeilenstein: ${completedCourses} von ${nextTarget} ${courseNoun} abgeschlossen`}
        className="mt-2 h-2 w-full accent-progress"
      >{completedCourses} von {nextTarget}</progress>
    </> : <p className="mt-1 text-sm text-reward-ink">Alle derzeitigen Lernmeilensteine erreicht.</p>}
    <Link href="/courses" className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Kurse entdecken</Link>
  </div>
}
