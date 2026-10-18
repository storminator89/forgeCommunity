'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen } from 'lucide-react'
import { ProgressSpark } from './ProgressSpark'
import { MilestoneTrack } from './MilestoneTrack'
import { Button } from '@/components/ui/button'
import type { RewardHistoryEntry, RewardSummary } from '@/lib/rewards'

interface PersonalProgressCardProps {
  summary: RewardSummary | null
  loading: boolean
  error: boolean
  isSignedIn: boolean
  role?: string | null
  onRefresh: () => void
}

const LEARNING_TARGETS = [1, 3, 5] as const

const changeReason = {
  QUIZ_REVISED: 'Das Kursquiz wurde überarbeitet. Für neue Punkte sind die aktuelle Leistung und eine erneute Adminfreigabe nötig.',
  APPROVAL_WITHDRAWN: 'Die Adminfreigabe für Kursbelohnungen wurde zurückgenommen.',
  LEARNING_CHANGED: 'Der aktuelle Lernstand erfüllt die Belohnungsbedingungen nicht mehr.',
  ACCOUNT_INELIGIBLE: 'Dieses Konto ist derzeit nicht für Kursbelohnungen berechtigt.',
  COURSE_REMOVED: 'Der Kurs wurde entfernt.',
} as const

function HistoryDate({ at }: { at: string }) {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return <span>Datum nicht verfügbar</span>
  return <time dateTime={date.toISOString()}>{date.toLocaleDateString('de-DE', { timeZone: 'UTC' })}</time>
}

function historyExplanation(change: RewardHistoryEntry) {
  if (change.type === 'REVOKED') {
    return change.reason ? changeReason[change.reason] : 'Kursbelohnung zurückgenommen.'
  }
  return change.type === 'REINSTATED'
    ? 'Punkte nach erneuter Prüfung wiederhergestellt.'
    : 'Kursbelohnung erworben.'
}

