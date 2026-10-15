'use client'

/* Hallmark · component: instructor preview · genre: editorial/utilitarian · theme: design.md
 * Pre-emit critique: P5 H4 E4 S5 R5 V4. Ephemeral reading workbench; existing tokens only.
 */
import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ContentRenderer } from './ContentRenderer'
import { QuizAuthorPreview } from './QuizAuthorPreview'
import { parseQuizContent, type CourseContent } from './types'
import { deriveInstructorPreviewTree, hasCourseTextContent } from './course-readiness'

export interface InstructorCoursePreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  courseTitle: string
  contents: CourseContent[]
  selectedContentId?: string | null
  draft?: CourseContent | null
  staged?: boolean
}

interface PreviewRow { content: CourseContent; depth: number; path: string[] }

function previewRows(contents: CourseContent[], depth = 0, path: string[] = []): PreviewRow[] {
  return contents.flatMap(content => [{ content, depth, path }, ...previewRows(content.subContents ?? [], depth + 1, [...path, content.title])])
}

export function InstructorCoursePreview({ open, onOpenChange, courseTitle, contents, selectedContentId, draft, staged = false }: InstructorCoursePreviewProps) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="h-[90dvh] w-[calc(100%_-_1rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:w-[calc(100%_-_2rem)]" onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }} onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus() }}>
      <DialogHeader className="border-b p-4 pr-14 sm:p-6 sm:pr-16">
        <DialogTitle>Kursvorschau</DialogTitle>
        <p className="break-words text-base font-medium [overflow-wrap:anywhere]">{courseTitle}</p>
        <DialogDescription className="leading-relaxed">{staged ? 'Entwurfsvorschau. Antworten und Abschlüsse werden nicht gespeichert. Der gespeicherte Entwurf ist für Lernende erst nach einer Veröffentlichung sichtbar.' : 'Nur zum Ausprobieren. Antworten und Abschlüsse werden nicht gespeichert. Gespeicherte Änderungen im Editor sind sofort für eingeschriebene Lernende sichtbar.'}</DialogDescription>
      </DialogHeader>
      {open && <PreviewContents contents={contents} selectedContentId={selectedContentId} draft={draft} />}
    </DialogContent>
  </Dialog>
}

function PreviewContents({ contents, selectedContentId, draft }: Pick<InstructorCoursePreviewProps, 'contents' | 'selectedContentId' | 'draft'>) {
  const tree = deriveInstructorPreviewTree(contents, draft)
  const rows = previewRows(tree)
  const [selection, setSelection] = useState(() => rows.some(row => row.content.id === selectedContentId) ? selectedContentId : rows[0]?.content.id)
  const selectedIndex = Math.max(0, rows.findIndex(row => row.content.id === selection))
  const selected = rows[selectedIndex]
  const titleRef = useRef<HTMLHeadingElement>(null)
  const previewingDraft = Boolean(draft && selected?.content.id === draft.id && selected.content.courseId === draft.courseId)
  const choose = (id: string) => {
    setSelection(id)
    titleRef.current?.focus()
  }

  if (!selected) return <div className="space-y-3 p-6 text-center sm:p-10"><BookOpen aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground" /><h3 className="text-lg font-semibold">Noch keine Inhalte für die Vorschau</h3><p className="text-sm leading-relaxed text-muted-foreground">Lege im Editor das erste Kapitel oder Thema an.</p></div>

  const emptyText = selected.content.type === 'TEXT' && typeof selected.content.content === 'string' && !hasCourseTextContent(selected.content.content)
  const previewQuiz = selected.content.type === 'QUIZ' || (selected.content.type === 'TEXT' && parseQuizContent(selected.content.content) !== null)
  return <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,9rem)_minmax(0,1fr)] overflow-hidden md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:grid-rows-1">
    <nav aria-label="Inhaltsverzeichnis der Vorschau" className="min-h-0 min-w-0 overflow-y-auto border-b bg-muted/30 p-3 md:border-b-0 md:border-r">
      <p className="px-3 pb-2 pt-1 text-sm font-semibold">Kursinhalt</p>
      <ol className="space-y-1">{rows.map(({ content, depth }, index) => <li key={content.id} className="min-w-0">
        <button type="button" title={content.title || 'Thema ohne Titel'} aria-current={content.id === selected.content.id ? 'page' : undefined} onClick={() => choose(content.id)} className={cn('flex min-h-11 w-full min-w-0 items-start gap-2 rounded-[10px] py-3 pr-3 text-left text-sm transition-colors hover:bg-accent active:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none', content.id === selected.content.id && 'bg-accent font-semibold text-accent-foreground')} style={{ paddingLeft: `${12 + Math.min(depth, 4) * 12}px` }}>
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">{index + 1}.</span><span className="min-w-0 flex-1 truncate"><span className="sr-only">Ebene {depth + 1}: </span>{content.title || 'Thema ohne Titel'}{draft?.id === content.id && draft.courseId === content.courseId && <span className="sr-only">, lokaler Entwurf</span>}</span>
        </button>
      </li>)}</ol>
    </nav>
    <section aria-label="Inhalt der Vorschau" className="min-h-0 min-w-0 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        {previewingDraft && <p role="status" className="border-l-2 border-primary pl-3 text-sm leading-relaxed">Ungespeicherter Entwurf. Diese Änderungen sind nur hier in deiner Vorschau enthalten.</p>}
        <header className="space-y-2 border-b pb-5">
          {selected.path.length > 0 && <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{selected.path.join(' / ')}</p>}
          <h3 ref={titleRef} tabIndex={-1} className="break-words text-xl font-semibold tracking-tight outline-hidden focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]">{selected.content.title || 'Thema ohne Titel'}</h3>
          <p className="text-sm text-muted-foreground">Inhalt {selectedIndex + 1} von {rows.length}</p>
        </header>
        {emptyText ? <div className="space-y-3 text-sm leading-relaxed text-muted-foreground"><p>{selected.content.subContents?.length ? 'Dieses Kapitel führt zu den folgenden Themen.' : 'Für dieses Thema fehlt noch der Lerninhalt.'}</p>{selected.content.subContents?.length ? <ul className="divide-y">{selected.content.subContents.map(child => <li key={child.id} className="min-w-0"><button type="button" title={child.title || 'Thema ohne Titel'} onClick={() => choose(child.id)} className="min-h-11 w-full truncate py-3 text-left font-medium text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{child.title || 'Thema ohne Titel'}</button></li>)}</ul> : null}</div> : previewQuiz ? <QuizAuthorPreview content={selected.content.content} /> : <ContentRenderer key={`${selected.content.id}:${JSON.stringify(selected.content.content)}`} content={selected.content} learnerQuiz={false} />}
        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={selectedIndex === 0} onClick={() => choose(rows[selectedIndex - 1].content.id)}><ArrowLeft aria-hidden="true" className="h-4 w-4" />Zurück</Button>
          <Button type="button" variant="outline" disabled={selectedIndex === rows.length - 1} onClick={() => choose(rows[selectedIndex + 1].content.id)}>Weiter<ArrowRight aria-hidden="true" className="h-4 w-4" /></Button>
        </div>
      </div>
    </section>
  </div>
}
