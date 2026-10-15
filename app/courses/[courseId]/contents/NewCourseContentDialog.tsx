'use client'

import { useId, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ContentTypeSelector } from './ContentTypeSelector'
import type { CourseContent } from './types'

export interface NewCourseContentInput { title: string; type: CourseContent['type']; parentId: string | null }
export interface NewCourseContentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  parentId: string | null
  parentTitle?: string
  onCreate: (input: NewCourseContentInput) => Promise<unknown>
  disabled?: boolean
}

/** Title and type are selected before the explicit, live create action. */
export function NewCourseContentDialog(props: NewCourseContentDialogProps) {
  const pending = useRef(false)
  // Unmount the local draft on close or parent change; never leak it to another target.
  return <Dialog open={props.open} onOpenChange={open => { if (!pending.current) props.onOpenChange(open) }}>
    {props.open && <NewCourseContentDraft key={props.parentId ?? 'root'} {...props} pendingRef={pending} />}
  </Dialog>
}

function NewCourseContentDraft({ onOpenChange, parentId, parentTitle, onCreate, disabled = false, pendingRef }: NewCourseContentDialogProps & { pendingRef: RefObject<boolean> }) {
  const id = useId()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<CourseContent['type']>('TEXT')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = disabled || saving
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || pendingRef.current || !title.trim()) return
    pendingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await onCreate({ title: title.trim(), type, parentId })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Der Inhalt konnte nicht angelegt werden. Deine Eingaben bleiben erhalten.')
    } finally { pendingRef.current = false; setSaving(false) }
  }
  return <DialogContent className="sm:max-w-xl" onEscapeKeyDown={event => { if (pendingRef.current) event.preventDefault() }} onPointerDownOutside={event => { if (pendingRef.current) event.preventDefault() }} onInteractOutside={event => { if (pendingRef.current) event.preventDefault() }}>
    <DialogHeader><DialogTitle>Inhalt hinzufügen</DialogTitle><DialogDescription className="break-words [overflow-wrap:anywhere]">{parentId ? `Unter „${parentTitle || 'Ausgewählter Inhalt'}“` : 'Auf der obersten Kursebene'}. Du kannst den Inhalt anschließend ausarbeiten.</DialogDescription></DialogHeader>
    <form onSubmit={submit} aria-label="Kursinhalt hinzufügen" aria-busy={saving} className="min-w-0 space-y-5">
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div className="space-y-2"><Label htmlFor={`${id}-title`}>Titel</Label><Input id={`${id}-title`} autoFocus required maxLength={300} value={title} onChange={event => { setTitle(event.target.value); setError(null) }} placeholder="Zum Beispiel: Willkommen im Kurs" /></div>
        <div className="space-y-2"><Label>Inhaltstyp</Label><ContentTypeSelector selectedType={type} onSelectType={next => { setType(next); setError(null) }} disabled={busy} showDescriptions /></div>
      </fieldset>
      <p className="text-sm text-muted-foreground">Mit „Anlegen“ wird der Eintrag für eingeschriebene Lernende sichtbar. Weitere Änderungen werden erst nach dem Speichern sichtbar.</p>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Abbrechen</Button><Button type="submit" disabled={busy || !title.trim()}>{saving ? 'Wird angelegt …' : 'Anlegen'}</Button></DialogFooter>
    </form>
  </DialogContent>
}
