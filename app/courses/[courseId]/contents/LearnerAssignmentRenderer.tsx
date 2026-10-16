'use client'

/* Hallmark · component: assignment workbench · genre: editorial/utilitarian · theme: design.md
 * states: default · hover · focus · active · disabled · loading · error · success
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { MAX_ASSIGNMENT_RESPONSE, parseAssignmentContent } from './assignment-content'

type Decision = { id: string; action: 'GRADED' | 'WITHDRAWN'; score: number | null; feedback: string | null; passed: boolean; createdAt: string; sequence: number }
type Submission = { id: string; response: string; attemptNumber: number; submittedAt: string; currentRevision: boolean; decisions: Decision[] }
type Status = { maySubmit: boolean; passingScore: number; submissions: Submission[] }

type LearnerAssignmentProps = {
  courseId: string; contentId: string; publicationId?: string | null; contentVersionToken?: string | null;
  content: unknown; refreshKey?: number; onChanged?: () => void; onReaderIssue?: (status: number) => void
}

export function LearnerAssignmentRenderer(props: LearnerAssignmentProps) {
  const version = JSON.stringify([props.courseId, props.contentId, props.publicationId, props.contentVersionToken])
  return <LearnerAssignmentSession key={version} {...props} />
}

function LearnerAssignmentSession({ courseId, contentId, publicationId, contentVersionToken, content, refreshKey = 0, onChanged, onReaderIssue }: LearnerAssignmentProps) {
  const assignment = parseAssignmentContent(content)
  const [status, setStatus] = useState<Status | null>(null)
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pendingId = useRef<string | null>(null)
  const sending = useRef(false)
  const active = useRef(true)
  const readerIssue = useRef(onReaderIssue)
  useEffect(() => { readerIssue.current = onReaderIssue }, [onReaderIssue])
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const url = `/api/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}/assignment`
  const statusUrl = useRef(url)
  const statusRequest = useRef(0)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++statusRequest.current
    const current = () => active.current && !signal?.aborted && request === statusRequest.current
    try {
      const response = await fetch(url, { cache: 'no-store', signal })
      const body = await response.json().catch(() => null) as Status | null
      if (!current()) return
      if (!response.ok) readerIssue.current?.(response.status)
      if (!response.ok || !body) throw new Error(response.status === 423 ? 'Diese Aufgabe ist noch gesperrt.' : 'Deine Abgaben konnten nicht geladen werden.')
      setStatus(body)
    } catch (error) { if (current()) throw error }
  }, [url])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return
      setLoading(true); setError(null)
      // A same-lesson reader refresh keeps the answer field mounted, including
      // any unsent text and focus acquired while the parent read was pending.
      if (statusUrl.current !== url) { statusUrl.current = url; setStatus(null) }
      return refresh(controller.signal)
    }).catch(cause => { if (!controller.signal.aborted) { setStatus(null); setError(cause instanceof Error ? cause.message : 'Abgaben konnten nicht geladen werden.') } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh, refreshKey, url])

  if (!assignment?.prompt.trim()) return <p role="alert">Diese Aufgabe ist noch nicht verfügbar.</p>
  const current = status?.submissions.find(row => row.currentRevision)
  const decision = current?.decisions[0]
  const canSubmit = Boolean(status?.maySubmit && publicationId && contentVersionToken)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (sending.current || !canSubmit || !answer.trim() || answer.length > MAX_ASSIGNMENT_RESPONSE) return
    sending.current = true; setSaving(true); setError(null); setNotice(null)
    const requestId = pendingId.current ?? crypto.randomUUID()
    pendingId.current = requestId
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, response: answer, publicationId, contentVersionToken }) })
      if (!active.current) return
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null
        if (!active.current) return
        readerIssue.current?.(response.status)
        throw new Error(response.status === 412 ? 'Die Aufgabe wurde geändert. Bitte lade den Kurs neu.' : response.status === 423 ? 'Diese Aufgabe ist noch gesperrt.' : data?.error || 'Die Abgabe konnte nicht gespeichert werden.')
      }
      pendingId.current = null; setAnswer(''); setNotice('Abgabe gespeichert. Die Bewertung folgt durch die Kursleitung.')
      await refresh(); if (active.current) onChanged?.()
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Die Abgabe konnte nicht gespeichert werden.') }
    finally { sending.current = false; if (active.current) setSaving(false) }
  }

  return <section aria-label="Aufgabe" className="mx-auto max-w-[72ch] space-y-6">
    <div className="space-y-3 border-b pb-5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Manuell bewertete Aufgabe</p>
      <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{assignment.prompt}</p>
      <p className="text-sm text-muted-foreground">Bestehensgrenze: {assignment.passingScore} von 100 Punkten. Antworten nur als Text, maximal {MAX_ASSIGNMENT_RESPONSE.toLocaleString('de-DE')} Zeichen.</p></div>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Deine Abgaben werden geladen …</p> : null}
    {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-border bg-card p-3 text-sm text-foreground">{notice}</p>}
    {current && <div className="space-y-2 border-b pb-5"><h3 className="font-semibold">Deine aktuelle Abgabe</h3>
      <p className="text-sm text-muted-foreground">Abgegeben am {new Date(current.submittedAt).toLocaleString('de-DE')}</p>
      <p className="whitespace-pre-wrap break-words rounded-lg border bg-card p-4 text-sm leading-relaxed">{current.response}</p>
      <p role="status" className="font-medium">{!decision ? 'Bewertung ausstehend' : decision.action === 'WITHDRAWN' ? 'Bewertung zurückgenommen' : decision.passed ? `Bestanden · ${decision.score} von 100 Punkten` : `Noch nicht bestanden · ${decision.score} von 100 Punkten`}</p>
      {decision?.feedback && <div className="space-y-1"><p className="text-sm font-medium">Rückmeldung</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{decision.feedback}</p></div>}
    </div>}
    {!loading && !status && !error && <p className="text-sm text-muted-foreground">Noch keine Abgabe.</p>}
    {canSubmit && <form onSubmit={submit} aria-busy={saving} className="space-y-3"><Label htmlFor={`assignment-response-${contentId}`}>{current ? 'Neue Antwort' : 'Deine Antwort'}</Label>
      <Textarea id={`assignment-response-${contentId}`} required maxLength={MAX_ASSIGNMENT_RESPONSE} rows={8} value={answer}
        onChange={event => { setAnswer(event.target.value); pendingId.current = null; setError(null) }} aria-invalid={Boolean(error)} aria-describedby={`assignment-hint-${contentId}`} className="min-h-40 resize-y" />
      <p id={`assignment-hint-${contentId}`} className="text-sm text-muted-foreground">Nur du und die Kursleitung sehen deine Antwort. {answer.length.toLocaleString('de-DE')} / {MAX_ASSIGNMENT_RESPONSE.toLocaleString('de-DE')} Zeichen.</p>
      <Button type="submit" disabled={saving || !answer.trim()}>{saving ? 'Wird abgegeben …' : 'Antwort abgeben'}</Button>
    </form>}
    {status && !status.maySubmit && !current && <p className="text-sm text-muted-foreground">Diese Aufgabe kann gerade nicht abgegeben werden.</p>}
    {status && status.submissions.length > 1 && <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Frühere Abgaben ({status.submissions.length - 1})</summary>
      <ol className="mt-3 space-y-4">{status.submissions.filter(row => row.id !== current?.id).map(row => <li key={row.id} className="space-y-1 border-b pb-3 text-sm"><p className="font-medium">Abgabe {row.attemptNumber} · {new Date(row.submittedAt).toLocaleString('de-DE')}</p><p className="whitespace-pre-wrap break-words">{row.response}</p><p className="text-muted-foreground">{row.decisions[0]?.action === 'WITHDRAWN' ? 'Bewertung zurückgenommen' : row.decisions[0]?.score === null || !row.decisions[0] ? 'Keine Bewertung' : `${row.decisions[0].score} von 100 Punkten`}</p></li>)}</ol>
    </details>}
  </section>
}