export function PersonalProgressCard({ summary, loading, error, isSignedIn, role, onRefresh }: PersonalProgressCardProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const ready = isSignedIn && !loading && !error && summary !== null
  const failed = isSignedIn && !loading && (error || summary === null)
  const completedCourses = ready ? summary.completedCourses : null
  const nextTarget = completedCourses === null ? undefined : LEARNING_TARGETS.find(target => completedCourses < target)

  // Reveal the existing retry control on failure without replacing its DOM node
  // or closing a disclosure the person has already opened.
  useEffect(() => {
    if (failed && detailsRef.current) detailsRef.current.open = true
  }, [failed])

  return <section aria-labelledby="personal-progress-title" className="flex min-w-0 flex-col p-4 [overflow-wrap:anywhere] sm:p-5">
    <header className="min-w-0">
      <h3 id="personal-progress-title" className="flex items-center gap-2 text-base font-semibold tracking-tight"><BookOpen className="size-4 shrink-0 text-primary" aria-hidden="true" />Dein Lernweg</h3>
      <p className="mt-1 text-xs text-muted-foreground">Bisher abgeschlossen</p>
    </header>
    <div className="mt-3 flex min-h-20 min-w-0 items-center justify-between gap-3" aria-busy={isSignedIn && loading}>
      <div className="min-w-0">
        {!isSignedIn ? <p className="text-sm text-muted-foreground">Melde dich an, um deinen Lernfortschritt zu sehen.</p>
          : loading ? <p className="text-sm text-muted-foreground" role="status">Lernfortschritt wird geladen…</p>
          : failed ? <p className="text-sm text-destructive" role="alert">Lernfortschritt konnte nicht geladen werden.</p>
          : completedCourses !== null && <>
            <p className={`text-4xl font-semibold tracking-tight tabular-nums ${completedCourses > 0 ? 'text-reward-ink' : 'text-foreground'}`}>{completedCourses}</p>
            <p className="mt-1 text-xs text-muted-foreground">{completedCourses === 1 ? 'unterschiedlicher Kurs' : 'unterschiedliche Kurse'}</p>
          </>}
      </div>
      <ProgressSpark state={completedCourses === null ? 'neutral' : completedCourses >= LEARNING_TARGETS[0] ? 'reached' : 'target'} />
    </div>

    {completedCourses !== null && <MilestoneTrack count={completedCourses} targets={LEARNING_TARGETS} tone="learning"
      label="Lernmeilensteine" unit={target => target === 1 ? 'Kurs' : 'Kurse'}
      remaining={count => `Noch ${count} ${count === 1 ? 'Kurs' : 'Kurse'} bis dahin`}
      complete="Alle drei Lernmeilensteine erreicht"
      progressDescription={nextTarget ? `${completedCourses} von ${nextTarget} ${nextTarget === 1 ? 'Kurs' : 'Kursen'} bis zum nächsten Meilenstein` : `Alle Lernmeilensteine bei 1, 3 und 5 Kursen erreicht; bisher ${completedCourses} Kurse abgeschlossen`} />}

    <div className="mt-auto pt-4">
      <Button asChild className="h-auto min-h-11 w-full whitespace-normal">
        <Link prefetch={false} href={!isSignedIn ? '/login?callbackUrl=%2Fcommunity' : role === 'USER' ? '/courses/journey' : '/courses'}>
          {!isSignedIn ? 'Anmelden' : role === 'USER' ? completedCourses !== null && !nextTarget ? 'Weiterlernen' : 'Mein Lernweg' : 'Kurse ansehen'}
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </Link>
      </Button>
    </div>

    {isSignedIn && <details ref={detailsRef} className="mt-2 min-w-0 border-t text-sm">
      <summary className="min-h-11 cursor-pointer rounded-sm py-3 text-sm text-primary [overflow-wrap:anywhere] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {ready ? <span className={summary.points > 0 ? 'text-reward-ink' : 'text-foreground'}>Aktive Kurspunkte: <span className="tabular-nums">{summary.points}</span></span> : 'Kurspunkte und Details'}
      </summary>
      <div className="space-y-3 pb-1 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        <p>Meilensteine zählen unterschiedliche Kurse, die du mindestens einmal abgeschlossen hast, und bleiben bei späteren Änderungen bestehen.</p>
        <p>Aktive Kurspunkte sind deine nicht zurückgenommenen Punktebuchungen; ein Kursabschluss kann auch bei 0 Punkten bestehen.</p>
        <p>Kursbelohnungen sind für reguläre Mitgliedskonten ohne Teststatus vorgesehen, wenn ein Kurs eines anderen Autors aktuell vollständig abgeschlossen ist, das aktuelle Quiz bestanden wurde und eine gültige Adminfreigabe für Kursbelohnungen in der aktuellen Kursfassung vorliegt.</p>
        <p>Dein persönlicher Fortschritt bleibt auch ohne Teilnahme an der öffentlichen Rangliste sichtbar.</p>
        {ready && summary.history && summary.history.length > 0 && <div className="border-t pt-3">
          <h4 className="text-sm font-medium text-foreground">Punkteverlauf</h4>
          <ol className="mt-3 space-y-3">
            {summary.history.map((change, index) => <li key={`${change.at}-${index}`} className="text-xs leading-relaxed">
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 font-medium text-foreground">{change.courseTitle}</span>
                <span className={`shrink-0 tabular-nums ${change.pointsDelta > 0 ? 'text-reward-ink' : 'text-muted-foreground'}`}>{change.pointsDelta > 0 ? '+' : ''}{change.pointsDelta} Punkte</span>
              </div>
              <p>{historyExplanation(change)}</p>
              <HistoryDate at={change.at} />
            </li>)}
          </ol>
        </div>}
        <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-left aria-disabled:cursor-wait aria-disabled:border-input aria-disabled:bg-muted aria-disabled:text-muted-foreground"
          aria-disabled={loading} onClick={() => { if (!loading) onRefresh() }}>
          {failed ? 'Lernfortschritt erneut laden' : 'Lernfortschritt aktualisieren'}
        </Button>
      </div>
    </details>}
  </section>
}
