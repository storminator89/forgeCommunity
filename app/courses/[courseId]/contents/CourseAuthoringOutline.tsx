'use client'

import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Box, ChevronRight, ClipboardPenLine, FileText, FolderInput, HelpCircle, MoreHorizontal, Music, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { authoringOutline, CONTENT_TYPE_LABELS } from './authoring-outline'
import type { CourseContent } from './types'

export interface CourseAuthoringOutlineProps {
  contents: CourseContent[]
  selectedContentId: string | null
  onContentSelect: (id: string) => void
  onAddContent: (parentId: string | null) => void
  onRename: (id: string, title: string) => Promise<void>
  onMoveContent: (id: string) => void
  onReorder: (id: string, direction: 'up' | 'down', parentId: string | null) => Promise<void>
  onDelete: (content: CourseContent) => Promise<void>
  disabled?: boolean
  requestAction?: (action: () => void) => void
  staged?: boolean
}

const icons = { TEXT: FileText, VIDEO: Video, AUDIO: Music, H5P: Box, QUIZ: HelpCircle, ASSIGNMENT: ClipboardPenLine }

/** Author-only structure tool. The shell owns permissions, writes and dirty decisions. */
export function CourseAuthoringOutline({ contents, selectedContentId, onContentSelect, onAddContent, onRename, onMoveContent, onReorder, onDelete, disabled = false, requestAction, staged = false }: CourseAuthoringOutlineProps) {
  const entries = useMemo(() => authoringOutline(contents), [contents])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renameTarget, setRenameTarget] = useState<CourseContent | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CourseContent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pending = useRef(false)
  const returnFocus = useRef<string | null>(null)
  const blocked = disabled || busy
  const leaves = entries.filter(entry => entry.childCount === 0).length
  const request = (action: () => void) => {
    if (blocked || pending.current) return
    if (requestAction) requestAction(action)
    else action()
  }
  const run = async (action: () => Promise<void>, success: string, after?: () => void) => {
    if (pending.current || disabled) return
    pending.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try { await action(); setNotice(success); after?.() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Änderung konnte nicht gespeichert werden.') }
    finally { pending.current = false; setBusy(false) }
  }
  const restoreFocus = (event: Event) => {
    const element = (returnFocus.current ? document.getElementById(returnFocus.current) : null) || document.getElementById('course-authoring-add')
    if (element) { event.preventDefault(); element.focus() }
  }
  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
    <div className="shrink-0 space-y-3 border-b px-4 py-4">
      <div><h2 className="text-sm font-semibold">Kursstruktur</h2><p className="mt-1 text-xs text-muted-foreground">{entries.length} {entries.length === 1 ? 'Eintrag' : 'Einträge'} · {leaves} {leaves === 1 ? 'Lerninhalt' : 'Lerninhalte'}</p></div>
      <Button id="course-authoring-add" type="button" variant="outline" className="w-full justify-start gap-2" disabled={blocked} onClick={() => request(() => onAddContent(null))}><Plus className="h-4 w-4" aria-hidden="true" />Inhalt hinzufügen</Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-busy={busy}>
      {entries.length === 0 ? <div className="space-y-2 px-2 py-5"><p className="text-sm font-medium">Dein Kurs beginnt hier.</p><p className="text-sm text-muted-foreground">Lege den ersten Inhalt an. Weitere Inhalte kannst du darunter einordnen.</p></div> : <nav aria-label="Kursstruktur bearbeiten"><ol className="space-y-1">
        {entries.filter(entry => !entry.ancestorIds.some(id => collapsed.has(id))).map(entry => {
          const { content } = entry
          const Icon = icons[entry.type]
          const expanded = !collapsed.has(content.id)
          return <li key={content.id} className="min-w-0" style={{ paddingInlineStart: `${Math.min(entry.depth, 3) * 10}px` }}>
            <div className={cn('min-w-0 rounded-lg border border-transparent px-2 py-2', selectedContentId === content.id ? 'border-primary/20 bg-accent/60' : 'hover:bg-muted/60')}>
              <div className="flex min-w-0 items-start gap-1">
                {entry.childCount > 0 ? <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`${expanded ? 'Einklappen' : 'Aufklappen'}: ${content.title}`} aria-expanded={expanded} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(content.id)) next.delete(content.id); else next.add(content.id); return next })}><ChevronRight className={cn('h-4 w-4', expanded && 'rotate-90')} aria-hidden="true" /></Button> : <span className="flex h-11 w-11 shrink-0 items-center justify-center"><Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></span>}
                <button type="button" disabled={blocked} aria-current={selectedContentId === content.id ? 'page' : undefined} title={entry.path.join(' / ')} className="min-h-11 min-w-0 flex-1 rounded-md px-1 py-1 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={() => request(() => onContentSelect(content.id))}>
                  <span className="mb-1 block truncate text-xs tabular-nums text-muted-foreground" aria-label={`Position ${entry.position}`}>{entry.position}</span>
                  <span className="line-clamp-2 break-words text-sm font-medium [overflow-wrap:anywhere]">{content.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{CONTENT_TYPE_LABELS[entry.type]}{entry.childCount ? ` · ${entry.childCount} Untereinträge` : ` · ${entry.readinessLabel}`}</span>
                </button>
                <DropdownMenu><DropdownMenuTrigger asChild><Button id={`outline-actions-${content.id}`} type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={blocked} aria-label={`Aktionen für ${content.title}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                  <DropdownMenuItem onSelect={() => request(() => onAddContent(content.id))}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Unterinhalt hinzufügen</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => request(() => { returnFocus.current = `outline-actions-${content.id}`; setRenameTitle(content.title); setError(null); setRenameTarget(content) })}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Umbenennen</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => request(() => onMoveContent(content.id))}><FolderInput className="mr-2 h-4 w-4" aria-hidden="true" />Verschieben …</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={entry.siblingIndex === 0} onSelect={() => request(() => { void run(() => onReorder(content.id, 'up', content.parentId), 'Reihenfolge gespeichert.') })}><ArrowUp className="mr-2 h-4 w-4" aria-hidden="true" />Nach oben</DropdownMenuItem>
                  <DropdownMenuItem disabled={entry.siblingIndex === entry.siblingCount - 1} onSelect={() => request(() => { void run(() => onReorder(content.id, 'down', content.parentId), 'Reihenfolge gespeichert.') })}><ArrowDown className="mr-2 h-4 w-4" aria-hidden="true" />Nach unten</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => request(() => { returnFocus.current = `outline-actions-${content.id}`; setError(null); setDeleteTarget(content) })}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Löschen …</DropdownMenuItem>
                </DropdownMenuContent></DropdownMenu>
              </div>
            </div>
          </li>
        })}
      </ol></nav>}
      {error && !renameTarget && !deleteTarget && <p role="alert" className="px-2 py-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="px-2 py-3 text-sm text-muted-foreground">{notice}</p>}
    </div>
    <p className="shrink-0 border-t px-4 py-3 text-xs text-muted-foreground">{staged ? 'Gespeicherte Entwürfe sind für Lernende noch nicht sichtbar.' : 'Gespeicherte Änderungen sind für eingeschriebene Lernende sichtbar.'}</p>
    <Dialog open={Boolean(renameTarget)} onOpenChange={open => { if (!open && !pending.current) { setRenameTarget(null); setError(null) } }}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={restoreFocus} onEscapeKeyDown={event => { if (pending.current) event.preventDefault() }} onPointerDownOutside={event => { if (pending.current) event.preventDefault() }}><DialogHeader><DialogTitle>Inhalt umbenennen</DialogTitle><DialogDescription>Nur der Titel ändert sich. Inhalt und Untereinträge bleiben erhalten.</DialogDescription></DialogHeader>
        <form className="min-w-0 space-y-4" aria-busy={busy} onSubmit={event => { event.preventDefault(); if (renameTarget && renameTitle.trim()) void run(() => onRename(renameTarget.id, renameTitle.trim()), 'Titel gespeichert.', () => setRenameTarget(null)) }}>
          <div className="space-y-2"><Label htmlFor="outline-rename-title">Titel</Label><Input id="outline-rename-title" autoFocus required maxLength={300} disabled={blocked} value={renameTitle} onChange={event => { setRenameTitle(event.target.value); setError(null) }} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={blocked} onClick={() => { setRenameTarget(null); setError(null) }}>Abbrechen</Button><Button type="submit" disabled={blocked || !renameTitle.trim()}>{busy ? 'Wird gespeichert …' : 'Speichern'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open && !pending.current) { setDeleteTarget(null); setError(null) } }}>
      <AlertDialogContent onCloseAutoFocus={restoreFocus}><AlertDialogHeader><AlertDialogTitle>Inhalt löschen</AlertDialogTitle><AlertDialogDescription className="break-words [overflow-wrap:anywhere]">{staged ? `„${deleteTarget?.title}“ und seine Unterinhalte werden aus dem Entwurf entfernt. Die veröffentlichte Fassung bleibt bis zur nächsten Veröffentlichung sichtbar.` : `„${deleteTarget?.title}“ und alle zugehörigen Unterinhalte werden dauerhaft gelöscht.`}</AlertDialogDescription></AlertDialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={blocked}>Abbrechen</AlertDialogCancel><AlertDialogAction disabled={blocked} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={event => { event.preventDefault(); if (deleteTarget) void run(() => onDelete(deleteTarget), staged ? 'Aus dem Entwurf entfernt.' : 'Inhalt gelöscht.', () => setDeleteTarget(null)) }}>{busy ? 'Wird gelöscht …' : 'Löschen'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>
}
