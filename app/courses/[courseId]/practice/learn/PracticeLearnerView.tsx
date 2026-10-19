'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { AppHeader, AppShell } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { PageState, RetryButton } from '@/components/page-state'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserNav } from '@/components/user-nav'
import { Button } from '@/components/ui/button'
import { PracticeAvailabilityNotice } from './PracticeAvailabilityNotice'
import type { PracticeLearnerState } from './practice-learner-api'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export type ConfidenceChoice = 'Sicher' | 'Eher sicher' | 'Unsicher' | 'Geraten' | null
export type LearnerQuestion = {
  reservationId: string
  prompt: string
  options: string[]
  objectiveTitle?: string
}
export type LearnerFeedback = {
  correct: boolean
  correctIndex?: number
  explanation?: string
  canContinue?: boolean
  submittedAnswer?: { reservationId: string; optionIndex: number }
}
export type LearnerStage = 'loading' | 'error' | 'forbidden' | 'unpublished' | 'archived' | 'off' | 'available' | 'paused' | 'idle' | 'question' | 'feedback' | 'done' | 'unavailable'

export type PracticeLearnerViewProps = {
  courseId: string
  stage: LearnerStage
  question?: LearnerQuestion | null
  feedback?: LearnerFeedback | null
  error?: string | null
  busy?: boolean
  onRetry?: () => void
  onEnable?: () => void
  onPause?: () => void
  onOptOut?: () => void
  onNext?: () => void
  onAnswer?: (optionIndex: number, confidence: ConfidenceChoice) => void
  onReset?: () => void
  nextLabel?: string
  canCloseSession?: boolean
  availabilityState?: PracticeLearnerState | null
  onRefresh?: () => void
}

const confidenceChoices = ['Sicher', 'Eher sicher', 'Unsicher', 'Geraten'] as const

function PrivacyNote({ atDecision = false }: { atDecision?: boolean }) {
  const Heading = atDecision ? 'h3' : 'h2'
  return <aside aria-labelledby="practice-private-heading" className={atDecision
    ? 'space-y-2 text-sm leading-relaxed text-muted-foreground'
    : 'min-w-0 space-y-2 border-t pt-5 text-sm leading-relaxed text-muted-foreground lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0'}>
    <Heading id="practice-private-heading" className="text-base font-semibold text-foreground">Privat und freiwillig</Heading>
    <p>Deine Antworten und deine optionale Sicherheitseinschätzung werden für deine private Übung gespeichert.</p>
    <p>Kein Einfluss auf Kursabschluss, Prüfungen, Zertifikate oder Belohnungen. Keine persönliche Übungsauswertung für Lehrende.</p>
    <details>
      <summary className="min-h-11 w-fit cursor-pointer rounded-lg py-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">Speicherung und Löschen</summary>
      <div className="space-y-2 pt-1">
        <p>Es gibt keine öffentlichen Punktestände.</p>
        <p>Private Übungsdaten werden nach 12 Kalendermonaten ohne Übungsaktivität zur automatischen Löschung fällig, technische Belege zur Antwortübermittlung nach 90 Tagen. Bei Störungen oder Rückstand kann sich die Löschung verzögern. Mit „Zurücksetzen“ löschst du deine Übungsdaten samt diesen technischen Belegen sofort.</p>
      </div>
    </details>
  </aside>
}

