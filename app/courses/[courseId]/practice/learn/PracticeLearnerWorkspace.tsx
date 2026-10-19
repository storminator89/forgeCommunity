'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PracticeLearnerView, type ConfidenceChoice, type LearnerFeedback, type LearnerQuestion, type LearnerStage } from './PracticeLearnerView'
import {
  answerPractice, closePractice, getLearnerPractice, nextPractice, optInPractice, optOutPractice, pausePractice,
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
  if (state.status === 'off' || state.status === 'unpublished' || state.status === 'archived' || state.status === 'available' || state.status === 'paused' || state.status === 'unavailable') return state.status
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
  const lifecycle = useRef<AbortController | null>(null)

  const apply = useCallback((next: PracticeLearnerState) => {
    setState(next)
    setQuestion(questionFrom(next))
    setFeedback(null)
    setStage(stageFrom(next))
    setError(null)
    submission.current = null
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    const boundSignal = signal ?? lifecycle.current?.signal
    const next = await getLearnerPractice(courseId, boundSignal)
    if (!boundSignal?.aborted && mounted.current) apply(next)
  }, [apply, courseId])

  const handleError = useCallback((cause: unknown) => {
    if (!mounted.current || lifecycle.current?.signal.aborted) return
    setState(null)
    setQuestion(null)
    setFeedback(null)
    if (cause instanceof PracticeLearnerApiError && cause.status === 401) {
      setStage('loading')
      router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/practice/learn`)}`)
      return
    }
    if (cause instanceof PracticeLearnerApiError && cause.status === 403) { setStage('forbidden'); setError(null); return }
    setError(errorMessage(cause))
    setStage('error')
  }, [courseId, router])

  useEffect(() => {
    mounted.current = true
    if (sessionStatus === 'unauthenticated') {
      router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/practice/learn`)}`)
      return () => { mounted.current = false }
    }
    if (sessionStatus !== 'authenticated') return () => { mounted.current = false }
    const controller = new AbortController()
    lifecycle.current = controller
    void load(controller.signal).catch(cause => { if (!controller.signal.aborted) handleError(cause) })
    return () => { mounted.current = false; controller.abort() }
  }, [courseId, handleError, load, router, sessionStatus])

  const mutate = useCallback(async (action: (signal?: AbortSignal) => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    const signal = lifecycle.current?.signal
    try { await action(signal) }
    catch (cause) {
      if (signal?.aborted || !mounted.current) return
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

  const enable = () => void mutate(async signal => { await optInPractice(courseId, signal); await load(signal) })
  const pause = () => void mutate(async signal => { await pausePractice(courseId, signal); await load(signal) })
  const optOut = () => void mutate(async signal => { await optOutPractice(courseId, signal); await load(signal) })
  const next = () => {
    if (stage === 'feedback' && feedback?.canContinue === false) {
      void mutate(async signal => { await load(signal) })
      return
    }
    void mutate(async signal => {
      if (stage === 'done' && state?.session?.id) await closePractice(courseId, state.session.id, signal)
      else if (state?.session?.id && (stage === 'feedback' ||
        (state.session.answeredCount > 0 && !state.session.pending))) await nextPractice(courseId, state.session.id, signal)
      else await startPractice(courseId, signal)
      await load(signal)
    })
  }
  const answer = (optionIndex: number, confidence: ConfidenceChoice) => void mutate(async signal => {
    const pending = state?.session?.pending
    if (!pending || !state?.session?.id) throw new Error('Diese Frage ist nicht mehr geöffnet. Bitte lade die Übung neu.')
    const code = confidence === null ? null : confidenceCode[confidence]
    if (!submission.current || submission.current.reservationId !== pending.reservationId ||
      submission.current.optionIndex !== optionIndex || submission.current.confidence !== code) {
      submission.current = { reservationId: pending.reservationId, optionIndex, confidence: code, id: crypto.randomUUID() }
    }
    const submitted = submission.current
    const submittedSessionId = state.session.id
    const submittedOrdinal = pending.ordinal
    const result = await answerPractice(courseId, { sessionId: state.session.id, reservationId: pending.reservationId,
      submissionId: submitted.id, optionIndex, confidence: code }, signal)
    if (!mounted.current || signal?.aborted) return
    // Answer feedback and its return window must share a fresh live snapshot.
    // A completed session is no longer present in this GET; never reuse its id.
    const fresh = await getLearnerPractice(courseId, signal)
    if (!mounted.current || signal?.aborted) return
    if (!['ready', 'active', 'complete'].includes(fresh.status) ||
      fresh.snapshotId !== state.snapshotId || fresh.publicationId !== state.publicationId) { apply(fresh); return }
    const sameAnswerWindow = Number.isSafeInteger(submittedOrdinal) && submittedOrdinal > 0 &&
      result.answeredCount === submittedOrdinal && (fresh.session
        ? fresh.session.id === submittedSessionId && fresh.session.answeredCount === result.answeredCount &&
          (fresh.session.pending === undefined || fresh.session.pending === null)
        : result.canContinue === false && (fresh.status === 'ready' || fresh.status === 'complete'))
    setState(fresh)
    setFeedback({ correct: result.correct, correctIndex: result.correctIndex, explanation: result.explanation,
      submittedAnswer: sameAnswerWindow && submission.current === submitted && question?.reservationId === submitted.reservationId &&
        Number.isSafeInteger(submitted.optionIndex) && submitted.optionIndex >= 0 &&
        submitted.optionIndex < pending.item.options.length && submitted.optionIndex < question.options.length
        ? { reservationId: submitted.reservationId, optionIndex: submitted.optionIndex } : undefined,
      canContinue: result.canContinue && fresh.status === 'active' && Boolean(fresh.session) && (fresh.dueCount > 0 || Boolean(fresh.session?.pending)) })
    setStage('feedback')
  })
  const reset = () => void mutate(async signal => {
    const prepared = await preparePracticeReset(courseId, signal)
    if (!prepared.token) throw new Error('Das Zurücksetzen konnte nicht vorbereitet werden.')
    await resetPractice(courseId, prepared.token, signal)
    await load(signal)
  })
  const retry = () => { void mutate(async signal => { await load(signal) }) }

  return <PracticeLearnerView courseId={courseId} stage={stage} question={question} feedback={feedback}
    error={error} busy={busy} availabilityState={state} onRefresh={retry} onRetry={retry} onEnable={enable} onPause={pause} onOptOut={optOut} onNext={next}
    onAnswer={answer} onReset={reset} nextLabel={state?.session && state.session.answeredCount > 0 ? 'Weitere Frage öffnen' : undefined}
    canCloseSession={stage === 'done' && state?.status === 'active' && Boolean(state.session && !state.session.pending)} />
}
