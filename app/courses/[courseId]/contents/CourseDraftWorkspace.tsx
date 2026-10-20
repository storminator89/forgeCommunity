'use client'

/* Hallmark · private author workbench · design.md. All writes use the staged author API. */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, BookOpen, Check, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Eye, ListChecks, Plus, RotateCcw, X } from 'lucide-react'
import { AppShell, AppHeader } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserNav } from '@/components/user-nav'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { CourseAuthoringOutline } from './CourseAuthoringOutline'
import { CoursePathOverview } from './CoursePathOverview'
import { CoursePrerequisitesEditor } from './CoursePrerequisitesEditor'
import { CourseChapterReleaseEditor } from './CourseChapterReleaseEditor'
import { chapterReleaseLabel } from '@/lib/course-release'
import { NewCourseContentDialog, type NewCourseContentInput } from './NewCourseContentDialog'
import { InstructorCoursePreview } from './InstructorCoursePreview'
import { EditContentForm } from './EditContentForm'
import { EMPTY_QUIZ } from './content-form-utils'
import { EMPTY_ASSIGNMENT } from './assignment-content'
import { findContent, parentIds } from './content-tree'
import { parseQuizContent, type CourseContent } from './types'
import {
  AuthoringError, authorTree, discardAuthorDraft, getAuthorState, getPublicationHistory,
  getPublicationReview, patchAuthorState, publishAuthorDraft, restorePublication, siblingIds,
  uploadDraftImage, type AuthorOperation, type AuthorPayload, type AuthorState,
  type PublicationRecord, type PublicationReview,
} from './authoring-api'

type Metadata = Pick<AuthorPayload, 'title' | 'description' | 'startDate' | 'endDate' | 'imageUrl'>
type Notice = { kind: 'success' | 'error'; text: string }

function metadata(payload: AuthorPayload): Metadata {
  return { title: payload.title, description: payload.description, startDate: payload.startDate, endDate: payload.endDate, imageUrl: payload.imageUrl }
}

function isoDate(value: string): string | null { return value ? `${value}T00:00:00.000Z` : null }
function dateInput(value: string | null): string { return value?.slice(0, 10) ?? '' }

function sameBody(a: string, b: string, courseId: string): boolean {
  if (a === b) return true
  const emptyHtml = (value: string) => !value.replace(/<(?:\/?p|br)\b[^>]*>/gi, '').replace(/&nbsp;|\u00a0/g, ' ').trim()
  if (emptyHtml(a) && emptyHtml(b)) return true
  const qa = parseQuizContent(a, courseId)
  const qb = parseQuizContent(b, courseId)
  return Boolean(qa && qb && JSON.stringify(qa) === JSON.stringify(qb))
}

