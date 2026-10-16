'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { getLearnerPractice, type PracticeLearnerState } from './practice-learner-api'
import { PracticeAvailabilityNotice } from './PracticeAvailabilityNotice'
import { Button } from '@/components/ui/button'

/** Shown only after course progress confirms current enrollment and a
 * read-only practice status confirms a current published pool. */
export function PracticeEntryLink({ courseId }: { courseId: string }) {
  const [availability, setAvailability] = useState<{ courseId: string; state: PracticeLearnerState | null } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void getLearnerPractice(courseId, controller.signal).then(state => {
      if (!controller.signal.aborted) setAvailability({ courseId, state: ['available', 'paused', 'ready', 'active', 'complete', 'unavailable'].includes(state.status) ? state : null })
    }).catch(() => { if (!controller.signal.aborted) setAvailability({ courseId, state: null }) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [courseId, refresh])
  if (!availability || availability.courseId !== courseId || !availability.state) return null
  return <div className="border-b px-4 py-3 sm:px-6">
    <div className="flex flex-wrap items-center gap-2">
    <Link href={`/courses/${encodeURIComponent(courseId)}/practice/learn`} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <ListChecks aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="[overflow-wrap:anywhere]">{availability.state.availability === 'resume' ? 'Übung fortsetzen' : 'Privat üben'}</span>
    </Link>
    {(availability.state.availability === 'waiting' || availability.state.availability === 'sessionComplete' || availability.state.status === 'unavailable') && <Button type="button" variant="ghost" className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]" disabled={busy} onClick={() => { setBusy(true); setRefresh(value => value + 1) }}>{busy ? 'Wird geprüft …' : 'Stand aktualisieren'}</Button>}
    </div>
    <div className="mt-1 space-y-1 text-sm text-muted-foreground">
      {availability.state.status === 'available' ? <p>Freiwillige Fragen ohne Einfluss auf den Kursabschluss.</p>
        : availability.state.status === 'paused' ? <p>Privates Üben ist pausiert.</p>
          : <PracticeAvailabilityNotice state={availability.state} />}
    </div>
  </div>
}
