'use client'

/* Hallmark · component: assignment review workbench · genre: editorial/utilitarian · theme: design.md
 * states: default · hover · focus · active · disabled · loading · error · success
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { AppShell, AppHeader } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserNav } from '@/components/user-nav'
import { PageState, RetryButton } from '@/components/page-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { MAX_ASSIGNMENT_FEEDBACK } from '../contents/assignment-content'

type Decision = { id: string; action: 'GRADED' | 'WITHDRAWN'; score: number | null; feedback: string | null; passed: boolean; createdAt: string; sequence: number }
type Submission = { id: string; contentId: string; title: string; learner: { id: string; name: string | null }; response: string;
  submittedAt: string; attemptNumber: number; isLatest: boolean; passingScore: number; decisions: Decision[] }
type Page = { submissions: Submission[]; nextCursor: string | null }

function GradeRow({ row, courseId, onChanged, onStale, onDenied }: { row: Submission; courseId: string; onChanged: () => Promise<void>; onStale: () => Promise<void>; onDenied: () => void }) {
  const latest = row.decisions[0]
  const [score, setScore] = useState(String(latest?.score ?? ''))
  const [feedback, setFeedback] = useState(latest?.feedback ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const receipt = useRef<{ signature: string; id: string } | null>(null)
  const submit = async (action: 'GRADED' | 'WITHDRAWN') => {
    if (busy || !row.isLatest) return
    const value = Number(score)
    if (action === 'GRADED' && (!Number.isInteger(value) || value < 0 || value > 100)) {
      setError('Gib eine ganze Punktzahl zwischen 0 und 100 ein.'); return
    }
    const payload = action === 'GRADED'
      ? { action, score: value, feedback, expectedDecisionId: latest?.id ?? null }
      : { action, feedback, expectedDecisionId: latest?.id ?? null }
    const signature = JSON.stringify(payload)
    if (receipt.current?.signature !== signature) receipt.current = { signature, id: crypto.randomUUID() }
    setBusy(true); setError(null); setSuccess(null)
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(row.id)}/grade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId: receipt.current.id }),
      })
      if (response.status === 401 || response.status === 403) { onDenied(); return }
      if (response.status === 409 || response.status === 412) { await onStale(); return }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error || 'Die Bewertung konnte nicht gespeichert werden.')
      }
      receipt.current = null
      setSuccess(action === 'WITHDRAWN' ? 'Bewertung zurückgenommen.' : 'Bewertung gespeichert.')
      await onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Bewertung konnte nicht gespeichert werden.') }
    finally { setBusy(false) }
  }
  return <li className="min-w-0 space-y-4 border-b py-6 last:border-b-0">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1"><h3 className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{row.title}</h3>
      <p className="text-sm text-muted-foreground">{row.learner.name?.trim() || `Person ${row.learner.id.slice(0, 8)}`} · Abgabe {row.attemptNumber} · {new Date(row.submittedAt).toLocaleString('de-DE')}</p></div>
      <span className="rounded-full border bg-card px-3 py-1 text-xs font-medium">{!row.isLatest ? 'Frühere Abgabe' : !latest ? 'Offen' : latest.action === 'WITHDRAWN' ? 'Zurückgenommen' : latest.passed ? 'Bestanden' : 'Nicht bestanden'}</span></div>
    <div className="space-y-2"><p className="text-sm font-semibold">Antwort</p><p className="whitespace-pre-wrap break-words rounded-xl border bg-card p-4 text-sm leading-relaxed">{row.response}</p></div>
    <p className="text-sm text-muted-foreground">Bestehensgrenze: {row.passingScore} von 100 Punkten.</p>
    {row.decisions.length > 0 && <details><summary className="cursor-pointer text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Bewertungsverlauf ({row.decisions.length})</summary>
      <ol className="mt-2 divide-y border-y">{row.decisions.map(decision => <li key={decision.id} className="py-2 text-sm"><span className="font-medium">{decision.action === 'WITHDRAWN' ? 'Zurückgenommen' : `${decision.score} Punkte${decision.passed ? ' · bestanden' : ' · nicht bestanden'}`}</span><span className="ml-2 text-muted-foreground">{new Date(decision.createdAt).toLocaleString('de-DE')}</span>{decision.feedback && <p className="mt-1 whitespace-pre-wrap break-words">{decision.feedback}</p>}</li>)}</ol>
    </details>}
    {row.isLatest && <form onSubmit={event => { event.preventDefault(); void submit('GRADED') }} aria-busy={busy} className="max-w-2xl space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <h4 className="font-semibold">{latest ? 'Bewertung korrigieren' : 'Bewertung abgeben'}</h4>
      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"><div className="min-w-0 space-y-2"><Label htmlFor={`grade-${row.id}`}>Punkte (0–100)</Label><Input id={`grade-${row.id}`} type="number" inputMode="numeric" min={0} max={100} step={1} value={score} onChange={event => { setScore(event.target.value); receipt.current = null; setError(null) }} aria-invalid={Boolean(error && error.includes('Punktzahl'))} /></div>
      <div className="min-w-0 space-y-2"><Label htmlFor={`feedback-${row.id}`}>Rückmeldung (optional)</Label><Textarea id={`feedback-${row.id}`} className="min-h-24 resize-y" maxLength={MAX_ASSIGNMENT_FEEDBACK} value={feedback} onChange={event => { setFeedback(event.target.value); receipt.current = null; setError(null) }} /><p className="text-xs text-muted-foreground">Die lernende Person sieht diese Rückmeldung.</p></div></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{success && <p role="status" className="text-sm text-foreground">{success}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || score === ''}>{busy ? 'Wird gespeichert …' : latest ? 'Korrektur speichern' : 'Bewertung speichern'}</Button>
        {latest?.action === 'GRADED' && <Button type="button" variant="outline" disabled={busy} onClick={() => void submit('WITHDRAWN')}>Bewertung zurücknehmen</Button>}</div>
    </form>}
  </li>
}

export function GradingClient({ courseId, sessionStatus }: { courseId: string; sessionStatus: string }) {
  const router = useRouter()
  const [page, setPage] = useState<Page | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [cursor, setCursor] = useState<string | null>(null)
  const [back, setBack] = useState<Array<string | null>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [staleNotice, setStaleNotice] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ filter })
    if (cursor) query.set('cursor', cursor)
    const url = `/api/courses/${encodeURIComponent(courseId)}/assignments?${query}`
    const response = await fetch(url, { cache: 'no-store', signal })
    const body = await response.json().catch(() => null) as Page | null
    if (response.status === 401 || response.status === 403) {
      setPage(null); setError('Du hast keinen Zugriff mehr auf die Bewertungen dieses Kurses.')
      throw new Error('Du hast keinen Zugriff mehr auf die Bewertungen dieses Kurses.')
    }
    if (!response.ok || !body) throw new Error('Die Abgaben konnten nicht geladen werden.')
    setPage(body)
  }, [courseId, cursor, filter])
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/grading`)}`)
    if (sessionStatus !== 'authenticated') return
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return
      setLoading(true); setError(null); setPage(null)
      return refresh(controller.signal)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Die Abgaben konnten nicht geladen werden.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [courseId, refresh, retry, router, sessionStatus])
  const previous = () => { setCursor(back.at(-1) ?? null); setBack(rows => rows.slice(0, -1)) }
  return <AppShell><Sidebar /><div className="flex min-w-0 flex-1 flex-col"><AppHeader><div className="flex min-w-0 flex-1 items-center justify-between gap-2"><h1 className="min-w-0 truncate text-base font-semibold sm:text-xl">Aufgaben bewerten</h1><div className="flex shrink-0 gap-1"><ThemeToggle /><UserNav /></div></div></AppHeader>
    <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5"><div className="space-y-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kursleitung</p><h2 className="text-2xl font-semibold">Abgaben und Bewertungen</h2><p className="text-sm text-muted-foreground">Bewerte die neueste Abgabe jeder Aufgabe. Korrekturen und Rücknahmen bleiben im Verlauf erhalten.</p></div><Button variant="outline" onClick={() => router.push(`/courses/${encodeURIComponent(courseId)}/contents`)}><ChevronLeft className="mr-1 h-4 w-4" />Zum Kurs</Button></div>
      <div role="group" aria-label="Abgaben filtern" className="flex flex-wrap gap-2"><Button variant={filter === 'pending' ? 'default' : 'outline'} aria-pressed={filter === 'pending'} onClick={() => { setFilter('pending'); setCursor(null); setBack([]) }}>Offene Bewertungen</Button><Button variant={filter === 'all' ? 'default' : 'outline'} aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); setCursor(null); setBack([]) }}>Alle Abgaben</Button></div>
      {staleNotice && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">{staleNotice}</p>}
      {sessionStatus !== 'authenticated' || loading ? <PageState kind="loading" title="Abgaben werden geladen" /> : error ? <PageState kind="error" title="Abgaben konnten nicht geladen werden" description={error} action={<RetryButton onClick={() => setRetry(value => value + 1)} />} /> : !page?.submissions.length ? <PageState title={filter === 'pending' ? 'Keine offenen Bewertungen' : 'Keine Abgaben auf dieser Seite'} description={filter === 'pending' ? 'Derzeit wartet keine aktuelle Abgabe auf eine Bewertung.' : 'Sobald Lernende eine veröffentlichte Aufgabe abgeben, erscheint sie hier.'} /> : <><p role="status" className="text-sm text-muted-foreground">{page.submissions.length} Abgaben auf dieser Seite</p><ol className="min-w-0">{page.submissions.map(row => <GradeRow key={`${row.id}:${row.decisions[0]?.id ?? 'ungraded'}`} row={row} courseId={courseId} onChanged={async () => { await refresh(); setStaleNotice(null) }} onStale={async () => { await refresh(); setStaleNotice('Die Abgabe oder Bewertung wurde zwischenzeitlich geändert. Die aktuelle Fassung ist geladen; prüfe sie vor dem erneuten Bewerten.') }} onDenied={() => { setPage(null); setError('Du hast keinen Zugriff mehr auf die Bewertungen dieses Kurses.') }} />)}</ol>
        <nav aria-label="Abgaben-Seiten" className="flex flex-wrap gap-2 border-t pt-5"><Button variant="outline" disabled={!back.length} onClick={previous}><ChevronLeft className="mr-1 h-4 w-4" />Zurück</Button><Button variant="outline" disabled={!page.nextCursor} onClick={() => { setBack(rows => [...rows, cursor]); setCursor(page.nextCursor) }}>Weiter<ChevronRight className="ml-1 h-4 w-4" /></Button></nav></>}
    </div></main></div></AppShell>
}
