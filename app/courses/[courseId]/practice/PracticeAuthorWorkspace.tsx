'use client'

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4. Quiet course-author workbench; project design.md tokens. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Eye, History, Plus } from 'lucide-react'
import { AppHeader, AppShell } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageState, RetryButton } from '@/components/page-state'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserNav } from '@/components/user-nav'
import {
  PracticeApiError, createItem, createObjective, getItemRevision, getItems, getObjectives,
  getPracticePreview, getObjective, getItem,
  getPracticeHistory, getPracticeState, publishPractice, reviseItem, reviseObjective,
  savePracticeState, type PracticeChoice, type PracticeHistory, type PracticeItem,
  type PracticeObjective, type PracticePreviewItem, type PracticeRef, type PracticeSnapshot, type PracticeState,
} from './practice-api'

type ObjectiveInput = Pick<PracticeObjective, 'title' | 'description'>
type Conflict =
  | { scope: 'objective'; remote: PracticeObjective }
  | { scope: 'item'; remote: PracticeItem; choice: PracticeChoice }
  | { scope: 'draft' | 'publish'; remote: PracticeState }

const blankChoice = (): PracticeChoice => ({ type: 'SINGLE_CHOICE', prompt: '', options: ['', ''], correctIndex: 0, explanation: '' })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const formatDate = (value?: string) => value ? new Date(value).toLocaleString('de-DE') : ''
const labelFor = (index: number) => String.fromCharCode(65 + index)

