'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { PageState, RetryButton } from '@/components/page-state'
import { CourseContentsEditor } from './CourseContentsEditor'
import { CourseDraftWorkspace } from './CourseDraftWorkspace'
import { AuthoringError, getAuthorState, type AuthorState } from './authoring-api'

export function CourseWorkspaceRoute({ courseId, status, canAuthorPractice = false }: { courseId: string; status: string; canAuthorPractice?: boolean }) {
  const router = useRouter()
  const [authorState, setAuthorState] = useState<AuthorState | null>(null)
  const [route, setRoute] = useState<'loading' | 'author' | 'learner' | 'error'>('loading')
  const [liveMode, setLiveMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/contents`)}`)
    if (status !== 'authenticated') return
    const controller = new AbortController()
    void getAuthorState(courseId, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setAuthorState(result)
      setRoute('author')
    }).catch(cause => {
      if (controller.signal.aborted) return
      // Non-authors only see the existing published learner reader. A temporary
      // author API error must never route an author into legacy live editing.
      if (cause instanceof AuthoringError && (cause.status === 403 || cause.status === 404)) setRoute('learner')
      else { setError(cause instanceof Error ? cause.message : 'Der Kurs konnte nicht geladen werden.'); setRoute('error') }
    })
    return () => controller.abort()
  }, [courseId, retry, router, status])

  if (route === 'learner' || (route === 'author' && liveMode)) return <CourseContentsEditor courseId={courseId} forceLearner authorPreview={route === 'author'} onReturnToAuthor={route === 'author' ? () => { setLiveMode(false); setRoute('loading'); setAuthorState(null); setRetry(value => value + 1) } : undefined} />
  if (route === 'author' && authorState) return <CourseDraftWorkspace key={`${courseId}:${authorState.draft.revision}:${liveMode}`} courseId={courseId} initialState={authorState} onLiveMode={() => setLiveMode(true)} canAuthorPractice={canAuthorPractice} />
  return <AppShell><Sidebar /><main id="page-content" tabIndex={-1} className="min-w-0 flex-1 p-4 sm:p-6">{route === 'error' ? <PageState kind="error" title="Kurs konnte nicht geladen werden" description={error ?? undefined} action={<RetryButton onClick={() => { setRoute('loading'); setError(null); setRetry(value => value + 1) }} />} /> : <PageState kind="loading" title="Kurs wird geladen" />}</main></AppShell>
}
