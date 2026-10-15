'use client'

/* Hallmark · authoring workbench · theme: design.md
 * Pre-emit critique: P5 H4 E4 S5 R5 V4. Browser visual verification remains pending.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Check, ChevronLeft, ChevronRight, Edit, Eye, FileText, FolderInput, Plus, X } from 'lucide-react'
import { AppShell, AppHeader } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserNav } from '@/components/user-nav'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { PageState, RetryButton } from '@/components/page-state'
import { cn } from '@/lib/utils'
import { CourseContentsSidebar } from './CourseContentsSidebar'
import { CourseAuthoringOutline } from './CourseAuthoringOutline'
import { NewCourseContentDialog, type NewCourseContentInput } from './NewCourseContentDialog'
import { InstructorCoursePreview } from './InstructorCoursePreview'
import { CourseReadinessPanel } from './CourseReadinessPanel'
import { CoursePathOverview } from './CoursePathOverview'
import { EditContentForm } from './EditContentForm'
import { ContentRenderer } from './ContentRenderer'
import { parseQuizContent, type CourseContent, type CourseProgressSnapshot } from './types'
import { appendContent, editableFields, editableSignature, findContent, parentIds, removeContent, replaceContent } from './content-tree'

type CourseDetails = { id: string; name: string; canEdit: boolean }
type Notice = { type: 'success' | 'error'; message: string }
const typeNames: Record<CourseContent['type'], string> = { TEXT: 'Text', VIDEO: 'Video', AUDIO: 'Audio', H5P: 'H5P', QUIZ: 'Quiz' }

// The quiz editor emits normalized object drafts, including on mount. Compare
// logical quiz values so JSON storage/defaults do not create false dirty states.
function authoringSignature(content: CourseContent): string {
  const quiz = content.type === 'QUIZ' || content.type === 'TEXT' ? parseQuizContent(content.content) : null
  return editableSignature(quiz ? { ...content, type: 'QUIZ', content: quiz } : content)
}

async function responseData<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
      403: 'Du hast keinen Zugriff auf diesen Kurs.',
      404: 'Der Kurs oder Inhalt ist nicht mehr verfügbar.',
      409: 'Der Inhalt wurde gleichzeitig geändert. Bitte lade die Ansicht erneut.',
      412: 'Der Inhalt wurde geändert. Bitte lade die Ansicht erneut, bevor du ihn abschließt.',
    }
    throw new Error(messages[response.status] || fallback)
  }
  return response.json() as Promise<T>
}

export function CourseContentsEditor({ courseId }: { courseId: string }) {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [course, setCourse] = useState<CourseDetails | null>(null)
  const [contents, setContents] = useState<CourseContent[]>([])
  const [progress, setProgress] = useState<CourseProgressSnapshot | null>(null)
  const [progressBusy, setProgressBusy] = useState(false)
  const progressLock = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CourseContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [mutating, setMutating] = useState(false)
  const mutationLock = useRef(false)
  const [topicsOpen, setTopicsOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(300)
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef({ x: 0, width: 300 })
  const [mode, setMode] = useState<'author' | 'learner'>('author')
  const [createOpen, setCreateOpen] = useState(false)
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  const [savedLiveId, setSavedLiveId] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const restoreSaveFocus = useRef(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveParent, setMoveParent] = useState('root')
  const [moveError, setMoveError] = useState<string | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)

  const selected = useMemo(() => selectedId ? findContent(contents, selectedId) : null, [contents, selectedId])
  const savedDraft = editingId ? findContent(contents, editingId) : null
  const dirty = Boolean(draft && savedDraft && authoringSignature(draft) !== authoringSignature(savedDraft))
  const canManage = Boolean(course?.canEdit && session?.user?.id)
  const authorMode = canManage && mode === 'author'
  const completedIds = progress?.completedContentIds ?? []
  const selectedComplete = Boolean(selected && completedIds.includes(selected.id))
  const selectedTrackable = Boolean(!authorMode && selected && progress?.canTrack && !selected.subContents?.length && selected.type !== 'QUIZ')

  const refreshProgress = useCallback(async () => {
    const response = await fetch(`/api/courses/${courseId}/progress`)
    const snapshot = await responseData<CourseProgressSnapshot>(response, 'Der Kursfortschritt konnte nicht geladen werden.')
    setProgress(snapshot)
    return snapshot
  }, [courseId])

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/contents`)}`)
  }, [courseId, router, status])

  useEffect(() => {
    if (status !== 'authenticated') return
    const controller = new AbortController()
    void Promise.all([
      fetch(`/api/courses/${courseId}`, { signal: controller.signal }).then(r => responseData<CourseDetails>(r, 'Kursinformationen konnten nicht geladen werden.')),
      fetch(`/api/courses/${courseId}/contents`, { signal: controller.signal }).then(r => responseData<CourseContent[]>(r, 'Kursinhalte konnten nicht geladen werden.')),
      fetch(`/api/courses/${courseId}/progress`, { signal: controller.signal }).then(r => responseData<CourseProgressSnapshot>(r, 'Der Kursfortschritt konnte nicht geladen werden.')),
    ]).then(([details, tree, snapshot]) => {
      if (controller.signal.aborted) return
      setCourse(details)
      setContents(tree)
      setProgress(snapshot)
      const requested = new URLSearchParams(location.search).get('content')
      const requestedContent = requested ? findContent(tree, requested) : null
      if (requestedContent) {
        setSelectedId(requestedContent.id)
        if (details.canEdit) { setEditingId(requestedContent.id); setDraft(requestedContent) }
      }
      setLoading(false)
    }).catch(error => {
      if (controller.signal.aborted) return
      setLoadError(error instanceof Error ? error.message : 'Der Kurs konnte nicht geladen werden.')
      setLoading(false)
    })
    return () => controller.abort()
  }, [courseId, retry, status])

  useEffect(() => {
    if (notice?.type !== 'success') return
    const timeout = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timeout)
  }, [notice])

  const requestNavigation = useCallback((action: () => void) => {
    if (mutationLock.current) return
    if (dirty) setPendingNavigation(() => () => {
      setEditingId(null)
      setDraft(null)
      setSavedLiveId(null)
      // Selecting the same row can restore the same editingId in this batch.
      // Force the form's local fields to remount from the saved content.
      setEditorVersion(value => value + 1)
      action()
    })
    else action()
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const interceptLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element)?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const destination = new URL(anchor.href, location.href)
      if (destination.origin !== location.origin || (destination.pathname === location.pathname && destination.search === location.search)) return
      event.preventDefault()
      event.stopPropagation()
      requestNavigation(() => router.push(destination.pathname + destination.search + destination.hash))
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', interceptLink, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', interceptLink, true)
    }
  }, [dirty, requestNavigation, router])

  useEffect(() => {
    if (!resizing) return
    const cursor = document.body.style.cursor
    const selection = document.body.style.userSelect
    const move = (event: MouseEvent) => setSidebarWidth(Math.max(220, Math.min(440, resizeStart.current.width + event.pageX - resizeStart.current.x)))
    const stop = () => setResizing(false)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', stop)
    return () => {
      document.body.style.cursor = cursor
      document.body.style.userSelect = selection
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', stop)
    }
  }, [resizing])

  const mutate = async <T,>(action: () => Promise<T>): Promise<T> => {
    if (!canManage) throw new Error('Du hast keine Berechtigung, diesen Kurs zu bearbeiten.')
    if (mutationLock.current) throw new Error('Eine Änderung wird gerade gespeichert. Bitte warte kurz.')
    mutationLock.current = true
    setMutating(true)
    try { return await action() }
    finally { mutationLock.current = false; setMutating(false) }
  }

  const selectContent = (id: string, edit = false) => {
    const content = findContent(contents, id)
    if (!content) return
    setSelectedId(id)
    setSavedLiveId(null)
    setEditingId(edit && canManage ? id : null)
    setDraft(edit && canManage ? { ...content } : null)
  }

  const setCompletion = async (contentId: string, completed: boolean, contentUpdatedAt?: string) => {
    if (authorMode || progressLock.current || !progress?.canTrack) return
    progressLock.current = true
    setProgressBusy(true)
    try {
      const response = await fetch(`/api/courses/${courseId}/progress`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId, completed, contentUpdatedAt }),
      })
      const changed = await responseData<Pick<CourseProgressSnapshot, 'completedContentIds' | 'complete'>>(response, 'Der Kursfortschritt konnte nicht gespeichert werden.')
      setProgress(previous => previous ? { ...previous, ...changed } : previous)
      setNotice({ type: 'success', message: completed ? 'Inhalt als abgeschlossen markiert.' : 'Abschlussmarkierung entfernt.' })
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Der Kursfortschritt konnte nicht gespeichert werden.' }) }
    finally { progressLock.current = false; setProgressBusy(false) }
  }

  const createContent = async ({ title, type, parentId: contentParentId }: NewCourseContentInput) => {
    if (!title.trim()) throw new Error('Bitte gib einen Titel ein.')
    return mutate(async () => {
      const created = await responseData<CourseContent>(await fetch(`/api/courses/${courseId}/contents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), type, content: '', parentId: contentParentId }),
      }), 'Der Inhalt konnte nicht angelegt werden. Bitte versuche es erneut.')
      setContents(previous => appendContent(previous, created))
      void refreshProgress().catch(() => {})
      setSelectedId(created.id)
      setEditingId(created.id)
      setDraft(created)
      setSavedLiveId(null)
      setNotice({ type: 'success', message: 'Inhalt angelegt. Der Eintrag ist für Teilnehmende sichtbar.' })
      return created
    })
  }

  const updateContent = async (updated: CourseContent) => mutate(async () => {
    const data = await responseData<CourseContent>(await fetch(`/api/courses/${courseId}/contents/${updated.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editableFields(updated)),
    }), 'Der Inhalt konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten.')
    setContents(previous => replaceContent(previous, data))
    void refreshProgress().catch(() => {})
    // Use the sanitized server response as both the saved and editable baseline.
    // Remount only after success so canonical values reach the form's local fields.
    // The submitting button is disabled during the request, so real browsers
    // can move focus to the body before this response arrives. A successful
    // form save always remounts the canonical fields; restore focus to its
    // replacement button regardless of that intermediate browser behavior.
    restoreSaveFocus.current = true
    setEditingId(data.id)
    setDraft(data)
    setEditorVersion(version => version + 1)
    setSavedLiveId(data.id)
    setNotice({ type: 'success', message: 'Inhalt gespeichert. Änderungen sind sofort für Teilnehmende sichtbar.' })
  })

  const deleteContent = async (content: CourseContent) => mutate(async () => {
    await responseData(await fetch(`/api/courses/${courseId}/contents/${content.id}`, { method: 'DELETE' }), 'Der Inhalt konnte nicht gelöscht werden.')
    const deletesSelected = selectedId && Boolean(findContent([content], selectedId))
    setContents(previous => removeContent(previous, content.id))
    void refreshProgress().catch(() => {})
    if (deletesSelected) { setSelectedId(null); setEditingId(null); setDraft(null) }
    setNotice({ type: 'success', message: 'Inhalt gelöscht.' })
  })

  const renameContent = async (id: string, title: string) => {
    if (!title.trim()) throw new Error('Bitte gib einen Titel ein.')
    await mutate(async () => {
      const updated = await responseData<CourseContent>(await fetch(`/api/courses/${courseId}/contents/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }),
      }), 'Der Titel konnte nicht gespeichert werden.')
      setContents(previous => replaceContent(previous, updated))
      void refreshProgress().catch(() => {})
      if (editingId === id) { setDraft(updated); setEditorVersion(version => version + 1) }
      setSavedLiveId(null)
      setNotice({ type: 'success', message: 'Titel gespeichert.' })
    })
  }

  const reorderContent = async (id: string, direction: 'up' | 'down', contentParentId: string | null) => {
    try {
      await mutate(async () => {
        const result = await responseData<{ contents?: CourseContent[] }>(await fetch(`/api/courses/${courseId}/contents/${id}/reorder`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction, mainContentId: contentParentId }),
        }), 'Die Reihenfolge konnte nicht gespeichert werden.')
        const tree = result.contents || await responseData<CourseContent[]>(await fetch(`/api/courses/${courseId}/contents`), 'Die Reihenfolge wurde gespeichert. Bitte lade die Ansicht erneut.')
        setContents(tree)
        void refreshProgress().catch(() => {})
        setNotice({ type: 'success', message: 'Reihenfolge gespeichert.' })
      })
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Die Reihenfolge konnte nicht gespeichert werden.' })
      throw error
    }
  }

  const moveTargets: Array<{ id: string; title: string }> = []
  const collectTargets = (items: CourseContent[], path = '') => items.forEach(item => {
    if (item.id === selectedId) return
    const title = path ? `${path} / ${item.title}` : item.title
    moveTargets.push({ id: item.id, title })
    collectTargets(item.subContents || [], title)
  })
  collectTargets(contents)

  const moveContent = async () => {
    if (!selected) return
    setMoveError(null)
    try {
      await mutate(async () => {
        const targetId = moveParent === 'root' ? contents.findLast(item => item.id !== selected.id)?.id : moveParent
        if (!targetId) throw new Error('Es ist kein passendes Ziel vorhanden.')
        const tree = await responseData<CourseContent[]>(await fetch(`/api/courses/${courseId}/contents/${selected.id}/move`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetId, position: moveParent === 'root' ? 'after' : 'inside' }),
        }), 'Der Inhalt konnte nicht verschoben werden.')
        setContents(tree)
        void refreshProgress().catch(() => {})
        setMoveOpen(false)
        setNotice({ type: 'success', message: 'Inhalt verschoben.' })
      })
    } catch (error) { setMoveError(error instanceof Error ? error.message : 'Der Inhalt konnte nicht verschoben werden.') }
  }

  useEffect(() => {
    if (loading) return
    const url = new URL(location.href)
    if (selectedId) url.searchParams.set('content', selectedId)
    else url.searchParams.delete('content')
    if (url.href !== location.href) history.replaceState(history.state, '', url)
  }, [loading, selectedId])

  useEffect(() => {
    if (!restoreSaveFocus.current) return
    restoreSaveFocus.current = false
    editorRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus()
  }, [editorVersion])

  const cancelEdit = () => requestNavigation(() => { setEditingId(null); setDraft(null); setSavedLiveId(null) })
  const changeMode = (nextMode: 'author' | 'learner') => {
    if (nextMode === mode) return
    requestNavigation(() => {
      setMode(nextMode)
      setEditingId(null)
      setDraft(null)
      setReviewOpen(false)
      if (nextMode === 'author' && selectedId) selectContent(selectedId, true)
    })
  }
  const openCreate = (contentParentId: string | null) => { setCreateParentId(contentParentId); setCreateOpen(true) }
  const openMove = (id: string) => {
    const content = findContent(contents, id)
    if (!content) return
    selectContent(id)
    setMoveParent(content.parentId || 'root')
    setMoveError(null)
    setMoveOpen(true)
  }
  const isLoading = status === 'loading' || (status === 'authenticated' && loading)

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex items-center justify-between gap-1 sm:gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
              <Button variant="outline" size="icon" aria-label={topicsOpen ? 'Inhaltsverzeichnis schließen' : 'Inhaltsverzeichnis öffnen'} aria-expanded={topicsOpen} aria-controls="course-contents-navigation" onClick={() => setTopicsOpen(value => !value)}>
                {topicsOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
              <h1 className="min-w-0 line-clamp-2 break-words [overflow-wrap:anywhere] max-sm:text-base" title={course?.name || 'Kursinhalt'}>{course?.name || 'Kursinhalt'}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>
        {notice && <div role={notice.type === 'error' ? 'alert' : 'status'} className={cn('mx-4 my-2 flex items-center justify-between gap-3 rounded-xl border px-4 py-2 text-sm', notice.type === 'error' ? 'border-destructive/30 text-destructive' : 'bg-card')}><span>{notice.message}</span><Button variant="ghost" size="icon" className="shrink-0" aria-label="Meldung schließen" onClick={() => setNotice(null)}><X className="h-4 w-4" /></Button></div>}
        <main id="page-content" tabIndex={-1} aria-busy={isLoading} className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? <PageState kind="loading" title="Kurs wird geladen" /> : loadError ? <PageState kind="error" title="Kurs konnte nicht geladen werden" description={loadError} action={<RetryButton onClick={() => { setLoading(true); setLoadError(null); setRetry(value => value + 1) }} />} /> : status === 'authenticated' ? (
            <div className="flex min-h-full flex-col md:h-full md:min-h-0">
              {canManage && <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
                <div role="group" aria-label="Kursansicht" className="flex max-w-full flex-wrap gap-2">
                  <Button type="button" size="sm" variant={authorMode ? 'default' : 'outline'} aria-pressed={authorMode} disabled={mutating || progressBusy} onClick={() => changeMode('author')}>Bearbeiten</Button>
                  <Button type="button" size="sm" variant={authorMode ? 'outline' : 'default'} aria-pressed={!authorMode} disabled={mutating || progressBusy} onClick={() => changeMode('learner')}>Lernen</Button>
                </div>
                {authorMode ? <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={mutating} onClick={() => setPreviewOpen(true)}><Eye aria-hidden="true" className="mr-2 h-4 w-4" />Vorschau</Button>
                  <Button type="button" variant="ghost" size="sm" aria-expanded={reviewOpen} aria-controls="course-review" disabled={mutating} onClick={() => setReviewOpen(open => !open)}><Check aria-hidden="true" className="mr-2 h-4 w-4" />Kurs prüfen</Button>
                </div> : <p className="text-sm text-muted-foreground">{progress?.canTrack ? 'Hier werden deine Antworten und dein Lernfortschritt gespeichert.' : 'Lernansicht des gespeicherten Kursinhalts.'}</p>}
              </div>}
              <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <div id="course-contents-navigation" className={cn('relative shrink-0 border-b bg-card md:border-b-0 md:border-r', topicsOpen ? 'w-full md:w-[var(--course-sidebar-width)]' : 'hidden')} style={{ '--course-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
                <div className="h-72 min-h-0 overflow-hidden md:h-full">
                  {authorMode ? <CourseAuthoringOutline contents={contents} selectedContentId={selectedId}
                    onContentSelect={id => selectContent(id, true)} onAddContent={openCreate}
                    onRename={renameContent} onMoveContent={openMove} onReorder={reorderContent}
                    onDelete={deleteContent} disabled={mutating} requestAction={requestNavigation} /> :
                    <CourseContentsSidebar contents={contents} selectedContentId={selectedId}
                      onContentSelect={id => { if (id !== selectedId) requestNavigation(() => selectContent(id)) }}
                      onEditClick={() => {}} onDeleteClick={() => {}} isInlineEditing={null} inlineEditTitle=""
                      onInlineEditSubmit={() => {}} setIsInlineEditing={() => {}} setInlineEditTitle={() => {}}
                      onMoveUp={() => {}} onMoveDown={() => {}} canManage={false} isMutating={mutating}
                      isProgressMutating={progressBusy} mainContentId={null} mainTopicIndex={0}
                      courseId={courseId} courseName={course?.name || ''} isLoading={false}
                      onSubContentSubmit={async () => {}} progress={progress}
                      onCertificateIssued={() => { void refreshProgress().catch(() => {}) }} />}
                </div>
                <div role="separator" aria-label="Breite des Inhaltsverzeichnisses" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={440} aria-valuenow={sidebarWidth} tabIndex={0} className="absolute right-0 top-0 hidden h-full w-4 cursor-col-resize border-r border-border focus-visible:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:block" onMouseDown={event => { resizeStart.current = { x: event.pageX, width: sidebarWidth }; setResizing(true) }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSidebarWidth(width => Math.max(220, Math.min(440, width + (event.key === 'ArrowLeft' ? -20 : 20)))) } }} />
              </div>
              <section className="min-w-0 flex-1 md:overflow-y-auto" aria-label="Ausgewählter Kursinhalt">
                {authorMode && reviewOpen && <div id="course-review" className="mx-auto w-full max-w-4xl space-y-6 p-4 pb-0 sm:p-6 sm:pb-0 lg:p-8 lg:pb-0">
                  <CourseReadinessPanel contents={contents} hasUnsavedChanges={dirty} disabled={mutating} onSelectContent={id => requestNavigation(() => { selectContent(id, true); setReviewOpen(false) })} />
                  <CoursePathOverview contents={contents} disabled={mutating} onContentSelect={id => requestNavigation(() => { selectContent(id, true); setReviewOpen(false) })} />
                </div>}
                {selected ? <div className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">
                  <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
                    <div className="min-w-0"><p className="mb-2 text-sm text-muted-foreground">{parentIds(contents, selected.id).reverse().map(id => findContent(contents, id)?.title).filter(Boolean).join(' / ') || typeNames[selected.type]}</p><h2 className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{selected.title}</h2></div>
                    {authorMode && !editingId && <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={mutating} onClick={() => selectContent(selected.id, true)}><Edit className="mr-2 h-4 w-4" />Inhalt bearbeiten</Button><Button variant="ghost" size="sm" disabled={mutating} onClick={() => requestNavigation(() => openMove(selected.id))}><FolderInput className="mr-2 h-4 w-4" />Verschieben</Button></div>}
                    {authorMode && editingId && <span className="text-xs text-muted-foreground" role="status">{dirty ? 'Ungespeicherte Änderungen' : 'Bearbeiten'}</span>}
                  </div>
                  {editingId === selected.id && authorMode ? <div ref={editorRef} className="rounded-xl border bg-card p-4 sm:p-6">
                    <EditContentForm key={`${selected.id}:${editorVersion}`} content={selected}
                      saveState={dirty ? 'dirty' : 'saved'}
                      saveMessage={`${savedLiveId === selected.id && !dirty ? 'Inhalt gespeichert. ' : ''}Gespeicherte Änderungen sind sofort für Teilnehmende sichtbar.`}
                      onSubmit={updateContent} onContentChange={change => {
                        setDraft(previous => previous ? { ...previous, ...change } : { ...selected, ...change })
                      }} onCancel={cancelEdit} />
                  </div> : <div className="space-y-6">{selected.type === 'TEXT' && typeof selected.content === 'string' && !selected.content.trim() ? <div className="space-y-3">{selected.subContents?.length ? <><h3 className="text-sm font-semibold">Themen in diesem Kapitel</h3>{selected.subContents.map(child => <button type="button" key={child.id} className="block min-h-11 w-full rounded-xl border bg-card p-4 text-left text-sm hover:border-input focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" onClick={() => requestNavigation(() => selectContent(child.id, authorMode))}>{child.title}</button>)}</> : <p className="text-sm text-muted-foreground">Für dieses Thema wurde noch kein Inhalt hinterlegt.</p>}</div> : <ContentRenderer key={selected.id} content={selected} learnerQuiz={!authorMode && Boolean(progress?.canTrack)} onQuizPassed={authorMode ? undefined : () => { void refreshProgress().catch(() => setNotice({ type: 'error', message: 'Quiz bestanden. Bitte lade den Fortschritt erneut.' })) }} />}{selectedTrackable && <div className="border-t pt-5"><Button type="button" variant={selectedComplete ? 'outline' : 'default'} disabled={progressBusy || mutating || (!selectedComplete && !selected.updatedAt)} onClick={() => void setCompletion(selected.id, !selectedComplete, selected.updatedAt)}>{progressBusy ? 'Wird gespeichert …' : selectedComplete ? 'Abschlussmarkierung entfernen' : 'Als abgeschlossen markieren'}</Button><p className="mt-2 text-sm text-muted-foreground">Bestätige selbst, wenn du diesen Inhalt abgeschlossen hast.</p></div>}</div>}
                </div> : <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"><FileText className="h-8 w-8 text-muted-foreground" /><h2 className="text-xl font-semibold">{contents.length ? 'Wähle ein Thema' : 'Noch keine Kursinhalte'}</h2><p className="text-sm text-muted-foreground">{contents.length ? authorMode ? 'Wähle in der Kursstruktur einen Inhalt zum Ausarbeiten.' : 'Die Inhalte findest du im Inhaltsverzeichnis.' : authorMode ? 'Lege in der Kursstruktur den ersten Inhalt an.' : 'Für diesen Kurs wurden noch keine Inhalte angelegt.'}</p>{authorMode && <Button type="button" disabled={mutating} onClick={() => requestNavigation(() => openCreate(null))}><Plus aria-hidden="true" className="mr-2 h-4 w-4" />Inhalt hinzufügen</Button>}</div>}
              </section>
              </div>
            </div>
          ) : <PageState kind="loading" title="Weiterleitung zur Anmeldung" />}
        </main>
      </div>
      {canManage && <>
        <NewCourseContentDialog open={createOpen} onOpenChange={setCreateOpen} parentId={createParentId} parentTitle={createParentId ? findContent(contents, createParentId)?.title : undefined} onCreate={createContent} disabled={mutating} />
        <InstructorCoursePreview open={previewOpen} onOpenChange={setPreviewOpen} courseTitle={course?.name || ''} contents={contents} selectedContentId={selectedId} draft={dirty ? draft : null} />
      </>}
      <Dialog open={moveOpen && canManage} onOpenChange={open => { if (!mutationLock.current) setMoveOpen(open) }}>
        <DialogContent onEscapeKeyDown={event => { if (mutationLock.current) event.preventDefault() }} onPointerDownOutside={event => { if (mutationLock.current) event.preventDefault() }}><DialogHeader><DialogTitle>Inhalt verschieben</DialogTitle><DialogDescription>„{selected?.title}“ wird mit seinen Unterthemen an das Ende des Ziels verschoben.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label htmlFor="move-parent">Ziel</Label><select id="move-parent" value={moveParent} disabled={mutating} onChange={event => setMoveParent(event.target.value)} className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"><option value="root">Oberste Ebene</option>{moveTargets.map(target => <option key={target.id} value={target.id}>{target.title}</option>)}</select></div>
          {moveError && <p role="alert" className="text-sm text-destructive">{moveError}</p>}
          <DialogFooter><Button variant="outline" disabled={mutating} onClick={() => setMoveOpen(false)}>Abbrechen</Button><Button disabled={mutating || moveParent === (selected?.parentId || 'root')} onClick={() => void moveContent()}>{mutating ? 'Wird verschoben …' : 'Verschieben'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null) }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle><AlertDialogDescription>Wenn du fortfährst, wird dein Entwurf verworfen. Der gespeicherte Inhalt bleibt erhalten.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingNavigation; setPendingNavigation(null); action?.() }}>Änderungen verwerfen</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}