export function PracticeAuthorWorkspace({ courseId, sessionStatus }: { courseId: string; sessionStatus: string }) {
  const router = useRouter()
  const [state, setState] = useState<PracticeState | null>(null)
  const [objectives, setObjectives] = useState<PracticeObjective[]>([])
  const [objectiveCursor, setObjectiveCursor] = useState<string | null>(null)
  const [objectivesPaging, setObjectivesPaging] = useState(false)
  const [objectiveId, setObjectiveId] = useState('')
  const [objectiveNew, setObjectiveNew] = useState(false)
  const [objectiveInput, setObjectiveInput] = useState<ObjectiveInput>({ title: '', description: '' })
  const [items, setItems] = useState<PracticeItem[]>([])
  const [itemCursor, setItemCursor] = useState<string | null>(null)
  const [itemsPaging, setItemsPaging] = useState(false)
  const [itemId, setItemId] = useState('')
  const [itemNew, setItemNew] = useState(false)
  const [itemRevision, setItemRevision] = useState(1)
  const [choice, setChoice] = useState<PracticeChoice | null>(null)
  const [choiceBaseline, setChoiceBaseline] = useState<PracticeChoice | null>(null)
  const [refs, setRefs] = useState<PracticeRef[]>([])
  const [previewRows, setPreviewRows] = useState<PracticePreviewItem[] | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewSignature, setReviewSignature] = useState<string | null>(null)
  const [history, setHistory] = useState<PracticeHistory | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyPaging, setHistoryPaging] = useState(false)
  const [receipt, setReceipt] = useState<PracticeSnapshot | null>(null)
  const [publishRequestId, setPublishRequestId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ text: string; status?: number } | null>(null)
  const [retry, setRetry] = useState(0)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemLoading, setItemLoading] = useState(false)
  const itemsRequest = useRef(0)
  const objectivesRequest = useRef(0)
  const choiceRequest = useRef(0)
  const previewRequest = useRef(0)

  const selectedObjective = objectives.find(row => row.id === objectiveId) ?? null
  const selectedItem = items.find(row => row.id === itemId) ?? null
  const objectiveDirty = objectiveNew ? Boolean(objectiveInput.title.trim() || objectiveInput.description.trim())
    : Boolean(selectedObjective && !same(objectiveInput, { title: selectedObjective.title, description: selectedObjective.description }))
  const itemDirty = itemNew ? Boolean(choice && (choice.prompt.trim() || choice.options.some(Boolean) || choice.explanation.trim()))
    : Boolean(choice && choiceBaseline && !same(choice, choiceBaseline))
  const refsDirty = Boolean(state && !same(refs, state.draft.payload.items))
  const currentReviewSignature = state && !refsDirty
    ? JSON.stringify([courseId, state.draft.revision, state.draft.payload.items, state.activeCoursePublicationId]) : null
  const hasLocalChanges = objectiveDirty || itemDirty || refsDirty
  const isCurrentItemRevision = Boolean(selectedItem && itemRevision === selectedItem.latestRevision)

  const loadItemsForObjective = useCallback(async (selectedId: string) => {
    const request = ++itemsRequest.current
    choiceRequest.current += 1
    setItemsLoading(true); setItems([]); setItemCursor(null); setItemsPaging(false); setItemId(''); setItemNew(false); setChoice(null); setChoiceBaseline(null); setItemLoading(false)
    try {
      const result = await getItems(selectedId)
      if (request === itemsRequest.current) { setItems(result.items); setItemCursor(result.nextCursor ?? null) }
    } catch (error) {
      if (request === itemsRequest.current) setNotice({ kind: 'error', text: message(error, 'Übungsfragen konnten nicht geladen werden.') })
    } finally {
      if (request === itemsRequest.current) setItemsLoading(false)
    }
  }, [])
  const loadOlderObjectives = async () => {
    if (!objectiveCursor || objectivesPaging) return
    const request = objectivesRequest.current
    setObjectivesPaging(true)
    try {
      const result = await getObjectives(undefined, objectiveCursor)
      if (request === objectivesRequest.current) {
        setObjectives(previous => [...previous, ...result.objectives.filter(row => !previous.some(current => current.id === row.id))])
        setObjectiveCursor(result.nextCursor ?? null)
      }
    } catch (error) {
      if (request === objectivesRequest.current) setNotice({ kind: 'error', text: message(error, 'Ältere Lernziele konnten nicht geladen werden.') })
    } finally { if (request === objectivesRequest.current) setObjectivesPaging(false) }
  }
  const loadOlderItems = async () => {
    if (!itemCursor || itemsPaging || !objectiveId) return
    const request = itemsRequest.current
    const selectedId = objectiveId
    setItemsPaging(true)
    try {
      const result = await getItems(selectedId, undefined, itemCursor)
      if (request === itemsRequest.current) {
        setItems(previous => [...previous, ...result.items.filter(row => !previous.some(current => current.id === row.id))])
        setItemCursor(result.nextCursor ?? null)
      }
    } catch (error) {
      if (request === itemsRequest.current) setNotice({ kind: 'error', text: message(error, 'Ältere Fragen konnten nicht geladen werden.') })
    } finally { if (request === itemsRequest.current) setItemsPaging(false) }
  }
  const loadChoiceVersion = async (selectedId: string, revision: number) => {
    const request = ++choiceRequest.current
    setItemLoading(true); setChoice(null); setChoiceBaseline(null)
    try {
      const result = await getItemRevision(selectedId, revision)
      if (request === choiceRequest.current) { setChoice(result.choice); setChoiceBaseline(result.choice) }
    } catch (error) {
      if (request === choiceRequest.current) setNotice({ kind: 'error', text: message(error, 'Diese Fragenversion konnte nicht geladen werden.') })
    } finally {
      if (request === choiceRequest.current) setItemLoading(false)
    }
  }

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return
    objectivesRequest.current += 1
    const controller = new AbortController()
    void Promise.all([getPracticeState(courseId, controller.signal), getObjectives(controller.signal)]).then(([next, result]) => {
      if (controller.signal.aborted) return
      setState(next); setRefs(next.draft.payload.items); setObjectives(result.objectives); setObjectiveCursor(result.nextCursor ?? null)
      setObjectiveId(result.objectives[0]?.id ?? '')
      setObjectiveNew(result.objectives.length === 0)
      setObjectiveInput(result.objectives[0] ? { title: result.objectives[0].title, description: result.objectives[0].description } : { title: '', description: '' })
      if (result.objectives[0]) void loadItemsForObjective(result.objectives[0].id)
      setLoading(false)
    }).catch(error => {
      if (controller.signal.aborted) return
      setLoadError({ text: message(error, 'Die Übungsdaten konnten nicht geladen werden.'), status: error instanceof PracticeApiError ? error.status : undefined })
      setLoading(false)
    })
    return () => { controller.abort(); objectivesRequest.current += 1; itemsRequest.current += 1; choiceRequest.current += 1 }
  }, [courseId, retry, sessionStatus, loadItemsForObjective])

  useEffect(() => {
    if (!hasLocalChanges) return
    const currentUrl = location.href
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const popState = () => {
      const destination = new URL(location.href)
      if (destination.pathname === new URL(currentUrl).pathname && destination.search === new URL(currentUrl).search) return
      window.history.pushState(window.history.state, '', currentUrl)
      if (window.confirm('Ungespeicherte Änderungen verwerfen?')) router.push(destination.pathname + destination.search + destination.hash)
    }
    const interceptLink = (event: MouseEvent) => {
      const target = event.target
      const anchor = target instanceof Element ? target.closest('a[href]') : null
      if (!anchor || anchor.getAttribute('target') || anchor.hasAttribute('download') || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const url = new URL(anchor.getAttribute('href') ?? '', location.href)
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return
      if (!window.confirm('Ungespeicherte Änderungen verwerfen?')) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('popstate', popState)
    document.addEventListener('click', interceptLink, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('popstate', popState); document.removeEventListener('click', interceptLink, true) }
  }, [hasLocalChanges, router])

  useEffect(() => {
    previewRequest.current += 1
    return () => { previewRequest.current += 1 }
  }, [refs, state?.draft.revision, state?.activeCoursePublicationId, courseId])

  const askDiscard = (dirty: boolean) => !dirty || window.confirm('Ungespeicherte Änderungen verwerfen?')
  const closeReview = () => { previewRequest.current += 1; setPreviewBusy(false); setPreviewRows(null); setReviewOpen(false); setReviewSignature(null); setPublishRequestId(null) }
  const editObjective = (row: PracticeObjective) => {
    if (!askDiscard(objectiveDirty || itemDirty)) return
    setObjectiveNew(false); setObjectiveId(row.id)
    setObjectiveInput({ title: row.title, description: row.description })
    setItemId(''); setItemNew(false); setConflict(null); closeReview()
    void loadItemsForObjective(row.id)
  }
  const beginObjective = () => {
    if (!askDiscard(objectiveDirty || itemDirty)) return
    setObjectiveNew(true); setObjectiveId('')
    setObjectiveInput({ title: '', description: '' }); setItems([]); setItemCursor(null); setItemId(''); setItemNew(false); setConflict(null); closeReview()
    itemsRequest.current += 1; choiceRequest.current += 1
  }
  const editItem = (row: PracticeItem, revision = row.latestRevision) => {
    if (!askDiscard(itemDirty)) return
    setItemNew(false); setItemId(row.id); setItemRevision(revision); setConflict(null); closeReview()
    void loadChoiceVersion(row.id, revision)
  }
  const beginItem = () => {
    if (!askDiscard(itemDirty)) return
    setItemNew(true); setItemId(''); setItemRevision(1)
    choiceRequest.current += 1
    const empty = blankChoice(); setChoice(empty); setChoiceBaseline(empty); setItemLoading(false); setConflict(null); closeReview()
  }
  const run = async (work: () => Promise<void>, fallback: string) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setNotice(null)
    try { await work() }
    catch (error) { setNotice({ kind: 'error', text: message(error, fallback) }) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const refreshObjectives = async (preferredId: string) => {
    const remote = await getObjective(preferredId)
    setObjectives(previous => previous.map(row => row.id === remote.id ? remote : row))
    return remote
  }
  const objectiveConflict = async (id: string) => {
    const remote = await refreshObjectives(id)
    if (remote) setConflict({ scope: 'objective', remote })
  }
  const itemConflict = async (id: string) => {
    if (!objectiveId) return
    const remote = await getItem(id)
    setItems(previous => previous.map(row => row.id === remote.id ? remote : row))
    if (remote) {
      const detail = await getItemRevision(id, remote.latestRevision)
      setConflict({ scope: 'item', remote, choice: detail.choice })
    }
  }
  const draftConflict = async (scope: 'draft' | 'publish') => setConflict({ scope, remote: await getPracticeState(courseId) })

  const saveObjective = () => void run(async () => {
    if (!objectiveInput.title.trim()) throw new Error('Gib dem Lernziel einen Titel.')
    const previous = selectedObjective
    try {
      const next = objectiveNew
        ? await createObjective(objectiveInput.title, objectiveInput.description)
        : await reviseObjective(previous!.id, previous!.revision, objectiveInput)
      setObjectives(rows => objectiveNew ? [next, ...rows] : rows.map(row => row.id === next.id ? next : row))
      setObjectiveId(next.id); setObjectiveNew(false)
      setObjectiveInput({ title: next.title, description: next.description })
      if (objectiveNew) void loadItemsForObjective(next.id)
      setConflict(null); closeReview(); setPreviewRows(null)
      setNotice({ kind: 'success', text: 'Lernziel gespeichert. Bereits angeheftete Referenzen werden nicht automatisch geändert.' })
    } catch (error) {
      if (error instanceof PracticeApiError && error.status === 412 && previous) await objectiveConflict(previous.id)
      throw error
    }
  }, 'Das Lernziel konnte nicht gespeichert werden.')

  const validChoice = (input: PracticeChoice): PracticeChoice => {
    const clean = { ...input, prompt: input.prompt.trim(), options: input.options.map(value => value.trim()), explanation: input.explanation.trim() }
    if (!clean.prompt || clean.options.length < 2 || clean.options.length > 8 || clean.options.some(value => !value) ||
        new Set(clean.options.map(value => value.toLocaleLowerCase('de-DE'))).size !== clean.options.length)
      throw new Error('Fragetext und zwei bis acht verschiedene Antworten sind erforderlich.')
    return clean
  }
  const saveItem = () => void run(async () => {
    if (!objectiveId || !choice) return
    if (!itemNew && !isCurrentItemRevision) throw new Error('Wähle die neueste Fragenversion zum Bearbeiten.')
    const clean = validChoice(choice)
    try {
      const result = itemNew ? await createItem(objectiveId, clean) : await reviseItem(itemId, selectedItem!.latestRevision, clean)
      const summary: PracticeItem = { id: result.id, objectiveId, latestRevision: result.latestRevision, prompt: clean.prompt }
      setItems(rows => itemNew ? [summary, ...rows] : rows.map(row => row.id === summary.id ? summary : row))
      setItemNew(false); setItemId(result.id); setItemRevision(result.latestRevision)
      setChoice(clean); setChoiceBaseline(clean); setConflict(null); closeReview()
      setNotice({ kind: 'success', text: 'Fragenversion gespeichert. Angeheftete Referenzen bleiben bei ihrer bisherigen Version.' })
    } catch (error) {
      if (error instanceof PracticeApiError && error.status === 412 && itemId) await itemConflict(itemId)
      throw error
    }
  }, 'Die Übungsfrage konnte nicht gespeichert werden.')

  const pinItem = () => {
    if (!selectedObjective || !selectedItem || itemDirty || objectiveDirty || !choice) return
    if (refs.length >= 100 && !refs.some(ref => ref.itemId === selectedItem.id)) {
      setNotice({ kind: 'error', text: 'Ein Übungsentwurf kann höchstens 100 Fragen enthalten.' }); return
    }
    const next: PracticeRef = { objectiveId: selectedObjective.id, objectiveRevision: selectedObjective.revision, itemId: selectedItem.id, itemRevision }
    setRefs(previous => {
      const index = previous.findIndex(ref => ref.itemId === next.itemId)
      if (index < 0) return previous.length >= 100 ? previous : [...previous, next]
      return previous.map((ref, position) => position === index ? next : ref)
    })
    closeReview(); setReceipt(null)
    setNotice({ kind: 'success', text: 'Version für den Übungsentwurf vorgemerkt. Speichere die Zusammenstellung ausdrücklich.' })
  }
  const moveRef = (index: number, direction: -1 | 1) => {
    setRefs(previous => { const next = [...previous]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next })
    closeReview()
  }
  const removeRef = (itemId: string) => {
    setRefs(previous => previous.filter(entry => entry.itemId !== itemId))
    closeReview()
  }
  const saveRefs = (revision = state?.draft.revision) => void run(async () => {
    if (!state || revision === undefined) return
    try {
      const next = await savePracticeState(courseId, revision, refs)
      setState(next); setRefs(next.draft.payload.items); setConflict(null); closeReview()
      setNotice({ kind: 'success', text: 'Übungsentwurf gespeichert. Mitglieder sehen erst eine veröffentlichte Übungsfassung.' })
    } catch (error) {
      if (error instanceof PracticeApiError && error.status === 412) await draftConflict('draft')
      throw error
    }
  }, 'Der Übungsentwurf konnte nicht gespeichert werden.')

  const preview = async (source: PracticeRef[], signature: string | null = null) => {
    const request = ++previewRequest.current
    setPreviewBusy(true); setPreviewRows(null)
    try {
      const result = await getPracticePreview(courseId, source)
      if (request !== previewRequest.current) return null
      setPreviewRows(result.items); setReviewSignature(signature)
      return result.items
    } catch (error) {
      if (request === previewRequest.current) setNotice({ kind: 'error', text: message(error, 'Die Vorschau konnte nicht geladen werden.') })
      return null
    } finally { if (request === previewRequest.current) setPreviewBusy(false) }
  }

  const startReview = () => {
    if (!state || refsDirty || !state.activeCoursePublicationId || !refs.length) return
    setReviewOpen(true); setPublishRequestId(crypto.randomUUID()); setReceipt(null)
    void preview(state.draft.payload.items, currentReviewSignature)
  }
  const publish = () => void run(async () => {
    if (!state || !state.activeCoursePublicationId || !publishRequestId || !reviewOpen || !previewRows ||
        !reviewSignature || reviewSignature !== currentReviewSignature || refsDirty) return
    try {
      const result = await publishPractice(courseId, state.draft.revision, state.activeCoursePublicationId, publishRequestId)
      setReceipt(result.snapshot)
      setState({ ...state, activeSnapshot: result.snapshot })
      setHistory(null); setHistoryOpen(false)
      closeReview(); setConflict(null)
      setNotice({ kind: 'success', text: result.unchanged ? 'Diese Übungsfassung war bereits veröffentlicht.' : 'Übungsfassung veröffentlicht. Freiwilliges Üben ist im Kurs verfügbar.' })
    } catch (error) {
      if (error instanceof PracticeApiError && error.status === 412) { await draftConflict('publish'); closeReview(); setPreviewRows(null) }
      throw error
    }
  }, 'Die Übungsfassung konnte nicht veröffentlicht werden.')

  const loadOlderHistory = async () => {
    if (!history?.nextCursor || historyPaging) return
    setHistoryPaging(true)
    try {
      const next = await getPracticeHistory(courseId, history.nextCursor)
      setHistory(previous => previous && ({ ...next, snapshots: [...previous.snapshots, ...next.snapshots.filter(row => !previous.snapshots.some(current => current.id === row.id))] }))
    } catch (error) { setNotice({ kind: 'error', text: message(error, 'Ältere Veröffentlichungen konnten nicht geladen werden.') }) }
    finally { setHistoryPaging(false) }
  }
  const showHistory = async () => {
    if (historyOpen) { setHistoryOpen(false); return }
    setHistoryOpen(true); setHistoryBusy(true)
    try { setHistory(await getPracticeHistory(courseId)) }
    catch (error) { setNotice({ kind: 'error', text: message(error, 'Der Versionsverlauf konnte nicht geladen werden.') }) }
    finally { setHistoryBusy(false) }
  }
  const adoptRemote = () => {
    if (!conflict) return
    if (conflict.scope === 'objective') {
      setObjectives(previous => previous.map(row => row.id === conflict.remote.id ? conflict.remote : row))
      setObjectiveInput({ title: conflict.remote.title, description: conflict.remote.description })
      closeReview()
    } else if (conflict.scope === 'item') {
      setItems(previous => previous.map(row => row.id === conflict.remote.id ? conflict.remote : row))
      setItemRevision(conflict.remote.latestRevision); setChoice(conflict.choice); setChoiceBaseline(conflict.choice)
    } else {
      setState(conflict.remote); setRefs(conflict.remote.draft.payload.items)
      closeReview()
    }
    setConflict(null); setNotice({ kind: 'success', text: 'Aktueller Stand übernommen.' })
  }
  const rebase = () => {
    if (!conflict) return
    if (conflict.scope === 'draft') { saveRefs(conflict.remote.draft.revision); return }
    if (conflict.scope === 'publish') { adoptRemote(); return }
    const currentConflict = conflict as Extract<Conflict, { scope: 'objective' | 'item' }>
    void run(async () => {
      try {
        if (currentConflict.scope === 'objective') {
          const result = await reviseObjective(currentConflict.remote.id, currentConflict.remote.revision, objectiveInput)
          setObjectives(previous => previous.map(row => row.id === result.id ? result : row))
          setObjectiveInput({ title: result.title, description: result.description })
        } else if (choice) {
          const clean = validChoice(choice)
          const result = await reviseItem(currentConflict.remote.id, currentConflict.remote.latestRevision, clean)
          setItems(rows => rows.map(row => row.id === result.id ? { ...row, latestRevision: result.latestRevision, prompt: clean.prompt } : row))
          setItemRevision(result.latestRevision); setChoice(clean); setChoiceBaseline(clean)
        }
        setConflict(null); closeReview()
        setNotice({ kind: 'success', text: 'Deine Eingaben wurden als neue Revision gespeichert.' })
      } catch (error) {
        if (error instanceof PracticeApiError && error.status === 412) {
          if (currentConflict.scope === 'objective') await objectiveConflict(currentConflict.remote.id)
          else await itemConflict(currentConflict.remote.id)
        }
        throw error
      }
    }, 'Die neue Revision konnte nicht gespeichert werden.')
  }

  const classInput = 'min-h-11'
  const classSelect = 'min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50'
  return <AppShell><Sidebar /><div className="min-w-0 flex-1">
    <AppHeader><div className="app-header-row"><span className="app-header-title font-semibold">Kursautorenschaft</span><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
    <main id="page-content" tabIndex={-1} className="min-w-0 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-3 border-b pb-5">
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => { if (askDiscard(hasLocalChanges)) router.push(`/courses/${encodeURIComponent(courseId)}/contents`) }}><ArrowLeft className="mr-2 h-4 w-4" />Zum Kursentwurf</Button>
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Autorenarbeitsplatz / Übungspool</p><h1 className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">Formative Übungen</h1><p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">Lernziele und einfache Single-Choice-Fragen erstellen, feste Versionen auswählen und eine Kursfassung prüfen.</p></div></div>
          <p className="border-l-2 border-primary pl-3 text-sm leading-relaxed">Veröffentlichte Übungen können Mitglieder im Kurs freiwillig nutzen.</p>
        </div>
        {sessionStatus !== 'authenticated' ? <PageState kind="loading" title="Sitzung wird geprüft" /> :
          loading ? <PageState kind="loading" title="Übungsdaten werden geladen" /> :
          loadError ? <PageState kind="error" title={loadError.status === 403 ? 'Kein Zugriff auf diesen Übungsentwurf' : 'Übungsdaten konnten nicht geladen werden'} description={loadError.text} action={loadError.status === 403 ? undefined : <RetryButton onClick={() => { setLoading(true); setLoadError(null); setRetry(value => value + 1) }} />} /> :
          state && <>
            {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${notice.kind === 'error' ? 'border-destructive/40 text-destructive' : 'bg-card'}`}>{notice.text}</div>}
            {conflict && <section aria-label="Versionskonflikt" className="space-y-3 rounded-xl border border-destructive/40 bg-card p-4">
              <h2 className="text-lg font-semibold">Zwischenzeitliche Änderung</h2>
              <p className="text-sm">Deine Eingaben sind noch da. Vergleiche die Versionen und entscheide, ob du sie auf die aktuelle Revision anwendest.</p>
              {conflict.scope === 'objective' ? <p className="break-words text-sm">Aktuelles Lernziel, Revision {conflict.remote.revision}: „{conflict.remote.title}“ — {conflict.remote.description || 'ohne Beschreibung'}. Deine Eingabe: „{objectiveInput.title}“ — {objectiveInput.description || 'ohne Beschreibung'}.</p> :
                conflict.scope === 'item' ? <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-2"><div className="min-w-0"><p className="font-semibold">Aktuell · V{conflict.remote.latestRevision}</p><p className="break-words">{conflict.choice.prompt}</p><ol className="list-inside list-decimal">{conflict.choice.options.map((option, index) => <li key={index} className="break-words">{option}{index === conflict.choice.correctIndex ? ' · richtig' : ''}</li>)}</ol></div><div className="min-w-0"><p className="font-semibold">Deine Eingabe</p><p className="break-words">{choice?.prompt}</p><ol className="list-inside list-decimal">{choice?.options.map((option, index) => <li key={index} className="break-words">{option}{index === choice.correctIndex ? ' · richtig' : ''}</li>)}</ol></div></div> :
                <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-2"><div className="min-w-0"><p className="font-semibold">Aktueller Entwurf · R{conflict.remote.draft.revision}</p><ol className="list-inside list-decimal">{conflict.remote.draft.payload.items.map(row => <li key={row.itemId} className="break-words">Lernziel {row.objectiveId} R{row.objectiveRevision} / Frage {row.itemId} V{row.itemRevision}</li>)}</ol></div><div className="min-w-0"><p className="font-semibold">Deine Auswahl</p><ol className="list-inside list-decimal">{refs.map(row => <li key={row.itemId} className="break-words">Lernziel {row.objectiveId} R{row.objectiveRevision} / Frage {row.itemId} V{row.itemRevision}</li>)}</ol></div>{conflict.scope === 'publish' && <p className="sm:col-span-2">Prüfe die Veröffentlichung danach erneut.</p>}</div>}
              <div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={busy} onClick={adoptRemote}>Aktuellen Stand übernehmen</Button>{conflict.scope !== 'publish' && <Button className="min-h-11" disabled={busy} onClick={rebase}>Meine Eingaben als neue Revision speichern</Button>}</div>
            </section>}
            <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <section aria-labelledby="objective-heading" className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm text-muted-foreground">1 / Eigener Pool</p><h2 id="objective-heading" className="text-xl font-semibold">Lernziele</h2></div><Button variant="outline" className="min-h-11" disabled={busy} onClick={beginObjective}><Plus className="mr-2 h-4 w-4" />Neues Lernziel</Button></div>
                {objectives.length ? <div className="space-y-1 border-y py-2" role="group" aria-label="Eigene Lernziele">{objectives.map(row => <button key={row.id} type="button" aria-current={!objectiveNew && objectiveId === row.id ? 'true' : undefined} onClick={() => editObjective(row)} className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${!objectiveNew && objectiveId === row.id ? 'bg-accent font-medium text-accent-foreground' : ''}`}><span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{row.title}</span><span className="shrink-0 text-xs">R{row.revision}</span></button>)}</div> : <p className="border-y py-4 text-sm text-muted-foreground">Noch keine Lernziele. Lege das erste Lernziel an.</p>}
                {objectiveCursor && <Button variant="outline" className="min-h-11" disabled={objectivesPaging} onClick={() => void loadOlderObjectives()}>{objectivesPaging ? 'Ältere Lernziele werden geladen …' : 'Ältere Lernziele laden'}</Button>}
                {(objectiveNew || selectedObjective) && <form onSubmit={event => { event.preventDefault(); saveObjective() }} className="space-y-3 rounded-xl border bg-card p-4" aria-label={objectiveNew ? 'Neues Lernziel' : 'Lernziel bearbeiten'} aria-busy={busy}>
                  <div className="space-y-1"><Label htmlFor="practice-objective-title">Titel</Label><Input id="practice-objective-title" className={classInput} maxLength={300} required value={objectiveInput.title} disabled={busy} onChange={event => setObjectiveInput(value => ({ ...value, title: event.target.value }))} /></div>
                  <div className="space-y-1"><Label htmlFor="practice-objective-description">Beschreibung</Label><Textarea id="practice-objective-description" maxLength={3000} rows={3} value={objectiveInput.description} disabled={busy} onChange={event => setObjectiveInput(value => ({ ...value, description: event.target.value }))} /></div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><span role="status" className="text-sm text-muted-foreground">{objectiveDirty ? 'Ungespeicherte Eingaben' : 'Keine lokalen Änderungen'}</span><Button type="submit" className="min-h-11" disabled={busy || !objectiveDirty}>{busy ? 'Wird gespeichert …' : objectiveNew ? 'Lernziel anlegen' : 'Neue Revision speichern'}</Button></div>
                </form>}
              </section>
              <section aria-labelledby="item-heading" className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm text-muted-foreground">2 / Ausgewähltes Lernziel</p><h2 id="item-heading" className="text-xl font-semibold">Übungsfragen</h2></div>{selectedObjective && <Button variant="outline" className="min-h-11" disabled={busy || objectiveDirty} onClick={beginItem}><Plus className="mr-2 h-4 w-4" />Neue Frage</Button>}</div>
                {!selectedObjective ? <p className="border-y py-4 text-sm text-muted-foreground">Wähle oder speichere zuerst ein Lernziel.</p> : itemsLoading ? <p role="status" className="border-y py-4 text-sm">Fragen werden geladen …</p> : items.length ? <div className="space-y-1 border-y py-2" role="group" aria-label="Eigene Übungsfragen">{items.map(row => <button key={row.id} type="button" aria-current={!itemNew && itemId === row.id ? 'true' : undefined} onClick={() => editItem(row)} className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${!itemNew && itemId === row.id ? 'bg-accent font-medium text-accent-foreground' : ''}`}><span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{row.prompt}</span><span className="shrink-0 text-xs">V{row.latestRevision}</span></button>)}</div> : <p className="border-y py-4 text-sm text-muted-foreground">Noch keine Fragen zu diesem Lernziel.</p>}
                {selectedObjective && itemCursor && <Button variant="outline" className="min-h-11" disabled={itemsPaging} onClick={() => void loadOlderItems()}>{itemsPaging ? 'Ältere Fragen werden geladen …' : 'Ältere Fragen laden'}</Button>}
                {selectedObjective && (itemNew || selectedItem) && <div className="space-y-4 rounded-xl border bg-card p-4" aria-busy={busy || itemLoading}>
                  {selectedItem && <div className="space-y-1"><Label htmlFor="practice-version">Fragenversion ansehen</Label><select id="practice-version" className={classSelect} value={itemRevision} disabled={busy} onChange={event => { if (askDiscard(itemDirty)) { const revision = Number(event.target.value); setItemRevision(revision); void loadChoiceVersion(selectedItem.id, revision) } }}>{Array.from({ length: selectedItem.latestRevision }, (_, index) => index + 1).reverse().map(revision => <option key={revision} value={revision}>Version {revision}{revision === selectedItem.latestRevision ? ' · aktuell' : ''}</option>)}</select>{!isCurrentItemRevision && <p className="text-sm text-muted-foreground">Ältere Versionen sind schreibgeschützt, können aber ausdrücklich angeheftet werden.</p>}</div>}
                  {itemLoading ? <p role="status" className="text-sm">Fragenversion wird geladen …</p> : choice && <form onSubmit={event => { event.preventDefault(); saveItem() }} className="space-y-4" aria-label={itemNew ? 'Neue Übungsfrage' : 'Übungsfrage bearbeiten'}>
                    <div className="space-y-1"><Label htmlFor="practice-prompt">Fragetext</Label><Textarea id="practice-prompt" rows={3} maxLength={3000} required value={choice.prompt} disabled={busy || (!itemNew && !isCurrentItemRevision)} onChange={event => setChoice(value => value && ({ ...value, prompt: event.target.value }))} /></div>
                    <fieldset className="space-y-2" disabled={busy || (!itemNew && !isCurrentItemRevision)}><legend className="text-sm font-medium">Antwortmöglichkeiten und richtige Antwort</legend>{choice.options.map((option, index) => <div className="flex min-w-0 items-center gap-2" key={index}><input type="radio" name="practice-correct" className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`Antwort ${labelFor(index)} ist richtig`} checked={choice.correctIndex === index} onChange={() => setChoice(value => value && ({ ...value, correctIndex: index }))} /><Label htmlFor={`practice-option-${index}`} className="shrink-0">{labelFor(index)}</Label><Input id={`practice-option-${index}`} className="min-h-11 min-w-0" maxLength={1000} required value={option} onChange={event => setChoice(value => value && ({ ...value, options: value.options.map((current, position) => position === index ? event.target.value : current) }))} />{choice.options.length > 2 && <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0" aria-label={`Antwort ${labelFor(index)} entfernen`} onClick={() => setChoice(value => value && ({ ...value, options: value.options.filter((_, position) => position !== index), correctIndex: value.correctIndex === index ? 0 : value.correctIndex > index ? value.correctIndex - 1 : value.correctIndex }))}>Entfernen</Button>}</div>)}</fieldset>
                    {choice.options.length < 8 && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy || (!itemNew && !isCurrentItemRevision)} onClick={() => setChoice(value => value && ({ ...value, options: [...value.options, ''] }))}>Antwort hinzufügen</Button>}
                    <div className="space-y-1"><Label htmlFor="practice-explanation">Erklärung (optional)</Label><Textarea id="practice-explanation" rows={3} maxLength={3000} value={choice.explanation} disabled={busy || (!itemNew && !isCurrentItemRevision)} onChange={event => setChoice(value => value && ({ ...value, explanation: event.target.value }))} /></div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><span role="status" className="text-sm text-muted-foreground">{itemDirty ? 'Ungespeicherte Eingaben' : 'Gespeicherte Version'}</span><div className="flex flex-wrap gap-2">{selectedItem && <Button type="button" variant="outline" className="min-h-11" disabled={busy || objectiveDirty || itemDirty || !choice} onClick={pinItem}>{refs.some(ref => ref.itemId === selectedItem.id) ? 'Anheftung aktualisieren' : 'Version anheften'}</Button>}{(itemNew || isCurrentItemRevision) && <Button type="submit" className="min-h-11" disabled={busy || !itemDirty}>{busy ? 'Wird gespeichert …' : itemNew ? 'Frage anlegen' : 'Neue Version speichern'}</Button>}</div></div>
                  </form>}
                </div>}
              </section>
            </div>
            <section aria-labelledby="draft-heading" className="space-y-4 border-t pt-7">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">3 / Kurszusammenstellung</p><h2 id="draft-heading" className="text-xl font-semibold">Angeheftete Versionen</h2><p className="mt-1 text-sm text-muted-foreground">Nur diese ausdrücklich ausgewählten Fragen und Revisionen gehören zum Übungsentwurf.</p></div><span role="status" className="text-sm text-muted-foreground">{refsDirty ? 'Ungespeicherte Zusammenstellung' : `Entwurf gespeichert · Revision ${state.draft.revision}`}</span></div>
              {refs.length ? <ol className="divide-y border-y">{refs.map((ref, index) => { const objective = objectives.find(row => row.id === ref.objectiveId); const item = items.find(row => row.id === ref.itemId); return <li key={ref.itemId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0 break-words text-sm [overflow-wrap:anywhere]"><span className="font-semibold">{index + 1}. {objective?.title ?? previewRows?.find(row => row.objectiveId === ref.objectiveId)?.objectiveTitle ?? `Lernziel ${ref.objectiveId}`}</span><span className="ml-2 text-muted-foreground">R{ref.objectiveRevision} / Frage {item?.prompt ?? ref.itemId} · V{ref.itemRevision}</span>{objective && objective.revision !== ref.objectiveRevision && <span className="ml-2 text-destructive">Lernzielrevision veraltet</span>}</div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" className="min-h-11" disabled={busy || index === 0} onClick={() => moveRef(index, -1)}>Hoch</Button><Button variant="ghost" size="sm" className="min-h-11" disabled={busy || index === refs.length - 1} onClick={() => moveRef(index, 1)}>Runter</Button><Button variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => removeRef(ref.itemId)}>Entfernen</Button></div></li> })}</ol> : <p className="border-y py-5 text-sm text-muted-foreground">Noch keine Frage angeheftet. Wähle oben eine gespeicherte Fragenversion.</p>}
              <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy || !refsDirty} onClick={() => saveRefs()}>{busy ? 'Wird gespeichert …' : 'Zusammenstellung speichern'}</Button><Button variant="outline" className="min-h-11" disabled={busy || !refs.length || previewBusy} onClick={() => { closeReview(); void preview(refs) }}><Eye className="mr-2 h-4 w-4" />Vorschau</Button><Button variant="outline" className="min-h-11" disabled={busy || refsDirty || !refs.length || !state.activeCoursePublicationId} onClick={startReview}><Check className="mr-2 h-4 w-4" />Veröffentlichung prüfen</Button><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => void showHistory()}><History className="mr-2 h-4 w-4" />Verlauf</Button></div>
              {!state.activeCoursePublicationId && <p className="text-sm text-muted-foreground">Veröffentliche zuerst eine Kursfassung, bevor du eine Übungsfassung veröffentlichen kannst.</p>}
              {previewBusy && <p role="status" className="text-sm">Private Fragenversionen werden geladen …</p>}
              {previewRows && <section aria-label={reviewOpen ? 'Veröffentlichung prüfen' : 'Autorenvorschau'} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"><div><h3 className="text-lg font-semibold">{reviewOpen ? 'Gespeicherte Fassung prüfen' : 'Autorenvorschau'}</h3><p className="text-sm text-muted-foreground">{reviewOpen ? 'Die Veröffentlichung verwendet nur den gespeicherten Entwurf und die unten genannten festen Versionen.' : refsDirty ? 'Vorschau deiner noch ungespeicherten Zusammenstellung, aus eigenen gespeicherten Fragenversionen.' : 'Vorschau des gespeicherten Übungsentwurfs aus eigenen Fragenversionen.'}</p></div>{previewRows.map((row, index) => <div key={row.itemId} className="space-y-2 border-t pt-4"><p className="break-words text-xs font-semibold uppercase tracking-wide text-muted-foreground [overflow-wrap:anywhere]">{row.objectiveTitle} · R{row.objectiveRevision} / V{row.itemRevision}</p><h4 className="break-words font-medium [overflow-wrap:anywhere]">{index + 1}. {row.prompt}</h4><ol className="space-y-1 text-sm">{row.options.map((option, position) => <li key={position} className={`break-words [overflow-wrap:anywhere] ${position === row.correctIndex ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{labelFor(position)}. {option}{position === row.correctIndex && ' · Richtig'}</li>)}</ol>{row.explanation && <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">Erklärung: {row.explanation}</p>}</div>)}{reviewOpen && <div className="space-y-3 border-t pt-4"><p className="text-sm">Kursveröffentlichung: {state.activeCoursePublicationId}. Entwurfsrevision: {state.draft.revision}. Fragen: {previewRows.length}. Veröffentlichung kann bei einer geänderten Kursfassung oder doppelten bewerteten Quizfrage abgelehnt werden.</p>{reviewSignature !== currentReviewSignature && <p role="status" className="text-sm text-destructive">Der Entwurf hat sich seit dieser Prüfung geändert. Prüfe die Veröffentlichung erneut.</p>}<div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={busy} onClick={closeReview}>Weiter bearbeiten</Button><Button className="h-auto min-h-11 max-w-full whitespace-normal break-words py-2 text-center [overflow-wrap:anywhere]" disabled={busy || refsDirty || !publishRequestId || !reviewSignature || reviewSignature !== currentReviewSignature} onClick={publish}>{busy ? 'Wird veröffentlicht …' : 'Diese Übungsfassung veröffentlichen'}</Button></div></div>}</section>}
              {receipt && <div role="status" className="rounded-xl border bg-card p-4 text-sm"><p className="font-semibold">Veröffentlichungsbeleg · Version {receipt.sequence}</p><p>Beleg-ID: {receipt.id}. Kursfassung: {receipt.coursePublicationId}. {receipt.itemCount} Fragen.</p><p className="mt-2 text-muted-foreground">Mitglieder können diese Fassung im Kurs freiwillig üben.</p></div>}
              {state.activeSnapshot && !receipt && <p className="text-sm text-muted-foreground">Letzter aktiver Übungs-Snapshot zu dieser Kursfassung: Version {state.activeSnapshot.sequence}, {state.activeSnapshot.itemCount} Fragen.</p>}
              {historyOpen && <section aria-labelledby="history-heading" className="space-y-2 border-t pt-4"><h3 id="history-heading" className="text-lg font-semibold">Veröffentlichungsverlauf</h3>{historyBusy ? <p role="status" className="text-sm">Verlauf wird geladen …</p> : history?.snapshots.length ? <ol className="divide-y border-y">{history.snapshots.map(row => <li key={row.id} className="break-words py-3 text-sm [overflow-wrap:anywhere]"><strong>Version {row.sequence}</strong> · {row.itemCount} Fragen · {formatDate(row.recordedAt)}<br /><span className="text-muted-foreground">Kursfassung: {row.coursePublicationId} · Beleg: {row.id}</span></li>)}</ol> : <p className="text-sm text-muted-foreground">Noch keine Übungsfassung veröffentlicht.</p>}{history?.nextCursor && <Button variant="outline" className="min-h-11" disabled={historyPaging} onClick={() => void loadOlderHistory()}>{historyPaging ? 'Ältere Versionen werden geladen …' : 'Ältere Versionen laden'}</Button>}</section>}
            </section>
          </>}
      </div>
    </main>
  </div></AppShell>
}
