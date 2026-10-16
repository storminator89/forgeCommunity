'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { parseLearnerQuizContent, parseQuizContent, type LearnerQuizContent } from './types'

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
  if (publicQuiz) return publicQuiz
  // Course editors may also be enrolled. Strip their editor-only answer key
  // before handing the questions to the learner interface.
  const full = parseQuizContent(value)
  if (!full) return null
  return {
    shuffleQuestions: full.shuffleQuestions ?? false,
    passingScore: full.passingScore ?? 70,
    questions: full.questions.map(question => {
      const base = { id: question.id, type: question.type, question: question.question }
      switch (question.type) {
        case 'SINGLE_CHOICE': case 'MULTIPLE_CHOICE': case 'TRUE_FALSE': return { ...base, options: [...question.options] }
        case 'MATCHING': return { ...base, pairs: question.pairs.map(pair => ({ left: pair.left })) }
        case 'FILL_BLANKS': return { ...base, text: question.text, blankCount: question.answers.length }
        case 'TEXT_INPUT': return base
      }
    }),
  } as LearnerQuizContent
}

function submissionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `attempt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

type LearnerQuizProps = {
  courseId: string
  contentId: string
  updatedAt: string | undefined
  publicationId?: string | null
  contentVersionToken?: string | null
  content: unknown
  onPassed: () => void
}

export function LearnerQuizRenderer(props: LearnerQuizProps) {
  // A new publication or content version starts a fresh attempt, including the
  // optional pre-submission evidence. The caller may also render us directly.
  const version = JSON.stringify([props.courseId, props.contentId, props.publicationId, props.contentVersionToken, props.updatedAt])
  return <LearnerQuizSession key={version} {...props} />
}

function LearnerQuizSession({ courseId, contentId, publicationId, contentVersionToken, content, onPassed }: LearnerQuizProps) {
  const quiz = learnerQuiz(content)
  const prefix = useId()
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [confidence, setConfidence] = useState<Record<string, ConfidenceChoice>>({})
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<Grade | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [staleVersion, setStaleVersion] = useState(false)
  const pendingSubmission = useRef<Submission | null>(null)
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
  if (!quiz?.questions.length) return <p role="alert">Dieses Quiz ist noch nicht verfügbar.</p>

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
  const ready = questions.every(question => {
    const answer = answers[question.id]
    switch (question.type) {
      case 'SINGLE_CHOICE': case 'TRUE_FALSE': return Array.isArray(answer) && answer.length === 1
      case 'MULTIPLE_CHOICE': return Array.isArray(answer) && answer.length > 0
      case 'TEXT_INPUT': return typeof answer === 'string' && Boolean(answer.trim())
      case 'MATCHING': return Array.isArray(answer) && answer.length === question.pairs.length && answer.every(value => typeof value === 'string' && Boolean(value.trim()))
      case 'FILL_BLANKS': return Array.isArray(answer) && answer.length === question.blankCount && answer.every(value => typeof value === 'string' && Boolean(value.trim()))
    }
  })
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

  return <section className="space-y-5" aria-label="Quiz">
    <div><h2 className="text-lg font-semibold">Quiz</h2><p className="text-sm text-muted-foreground">Beantworte alle Fragen. Deine Antworten werden am Ende geprüft. Bestehensgrenze: {quiz.passingScore}%.</p></div>
    {questions.map((question, questionIndex) => <fieldset key={question.id} disabled={pending || submitted || Boolean(result)} className="min-w-0 space-y-3 border-t pt-4">
      <legend className="min-w-0 break-words font-medium">{questionIndex + 1}. {question.question}</legend>
      {(question.type === 'SINGLE_CHOICE' || question.type === 'TRUE_FALSE') && <RadioGroup value={Array.isArray(answers[question.id]) ? String((answers[question.id] as number[])[0] ?? '') : ''} onValueChange={value => setAnswer(question.id, [Number(value)])}>
        {question.options.map((option, index) => <div key={index} className="flex items-center gap-2"><RadioGroupItem value={String(index)} id={`${prefix}-${question.id}-${index}`} /><Label htmlFor={`${prefix}-${question.id}-${index}`}>{option}</Label></div>)}
      </RadioGroup>}
      {question.type === 'MULTIPLE_CHOICE' && question.options.map((option, index) => <div key={index} className="flex items-center gap-2"><Checkbox id={`${prefix}-${question.id}-${index}`} checked={Array.isArray(answers[question.id]) && (answers[question.id] as number[]).includes(index)} onCheckedChange={checked => { const current = Array.isArray(answers[question.id]) ? answers[question.id] as number[] : []; setAnswer(question.id, checked ? [...current, index].sort((a, b) => a - b) : current.filter(value => value !== index)) }} /><Label htmlFor={`${prefix}-${question.id}-${index}`}>{option}</Label></div>)}
      {question.type === 'TEXT_INPUT' && <Input aria-label={`Antwort zu Frage ${questionIndex + 1}`} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={event => setAnswer(question.id, event.target.value)} maxLength={1000} />}
      {question.type === 'MATCHING' && question.pairs.map((pair, index) => <div key={index} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"><Label htmlFor={`${prefix}-${question.id}-${index}`} className="sm:w-1/2">{pair.left}</Label><Input id={`${prefix}-${question.id}-${index}`} value={Array.isArray(answers[question.id]) ? (answers[question.id] as string[])[index] ?? '' : ''} onChange={event => { const values = Array.isArray(answers[question.id]) ? [...answers[question.id] as string[]] : []; values[index] = event.target.value; setAnswer(question.id, values) }} maxLength={1000} /></div>)}
      {question.type === 'FILL_BLANKS' && <><p className="text-sm">{question.text}</p>{Array.from({ length: question.blankCount }, (_, index) => <Input key={index} aria-label={`Frage ${questionIndex + 1}, Lücke ${index + 1}`} value={Array.isArray(answers[question.id]) ? (answers[question.id] as string[])[index] ?? '' : ''} onChange={event => { const values = Array.isArray(answers[question.id]) ? [...answers[question.id] as string[]] : []; values[index] = event.target.value; setAnswer(question.id, values) }} maxLength={1000} />)}</>}
      <fieldset className="min-w-0 space-y-2 pt-2">
        <legend className="text-sm font-medium">Wie sicher bist du dir? (freiwillig)</legend>
        <div className="grid min-w-0 grid-cols-1 gap-2 min-[375px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {confidenceOptions.map(option => <label key={option.value} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-[10px] border border-input bg-background px-3 py-2 text-sm hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
            <input
              type="radio"
              name={`${prefix}-${question.id}-confidence`}
              value={option.value}
              checked={confidence[question.id] === option.value}
              onChange={() => setConfidenceChoice(question.id, option.value)}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>)}
        </div>
      </fieldset>
    </fieldset>)}
    {result && <p role="status" className={result.passed ? 'text-success' : 'text-destructive'}>Du hast {result.score.toFixed(1)}% erreicht. {result.passed ? 'Bestanden!' : 'Noch nicht bestanden.'}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {error && !staleVersion && <p className="text-sm text-muted-foreground">Deine Antworten sind bis zur Klärung gesperrt. Die erneute Prüfung verwendet dieselbe Abgabe.</p>}
    <div className="flex flex-wrap gap-2">{result ? <Button type="button" variant="outline" onClick={() => { setAnswers({}); setConfidence({}); setSubmitted(false); setResult(null); setError(null); pendingSubmission.current = null }}>Quiz wiederholen</Button> : <Button type="button" disabled={!ready || pending || staleVersion || !publicationId || !contentVersionToken} onClick={() => void submit()}>{pending ? 'Wird geprüft …' : error && !staleVersion ? 'Abgabe erneut prüfen' : 'Antworten abgeben'}</Button>}{(!publicationId || !contentVersionToken) && <p className="text-sm text-muted-foreground">Bitte lade das Quiz neu, bevor du Antworten abgibst.</p>}</div>
  </section>
}
