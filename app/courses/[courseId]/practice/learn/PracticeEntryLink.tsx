'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { getLearnerPractice } from './practice-learner-api'

/** Shown only after course progress confirms current enrollment and a
 * read-only practice status confirms a current published pool. */
export function PracticeEntryLink({ courseId }: { courseId: string }) {
  const [availability, setAvailability] = useState<{ courseId: string; available: boolean } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void getLearnerPractice(courseId, controller.signal).then(state => {
      if (!controller.signal.aborted) setAvailability({ courseId, available: ['available', 'paused', 'ready', 'active', 'complete'].includes(state.status) })
    }).catch(() => { if (!controller.signal.aborted) setAvailability({ courseId, available: false }) })
    return () => controller.abort()
  }, [courseId])
  if (!availability || availability.courseId !== courseId || !availability.available) return null
  return <div className="border-b px-4 py-3 sm:px-6">
    <Link href={`/courses/${encodeURIComponent(courseId)}/practice/learn`} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <ListChecks aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="[overflow-wrap:anywhere]">Privat üben</span>
    </Link>
    <p className="mt-1 text-sm text-muted-foreground">Freiwillige Fragen ohne Einfluss auf den Kursabschluss.</p>
  </div>
}