function contentString(content: CourseContent['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

function editorDirty(saved: CourseContent | null, local: CourseContent | null): boolean {
  if (!saved || !local || saved.id !== local.id) return false
  return saved.title !== local.title || saved.type !== local.type || !sameBody(contentString(saved.content), contentString(local.content), saved.courseId)
}

export function CourseDraftWorkspace({ courseId, initialState, onLiveMode, canAuthorPractice = false }: { courseId: string; initialState: AuthorState; onLiveMode: () => void; canAuthorPractice?: boolean }) {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [meta, setMeta] = useState<Metadata>(() => metadata(initialState.draft.payload))
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('content'))
  const [localMediaPending, setLocalMediaPending] = useState(false)
  const [localContent, setLocalContent] = useState<CourseContent | null>(null)
  const [releaseBuffer, setReleaseBuffer] = useState<{ id: string; value: string } | null>(null)
  const [editorVersion, setEditorVersion] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [topicsOpen, setTopicsOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(300)
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef({ x: 0, width: 300 })
  const [createOpen, setCreateOpen] = useState(false)
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [review, setReview] = useState<PublicationReview | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRows, setHistoryRows] = useState<PublicationRecord[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveParent, setMoveParent] = useState('root')
  const [moveError, setMoveError] = useState<string | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)
  const [conflict, setConflict] = useState(false)
  const [comparison, setComparison] = useState<AuthorState | null>(null)
  const currentUrl = useRef(typeof location === 'undefined' ? '' : location.href)

  const tree = useMemo(() => authorTree(state.draft.payload, courseId), [state.draft.payload, courseId])
  const selected = selectedId ? findContent(tree, selectedId) : null
  const draftChanged = editorDirty(selected, localContent)
  const metadataChanged = JSON.stringify(meta) !== JSON.stringify(metadata(state.draft.payload))
  const releaseValue = releaseBuffer?.id === selected?.id ? releaseBuffer?.value ?? '' : selected?.releaseOn ?? ''
  const releaseChanged = Boolean(selected && releaseValue !== (selected.releaseOn ?? ''))
  const hasLocalChanges = draftChanged || metadataChanged || releaseChanged || localMediaPending
  let releaseRoot = selected
  while (releaseRoot?.parentId) releaseRoot = findContent(tree, releaseRoot.parentId)

  const unpublishedChanges = !state.activePublication || state.draft.digest !== state.activePublication.digest
  const selectedForPreview = draftChanged ? localContent : null

  const commitState = (next: AuthorState, resetBuffer = false) => {
    setState(next)
    setReview(null)
    setRequestId(null)
    setConflict(false)
    setComparison(null)
    if (resetBuffer) {
      setMeta(metadata(next.draft.payload))
      setLocalContent(null); setReleaseBuffer(null)
      setEditorVersion(value => value + 1)
    }
  }

  const mutate = async (operation: AuthorOperation, resetEditor = false): Promise<AuthorState> => {
    if (busyRef.current) throw new Error('Eine Änderung wird gerade gespeichert. Bitte warte kurz.')
    busyRef.current = true
    setBusy(true)
    try {
      const result = await patchAuthorState(courseId, state.draft.revision, operation)
      commitState(result)
      if (resetEditor) { setLocalContent(null); setEditorVersion(value => value + 1) }
      return result
    } catch (error) {
      if (error instanceof AuthoringError && (error.status === 412 || error.status === 409)) setConflict(true)
      throw error
    } finally { busyRef.current = false; setBusy(false) }
  }

  const showError = (error: unknown, fallback: string) => setNotice({ kind: 'error', text: error instanceof Error ? error.message : fallback })

  const saveMetadata = async () => {
    const patch = Object.fromEntries((Object.keys(meta) as Array<keyof Metadata>).filter(key => meta[key] !== state.draft.payload[key]).map(key => [key, meta[key]])) as Partial<Metadata>
    if (!Object.keys(patch).length) return
    try {
      const next = await mutate({ kind: 'setMetadata', patch })
      setMeta(metadata(next.draft.payload))
      setNotice({ kind: 'success', text: 'Entwurf gespeichert. Für Lernende noch nicht sichtbar.' })
    } catch (error) { showError(error, 'Die Kursdaten konnten nicht gespeichert werden.') }
  }

  const saveContent = async (updated: CourseContent) => {
    const original = state.draft.payload.contents.find(node => node.id === updated.id)
    if (!original) throw new Error('Dieser Inhalt ist nicht mehr im Entwurf. Bitte vergleiche den aktuellen Stand.')
    const patch: { title?: string; type?: CourseContent['type']; content?: string } = {}
    if (original.title !== updated.title) patch.title = updated.title
    if (original.type !== updated.type && !(original.type === null && updated.type === 'TEXT' && original.content === updated.content)) patch.type = updated.type
    const nextContent = typeof updated.content === 'string' ? updated.content : JSON.stringify(updated.content)
    if (!sameBody(original.content, nextContent, courseId)) patch.content = nextContent
    if (!Object.keys(patch).length) { setLocalContent(null); setEditorVersion(value => value + 1); return }
    await mutate({ kind: 'updateNode', id: updated.id, patch }, true)
    setNotice({ kind: 'success', text: 'Entwurf gespeichert. Für Lernende noch nicht sichtbar.' })
  }

  const createContent = async ({ title, type, parentId }: NewCourseContentInput) => {
    const siblings = siblingIds(state.draft.payload, parentId)
    const id = crypto.randomUUID()
    await mutate({ kind: 'insertNode', node: { id, title, type, content: type === 'QUIZ' ? JSON.stringify(EMPTY_QUIZ) : type === 'ASSIGNMENT' ? JSON.stringify(EMPTY_ASSIGNMENT) : '' }, parentId, afterId: siblings.at(-1) ?? null }, true)
    setSelectedId(id)
    setNotice({ kind: 'success', text: 'Inhalt im Entwurf angelegt. Für Lernende noch nicht sichtbar.' })
  }

  const renameContent = async (id: string, title: string) => {
    await mutate({ kind: 'updateNode', id, patch: { title } }, true)
    setNotice({ kind: 'success', text: 'Titel im Entwurf gespeichert.' })
  }

  const deleteContent = async (content: CourseContent) => {
    await mutate({ kind: 'deleteNode', id: content.id }, true)
    if (selectedId && findContent([content], selectedId)) setSelectedId(null)
    setNotice({ kind: 'success', text: 'Inhalt aus dem Entwurf entfernt. Die veröffentlichte Fassung bleibt vorerst sichtbar.' })
  }

  const setPrerequisites = async (id: string, prerequisiteIds: string[]) => {
    try {
      await mutate({ kind: 'setPrerequisites', id, prerequisiteIds })
      setNotice({ kind: 'success', text: 'Lernvoraussetzungen im Entwurf gespeichert.' })
    } catch (error) { showError(error, 'Die Lernvoraussetzungen konnten nicht gespeichert werden.') }
  }

  const saveRelease = async () => {
    if (!selected || selected.parentId !== null || !releaseChanged) return
    try {
      await mutate({ kind: 'setReleaseOn', id: selected.id, releaseOn: releaseValue || null })
      setReleaseBuffer(null)
      setNotice({ kind: 'success', text: 'Freigabe im Entwurf gespeichert.' })
    } catch (error) { showError(error, 'Die Freigabe konnte nicht gespeichert werden.') }
  }

  const reorderContent = async (id: string, direction: 'up' | 'down', parentId: string | null) => {
    const siblings = siblingIds(state.draft.payload, parentId)
    const index = siblings.indexOf(id)
    if (index < 0 || (direction === 'up' && index === 0) || (direction === 'down' && index === siblings.length - 1)) return
    const afterId = direction === 'up' ? siblings[index - 2] ?? null : siblings[index + 1]
    await mutate({ kind: 'moveNode', id, parentId, afterId })
    setNotice({ kind: 'success', text: 'Reihenfolge im Entwurf gespeichert.' })
  }

  const moveTargets: Array<{ id: string; title: string }> = []
  const collectTargets = (items: CourseContent[], path = '') => items.forEach(item => {
    if (item.id === selectedId) return
    const label = path ? `${path} / ${item.title}` : item.title
    moveTargets.push({ id: item.id, title: label })
    collectTargets(item.subContents ?? [], label)
  })
  collectTargets(tree)

  const moveContent = async () => {
    if (!selected) return
    setMoveError(null)
    try {
      const parentId = moveParent === 'root' ? null : moveParent
      const afterId = siblingIds(state.draft.payload, parentId, selected.id).at(-1) ?? null
      await mutate({ kind: 'moveNode', id: selected.id, parentId, afterId }, true)
      setMoveOpen(false)
      setNotice({ kind: 'success', text: 'Inhalt im Entwurf verschoben.' })
    } catch (error) { setMoveError(error instanceof Error ? error.message : 'Der Inhalt konnte nicht verschoben werden.') }
  }

  const requestNavigation = (action: () => void, includeMetadata = false) => {
    if (busyRef.current) return
    if (draftChanged || releaseChanged || localMediaPending || (includeMetadata && metadataChanged)) setPendingNavigation(() => action)
    else action()
  }

  const selectContent = (id: string | null) => requestNavigation(() => { setSelectedId(id); setLocalContent(null); setReleaseBuffer(null); setEditorVersion(value => value + 1) })

  useEffect(() => {
    const url = new URL(location.href)
    if (selectedId) url.searchParams.set('content', selectedId)
    else url.searchParams.delete('content')
    if (url.href !== location.href) history.replaceState(history.state, '', url)
    currentUrl.current = location.href
  }, [selectedId])

  useEffect(() => {
    if (!hasLocalChanges) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const popState = () => {
      const destination = new URL(location.href)
      if (destination.href === currentUrl.current) return
      // Restore the editor URL before Next's navigation can discard its buffer.
      history.pushState(history.state, '', currentUrl.current)
      setPendingNavigation(() => () => router.push(destination.pathname + destination.search + destination.hash))
    }
    const interceptLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element)?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const destination = new URL(anchor.href, location.href)
      if (destination.origin !== location.origin || destination.href === location.href) return
      event.preventDefault(); event.stopPropagation()
      const navigate = () => router.push(destination.pathname + destination.search + destination.hash)
      if (draftChanged || metadataChanged || releaseChanged || localMediaPending) setPendingNavigation(() => navigate)
      else navigate()
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('popstate', popState)
    document.addEventListener('click', interceptLink, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('popstate', popState); document.removeEventListener('click', interceptLink, true) }
  }, [hasLocalChanges, draftChanged, metadataChanged, releaseChanged, localMediaPending, router])

  useEffect(() => {
    if (!resizing) return
    const previousCursor = document.body.style.cursor
    const previousSelection = document.body.style.userSelect
    const move = (event: MouseEvent) => setSidebarWidth(Math.max(220, Math.min(440, resizeStart.current.width + event.pageX - resizeStart.current.x)))
    const stop = () => setResizing(false)
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', stop)
    return () => { document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelection; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stop) }
  }, [resizing])

  const openReview = async () => {
    if (hasLocalChanges || busyRef.current) { setNotice({ kind: 'error', text: 'Speichere oder verwirf zuerst deine lokalen Änderungen. Veröffentlicht wird nur der gespeicherte Entwurf.' }); return }
    setReviewOpen(true); setReview(null); setReviewBusy(true); setRequestId(crypto.randomUUID())
    try { setReview(await getPublicationReview(courseId, state.draft, state.activePublication)) }
    catch (error) { if (error instanceof AuthoringError && (error.status === 412 || error.status === 409)) setConflict(true); showError(error, 'Die Prüfung ist fehlgeschlagen.') }
    finally { setReviewBusy(false) }
  }

  const publish = async () => {
    if (!review?.ready || review.blockers.length || !requestId || hasLocalChanges || !unpublishedChanges || review.revision !== state.draft.revision || review.digest !== state.draft.digest || review.activePublicationId !== (state.activePublication?.id ?? null) || busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const result = await publishAuthorDraft(courseId, state.draft, state.activePublication, requestId)
      // Re-read the committed projection and synchronized draft. If this read fails,
      // keep the receipt visible rather than suggesting publication did not happen.
      try { commitState(await getAuthorState(courseId), true) }
      catch { setState(previous => ({ ...previous, activePublication: result.publication })) }
      setReviewOpen(false)
      setNotice({ kind: 'success', text: result.unchanged ? `Keine neuen Änderungen. Version ${result.publication.sequence} bleibt veröffentlicht.` : `Veröffentlicht · Version ${result.publication.sequence}.` })
    } catch (error) { if (error instanceof AuthoringError && (error.status === 412 || error.status === 409)) setConflict(true); showError(error, 'Die Veröffentlichung konnte nicht abgeschlossen werden.') }
    finally { busyRef.current = false; setBusy(false) }
  }

  const openHistory = async () => {
    setHistoryOpen(true); setHistoryBusy(true)
    try { setHistoryRows(await getPublicationHistory(courseId)) }
    catch (error) { showError(error, 'Der Versionsverlauf konnte nicht geladen werden.') }
    finally { setHistoryBusy(false) }
  }

  const restore = async () => {
    if (!restoreId || hasLocalChanges || busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const next = await restorePublication(courseId, restoreId, state.draft.revision)
      commitState(next, true); setRestoreId(null); setHistoryOpen(false); setSelectedId(null)
      setNotice({ kind: 'success', text: 'Version als neuen privaten Entwurf wiederhergestellt. Prüfe sie vor der Veröffentlichung.' })
    } catch (error) { if (error instanceof AuthoringError && error.status === 412) setConflict(true); showError(error, 'Die Version konnte nicht wiederhergestellt werden.') }
    finally { busyRef.current = false; setBusy(false) }
  }

  const discard = async () => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const next = await discardAuthorDraft(courseId, state.draft.revision)
      commitState(next, true); setDiscardOpen(false); setSelectedId(null)
      setNotice({ kind: 'success', text: state.activePublication ? 'Entwurf auf die veröffentlichte Fassung zurückgesetzt. Der Kurs wurde nicht gelöscht.' : 'Privaten Entwurf geleert. Der Kurs wurde nicht gelöscht.' })
    } catch (error) { if (error instanceof AuthoringError && error.status === 412) setConflict(true); showError(error, 'Der Entwurf konnte nicht verworfen werden.') }
    finally { busyRef.current = false; setBusy(false) }
  }

  const compare = async () => {
    try { setComparison(await getAuthorState(courseId)) }
    catch (error) { showError(error, 'Der aktuelle Entwurf konnte nicht geladen werden.') }
  }

  const reload = async () => {
    try {
      const next = comparison ?? await getAuthorState(courseId)
      commitState(next, true); setSelectedId(null)
      setNotice({ kind: 'success', text: 'Aktueller Entwurf geladen.' })
    } catch (error) { showError(error, 'Der aktuelle Entwurf konnte nicht geladen werden.') }
  }

  const uploadImage = async (file: File, signal?: AbortSignal) => {
    const result = await uploadDraftImage(courseId, file, signal)
    return result.url
  }

  const statusText = !state.activePublication ? 'Noch nicht veröffentlicht' : `Veröffentlicht · Version ${state.activePublication.sequence}`
  const localStatus = hasLocalChanges ? 'Ungespeicherte Änderungen' : 'Entwurf gespeichert'
  return <AppShell data-page-family="course-workspace">
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="app-header-row"><div className="app-header-title"><h1 className="line-clamp-2 break-words [overflow-wrap:anywhere] max-sm:text-base" title={meta.title || 'Kurs ohne Titel'}>{meta.title || 'Kurs ohne Titel'}</h1></div><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
      {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={cn('mx-4 my-2 flex items-center justify-between gap-3 rounded-xl border px-4 py-2 text-sm', notice.kind === 'error' ? 'border-destructive/40 text-destructive' : 'bg-card')}><span>{notice.text}</span><Button size="icon" variant="ghost" aria-label="Meldung schließen" onClick={() => setNotice(null)}><X className="h-4 w-4" /></Button></div>}
      <main id="page-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="fc-course-workspace flex min-h-full flex-col md:h-full md:min-h-0">
          <div className="fc-course-author-toolbar shrink-0 space-y-3 border-b px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="font-semibold">{statusText}</span>{unpublishedChanges && state.activePublication && <span className="text-muted-foreground">Unveröffentlichte Änderungen</span>}<span role="status" aria-live="polite" className={hasLocalChanges ? 'text-foreground' : 'text-muted-foreground'}>{localStatus}</span></div><div className="flex max-w-full flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy || !state.activePublication} onClick={() => requestNavigation(onLiveMode, true)}><BookOpen className="mr-2 h-4 w-4" />Lernen</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => setPreviewOpen(true)}><Eye className="mr-2 h-4 w-4" />Vorschau</Button><Button size="sm" disabled={busy || !unpublishedChanges || hasLocalChanges} onClick={() => void openReview()}>Änderungen veröffentlichen</Button></div></div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm"><Button variant="ghost" size="sm" disabled={busy} onClick={() => selectContent(null)}>Kursdaten</Button>{canAuthorPractice && <Button variant="ghost" size="sm" disabled={busy} onClick={() => requestNavigation(() => router.push(`/courses/${encodeURIComponent(courseId)}/practice`), true)}><ListChecks className="mr-2 h-4 w-4" />Übungspool</Button>}<Button variant="ghost" size="sm" disabled={busy} onClick={() => requestNavigation(() => router.push(`/courses/${encodeURIComponent(courseId)}/analytics`), true)}><BarChart3 className="mr-2 h-4 w-4" />Kursanalyse</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void openHistory()}><Clock3 className="mr-2 h-4 w-4" />Versionen</Button><Button variant="ghost" size="sm" disabled={busy || !state.activePublication} onClick={() => requestNavigation(() => router.push(`/courses/${encodeURIComponent(courseId)}/grading`), true)}><ClipboardCheck className="mr-2 h-4 w-4" />Abgaben bewerten</Button><Button variant="ghost" size="sm" disabled={busy || !unpublishedChanges} onClick={() => setDiscardOpen(true)}>Entwurf verwerfen</Button>{hasLocalChanges && <span className="text-muted-foreground">Speichere deine lokalen Änderungen vor der Veröffentlichung.</span>}</div>
          </div>
          {conflict && <section aria-label="Entwurfskonflikt" className="mx-4 my-3 space-y-3 rounded-xl border border-destructive/40 bg-card p-4 text-sm sm:mx-6"><h2 className="font-semibold">Der Entwurf wurde an anderer Stelle geändert</h2><p>Deine lokalen Eingaben bleiben erhalten. Lade den aktuellen Stand zum Vergleichen; Änderungen werden nicht automatisch zusammengeführt.</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void compare()}>Aktuellen Entwurf vergleichen</Button><Button variant="outline" size="sm" onClick={() => requestNavigation(() => void reload(), true)}>Aktuellen Entwurf laden</Button></div>{comparison && <p role="status">Deine Ansicht: Revision {state.draft.revision}, {state.draft.payload.contents.length} Inhalte. Aktueller Entwurf: Revision {comparison.draft.revision}, {comparison.draft.payload.contents.length} Inhalte. Kurstitel: „{comparison.draft.payload.title || 'Ohne Titel'}“. Lokale Eingaben werden erst durch „Aktuellen Entwurf laden“ verworfen.</p>}</section>}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div id="draft-course-navigation" className={cn('relative shrink-0 border-b bg-card md:border-b-0 md:border-r', topicsOpen ? 'w-full md:w-[var(--course-sidebar-width)]' : 'hidden')} style={{ '--course-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
              <div className="h-72 min-h-0 overflow-hidden md:h-full"><CourseAuthoringOutline staged contents={tree} selectedContentId={selectedId} onContentSelect={id => { setSelectedId(id); setLocalContent(null); setReleaseBuffer(null); setEditorVersion(value => value + 1) }} onAddContent={parentId => { setCreateParentId(parentId); setCreateOpen(true) }} onRename={renameContent} onMoveContent={id => { setSelectedId(id); setLocalContent(null); setReleaseBuffer(null); setMoveParent(state.draft.payload.contents.find(node => node.id === id)?.parentId ?? 'root'); setMoveOpen(true) }} onReorder={reorderContent} onDelete={deleteContent} disabled={busy} requestAction={action => requestNavigation(action)} /></div>
              <div role="separator" aria-label="Breite der Kursstruktur" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={440} aria-valuenow={sidebarWidth} tabIndex={0} className="absolute right-0 top-0 hidden h-full w-4 cursor-col-resize border-r border-border focus-visible:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:block" onMouseDown={event => { resizeStart.current = { x: event.pageX, width: sidebarWidth }; setResizing(true) }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSidebarWidth(width => Math.max(220, Math.min(440, width + (event.key === 'ArrowLeft' ? -20 : 20)))) } }} />
            </div>
            <section className="min-w-0 flex-1 md:overflow-y-auto" aria-label={selected ? 'Kursinhalt bearbeiten' : 'Kursdaten bearbeiten'}>
              <div className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">
                <Button type="button" variant="outline" size="sm" className="mb-5" aria-label={topicsOpen ? 'Kursstruktur schließen' : 'Kursstruktur öffnen'} aria-expanded={topicsOpen} aria-controls="draft-course-navigation" onClick={() => setTopicsOpen(value => !value)}>{topicsOpen ? <ChevronLeft className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}{topicsOpen ? 'Kursstruktur schließen' : 'Kursstruktur öffnen'}</Button>
                {selected ? <><div className="mb-6 border-b pb-5"><p className="mb-2 break-words text-sm text-muted-foreground">{parentIds(tree, selected.id).reverse().map(id => findContent(tree, id)?.title).filter(Boolean).join(' / ') || 'Kursinhalt'}</p><h2 className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{selected.title || 'Inhalt ohne Titel'}</h2></div><div className="rounded-xl border bg-card p-4 sm:p-6"><EditContentForm disabled={busy} key={`${selected.id}:${editorVersion}`} content={selected} staged onLocalMediaChange={setLocalMediaPending} saveState={draftChanged ? 'dirty' : 'saved'} saveMessage="Für Lernende noch nicht sichtbar. Veröffentliche den gespeicherten Entwurf später ausdrücklich." onImageUpload={uploadImage} onContentChange={change => setLocalContent(previous => ({ ...(previous?.id === selected.id ? previous : selected), ...change }))} onSubmit={saveContent} onCancel={() => requestNavigation(() => { setLocalContent(null); setReleaseBuffer(null); setEditorVersion(value => value + 1) })} />{releaseRoot && <CourseChapterReleaseEditor root={releaseRoot} selected={selected} value={releaseValue} busy={busy || draftChanged || localMediaPending} onChange={value => setReleaseBuffer({ id: selected.id, value })} onSave={() => void saveRelease()} onRootSelect={() => selectContent(releaseRoot!.id)} />}<CoursePrerequisitesEditor contents={tree} selected={selected} busy={busy || draftChanged || localMediaPending} onChange={ids => setPrerequisites(selected.id, ids)} /></div></> : <>
                  <div className="mb-7 border-b pb-5"><h2 className="text-2xl font-semibold tracking-tight">Kursdaten</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Änderungen am Entwurf werden erst nach einer ausdrücklichen Veröffentlichung für Lernende sichtbar.</p></div>
                  <form onSubmit={event => { event.preventDefault(); void saveMetadata() }} className="fc-section-card space-y-6" aria-label="Kursdaten bearbeiten" aria-busy={busy}>
                    <div className="space-y-2"><Label htmlFor="draft-course-title">Kurstitel</Label><Input id="draft-course-title" value={meta.title} maxLength={300} disabled={busy} onChange={event => setMeta(value => ({ ...value, title: event.target.value }))} /></div>
                    <div className="space-y-2"><Label htmlFor="draft-course-description">Kurskategorie</Label><Input id="draft-course-description" value={meta.description} disabled={busy} onChange={event => setMeta(value => ({ ...value, description: event.target.value }))} /></div>
                    <div className="grid min-w-0 gap-4 sm:grid-cols-2"><div className="min-w-0 space-y-2"><Label htmlFor="draft-course-start">Startdatum</Label><Input id="draft-course-start" type="date" value={dateInput(meta.startDate)} disabled={busy} onChange={event => setMeta(value => ({ ...value, startDate: isoDate(event.target.value) }))} /></div><div className="min-w-0 space-y-2"><Label htmlFor="draft-course-end">Enddatum</Label><Input id="draft-course-end" type="date" value={dateInput(meta.endDate)} disabled={busy} onChange={event => setMeta(value => ({ ...value, endDate: isoDate(event.target.value) }))} /></div></div>
                    <div className="space-y-2"><Label htmlFor="draft-course-image-url">Titelbild-URL</Label><Input id="draft-course-image-url" value={meta.imageUrl ?? ''} disabled={busy} onChange={event => setMeta(value => ({ ...value, imageUrl: event.target.value || null }))} placeholder="Bild hochladen oder URL eintragen" /><Label htmlFor="draft-course-image-upload" className="block">Neues privates Bild hochladen</Label><Input id="draft-course-image-upload" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadImage(file).then(url => setMeta(value => ({ ...value, imageUrl: url }))).catch(error => showError(error, 'Das Bild konnte nicht hochgeladen werden.')) }} />{meta.imageUrl?.startsWith(`/api/courses/${encodeURIComponent(courseId)}/assets/`) && <div className="w-full max-w-xs overflow-hidden rounded-lg border bg-muted/30 p-2">{/* Authenticated draft assets must bypass Next's image optimizer cache. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={meta.imageUrl} alt="Titelbild im privaten Entwurf" className="max-h-48 w-full object-contain" /></div>}<p className="text-sm text-muted-foreground">Neue Uploads bleiben geschützt, bis sie veröffentlicht werden. Bereits öffentliche oder externe Bild-URLs bleiben über ihre bisherigen Adressen erreichbar. Hochladen allein speichert den Entwurf noch nicht.</p></div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><span role="status" className="text-sm text-muted-foreground">{metadataChanged ? 'Ungespeicherte Änderungen' : 'Entwurf gespeichert'}</span><Button type="submit" disabled={busy || !metadataChanged}>{busy ? 'Wird gespeichert …' : 'Entwurf speichern'}</Button></div>
                  </form>
                  <div className="mt-8 space-y-6"><CoursePathOverview contents={tree} disabled={busy} onContentSelect={id => selectContent(id)} /><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { setCreateParentId(null); setCreateOpen(true) }}><Plus className="mr-2 h-4 w-4" />Inhalt hinzufügen</Button><Button variant="outline" disabled={busy} onClick={() => void openReview()}><Check className="mr-2 h-4 w-4" />Veröffentlichung prüfen</Button></div></div>
                </>}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
    <NewCourseContentDialog staged open={createOpen} onOpenChange={setCreateOpen} parentId={createParentId} parentTitle={createParentId ? findContent(tree, createParentId)?.title : undefined} onCreate={createContent} disabled={busy} />
    <InstructorCoursePreview staged open={previewOpen} onOpenChange={setPreviewOpen} courseTitle={meta.title} contents={tree} selectedContentId={selectedId} draft={selectedForPreview} />
    <Dialog open={moveOpen} onOpenChange={open => { if (!busyRef.current) setMoveOpen(open) }}><DialogContent><DialogHeader><DialogTitle>Inhalt verschieben</DialogTitle><DialogDescription>„{selected?.title}“ wird mit seinen Unterinhalten im Entwurf verschoben. Die Freigabe folgt dem Zielkapitel; auf der obersten Ebene gilt zunächst sofort.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="draft-move-parent">Ziel</Label><select id="draft-move-parent" value={moveParent} disabled={busy} onChange={event => setMoveParent(event.target.value)} className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"><option value="root">Oberste Ebene</option>{moveTargets.map(target => <option key={target.id} value={target.id}>{target.title}</option>)}</select></div>{moveError && <p role="alert" className="text-sm text-destructive">{moveError}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setMoveOpen(false)}>Abbrechen</Button><Button disabled={busy || moveParent === (selected?.parentId ?? 'root')} onClick={() => void moveContent()}>{busy ? 'Wird verschoben …' : 'Verschieben'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={reviewOpen} onOpenChange={open => { if (!busyRef.current) setReviewOpen(open) }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Veröffentlichung prüfen</DialogTitle><DialogDescription>Es wird ausschließlich der gespeicherte Entwurf veröffentlicht. Prüfe die Auswirkungen, bevor du fortfährst.</DialogDescription></DialogHeader>{reviewBusy ? <p role="status">Gespeicherten Entwurf prüfen …</p> : review ? <div className="space-y-5 text-sm"><div role="status" className={cn('rounded-lg border p-3', review.ready ? 'bg-card' : 'border-destructive/40')}><p className="font-semibold">{review.ready ? 'Bereit zur Veröffentlichung' : `${review.blockers.length} ${review.blockers.length === 1 ? 'Sperrgrund' : 'Sperrgründe'}`}</p>{review.blockers.length > 0 && <ul className="mt-2 list-inside list-disc space-y-1">{review.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}</div><dl className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div><dt>Neu</dt><dd className="text-lg font-semibold">{review.impact.added.length}</dd></div><div><dt>Entfernt</dt><dd className="text-lg font-semibold">{review.impact.removed.length}</dd></div><div><dt>Geändert</dt><dd className="text-lg font-semibold">{review.impact.changed.length}</dd></div><div><dt>Umbenannt/Sortiert</dt><dd className="text-lg font-semibold">{review.impact.renamedOrReordered.length}</dd></div></dl><div className="space-y-2 border-t pt-4"><h3 className="font-semibold">Auswirkungen für Lernende</h3><p>{review.impact.enrolledLearners} eingeschriebene Lernende folgen nach Veröffentlichung der neuesten Fassung.</p>{Boolean(review.impact.prerequisitesChanged?.length) && <p>{review.impact.prerequisitesChanged.length} Inhalte haben neue Lernvoraussetzungen. Frühere Abschlüsse bleiben gespeichert; abhängige Inhalte zählen erst wieder, wenn die aktuellen Voraussetzungen erfüllt sind.</p>}{Boolean(review.impact.releaseScheduleChanged?.length) && <div className="space-y-2"><p>Geänderte Freigaben · jeweils 00:00 UTC:</p><ul className="space-y-1 border-l-2 border-input pl-3">{review.impact.releaseScheduleChanged?.map(change => <li key={change.id} className="break-words [overflow-wrap:anywhere]">{change.title}: {change.before ? chapterReleaseLabel(change.before) : 'sofort'} → {change.after ? chapterReleaseLabel(change.after) : 'sofort'}</li>)}</ul><p>Bis zur Freigabe sind Zugriff, neue Lernaktionen und neue Zertifikate gesperrt. Bereits erworbene Abschlüsse und Belohnungen zählen bei unveränderten Inhalten weiter.</p></div>}{review.impact.completionMayChange && <p>Neue oder geänderte Lerninhalte können einen erneuten Abschluss in der aktuellen Fassung erfordern.</p>}{review.impact.rewardsMayChange && <p>Änderungen am Lernpfad oder an Bewertungen können bisherige Freigaben und Belohnungen beeinflussen.</p>}<p className="text-muted-foreground">Bisherige Lernaktivitäten bleiben erhalten. Bereits ausgestellte Zertifikate bleiben gültig; neue Zertifikate werden nicht automatisch ausgestellt.</p></div></div> : <p role="alert">Die Prüfung konnte nicht angezeigt werden. Schließe das Fenster und versuche es erneut.</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReviewOpen(false)}>Abbrechen</Button><Button disabled={busy || reviewBusy || !review?.ready || Boolean(review.blockers.length) || !unpublishedChanges || hasLocalChanges || review?.revision !== state.draft.revision || review?.digest !== state.draft.digest} onClick={() => void publish()}>{busy ? 'Wird veröffentlicht …' : 'Änderungen veröffentlichen'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={historyOpen} onOpenChange={open => { if (!busyRef.current) setHistoryOpen(open) }}><DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle>Veröffentlichte Versionen</DialogTitle><DialogDescription>Eine frühere Version wird als neuer privater Entwurf kopiert. Bestehende Lernaktivitäten und Zertifikate bleiben bestehen.</DialogDescription></DialogHeader>{historyBusy ? <p role="status">Versionen werden geladen …</p> : historyRows.length ? <ol className="divide-y border-y">{historyRows.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">Version {row.sequence}</p><p className="text-sm text-muted-foreground">{new Date(row.recordedAt).toLocaleString('de-DE')}</p></div><Button variant="outline" size="sm" disabled={busy || hasLocalChanges} onClick={() => setRestoreId(row.id)}><RotateCcw className="mr-2 h-4 w-4" />Als Entwurf wiederherstellen</Button></li>)}</ol> : <p className="text-sm text-muted-foreground">Noch keine Veröffentlichung vorhanden.</p>}{hasLocalChanges && <p className="text-sm text-muted-foreground">Speichere oder verwirf deine lokalen Änderungen vor dem Wiederherstellen.</p>}<DialogFooter><Button variant="outline" onClick={() => setHistoryOpen(false)}>Schließen</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={Boolean(restoreId)} onOpenChange={open => { if (!open && !busyRef.current) setRestoreId(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Version als Entwurf wiederherstellen?</AlertDialogTitle><AlertDialogDescription>Der aktuelle private Entwurf wird durch eine Kopie dieser Version ersetzt. Der veröffentlichte Kurs bleibt unverändert, bis du den neuen Entwurf ausdrücklich veröffentlichst.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel><AlertDialogAction disabled={busy || hasLocalChanges} onClick={event => { event.preventDefault(); void restore() }}>Als Entwurf wiederherstellen</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={discardOpen} onOpenChange={open => { if (!busyRef.current) setDiscardOpen(open) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Entwurf verwerfen?</AlertDialogTitle><AlertDialogDescription>{state.activePublication ? 'Der private Entwurf wird auf die veröffentlichte Fassung zurückgesetzt. Der Kurs und seine bisherigen Veröffentlichungen werden nicht gelöscht.' : 'Der private Entwurf samt Kursdaten und Inhalten wird geleert. Der Kurs bleibt bestehen und kann neu bearbeitet werden.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Weiter bearbeiten</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void discard() }}>Entwurf verwerfen</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle><AlertDialogDescription>Wenn du fortfährst, gehen deine lokalen Änderungen verloren. Der gespeicherte private Entwurf bleibt erhalten.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingNavigation; setPendingNavigation(null); setLocalContent(null); setReleaseBuffer(null); setMeta(metadata(state.draft.payload)); setLocalMediaPending(false); setEditorVersion(value => value + 1); action?.() }}>Lokale Änderungen verwerfen</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AppShell>
}
