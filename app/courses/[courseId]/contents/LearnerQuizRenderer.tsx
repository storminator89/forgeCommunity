'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { QuizStage, isQuizQuestionAnswered } from './QuizStage'
import styles from './QuizStage.module.css'
import { parseLearnerQuizContent, parseQuizContent, type LearnerQuizContent, type LearnerQuizQuestion, type LatestQuizAttempt } from './types'

type Grade = { score: number; passed: boolean }
type Confidence = 'SURE' | 'SOMEWHAT_SURE' | 'UNSURE' | 'GUESSED'
type ConfidenceChoice = Confidence | 'NONE'
type Submission = {
  submissionId: string
  answers: Record<string, unknown>
  confidenceByQuestion?: Record<string, Confidence>
}

const confidenceOptions: { value: ConfidenceChoice; label: string }[] = [
  { value: 'SURE', label: 'Sicher' },
  { value: 'SOMEWHAT_SURE', label: 'Eher sicher' },
  { value: 'UNSURE', label: 'Unsicher' },
  { value: 'GUESSED', label: 'Geraten' },
  { value: 'NONE', label: 'Keine Angabe' },
]

function learnerQuiz(value: unknown): LearnerQuizContent | null {
  const publicQuiz = parseLearnerQuizContent(value)
  if (publicQuiz) return {
    shuffleQuestions: publicQuiz.shuffleQuestions,
    passingScore: publicQuiz.passingScore,
    // The parser validates but does not redact. Reconstruct even a public-shaped object.
    questions: publicQuiz.questions.map((question): LearnerQuizQuestion => {
      const base = { id: question.id, question: question.question }
      switch (question.type) {
        case 'SINGLE_CHOICE': case 'MULTIPLE_CHOICE': case 'TRUE_FALSE': return { ...base, type: question.type, options: [...question.options] }
        case 'MATCHING': return { ...base, type: 'MATCHING', pairs: question.pairs.map(pair => ({ left: pair.left })) }
        case 'FILL_BLANKS': return { ...base, type: 'FILL_BLANKS', text: question.text, blankCount: question.blankCount }
        case 'TEXT_INPUT': return { ...base, type: 'TEXT_INPUT' }
      }
    }),
  }
  // Course editors may also be enrolled. Strip their editor-only answer key.
  const full = parseQuizContent(value)
  if (!full) return null
  return {
    shuffleQuestions: full.shuffleQuestions ?? false,
    passingScore: full.passingScore ?? 70,
    questions: full.questions.map((question): LearnerQuizQuestion => {
      const base = { id: question.id, question: question.question }
      switch (question.type) {
        case 'SINGLE_CHOICE': case 'MULTIPLE_CHOICE': case 'TRUE_FALSE': return { ...base, type: question.type, options: [...question.options] }
        case 'MATCHING': return { ...base, type: 'MATCHING', pairs: question.pairs.map(pair => ({ left: pair.left })) }
        case 'FILL_BLANKS': return { ...base, type: 'FILL_BLANKS', text: question.text, blankCount: question.answers.length }
        case 'TEXT_INPUT': return { ...base, type: 'TEXT_INPUT' }
      }
    }),
  }
}

function submissionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `attempt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

type LearnerQuizProps = {
  latestAttempt?: LatestQuizAttempt
  courseId: string
  contentId: string
  updatedAt: string | undefined
  publicationId?: string | null
  contentVersionToken?: string | null
  content: unknown
  onPassed: () => void
  onReaderIssue?: (status: number) => void
}

export function LearnerQuizRenderer(props: LearnerQuizProps) {
  // A new publication or content version starts a fresh attempt, including the
  // optional pre-submission evidence. The caller may also render us directly.
  const version = JSON.stringify([props.courseId, props.contentId, props.publicationId, props.contentVersionToken, props.updatedAt])
  return <LearnerQuizSession key={version} {...props} />
}

function LearnerQuizSession({ courseId, contentId, publicationId, contentVersionToken, content, onPassed, onReaderIssue, latestAttempt }: LearnerQuizProps) {
  const quiz = learnerQuiz(content)
  const prefix = useId()
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [confidence, setConfidence] = useState<Record<string, ConfidenceChoice>>({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<Grade | null>(null)
  const [repeating, setRepeating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [staleVersion, setStaleVersion] = useState(false)
  const pendingSubmission = useRef<Submission | null>(null)
  const pendingNavigationFocus = useRef(false)
  const sending = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const [questions] = useState(() => {
    const ordered = [...(quiz?.questions ?? [])]
    if (quiz?.shuffleQuestions) for (let index = ordered.length - 1; index > 0; index--) {
      const target = Math.floor(Math.random() * (index + 1))
      ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    }
    return ordered
  })
  useEffect(() => {
    if (!pendingNavigationFocus.current) return
    pendingNavigationFocus.current = false
    const prompt = document.getElementById(`${prefix}-prompt`)
    prompt?.focus({ preventScroll: true })
    prompt?.scrollIntoView?.({ block: 'nearest' })
  }, [questionIndex, result, repeating, prefix])
  if (!quiz?.questions.length) return <p role="alert">Dieses Quiz ist noch nicht verfügbar.</p>
  const saved = latestAttempt?.contentId === contentId && latestAttempt.publicationId === publicationId ? latestAttempt : null
  const started = submitted || pending || Object.keys(answers).length > 0 || Object.keys(confidence).length > 0
  if (saved && !repeating && !result && !started) return <section className="space-y-4" aria-label="Quiz">
    <h2 className="text-lg font-semibold">Quiz</h2>
    <div role="status" className="space-y-1">
      <p className={saved.passed ? 'text-success' : 'text-destructive'}>Letzter Versuch: {saved.score.toFixed(1)}%. {saved.passed ? 'Bestanden!' : 'Noch nicht bestanden.'}</p>
      <p className="text-sm text-muted-foreground"><time dateTime={saved.submittedAt}>{new Date(saved.submittedAt).toLocaleString('de-DE')}</time></p>
    </div>
    <Button type="button" variant="outline" onClick={() => { pendingNavigationFocus.current = true; setRepeating(true) }}>Quiz wiederholen</Button>
  </section>

  const setAnswer = (id: string, value: unknown) => {
    if (sending.current || pendingSubmission.current || result) return
    setError(null)
    setAnswers(previous => ({ ...previous, [id]: value }))
  }
  const setConfidenceChoice = (id: string, value: ConfidenceChoice) => {
    if (sending.current || pendingSubmission.current || result) return
    setError(null)
    setConfidence(previous => ({ ...previous, [id]: value }))
  }
  const ready = questions.every(question => isQuizQuestionAnswered(question, answers[question.id]))
  const answeredCount = questions.filter(question => isQuizQuestionAnswered(question, answers[question.id])).length
  const question = questions[questionIndex]
  const lastQuestion = questionIndex === questions.length - 1
  const controlsDisabled = pending || submitted || Boolean(result)
  const goToQuestion = (nextIndex: number) => {
    pendingNavigationFocus.current = true
    setQuestionIndex(Math.max(0, Math.min(questions.length - 1, nextIndex)))
  }

  const submit = async () => {
    if (sending.current || staleVersion || !ready || !publicationId || !contentVersionToken) return
    sending.current = true
    setPending(true)
    setSubmitted(true)
    setError(null)
    const submission = pendingSubmission.current ?? (() => {
      const selected = Object.fromEntries(
        questions.flatMap(question => {
          const choice = confidence[question.id]
          // An untouched control or "Keine Angabe" is not confidence evidence.
          return choice && choice !== 'NONE' ? [[question.id, choice]] : []
        }),
      ) as Record<string, Confidence>
      return {
        submissionId: submissionId(),
        answers,
        ...(Object.keys(selected).length ? { confidenceByQuestion: selected } : {}),
      }
    })()
    pendingSubmission.current = submission
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}/attempts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...submission, publicationId, contentVersionToken }),
      })
      if (!response.ok) {
        if (active.current) onReaderIssue?.(response.status)
        if (response.status === 409 || response.status === 412) {
          if (active.current) setStaleVersion(true)
          throw new Error('Dieses Quiz wurde geändert. Deine Antworten sind hier noch sichtbar. Bitte lade den Kurs neu, bevor du erneut abgibst.')
        }
        if (response.status === 429) throw new Error('Bitte sieh dir die Inhalte noch einmal an und versuche es später erneut.')
        if (response.status === 403) throw new Error('Du musst für diesen Kurs eingeschrieben sein.')
        throw new Error('Deine Antworten konnten nicht geprüft werden. Bitte versuche es erneut.')
      }
      const graded = await response.json() as Grade
      if (typeof graded.score !== 'number' || typeof graded.passed !== 'boolean') throw new Error('Das Quiz-Ergebnis konnte nicht gelesen werden.')
      if (!active.current) return
      setResult(graded)
      pendingSubmission.current = null
      if (graded.passed) onPassed()
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Deine Antworten konnten nicht geprüft werden.') }
    finally { sending.current = false; if (active.current) setPending(false) }
  }

  return <section className="min-w-0 space-y-4" aria-label="Quiz">
    <div className="mx-auto max-w-[44rem]"><h2 className="text-lg font-semibold">Quiz</h2><p className="text-sm text-muted-foreground">Deine Antworten werden gemeinsam am Ende geprüft. Bestehensgrenze: {quiz.passingScore}%.</p></div>
    <QuizStage promptId={`${prefix}-prompt`} question={question} answer={answers[question.id]} onAnswerChange={answer => setAnswer(question.id, answer)} questionNumber={questionIndex + 1} totalQuestions={questions.length} answeredCount={answeredCount} disabled={controlsDisabled}>
      <details className={styles.confidence}>
        <summary>Wie sicher bist du dir? (freiwillig)</summary>
        <fieldset className="min-w-0">
          <legend className="sr-only">Sicherheit zu Frage {questionIndex + 1}</legend>
          <div className={styles.confidenceChoices}>
            {confidenceOptions.map(option => <label key={option.value} className={styles.confidenceChoice}>
              <input type="radio" name={`${prefix}-${question.id}-confidence`} value={option.value} checked={confidence[question.id] === option.value} onChange={() => setConfidenceChoice(question.id, option.value)} />
              <span>{option.label}</span>
            </label>)}
          </div>
        </fieldset>
      </details>
    </QuizStage>
    {result && <p role="status" className={result.passed ? 'text-success' : 'text-destructive'}>Du hast {result.score.toFixed(1)}% erreicht. {result.passed ? 'Bestanden!' : 'Noch nicht bestanden.'}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {error && !staleVersion && <p className="text-sm text-muted-foreground">Deine Antworten sind bis zur Klärung gesperrt. Die erneute Prüfung verwendet dieselbe Abgabe.</p>}
    <div className={styles.actions}>
      <Button type="button" variant="outline" className={styles.backAction} disabled={pending || questionIndex === 0} onClick={() => goToQuestion(questionIndex - 1)}>Zurück</Button>
      {!lastQuestion ? <Button type="button" className={styles.primaryAction} disabled={pending} onClick={() => goToQuestion(questionIndex + 1)}>Weiter</Button>
        : result ? <Button type="button" variant="outline" className={styles.primaryAction} onClick={() => { pendingNavigationFocus.current = true; setAnswers({}); setConfidence({}); setQuestionIndex(0); setSubmitted(false); setResult(null); setRepeating(true); setError(null); pendingSubmission.current = null }}>Quiz wiederholen</Button>
          : <Button type="button" className={styles.primaryAction} disabled={!ready || pending || staleVersion || !publicationId || !contentVersionToken} onClick={() => void submit()}>{pending ? 'Wird geprüft …' : error && !staleVersion ? 'Abgabe erneut prüfen' : 'Antworten abgeben'}</Button>}
    </div>
    {lastQuestion && !ready && !result && <p className="text-center text-sm text-muted-foreground">Noch {questions.length - answeredCount} {questions.length - answeredCount === 1 ? 'Frage offen' : 'Fragen offen'}. Gehe zurück, um sie zu beantworten.</p>}
    {(!publicationId || !contentVersionToken) && <p className="text-sm text-muted-foreground">Bitte lade das Quiz neu, bevor du Antworten abgibst.</p>}
  </section>
}