function PracticeQuestion({ question, busy, onAnswer }: { question: LearnerQuestion; busy: boolean; onAnswer?: PracticeLearnerViewProps['onAnswer'] }) {
  const [answer, setAnswer] = useState<number | null>(null)
  const [confidence, setConfidence] = useState<ConfidenceChoice>(null)
  const heading = useRef<HTMLLegendElement>(null)
  useEffect(() => { heading.current?.focus() }, [question.reservationId])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (answer !== null && !busy) onAnswer?.(answer, confidence)
  }
  return <form onSubmit={submit} className="space-y-7" aria-busy={busy}>
    {question.objectiveTitle && <p className="text-sm font-medium text-muted-foreground [overflow-wrap:anywhere]">{question.objectiveTitle}</p>}
    <fieldset className="space-y-4" disabled={busy}>
      <legend ref={heading} tabIndex={-1} className="text-xl font-semibold leading-snug tracking-tight outline-none [overflow-wrap:anywhere] sm:text-2xl">{question.prompt}</legend>
      <div className="space-y-2 pt-2">
        {question.options.map((option, index) => <label key={`${question.reservationId}:${index}`} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-base leading-relaxed has-[:checked]:border-primary has-[:checked]:bg-accent/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
          <input type="radio" name="practice-answer" value={index} checked={answer === index} onChange={() => setAnswer(index)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{option}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset className="border-t pt-5" disabled={busy}>
      <legend className="text-base font-semibold">Wie sicher bist du dir?</legend>
      <p className="mt-1 text-sm text-muted-foreground">Freiwillig. Du kannst diese Einschätzung überspringen.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {confidenceChoices.map(value => <label key={value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
          <input type="radio" name="practice-confidence" value={value} checked={confidence === value} onChange={() => setConfidence(value)} className="h-4 w-4 accent-primary" />
          {value}
        </label>)}
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
          <input type="radio" name="practice-confidence" value="skip" checked={confidence === null} onChange={() => setConfidence(null)} className="h-4 w-4 accent-primary" />
          Überspringen
        </label>
      </div>
    </fieldset>
    <div className="border-t pt-5">
      <Button type="submit" disabled={answer === null || busy} className="min-h-11">{busy ? 'Antwort wird gespeichert …' : 'Antwort prüfen'}</Button>
    </div>
  </form>
}

function PracticeFeedback({ feedback, question, busy, onNext, availabilityState }: { feedback: LearnerFeedback; question: LearnerQuestion; busy: boolean; onNext?: () => void; availabilityState?: PracticeLearnerState | null }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [question.reservationId])
  const correctOption = typeof feedback.correctIndex === 'number' && Number.isSafeInteger(feedback.correctIndex) &&
    feedback.correctIndex >= 0 && feedback.correctIndex < question.options.length ? question.options[feedback.correctIndex] : undefined
  const submittedIndex = feedback.submittedAnswer?.reservationId === question.reservationId ? feedback.submittedAnswer.optionIndex : undefined
  const submittedOption = typeof submittedIndex === 'number' && Number.isSafeInteger(submittedIndex) &&
    submittedIndex >= 0 && submittedIndex < question.options.length ? question.options[submittedIndex] : undefined
  const canCompare = submittedOption !== undefined && feedback.correct === (submittedIndex === feedback.correctIndex)
  return <div className="space-y-5" role="status" aria-live="polite">
    <p className="text-sm font-medium text-muted-foreground [overflow-wrap:anywhere]">{question.objectiveTitle || 'Rückmeldung zur Frage'}</p>
    <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none sm:text-2xl">{feedback.correct ? 'Diese Antwort passt.' : 'Eine andere Antwort war vorgesehen.'}</h2>
    <p className="text-base leading-relaxed [overflow-wrap:anywhere]">{question.prompt}</p>
    {correctOption !== undefined && (canCompare
      ? <dl className="space-y-3 border-l-2 border-border pl-4 text-base leading-relaxed">
        <div className="min-w-0">
          <dt className="text-sm font-medium text-muted-foreground">Deine Antwort</dt>
          <dd className="[overflow-wrap:anywhere]">{submittedOption}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sm font-medium text-muted-foreground">Vorgesehen</dt>
          <dd className="[overflow-wrap:anywhere]">{correctOption}</dd>
        </div>
      </dl>
      : <p className="border-l-2 border-border pl-4 text-base leading-relaxed [overflow-wrap:anywhere]">Vorgesehene Antwort: {correctOption}</p>)}
    {feedback.explanation && <p className="text-base leading-relaxed [overflow-wrap:anywhere]">{feedback.explanation}</p>}
    <div className="space-y-3 border-t pt-5">
      <div className="text-sm text-muted-foreground"><PracticeAvailabilityNotice state={availabilityState} /></div>
      <Button type="button" className="min-h-11" disabled={busy} onClick={onNext}>{busy ? 'Wird geladen …' : feedback.canContinue === false ? 'Für jetzt beenden' : 'Weitere Frage öffnen'}</Button>
      {feedback.canContinue !== false && <p className="mt-2 text-sm text-muted-foreground">Die nächste Frage wird erst geöffnet, wenn du fortfährst.</p>}
    </div>
  </div>
}

function StateSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="space-y-4" aria-labelledby="practice-state-heading">
    <h2 id="practice-state-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
    <div className="max-w-prose space-y-3 text-base leading-relaxed text-muted-foreground">{children}</div>
    {action && <div className="pt-2">{action}</div>}
  </section>
}

export function PracticeLearnerView({ courseId, stage, question, feedback, error, busy = false,
  onRetry, onEnable, onPause, onOptOut, onNext, onAnswer, onReset, nextLabel, canCloseSession = false, availabilityState, onRefresh }: PracticeLearnerViewProps) {
  const [pauseOpen, setPauseOpen] = useState(false)
  const [optOutOpen, setOptOutOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetInput, setResetInput] = useState('')
  const courseHref = `/courses/${encodeURIComponent(courseId)}/contents`
  const dataStage = stage === 'question' && question ? 'question' : stage === 'feedback' && question && feedback ? 'feedback' : stage
  const isEnableDecision = dataStage === 'available' || dataStage === 'paused'

  return <AppShell data-page-family="practice">
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader>
        <div className="app-header-row">
          <div className="app-header-title"><p className="text-sm text-muted-foreground">Kurs · freiwillige Übung</p><h1 className="[overflow-wrap:anywhere]">Privat üben</h1></div>
          <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
        </div>
      </AppHeader>
      <main id="page-content" tabIndex={-1} aria-busy={busy || stage === 'loading'} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="fc-page-container mx-auto max-w-5xl">
          <Link href={courseHref} className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Zum Kursinhalt</Link>
          <div className={`grid min-w-0 gap-10 ${isEnableDecision ? 'max-w-2xl' : 'lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)] lg:gap-12'}`}>
            <div className="fc-section-card min-w-0">
              {error && stage !== 'error' && <p role="alert" className="mb-5 rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive">{error}</p>}
              {dataStage === 'loading' && <PageState kind="loading" title="Übungen werden geladen" />}
              {dataStage === 'error' && <PageState kind="error" title="Übung konnte nicht geladen werden" description={error ?? undefined} action={onRetry && <RetryButton onClick={onRetry} />} />}
              {dataStage === 'forbidden' && <StateSection title="Kein Zugang zu dieser Übung"><p>Diese Übung ist nur für eingeschriebene Teilnehmende verfügbar.</p></StateSection>}
              {dataStage === 'unpublished' && <StateSection title="Kurs noch nicht veröffentlicht"><p>Für diesen Kurs gibt es noch keine veröffentlichte Lernversion.</p></StateSection>}
              {dataStage === 'archived' && <StateSection title="Bisheriger Übungspool archiviert"><p>Für die aktuelle Kursversion ist der frühere Übungspool nicht mehr verfügbar. Dein Kursinhalt bleibt erreichbar.</p></StateSection>}
              {dataStage === 'off' && <StateSection title="Noch keine Übung veröffentlicht"><p>Für die aktuelle Kursversion gibt es noch keinen veröffentlichten Übungspool.</p></StateSection>}
              {dataStage === 'available' && <StateSection title="In deinem Tempo wiederholen" action={<Button type="button" className="min-h-11" disabled={busy} onClick={onEnable}>{busy ? 'Wird eingeschaltet …' : 'Privates Üben einschalten'}</Button>}>
                <p>Standardmäßig ausgeschaltet. Du öffnest jede Frage selbst.</p>
                <PrivacyNote atDecision />
              </StateSection>}
              {dataStage === 'paused' && <StateSection title="Privates Üben ist pausiert" action={<Button type="button" className="min-h-11" disabled={busy} onClick={onEnable}>{busy ? 'Wird eingeschaltet …' : 'Üben wieder einschalten'}</Button>}>
                <p>Es werden keine neuen Fragen geöffnet. Deine bisherigen Übungsdaten bleiben gespeichert.</p>
                <PrivacyNote atDecision />
              </StateSection>}
              {dataStage === 'unavailable' && <StateSection title="Privates Üben gerade nicht verfügbar" action={<Button type="button" variant="outline" className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]" disabled={busy} onClick={onRefresh}>{busy ? 'Wird geprüft …' : 'Stand aktualisieren'}</Button>}><PracticeAvailabilityNotice state={availabilityState} /></StateSection>}
              {dataStage === 'idle' && <StateSection title="Bereit für eine Frage?" action={<Button type="button" className="min-h-11" disabled={busy} onClick={onNext}>{busy ? 'Frage wird geladen …' : nextLabel ?? 'Erste Frage öffnen'}</Button>}>
                <PracticeAvailabilityNotice state={availabilityState} /><p>Eine Frage wird erst ausgewählt, wenn du sie ausdrücklich öffnest.</p>
              </StateSection>}
              {dataStage === 'done' && <StateSection title="Gerade keine weitere Frage fällig"
                action={<div className="flex flex-wrap gap-3">
                  {canCloseSession && <Button type="button" className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]" disabled={busy} onClick={onNext}>{busy ? 'Sitzung wird abgeschlossen …' : 'Sitzung abschließen'}</Button>}
                  <Button type="button" variant="outline" className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]" disabled={busy} onClick={onRefresh}>{busy ? 'Wird geprüft …' : 'Stand aktualisieren'}</Button>
                </div>}>
                <PracticeAvailabilityNotice state={availabilityState} />
                <p>Du öffnest jede Frage selbst. Privates Üben bleibt eingeschaltet, bis du es pausierst.</p>
              </StateSection>}
              {dataStage === 'question' && question && <PracticeQuestion key={question.reservationId} question={question} busy={busy} onAnswer={onAnswer} />}
              {dataStage === 'feedback' && question && feedback && <PracticeFeedback question={question} feedback={feedback} busy={busy} onNext={onNext} availabilityState={availabilityState} />}
              {dataStage !== 'loading' && dataStage !== 'error' && dataStage !== 'forbidden' && <details className="mt-10 border-t pt-6">
                <summary className="w-fit cursor-pointer rounded-lg py-2 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Übung verwalten</summary>
                <div className="max-w-prose space-y-6 pt-4 text-sm leading-relaxed text-muted-foreground">
                  {(dataStage === 'idle' || dataStage === 'question' || dataStage === 'feedback' || dataStage === 'done' || dataStage === 'unavailable') && <div className="space-y-2"><h2 className="text-base font-semibold text-foreground">Vorübergehend pausieren</h2><p>Deine Zustimmung und bisherigen Übungsdaten bleiben bestehen. Es werden keine neuen Fragen geöffnet, bis du weitermachst.</p><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setPauseOpen(true)}>Üben pausieren</Button></div>}
                  {(dataStage === 'paused' || dataStage === 'idle' || dataStage === 'question' || dataStage === 'feedback' || dataStage === 'done' || dataStage === 'unavailable') && <div className="space-y-2 border-t pt-5"><h2 className="text-base font-semibold text-foreground">Privates Üben ausschalten</h2><p>Damit widerrufst du deine Zustimmung für neue Übungssitzungen. Bisherige Übungsdaten bleiben bis zum Zurücksetzen oder Ablauf der Aufbewahrungsfrist gespeichert.</p><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setOptOutOpen(true)}>Privates Üben ausschalten</Button></div>}
                  <div className="space-y-2 border-t pt-5"><h2 className="text-base font-semibold text-foreground">Übungsdaten zurücksetzen</h2><p>Das löscht deine gespeicherten Antworten und Sicherheitseinschätzungen, falls vorhanden. Pausieren oder Ausschalten lässt sie bestehen.</p><Button type="button" variant="ghost" className="min-h-11 text-destructive hover:text-destructive hover:bg-destructive/10" disabled={busy} onClick={() => setResetOpen(true)}><RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" />Übungsdaten zurücksetzen</Button></div>
                </div>
              </details>}
            </div>
            {!isEnableDecision && <PrivacyNote />}
          </div>
        </div>
      </main>
    </div>
    <AlertDialog open={pauseOpen} onOpenChange={setPauseOpen}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Privates Üben pausieren?</AlertDialogTitle><AlertDialogDescription>Es werden keine neuen Fragen geöffnet. Deine bisherigen Übungsdaten bleiben gespeichert. Du kannst später wieder einschalten.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Weiter üben</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { setPauseOpen(false); onPause?.() }}>Üben pausieren</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={optOutOpen} onOpenChange={setOptOutOpen}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Privates Üben ausschalten?</AlertDialogTitle><AlertDialogDescription>Es werden keine neuen Übungssitzungen gestartet. Deine bisherigen privaten Übungsdaten bleiben gespeichert und lassen sich separat zurücksetzen. Wenn du später wieder üben willst, musst du es neu einschalten.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { setOptOutOpen(false); onOptOut?.() }}>Privates Üben ausschalten</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={open => { setResetOpen(open); if (!open) setResetInput('') }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Übungsdaten endgültig löschen?</AlertDialogTitle><AlertDialogDescription>Deine Antworten und Sicherheitseinschätzungen zu diesem Kurs werden gelöscht und lassen sich nicht wiederherstellen. Auch die technischen Belege zur Antwortübermittlung werden gelöscht. Privates Üben wird ausgeschaltet. Du kannst später neu beginnen.</AlertDialogDescription></AlertDialogHeader><div className="space-y-2"><label htmlFor="practice-reset-confirmation" className="text-sm font-medium">Zur Bestätigung RESET eingeben</label><input id="practice-reset-confirmation" autoComplete="off" value={resetInput} onChange={event => setResetInput(event.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div><AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction disabled={busy || resetInput !== 'RESET'} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { setResetOpen(false); setResetInput(''); onReset?.() }}>Übungsdaten endgültig löschen</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </AppShell>
}
