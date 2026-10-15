'use client'

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { parseLearnerQuizContent, parseQuizContent, type LearnerQuizContent } from './types'

type Grade = { score: number; passed: boolean }
type Submission = { submissionId: string; answers: Record<string, unknown> }

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

export function LearnerQuizRenderer({ courseId, contentId, updatedAt, content, onPassed }: {
  courseId: string
  contentId: string
  updatedAt: string | undefined
  content: unknown
  onPassed: () => void
}) {
  const quiz = learnerQuiz(content)
  const prefix = useId()
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Grade | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingSubmission = useRef<Submission | null>(null)
  const sending = useRef(false)
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
    if (sending.current || result) return
    pendingSubmission.current = null
    setError(null)
    setAnswers(previous => ({ ...previous, [id]: value }))
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
    if (sending.current || !ready || !updatedAt) return
    sending.current = true
    setPending(true)
    setError(null)
    const submission = pendingSubmission.current ?? { submissionId: submissionId(), answers }
    pendingSubmission.current = submission
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}/attempts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...submission, contentUpdatedAt: updatedAt }),
      })
      if (!response.ok) {
        if (response.status === 409) throw new Error('Dieses Quiz wurde geändert. Bitte lade die Seite neu und versuche es erneut.')
        if (response.status === 429) throw new Error('Bitte sieh dir die Inhalte noch einmal an und versuche es später erneut.')
        if (response.status === 403) throw new Error('Du musst für diesen Kurs eingeschrieben sein.')
        throw new Error('Deine Antworten konnten nicht geprüft werden. Bitte versuche es erneut.')
      }
      const graded = await response.json() as Grade
      if (typeof graded.score !== 'number' || typeof graded.passed !== 'boolean') throw new Error('Das Quiz-Ergebnis konnte nicht gelesen werden.')
      setResult(graded)
      pendingSubmission.current = null
      if (graded.passed) onPassed()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Deine Antworten konnten nicht geprüft werden.') }
    finally { sending.current = false; setPending(false) }
  }

  return <section className="space-y-5" aria-label="Quiz">
    <div><h2 className="text-lg font-semibold">Quiz</h2><p className="text-sm text-muted-foreground">Beantworte alle Fragen. Deine Antworten werden am Ende geprüft. Bestehensgrenze: {quiz.passingScore}%.</p></div>
    {questions.map((question, questionIndex) => <fieldset key={question.id} disabled={pending || Boolean(result)} className="space-y-3 border-t pt-4">
      <legend className="font-medium">{questionIndex + 1}. {question.question}</legend>
      {(question.type === 'SINGLE_CHOICE' || question.type === 'TRUE_FALSE') && <RadioGroup value={Array.isArray(answers[question.id]) ? String((answers[question.id] as number[])[0] ?? '') : ''} onValueChange={value => setAnswer(question.id, [Number(value)])}>
        {question.options.map((option, index) => <div key={index} className="flex items-center gap-2"><RadioGroupItem value={String(index)} id={`${prefix}-${question.id}-${index}`} /><Label htmlFor={`${prefix}-${question.id}-${index}`}>{option}</Label></div>)}
      </RadioGroup>}
      {question.type === 'MULTIPLE_CHOICE' && question.options.map((option, index) => <div key={index} className="flex items-center gap-2"><Checkbox id={`${prefix}-${question.id}-${index}`} checked={Array.isArray(answers[question.id]) && (answers[question.id] as number[]).includes(index)} onCheckedChange={checked => { const current = Array.isArray(answers[question.id]) ? answers[question.id] as number[] : []; setAnswer(question.id, checked ? [...current, index].sort((a, b) => a - b) : current.filter(value => value !== index)) }} /><Label htmlFor={`${prefix}-${question.id}-${index}`}>{option}</Label></div>)}
      {question.type === 'TEXT_INPUT' && <Input aria-label={`Antwort zu Frage ${questionIndex + 1}`} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={event => setAnswer(question.id, event.target.value)} maxLength={1000} />}
      {question.type === 'MATCHING' && question.pairs.map((pair, index) => <div key={index} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"><Label htmlFor={`${prefix}-${question.id}-${index}`} className="sm:w-1/2">{pair.left}</Label><Input id={`${prefix}-${question.id}-${index}`} value={Array.isArray(answers[question.id]) ? (answers[question.id] as string[])[index] ?? '' : ''} onChange={event => { const values = Array.isArray(answers[question.id]) ? [...answers[question.id] as string[]] : []; values[index] = event.target.value; setAnswer(question.id, values) }} maxLength={1000} /></div>)}
      {question.type === 'FILL_BLANKS' && <><p className="text-sm">{question.text}</p>{Array.from({ length: question.blankCount }, (_, index) => <Input key={index} aria-label={`Frage ${questionIndex + 1}, Lücke ${index + 1}`} value={Array.isArray(answers[question.id]) ? (answers[question.id] as string[])[index] ?? '' : ''} onChange={event => { const values = Array.isArray(answers[question.id]) ? [...answers[question.id] as string[]] : []; values[index] = event.target.value; setAnswer(question.id, values) }} maxLength={1000} />)}</>}
    </fieldset>)}
    {result && <p role="status" className={result.passed ? 'text-foreground' : 'text-destructive'}>Du hast {result.score.toFixed(1)}% erreicht. {result.passed ? 'Bestanden!' : 'Noch nicht bestanden.'}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">{result ? <Button type="button" variant="outline" onClick={() => { setAnswers({}); setResult(null); setError(null); pendingSubmission.current = null }}>Quiz wiederholen</Button> : <Button type="button" disabled={!ready || pending || !updatedAt} onClick={() => void submit()}>{pending ? 'Wird geprüft …' : 'Antworten abgeben'}</Button>}{!updatedAt && <p className="text-sm text-muted-foreground">Bitte lade das Quiz neu, bevor du Antworten abgibst.</p>}</div>
  </section>
}
