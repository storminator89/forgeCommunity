'use client'

/* Hallmark · component: course review · genre: editorial/utilitarian · theme: design.md
 * Pre-emit critique: P5 H4 E4 S5 R5 V4. Tokens and controls inherit the locked system.
 */
import { useId } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CourseContent } from './types'
import { getCourseReadiness } from './course-readiness'

export interface CourseReadinessPanelProps {
  contents: CourseContent[]
  hasUnsavedChanges?: boolean
  onSelectContent?: (contentId: string) => void
  disabled?: boolean
}

export function CourseReadinessPanel({ contents, hasUnsavedChanges = false, onSelectContent, disabled = false }: CourseReadinessPanelProps) {
  const headingId = useId()
  const readiness = getCourseReadiness(contents)
  return <section aria-labelledby={headingId} aria-busy={disabled} className="min-w-0 space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
    <div className="space-y-2">
      <h2 id={headingId} className="text-lg font-semibold tracking-tight">Kurs prüfen</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">Gespeicherte Änderungen sind sofort für eingeschriebene Lernende sichtbar. Diese Prüfung ist eine Orientierung und veröffentlicht nichts.</p>
    </div>
    <dl className="flex flex-wrap gap-x-6 gap-y-3 border-y py-3 text-sm">
      <div><dt className="text-muted-foreground">Inhalte</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{readiness.totalContents}</dd></div>
      <div><dt className="text-muted-foreground">Lernthemen ohne Unterthemen</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{readiness.leafCount}</dd></div>
      <div><dt className="text-muted-foreground">Quiz</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{readiness.quizCount}</dd></div>
    </dl>
    {hasUnsavedChanges && <p role="status" className="border-l-2 border-primary pl-3 text-sm leading-relaxed">Du hast ungespeicherte Änderungen. Die Prüfung zeigt den gespeicherten Stand; deinen lokalen Entwurf siehst du in der Vorschau.</p>}
    <div className="flex items-start gap-2 text-sm" role="status">
      {readiness.ready ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
      <p className="leading-relaxed">{readiness.ready ? 'Keine offenen Hinweise in den gespeicherten Inhalten. Prüfe Darstellung und Ablauf zusätzlich in der Vorschau.' : `${readiness.findings.length} ${readiness.findings.length === 1 ? 'Hinweis' : 'Hinweise'} zur Durchsicht.`}</p>
    </div>
    {readiness.findings.length > 0 && <ul className="divide-y" aria-label="Hinweise zum Kurs">
      {readiness.findings.map(finding => <li key={finding.id} className="min-w-0 py-4 first:pt-0 last:pb-0">
        <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{finding.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{finding.message}</p>
        {finding.contentId && onSelectContent && <Button type="button" variant="link" className="mt-1 min-h-11 max-w-full px-0" disabled={disabled} onClick={() => onSelectContent(finding.contentId!)} aria-label={`Thema öffnen: ${finding.title}`}>Thema öffnen</Button>}
      </li>)}
    </ul>}
  </section>
}
