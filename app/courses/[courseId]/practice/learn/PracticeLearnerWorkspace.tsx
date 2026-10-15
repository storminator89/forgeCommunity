'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PracticeLearnerView, type ConfidenceChoice, type LearnerFeedback, type LearnerQuestion, type LearnerStage } from './PracticeLearnerView'
import {
  answerPractice, getLearnerPractice, nextPractice, optInPractice, optOutPractice, pausePractice,
  preparePracticeReset, resetPractice, startPractice, PracticeLearnerApiError,
  type AnswerConfidence, type PracticeLearnerState,
} from './practice-learner-api'

const confidenceCode: Record<Exclude<ConfidenceChoice, null>, Exclude<AnswerConfidence, null>> = {
  Sicher: 'SURE', 'Eher sicher': 'SOMEWHAT_SURE', Unsicher: 'UNSURE', Geraten: 'GUESSED',
}

function errorMessage(cause: unknown) {
  if (cause instanceof PracticeLearnerApiError && cause.status === 409) return 'Der Übungsstand hat sich geändert. Bitte prüfe den aktuellen Stand.'
  return cause instanceof Error ? cause.message : 'Die Übung konnte nicht geladen werden.'
}

function questionFrom(state: PracticeLearnerState): LearnerQuestion | null {
  const pending = state.session?.pending
  return pending ? { reservationId: pending.reservationId, prompt: pending.item.prompt,
    options: pending.item.options, objectiveTitle: pending.item.objectiveTitle } : null
}

function stageFrom(state: PracticeLearnerState): LearnerStage {
  if (state.status === 'off' || state.status === 'unpublished' || state.status === 'archived' || state.status === 'available' || state.status === 'paused') return state.status
  if (state.session?.pending) return 'question'
  return state.status === 'complete' || state.dueCount < 1 ? 'done' : 'idle'
}

export function PracticeLearnerWorkspace({ courseId, sessionStatus }: { courseId: string; sessionStatus: string }) {
  const router = useRouter()
  const [state, setState] = useState<PracticeLearnerState | null>(null)
  const [stage, setStage] = useState<LearnerStage>('loading')
  const [question, setQuestion] = useState<LearnerQuestion | null>(null)
  const [feedback, setFeedback] = useState<LearnerFeedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const submission = useRef<{ reservationId: string; optionIndex: number; confidence: AnswerConfidence; id: string } | null>(null)
  const mounted = useRef(true)

  const apply = useCallback((next: PracticeLearnerState) => {
    setState(next)
    setQuestion(questionFrom(next))
    setFeedback(null)
    setStage(stageFrom(next))
    setError(null)
    submission.current = null
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    const next = await getLearnerPractice(courseId, signal)
    if (!signal?.aborted && mounted.current) apply(next)
  }, [apply, courseId])

  const handleError = useCallback((cause: unknown) => {
    if (!mounted.current) return
    if (cause instanceof PracticeLearnerApiError && cause.status === 401) {
      router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/practice/learn`)}`)
      return
    }
    if (cause instanceof PracticeLearnerApiError && cause.status === 403) { setStage('forbidden'); setError(null); return }
    setError(errorMessage(cause))
    setStage(current => current === 'loading' ? 'error' : current)
  }, [courseId, router])

  useEffect(() => {
    mounted.current = true
    if (sessionStatus === 'unauthenticated') {
      router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/practice/learn`)}`)
      return () => { mounted.current = false }
    }
    if (sessionStatus !== 'authenticated') return () => { mounted.current = false }
    const controller = new AbortController()
    void load(controller.signal).catch(cause => { if (!controller.signal.aborted) handleError(cause) })
    return () => { mounted.current = false; controller.abort() }
  }, [courseId, handleError, load, router, sessionStatus])

  const mutate = useCallback(async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try { await action() }
    catch (cause) {
      if (cause instanceof PracticeLearnerApiError && (cause.status === 401 || cause.status === 403)) {
        handleError(cause)
        return
      }
      // An uncertain write can have committed even if its response was lost.
      // Re-read current state; GET never marks a question seen.
      if (mounted.current) {
        try { await load(); if (mounted.current) setError(errorMessage(cause)) }
        catch { handleError(cause) }
      }
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }, [handleError, load])

  const enable = () => void mutate(async () => { await optInPractice(courseId); await load() })
  const pause = () => void mutate(async () => { await pausePractice(courseId); await load() })
  const optOut = () => void mutate(async () => { await optOutPractice(courseId); await load() })
  const next = () => {
    if (stage === 'feedback' && feedback?.canContinue === false) { setStage('done'); return }
    void mutate(async () => {
      if (state?.session?.id && (stage === 'feedback' || stage === 'done' ||
        (state.session.answeredCount > 0 && !state.session.pending))) await nextPractice(courseId, state.session.id)
      else await startPractice(courseId)
      await load()
    })
  }
  const answer = (optionIndex: number, confidence: ConfidenceChoice) => void mutate(async () => {
    const pending = state?.session?.pending
    if (!pending || !state?.session?.id) throw new Error('Diese Frage ist nicht mehr geöffnet. Bitte lade die Übung neu.')
    const code = confidence === null ? null : confidenceCode[confidence]
    if (!submission.current || submission.current.reservationId !== pending.reservationId ||
      submission.current.optionIndex !== optionIndex || submission.current.confidence !== code) {
      submission.current = { reservationId: pending.reservationId, optionIndex, confidence: code, id: crypto.randomUUID() }
    }
    const result = await answerPractice(courseId, { sessionId: state.session.id, reservationId: pending.reservationId,
      submissionId: submission.current.id, optionIndex, confidence: code })
    if (!mounted.current) return
    setFeedback({ correct: result.correct, correctIndex: result.correctIndex, explanation: result.explanation,
      canContinue: result.canContinue })
    setStage('feedback')
  })
  const reset = () => void mutate(async () => {
    const prepared = await preparePracticeReset(courseId)
    if (!prepared.token) throw new Error('Das Zurücksetzen konnte nicht vorbereitet werden.')
    await resetPractice(courseId, prepared.token)
    await load()
  })
  const retry = () => { setStage('loading'); setError(null); void load().catch(handleError) }

  return <PracticeLearnerView courseId={courseId} stage={stage} question={question} feedback={feedback}
    error={error} busy={busy} onRetry={retry} onEnable={enable} onPause={pause} onOptOut={optOut} onNext={next}
    onAnswer={answer} onReset={reset} nextLabel={state?.session && state.session.answeredCount > 0 ? 'Weitere Frage öffnen' : undefined}
    canCloseSession={stage === 'done' && state?.status === 'active' && Boolean(state.session && !state.session.pending)} />
}
