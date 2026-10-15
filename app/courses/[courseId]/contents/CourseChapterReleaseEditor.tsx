'use client'

/* Hallmark · compact chapter scheduling · existing semantic tokens and SVG icons. */
import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { chapterReleaseLabel, isChapterReleaseDate } from '@/lib/course-release'
import type { CourseContent } from './types'

export function CourseChapterReleaseEditor({ root, selected, value, busy, onChange, onSave, onRootSelect }: {
  root: CourseContent; selected: CourseContent; value: string; busy: boolean
  onChange: (value: string) => void; onSave: () => void; onRootSelect: () => void
}) {
  const inherited = root.id !== selected.id
  return <section className="mt-6 space-y-3 border-t pt-5" aria-label="Kapitelfreigabe">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays aria-hidden="true" className="h-4 w-4 text-muted-foreground" />Kapitelfreigabe</h3>
    {inherited ? <div className="text-sm"><p className="text-muted-foreground">{root.releaseOn ? `Ab ${chapterReleaseLabel(root.releaseOn)}` : 'Sofort verfügbar'} · gilt für alle Unterthemen.</p><Button type="button" variant="link" className="h-auto min-h-11 max-w-full whitespace-normal px-0 text-left" disabled={busy} onClick={onRootSelect}>Im Kapitel „{root.title}“ ändern</Button></div> : <form aria-label="Kapitelfreigabe bearbeiten" className="space-y-3" onSubmit={event => { event.preventDefault(); if (!value || isChapterReleaseDate(value)) onSave() }}>
      <div className="flex min-w-0 flex-wrap items-end gap-3"><div className="min-w-0 flex-1 basis-44 space-y-2"><Label htmlFor="chapter-release-on">Freigabedatum · 00:00 UTC</Label><Input id="chapter-release-on" type="date" min="0001-01-01" max="9999-12-31" value={value} disabled={busy} onChange={event => onChange(event.target.value)} aria-describedby="chapter-release-hint" /></div><Button type="submit" variant="outline" disabled={busy || value === (root.releaseOn ?? '') || Boolean(value && !isChapterReleaseDate(value))}>Freigabe speichern</Button></div>
      <p id="chapter-release-hint" className="text-sm text-muted-foreground">Für alle Lernenden und Unterthemen. Leer: sofort. Wird erst mit dem Entwurf veröffentlicht.</p>
    </form>}
  </section>
}
