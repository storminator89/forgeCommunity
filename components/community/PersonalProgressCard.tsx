'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { BookOpen, Check } from 'lucide-react'
import { SparkStaticFigure } from '@/components/spark-entry'
import { Button } from '@/components/ui/button'
import { useSparkVisibility } from '@/hooks/useSparkVisibility'
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
  const { visible } = useSparkVisibility()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const ready = isSignedIn && !loading && !error && summary !== null
  const failed = isSignedIn && !loading && (error || summary === null)
  const completedCourses = ready ? summary.completedCourses : null
  const nextTarget = completedCourses === null ? undefined : LEARNING_TARGETS.find(target => completedCourses < target)
  const courseNoun = nextTarget === 1 ? 'Kurs' : 'Kursen'

  // Reveal the existing retry control on failure without replacing its DOM node
  // or closing a disclosure the person has already opened.
  useEffect(() => {
    if (failed && detailsRef.current) detailsRef.current.open = true
  }, [failed])

  return <section aria-labelledby="personal-progress-title" className="fc-surface mb-4 p-4 sm:p-5">
    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.25fr)_auto] sm:items-center sm:gap-4">
      <header className="flex min-w-0 items-center justify-between gap-3 sm:flex-col sm:items-start sm:gap-2">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h2 id="personal-progress-title" className="text-base font-semibold tracking-tight">Dein Lernfortschritt</h2>
          <p className="text-xs text-muted-foreground">Nur für dich</p>
          <div className="mt-1" aria-busy={isSignedIn && loading}>
            {!isSignedIn ? <p className="text-sm text-muted-foreground">Melde dich an, um deinen Lernfortschritt zu sehen.</p>
              : loading ? <p className="text-sm text-muted-foreground" role="status">Lernfortschritt wird geladen…</p>
              : failed ? <p className="text-sm text-destructive" role="alert">Lernfortschritt konnte nicht geladen werden.</p>
              : completedCourses !== null && <p className={`text-base font-semibold tracking-tight ${completedCourses > 0 ? 'text-reward-ink' : 'text-foreground'}`}>
                {completedCourses === 0 ? 'Noch kein Kurs abgeschlossen' : completedCourses === 1 ? '1 Kurs abgeschlossen' : `${completedCourses} Kurse abgeschlossen`}
              </p>}
          </div>
        </div>
        {visible && <SparkStaticFigure />}
      </header>

      {completedCourses !== null && <div className="min-w-0 [overflow-wrap:anywhere]">
        <h3 className="text-xs font-medium text-muted-foreground">Meilensteine</h3>
        <ol className="mt-2 grid grid-cols-3 gap-1.5" aria-label="Lernmeilensteine">
          {LEARNING_TARGETS.map(target => {
            const reached = completedCourses >= target
            const isNext = nextTarget === target
            return <li key={target} className="flex min-w-0 items-center justify-center gap-1.5">
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${reached ? 'border border-reward-ink/40 bg-reward/15 text-reward-ink' : isNext ? 'border-2 border-primary text-primary' : 'border border-border text-muted-foreground'}`} aria-hidden="true">
                {reached ? <Check className="size-3.5" strokeWidth={2.5} /> : <span className="text-xs font-medium">{target}</span>}
              </span>
              <span className={`text-xs font-medium ${reached ? 'text-reward-ink' : isNext ? 'text-primary' : 'text-muted-foreground'}`}>{target} {target === 1 ? 'Kurs' : 'Kurse'}<span className="sr-only">: {reached ? 'erreicht' : isNext ? 'nächster Meilenstein' : 'noch nicht erreicht'}</span></span>
            </li>
          })}
        </ol>
        {nextTarget ? <>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground tabular-nums">{completedCourses} von {nextTarget} {courseNoun} bis zum nächsten Meilenstein</p>
          <progress value={completedCourses} max={nextTarget}
            aria-label={`${completedCourses} von ${nextTarget} ${courseNoun} bis zum nächsten Meilenstein`}
            className="mt-1 block h-1.5 w-full accent-progress">{completedCourses} von {nextTarget}</progress>
        </> : <p className="mt-2 text-xs font-medium text-reward-ink">Alle Lernmeilensteine erreicht</p>}
      </div>}

      <div className="min-w-0 sm:col-start-3">
        <Button asChild className="w-full">
          <Link href={!isSignedIn ? '/login?callbackUrl=%2Fcommunity' : role === 'USER' ? '/courses/journey' : '/courses'}>
            <BookOpen className="size-4 shrink-0" aria-hidden="true" />
            {!isSignedIn ? 'Anmelden' : role === 'USER' ? 'Mein Lernweg' : 'Kurse ansehen'}
          </Link>
        </Button>
      </div>
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
          <h3 className="text-sm font-medium text-foreground">Punkteverlauf</h3>
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
