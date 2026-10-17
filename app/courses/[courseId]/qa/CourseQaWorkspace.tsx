'use client'

/* Hallmark · course conversation workbench · design.md */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, ChevronRight, Search, X } from 'lucide-react'
import { AppHeader, AppShell } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageState, RetryButton } from '@/components/page-state'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserNav } from '@/components/user-nav'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { CourseQaIcon } from './CourseQaIcon'
import type { CourseQaContextEntry, CourseQaLessonContext, CourseQaLessonContextPair, CourseQaScope } from '@/lib/course-qa-context-contract'
import { LessonContextLabel, readLessonContext, readQaScope, suppressLessonContext } from './CourseQaLessonContext'

type Author = { id: string; name: string }
type Question = { id: string; title: string; body: string; createdAt: string; author: Author; answerCount?: number; acceptedAnswerId: string | null; revision: string | number | null; hidden?: boolean; lessonContext: CourseQaLessonContext }
type Answer = { id: string; body: string; createdAt: string; author: Author; hidden?: boolean }
type Access = { canAsk: boolean; canReply: boolean; canModerate: boolean }
type ScopeAccess = { scope: CourseQaScope; canAskInScope: boolean }
type QuestionList = Access & ScopeAccess & { items: Question[]; nextCursor: string | null }
type QuestionDetail = Access & { question: Question; answers: Answer[] }
type Visibility = Access & ScopeAccess & { visibleIds: string[]; contexts: CourseQaContextEntry[] }
type ContextProof = { lease: number; scope: string; lesson: boolean; pending: boolean; unavailableScope: boolean; scopeAccess: ScopeAccess | null; contexts: Map<string, CourseQaLessonContext> }
type PendingQuestion = { title: string; body: string; requestId: string; lessonContext: CourseQaLessonContextPair | null }
type Filter = 'all' | 'open' | 'answered' | 'hidden'
type Notice = { kind: 'success' | 'error'; text: string }
type AccessFailure = { title: string; message: string }
type HideTarget = { kind: 'question' | 'answer'; questionId: string; answerId?: string }

class QaApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function isAccessError(cause: unknown): cause is QaApiError {
  return cause instanceof QaApiError && [401, 403, 404].includes(cause.status)
}

function sameAccess(left: Access, right: Access) {
  return left.canAsk === right.canAsk && left.canReply === right.canReply && left.canModerate === right.canModerate
}

const date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })
const VISIBILITY_BATCH_SIZE = 200
function formatDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : date.format(parsed)
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload.error === 'string' && payload.error.trim() && payload.error.length <= 240 ? payload.error : fallback
    if (response.status === 401) throw new QaApiError('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.', response.status)
    if (response.status === 403) throw new QaApiError('Du hast keinen Zugriff auf die Fragen dieses Kurses.', response.status)
    if (response.status === 404) throw new QaApiError('Dieser Kurs oder Beitrag ist nicht mehr verfügbar.', response.status)
    if (response.status === 409) throw new QaApiError(message, response.status)
    if (response.status === 412) throw new QaApiError('Der Beitrag hat sich geändert. Bitte prüfe den aktuellen Stand und versuche es erneut.', response.status)
    throw new QaApiError(message, response.status)
  }
  return payload as T
}

export function CourseQaWorkspace({ courseId, sessionStatus, lessonContext = null, invalidLessonScope = false, openComposer = false, courseDenial = null, onCourseAccessDenied, onRetryCourseAccess }: {
  courseId: string; sessionStatus: string; lessonContext?: CourseQaLessonContextPair | null; invalidLessonScope?: boolean; openComposer?: boolean;
  courseDenial?: string | null; onCourseAccessDenied?: (message: string) => void; onRetryCourseAccess?: () => void
}) {
  const router = useRouter()
  const base = `/api/courses/${encodeURIComponent(courseId)}/qa`
  const [courseTitle, setCourseTitle] = useState('Kurs')
  const [list, setList] = useState<QuestionList | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [accessError, setAccessError] = useState<AccessFailure | null>(null)
  const [accessVersion, setAccessVersion] = useState(0)
  const [probeVersion, setProbeVersion] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [listVersion, setListVersion] = useState(0)
  const [moreBusy, setMoreBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<QuestionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [composerOpen, setComposerOpen] = useState(openComposer)
  const [contextChecking, setContextChecking] = useState(false)
  const [pendingCreate, setPendingCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [hideTarget, setHideTarget] = useState<HideTarget | null>(null)
  const pendingQuestion = useRef<PendingQuestion | null>(null)
  const composerTrigger = useRef<HTMLButtonElement>(null)
  const courseScopeLink = useRef<HTMLAnchorElement>(null)
  const composerTitle = useRef<HTMLInputElement>(null)
  const composerFocus = useRef(openComposer)
  const alive = useRef(true)
  const contextEpoch = useRef(0)
  const contextProof = useRef<ContextProof | null>(null)
  const pairKey = JSON.stringify(lessonContext)
  const scopeKey = JSON.stringify([courseId, filter, query, lessonContext])
  const pendingReplyId = useRef<string | null>(null)
  const moreLock = useRef(false)
  const mutationLock = useRef(false)
  const mutationSequence = useRef(0)
  const epoch = useRef(0)
  const denied = useRef(false)
  const rights = useRef<Access | null>(null)
  const selectedIdRef = useRef(selectedId)
  const listRef = useRef(list)
  const listScopeRef = useRef(scopeKey)
  const previousScope = useRef(scopeKey)
  const loadedListScope = useRef<string | null>(null)
  const detailRef = useRef(detail)
  const listAbort = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)
  const courseAbort = useRef<AbortController | null>(null)
  const moreAbort = useRef<AbortController | null>(null)
  const probeAbort = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    selectedIdRef.current = selectedId
    listRef.current = list
    listScopeRef.current = scopeKey
    detailRef.current = detail
  }, [selectedId, list, scopeKey, detail])
  useLayoutEffect(() => {
    if (previousScope.current === scopeKey) return
    previousScope.current = scopeKey
    contextEpoch.current += 1
    contextProof.current = null
    loadedListScope.current = null
    listAbort.current?.abort(); detailAbort.current?.abort(); moreAbort.current?.abort(); probeAbort.current?.abort()
    listRef.current = null; detailRef.current = null
    moreLock.current = false; mutationLock.current = false; mutationSequence.current += 1
    setList(null); setDetail(null); setReply(''); setHideTarget(null)
    setListLoading(true); setDetailLoading(Boolean(selectedIdRef.current)); setMoreBusy(false); setBusy(false); setNotice(null); setContextChecking(false)
  }, [scopeKey])
  useLayoutEffect(() => {
    alive.current = true
    return () => {
      alive.current = false; epoch.current += 1; contextEpoch.current += 1; contextProof.current = null
      listAbort.current?.abort(); detailAbort.current?.abort(); courseAbort.current?.abort(); moreAbort.current?.abort(); probeAbort.current?.abort()
    }
  }, [])

  const revoke = useCallback((message: string, verificationFailed = false) => {
    if (denied.current) return
    denied.current = true
    epoch.current += 1
    rights.current = null
    contextProof.current = null
    loadedListScope.current = null
    listAbort.current?.abort(); detailAbort.current?.abort(); courseAbort.current?.abort(); moreAbort.current?.abort(); probeAbort.current?.abort()
    moreLock.current = false; mutationLock.current = false; mutationSequence.current += 1
    pendingQuestion.current = null; setPendingCreate(false); pendingReplyId.current = null
    setList(null); setDetail(null); setSelectedId(null); setCourseTitle('Kurs')
    setTitle(''); setBody(''); setReply(''); setSearchInput(''); setQuery(''); setFilter('all')
    setComposerOpen(false); setHideTarget(null)
    setListLoading(false); setDetailLoading(false); setMoreBusy(false); setBusy(false)
    setListError(null); setDetailError(null); setNotice(null)
    setAccessError({ title: verificationFailed ? 'Kursfragen vorübergehend nicht verfügbar' : 'Kein Zugriff auf Kursfragen', message })
  }, [])

  // A course-wide 401/403 stays authoritative even after an old scope was aborted.
  const readApi = useCallback(async <T,>(response: Response, fallback: string): Promise<T> => {
    try { return await readJson<T>(response, fallback) }
    catch (cause) {
      if (cause instanceof QaApiError && [401, 403].includes(cause.status)) {
        onCourseAccessDenied?.(cause.message)
        if (alive.current) revoke(cause.message)
      }
      throw cause
    }
  }, [onCourseAccessDenied, revoke])

  const verifyScope = useCallback((data: Access & ScopeAccess) => {
    const scope = readQaScope(data.scope, courseId, lessonContext)
    const canAskInScope = data.canAsk && (scope.kind === 'course' || scope.lessonContext.status === 'current')
    if (typeof data.canAskInScope !== 'boolean' || data.canAskInScope !== canAskInScope) throw new Error('Der Fragenbereich konnte nicht geprüft werden.')
    return { scope, canAskInScope }
  }, [courseId, lessonContext])

  const verifyList = useCallback((data: QuestionList): QuestionList => {
    const scope = verifyScope(data)
    const ids = new Set<string>()
    const items = data.items.map(item => {
      if (!item.id || ids.has(item.id)) throw new Error('Fragen konnten nicht geprüft werden.')
      ids.add(item.id)
      const context = readLessonContext(item.lessonContext, courseId)
      if (lessonContext && context?.status === 'current' && (context.publicationId !== lessonContext.publicationId || context.contentId !== lessonContext.contentId)) throw new Error('Lektionskontext konnte nicht geprüft werden.')
      return { ...item, lessonContext: context }
    })
    return { ...data, ...scope, items }
  }, [courseId, lessonContext, verifyScope])

  // One atomic probe owns metadata for its generation. Independent reads may
  // supply discussion content, but cannot restore a superseded lesson label.
  const projectQuestionContext = useCallback((item: Question, lease: number): Question => {
    const proof = contextProof.current
    if (!proof || proof.scope !== listScopeRef.current || proof.lease < lease) return item
    const context = proof.contexts.has(item.id) ? proof.contexts.get(item.id)! : suppressLessonContext(item.lessonContext)
    return { ...item, lessonContext: proof.pending || proof.unavailableScope ? suppressLessonContext(context) : context }
  }, [])
  const projectListContext = useCallback((data: QuestionList, lease: number): QuestionList => {
    const proof = contextProof.current
    if (!proof || proof.scope !== listScopeRef.current || proof.lease < lease) return data
    const verified = proof.scopeAccess
    const scope = proof.pending || proof.unavailableScope || !verified ?
      data.scope.kind === 'lesson' ? { kind: 'lesson' as const, lessonContext: { status: 'unavailable' as const } } : data.scope : verified.scope
    return { ...data, scope, canAskInScope: !proof.pending && !proof.unavailableScope && Boolean(verified?.canAskInScope) && data.canAsk,
      items: data.items.map(item => projectQuestionContext(item, lease)) }
  }, [projectQuestionContext])
  const observeIncomingContexts = useCallback((items: Question[], lease: number, scope?: CourseQaScope) => {
    const proof = contextProof.current
    if (!proof || proof.scope !== listScopeRef.current || proof.lease < lease) return
    if (scope?.kind === 'lesson' && scope.lessonContext.status === 'unavailable') proof.unavailableScope = true
    for (const item of items) if (item.lessonContext?.status === 'unavailable') {
      proof.contexts.set(item.id, { status: 'unavailable' })
      if (proof.lesson) proof.unavailableScope = true
    }
  }, [])
  const reconcileContexts = useCallback((lease: number) => {
    const currentList = listRef.current
    if (currentList) { const projected = projectListContext(currentList, lease); listRef.current = projected; setList(projected) }
    const currentDetail = detailRef.current
    if (currentDetail) { const projected = { ...currentDetail, question: projectQuestionContext(currentDetail.question, lease) }; detailRef.current = projected; setDetail(projected) }
  }, [projectListContext, projectQuestionContext])
  const beginContextVerification = useCallback(() => {
    const scope = listScopeRef.current
    const lease = ++contextEpoch.current
    contextProof.current = { lease, scope, lesson: JSON.parse(scope)[3] !== null, pending: true, unavailableScope: false, scopeAccess: null, contexts: new Map() }
    setContextChecking(true)
    reconcileContexts(lease)
    return lease
  }, [reconcileContexts])

  useLayoutEffect(() => { if (courseDenial) revoke(courseDenial) }, [courseDenial, revoke])

  const resetMissingQuestion = useCallback(() => {
    if (denied.current) return
    epoch.current += 1
    rights.current = null
    contextProof.current = null
    loadedListScope.current = null
    listAbort.current?.abort(); detailAbort.current?.abort(); courseAbort.current?.abort(); moreAbort.current?.abort(); probeAbort.current?.abort()
    moreLock.current = false; mutationLock.current = false; mutationSequence.current += 1
    pendingQuestion.current = null; setPendingCreate(false); pendingReplyId.current = null
    setList(null); setDetail(null); setSelectedId(null); setCourseTitle('Kurs')
    setTitle(''); setBody(''); setReply(''); setSearchInput(''); setQuery(''); setFilter('all')
    setComposerOpen(false); setHideTarget(null)
    setListLoading(true); setDetailLoading(false); setMoreBusy(false); setBusy(false)
    setListError(null); setDetailError(null); setNotice({ kind: 'error', text: 'Diese Frage ist nicht mehr verfügbar.' })
    setAccessVersion(value => value + 1)
    setListVersion(value => value + 1)
  }, [])

  const resetChangedRights = useCallback(() => {
    if (denied.current) return
    epoch.current += 1
    rights.current = null
    contextProof.current = null
    loadedListScope.current = null
    listAbort.current?.abort(); detailAbort.current?.abort(); courseAbort.current?.abort(); moreAbort.current?.abort(); probeAbort.current?.abort()
    moreLock.current = false; mutationLock.current = false; mutationSequence.current += 1
    pendingQuestion.current = null; setPendingCreate(false); pendingReplyId.current = null
    setList(null); setDetail(null); setSelectedId(null)
    setTitle(''); setBody(''); setReply(''); setSearchInput(''); setQuery(''); setFilter('all')
    setComposerOpen(false); setHideTarget(null)
    setListLoading(true); setDetailLoading(false); setMoreBusy(false); setBusy(false)
    setListError(null); setDetailError(null); setNotice(null)
    setListVersion(value => value + 1)
  }, [])

  const refresh = useCallback(() => {
    if (denied.current) return
    setListVersion(value => value + 1); setDetailVersion(value => value + 1)
  }, [])

  const retryAccess = () => {
    epoch.current += 1
    denied.current = false
    onRetryCourseAccess?.()
    setAccessError(null); setListLoading(true)
    setAccessVersion(value => value + 1)
    setListVersion(value => value + 1)
  }

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/qa`)}`)
  }, [courseId, router, sessionStatus])

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || denied.current || invalidLessonScope || courseDenial) return
    const controller = new AbortController()
    const generation = epoch.current
    courseAbort.current = controller
    void fetch(`/api/courses/${encodeURIComponent(courseId)}`, { cache: 'no-store', signal: controller.signal })
      .then(response => readApi<{ name: string }>(response, 'Kurs konnte nicht geladen werden.'))
      .then(data => { if (!controller.signal.aborted && generation === epoch.current && !denied.current) setCourseTitle(data.name) })
      .catch(cause => {
        if (generation === epoch.current && isAccessError(cause)) revoke(cause.message)
      })
    return () => { controller.abort(); if (courseAbort.current === controller) courseAbort.current = null }
  }, [courseId, sessionStatus, accessVersion, revoke, readApi, invalidLessonScope, courseDenial])

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || denied.current || invalidLessonScope || courseDenial || probeVersion === 0) return
    const controller = new AbortController()
    const generation = epoch.current
    const contextLease = contextEpoch.current
    if (!contextProof.current || contextProof.current.lease !== contextLease || contextProof.current.scope !== listScopeRef.current) {
      contextProof.current = { lease: contextLease, scope: listScopeRef.current, lesson: JSON.parse(listScopeRef.current)[3] !== null, pending: true, unavailableScope: false, scopeAccess: null, contexts: new Map() }
    }
    probeAbort.current = controller
    const scope = listScopeRef.current
    const [, currentFilter, currentQuery, scopedPair] = JSON.parse(scope) as [string, Filter, string, CourseQaLessonContextPair | null]
    const retainedList = loadedListScope.current === scope ? listRef.current : null
    const ids = retainedList?.items.map(item => item.id) ?? []
    const checked = new Set(ids)
    const batches: string[][] = []
    for (let index = 0; index < ids.length; index += VISIBILITY_BATCH_SIZE) batches.push(ids.slice(index, index + VISIBILITY_BATCH_SIZE))
    if (!batches.length) batches.push([])
    void Promise.all(batches.map(async batch => {
      const result = await fetch(`${base}/revalidate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({ ids: batch, filter: currentFilter, q: currentQuery, lessonContext: scopedPair }),
      }).then(response => readApi<Visibility>(response, 'Kursfragen konnten nicht geprüft werden.'))
      const scopeAccess = verifyScope(result)
      if (!Array.isArray(result.visibleIds) || !Array.isArray(result.contexts)) throw new Error('Kursfragen konnten nicht geprüft werden.')
      const requested = new Set(batch)
      const visible = new Set(result.visibleIds)
      if (visible.size !== result.visibleIds.length || result.visibleIds.some(id => !requested.has(id)) || result.contexts.length !== visible.size) throw new Error('Kursfragen konnten nicht geprüft werden.')
      const contexts = new Map<string, CourseQaLessonContext>()
      for (const entry of result.contexts) {
        if (!visible.has(entry.id) || contexts.has(entry.id)) throw new Error('Lektionskontext konnte nicht geprüft werden.')
        const context = readLessonContext(entry.lessonContext, courseId)
        if (scopedPair && context?.status === 'current' && (context.publicationId !== scopedPair.publicationId || context.contentId !== scopedPair.contentId)) throw new Error('Lektionskontext konnte nicht geprüft werden.')
        contexts.set(entry.id, context)
      }
      return { ...result, ...scopeAccess, contexts }
    }))
      .then(results => {
        if (controller.signal.aborted || generation !== epoch.current || contextLease !== contextEpoch.current || denied.current || scope !== listScopeRef.current) return
        const access = results[0]
        if (results.some(result => !sameAccess(access, result) || JSON.stringify(result.scope) !== JSON.stringify(access.scope) || result.canAskInScope !== access.canAskInScope) || (rights.current && !sameAccess(rights.current, access))) { resetChangedRights(); return }
        rights.current = { canAsk: access.canAsk, canReply: access.canReply, canModerate: access.canModerate }
        if (retainedList && loadedListScope.current === scope) {
          const visible = new Set(results.flatMap(result => result.visibleIds))
          if (selectedIdRef.current && checked.has(selectedIdRef.current) && !visible.has(selectedIdRef.current)) { resetMissingQuestion(); return }
          const currentList = listRef.current
          if (currentList) listRef.current = { ...currentList, items: currentList.items.filter(item => !checked.has(item.id) || visible.has(item.id)) }
        }
        const proof = contextProof.current!
        for (const [id, context] of results.flatMap(result => [...result.contexts.entries()])) {
          // A fresh unavailable read is a monotonic veto within this cycle.
          if (proof.contexts.get(id)?.status !== 'unavailable') proof.contexts.set(id, context)
        }
        proof.pending = false
        proof.scopeAccess = { scope: access.scope, canAskInScope: access.canAskInScope }
        if (access.scope.kind === 'lesson' && access.scope.lessonContext.status === 'unavailable') proof.unavailableScope = true
        reconcileContexts(contextLease)
        // An uncaptured selected discussion keeps its own visibility authority.
        // Verify its metadata only with a read started after this proof settled.
        if (selectedIdRef.current && !proof.contexts.has(selectedIdRef.current) && !proof.unavailableScope) setDetailVersion(value => value + 1)
      })
      .catch(cause => {
        if (generation !== epoch.current || denied.current) return
        if (isAccessError(cause)) revoke(cause.message)
        else if (!controller.signal.aborted && contextLease === contextEpoch.current && scope === listScopeRef.current) revoke('Der Zugriff auf Kursfragen konnte nicht geprüft werden. Bitte versuche es erneut.', true)
      })
      .finally(() => { if (generation === epoch.current && contextLease === contextEpoch.current && scope === listScopeRef.current && !denied.current) setContextChecking(false) })
    return () => { controller.abort(); if (probeAbort.current === controller) probeAbort.current = null }
  }, [base, courseId, probeVersion, sessionStatus, invalidLessonScope, courseDenial, revoke, readApi, verifyScope, resetChangedRights, resetMissingQuestion, reconcileContexts])

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || denied.current || invalidLessonScope || courseDenial) return
    const controller = new AbortController()
    const generation = epoch.current
    const scope = scopeKey
    const contextLease = contextEpoch.current
    listAbort.current = controller
    moreAbort.current?.abort()
    const parameters = new URLSearchParams({ filter })
    if (query) parameters.set('q', query)
    if (lessonContext) { parameters.set('publicationId', lessonContext.publicationId); parameters.set('contentId', lessonContext.contentId) }
    queueMicrotask(() => { if (!controller.signal.aborted && generation === epoch.current && !denied.current) { if (loadedListScope.current !== scope) setListLoading(true); setListError(null) } })
    void fetch(`${base}?${parameters}`, { cache: 'no-store', signal: controller.signal })
      .then(response => readApi<QuestionList>(response, 'Fragen konnten nicht geladen werden.'))
      .then(verifyList)
      .then(data => {
        if (controller.signal.aborted || generation !== epoch.current || contextLease !== contextEpoch.current || denied.current || scope !== listScopeRef.current) return
        if (rights.current && !sameAccess(rights.current, data)) { resetChangedRights(); return }
        rights.current = { canAsk: data.canAsk, canReply: data.canReply, canModerate: data.canModerate }
        observeIncomingContexts(data.items, contextLease, data.scope)
        loadedListScope.current = scope; listRef.current = data
        reconcileContexts(contextLease)
        setContextChecking(Boolean(contextProof.current?.pending))
      })
      .catch(cause => {
        if (generation !== epoch.current || denied.current) return
        if (isAccessError(cause)) { revoke(cause.message); return }
        if (controller.signal.aborted || contextLease !== contextEpoch.current) return
        if (scope === listScopeRef.current) { loadedListScope.current = null; setList(null); setListError(cause instanceof Error ? cause.message : 'Fragen konnten nicht geladen werden.') }
      })
      .finally(() => { if (!controller.signal.aborted && generation === epoch.current && contextLease === contextEpoch.current && !denied.current && scope === listScopeRef.current) setListLoading(false) })
    return () => { controller.abort(); if (listAbort.current === controller) listAbort.current = null }
  }, [base, filter, query, scopeKey, listVersion, sessionStatus, revoke, readApi, verifyList, resetChangedRights, invalidLessonScope, courseDenial, pairKey, lessonContext, observeIncomingContexts, reconcileContexts])

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || denied.current || !selectedId) { queueMicrotask(() => { setDetail(null); setDetailError(null) }); return }
    const controller = new AbortController()
    const generation = epoch.current
    const scope = listScopeRef.current
    const contextLease = contextEpoch.current
    const proofAtStart = contextProof.current
    const independentContextRead = Boolean(proofAtStart && !proofAtStart.pending && !proofAtStart.unavailableScope && !proofAtStart.contexts.has(selectedId))
    detailAbort.current = controller
    queueMicrotask(() => { if (!controller.signal.aborted && generation === epoch.current && !denied.current) { if (detailRef.current?.question.id !== selectedId) { setDetail(null); setDetailLoading(true) }; setDetailError(null) } })
    void fetch(`${base}/${encodeURIComponent(selectedId)}`, { cache: 'no-store', signal: controller.signal })
      .then(response => readApi<QuestionDetail>(response, 'Die Frage konnte nicht geladen werden.'))
      .then(data => {
        if (controller.signal.aborted || generation !== epoch.current || contextLease !== contextEpoch.current || scope !== listScopeRef.current || denied.current || selectedIdRef.current !== selectedId) return
        if (rights.current && !sameAccess(rights.current, data)) { resetChangedRights(); return }
        rights.current = { canAsk: data.canAsk, canReply: data.canReply, canModerate: data.canModerate }
        const incoming = { ...data, question: { ...data.question, lessonContext: readLessonContext(data.question.lessonContext, courseId) } }
        observeIncomingContexts([incoming.question], contextLease)
        if (independentContextRead && proofAtStart === contextProof.current && proofAtStart && !proofAtStart.pending && !proofAtStart.unavailableScope && !proofAtStart.contexts.has(selectedId)) {
          proofAtStart.contexts.set(selectedId, incoming.question.lessonContext)
        }
        detailRef.current = incoming
        reconcileContexts(contextLease)
      })
      .catch(cause => {
        if (generation !== epoch.current || denied.current) return
        if (cause instanceof QaApiError && [401, 403].includes(cause.status)) { revoke(cause.message); return }
        if (controller.signal.aborted || contextLease !== contextEpoch.current || scope !== listScopeRef.current || selectedIdRef.current !== selectedId) return
        if (cause instanceof QaApiError && cause.status === 404) { resetMissingQuestion(); return }
        setDetail(null); setReply(''); setHideTarget(null)
        setDetailError(cause instanceof Error ? cause.message : 'Die Frage konnte nicht geladen werden.')
      })
      .finally(() => { if (!controller.signal.aborted && generation === epoch.current && !denied.current && selectedIdRef.current === selectedId) setDetailLoading(false) })
    return () => { controller.abort(); if (detailAbort.current === controller) detailAbort.current = null }
  }, [base, selectedId, detailVersion, sessionStatus, revoke, readApi, resetMissingQuestion, resetChangedRights, courseId, pairKey, scopeKey, observeIncomingContexts, reconcileContexts])

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return
    let last = 0
    const revalidate = () => {
      if (document.visibilityState !== 'visible' || denied.current || Date.now() - last < 1000) return
      last = Date.now()
      beginContextVerification()
      moreAbort.current?.abort(); detailAbort.current?.abort(); listAbort.current?.abort()
      moreLock.current = false; setMoreBusy(false)
      const retained = listRef.current
      if (!retained || loadedListScope.current !== listScopeRef.current) setListVersion(value => value + 1)
      setProbeVersion(value => value + 1)
      if (selectedIdRef.current) setDetailVersion(value => value + 1)
    }
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', revalidate)
    const timer = window.setInterval(revalidate, 15_000)
    return () => { window.removeEventListener('focus', revalidate); document.removeEventListener('visibilitychange', revalidate); window.clearInterval(timer) }
  }, [sessionStatus, beginContextVerification])

  const loadMore = async () => {
    if (!list?.nextCursor || moreLock.current || denied.current || contextChecking || loadedListScope.current !== listScopeRef.current) return
    moreLock.current = true
    const generation = epoch.current
    const scope = listScopeRef.current
    const contextLease = contextEpoch.current
    const cursor = list.nextCursor
    const controller = new AbortController()
    moreAbort.current = controller
    setMoreBusy(true)
    setNotice(null)
    try {
      const parameters = new URLSearchParams({ filter, cursor })
      if (query) parameters.set('q', query)
      if (lessonContext) { parameters.set('publicationId', lessonContext.publicationId); parameters.set('contentId', lessonContext.contentId) }
      const next = await fetch(`${base}?${parameters}`, { cache: 'no-store', signal: controller.signal }).then(response => readApi<QuestionList>(response, 'Weitere Fragen konnten nicht geladen werden.')).then(verifyList)
      if (!controller.signal.aborted && generation === epoch.current && contextLease === contextEpoch.current && !denied.current && scope === listScopeRef.current) {
        if (rights.current && !sameAccess(rights.current, next)) { resetChangedRights(); return }
        rights.current = { canAsk: next.canAsk, canReply: next.canReply, canModerate: next.canModerate }
        // The new page proves only its own metadata. Recheck all retained pages
        // before restoring their labels, even if publication changed mid-scroll.
        beginContextVerification()
        const previous = listRef.current
        if (previous?.nextCursor === cursor) {
          const merged = { ...next, canAskInScope: false, items: [...previous.items, ...next.items.filter(item => !previous.items.some(old => old.id === item.id))] }
          listRef.current = projectListContext(merged, contextEpoch.current)
          setList(listRef.current)
        }
        setProbeVersion(value => value + 1)
        if (selectedIdRef.current) setDetailVersion(value => value + 1)
      }
    } catch (cause) {
      if (generation === epoch.current && !denied.current) {
        if (isAccessError(cause)) revoke(cause.message)
        else if (!controller.signal.aborted && scope === listScopeRef.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : 'Weitere Fragen konnten nicht geladen werden.' })
      }
    } finally {
      if (moreAbort.current === controller) {
        moreAbort.current = null
        if (generation === epoch.current) { moreLock.current = false; if (!denied.current) setMoreBusy(false) }
      }
    }
  }

  const mutate = async (work: (isCurrent: () => boolean) => Promise<void>) => {
    if (mutationLock.current || denied.current) return
    mutationLock.current = true
    const generation = epoch.current
    const mutation = ++mutationSequence.current
    const scope = listScopeRef.current
    const isCurrent = () => alive.current && generation === epoch.current && scope === listScopeRef.current && !denied.current
    setBusy(true)
    setNotice(null)
    try { await work(isCurrent) }
    catch (cause) {
      if (!isCurrent()) return
      if (isAccessError(cause)) { revoke(cause.message); return }
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : 'Die Änderung konnte nicht gespeichert werden.' })
      // An uncertain write may have succeeded. Always re-read both views.
      refresh()
    } finally { if (generation === epoch.current && mutation === mutationSequence.current) { mutationLock.current = false; if (!denied.current) setBusy(false) } }
  }

  const ask = (event: FormEvent) => {
    event.preventDefault()
    if (!list?.canAsk || (!pendingQuestion.current && (!list.canAskInScope || contextChecking)) || title.trim().length < 5 || body.trim().length < 10) return
    void mutate(async isCurrent => {
      const payload = pendingQuestion.current ?? { title: title.trim(), body: body.trim(), requestId: crypto.randomUUID(), lessonContext }
      pendingQuestion.current = payload; setPendingCreate(true)
      const created = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(response => readApi<{ id?: string; question?: { id: string } }>(response, 'Deine Frage konnte nicht gesendet werden.'))
      if (!isCurrent()) return
      pendingQuestion.current = null; setPendingCreate(false)
      setTitle(''); setBody(''); setComposerOpen(false)
      setNotice({ kind: 'success', text: 'Deine Frage ist veröffentlicht.' })
      if (created.id || created.question?.id) setSelectedId(created.id ?? created.question!.id)
      refresh()
    })
  }

  const answer = (event: FormEvent) => {
    event.preventDefault()
    if (!selectedId || detail?.question.id !== selectedId || detail.question.hidden || !detail.canReply || reply.trim().length < 2) return
    void mutate(async isCurrent => {
      const requestId = pendingReplyId.current ?? crypto.randomUUID()
      pendingReplyId.current = requestId
      await fetch(`${base}/${encodeURIComponent(selectedId)}/answers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply.trim(), requestId }) })
        .then(response => readApi<unknown>(response, 'Deine Antwort konnte nicht gesendet werden.'))
      if (!isCurrent()) return
      pendingReplyId.current = null
      setReply('')
      setNotice({ kind: 'success', text: 'Deine Antwort ist veröffentlicht.' })
      refresh()
    })
  }

  const selectSolution = (answerId: string | null) => {
    if (!selectedId || detail?.question.id !== selectedId || !detail.canModerate) return
    void mutate(async isCurrent => {
      await fetch(`${base}/${encodeURIComponent(selectedId)}/solution`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answerId, expectedRevision: detail.question.revision }) })
        .then(response => readApi<unknown>(response, 'Die Markierung konnte nicht gespeichert werden.'))
      if (!isCurrent()) return
      setNotice({ kind: 'success', text: answerId ? 'Antwort als Lösung markiert.' : 'Lösungsmarkierung entfernt.' })
      refresh()
    })
  }

  const applyHidden = (target: HideTarget, hidden: boolean) => {
    if (denied.current || selectedIdRef.current !== target.questionId) return
    void mutate(async isCurrent => {
      const url = target.kind === 'question' ? `${base}/${encodeURIComponent(target.questionId)}` : `${base}/${encodeURIComponent(target.questionId)}/answers/${encodeURIComponent(target.answerId!)}`
      await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden }) })
        .then(response => readApi<unknown>(response, 'Der Beitrag konnte nicht geändert werden.'))
      if (!isCurrent()) return
      if (target.kind === 'question') setSelectedId(null)
      setNotice({ kind: 'success', text: target.kind === 'question' ? hidden ? 'Frage ausgeblendet.' : 'Frage wieder sichtbar.' : hidden ? 'Antwort ausgeblendet.' : 'Antwort wieder sichtbar.' })
      refresh()
    })
  }

  const setHidden = (kind: HideTarget['kind'], hidden: boolean, answerId?: string) => {
    if (!selectedId || detail?.question.id !== selectedId || !detail.canModerate) return
    const target: HideTarget = { kind, questionId: selectedId, answerId }
    if (hidden) setHideTarget(target)
    else applyHidden(target, false)
  }

  const closeComposer = () => {
    const ownsFocus = Boolean(document.activeElement?.closest('#qa-composer'))
    composerFocus.current = false
    setComposerOpen(false)
    if (ownsFocus) {
      if (lessonContext && !list?.canAskInScope && !pendingQuestion.current) courseScopeLink.current?.focus()
      else composerTrigger.current?.focus()
    }
  }
  useLayoutEffect(() => {
    if (!composerOpen || !list?.canAsk || !composerFocus.current || !composerTitle.current) return
    const focused = document.activeElement
    if (focused === document.body || focused === composerTrigger.current || focused?.id === 'page-content') composerTitle.current.focus()
    composerFocus.current = false
  }, [composerOpen, list?.canAsk])

  const showList = !selectedId
  const activeAccess = detail?.question.id === selectedId ? detail : list

  return <AppShell>
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader>
        <div className="app-header-row">
          <div className="app-header-title flex items-center gap-2"><CourseQaIcon className="h-5 w-5 shrink-0 text-muted-foreground" /><span className="text-sm font-semibold min-w-0">Kursfragen</span></div>
          <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
        </div>
      </AppHeader>
      <main id="page-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {invalidLessonScope ? <PageState kind="error" title="Lektionskontext ungültig" description="Öffne die Kursfragen oder wähle die Lektion erneut." action={<Link href={`/courses/${encodeURIComponent(courseId)}/qa`} className="inline-flex min-h-11 items-center rounded-md px-4 text-primary underline focus-visible:ring-2 focus-visible:ring-ring">Alle Kursfragen</Link>} /> : accessError ? <PageState kind="error" title={accessError.title} description={accessError.message} action={<RetryButton onClick={retryAccess} />} /> : <>
          <nav aria-label="Kurspfad" className="mb-4 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <Link href={`/courses/${encodeURIComponent(courseId)}/contents`} className="min-w-0 truncate rounded-sm hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{courseTitle}</Link>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="shrink-0 text-foreground">Fragen</span>
          </nav>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-5">
            <div className="min-w-0"><h1 className="break-words text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight [overflow-wrap:anywhere]">Fragen zum Kurs</h1><p className="mt-1 text-sm text-muted-foreground">Fragen und Antworten der Kursteilnehmenden.</p></div>
            {list?.canAsk && <Button ref={composerTrigger} type="button" className="h-auto min-h-11 max-w-full whitespace-normal [overflow-wrap:anywhere]" disabled={!composerOpen && !list.canAskInScope && !pendingCreate} onClick={() => { if (composerOpen) closeComposer(); else { composerFocus.current = true; setSelectedId(null); setComposerOpen(true) } }} aria-expanded={composerOpen} aria-controls="qa-composer">{composerOpen ? 'Schließen' : 'Frage stellen'}</Button>}
          </div>
          {lessonContext && <div className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-l-2 border-primary pl-4">
            <div className="min-w-0 flex-1">{contextChecking || !list ? <p className="text-sm text-muted-foreground">Lektionskontext wird geprüft …</p> : list.scope.kind === 'lesson' && <LessonContextLabel context={list.scope.lessonContext} link />}
              {list && !list.canAskInScope && !contextChecking && <p className="text-sm text-muted-foreground">Hier sind keine neuen Lektionsfragen möglich. Die bisherigen Gespräche bleiben verfügbar.</p>}</div>
            <Link ref={courseScopeLink} href={`/courses/${encodeURIComponent(courseId)}/qa`} className="inline-flex min-h-11 min-w-0 max-w-full items-center rounded-sm text-sm text-primary [overflow-wrap:anywhere] underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Alle Kursfragen</Link>
          </div>}
          {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-destructive/40 text-destructive' : 'bg-card'}`}><span>{notice.text}</span><Button type="button" variant="ghost" size="icon" className="-my-2 shrink-0" aria-label="Meldung schließen" onClick={() => setNotice(null)}><X className="h-4 w-4" /></Button></div>}
          {composerOpen && list?.canAsk && <form id="qa-composer" onSubmit={ask} className="mb-7 max-w-3xl space-y-4 rounded-2xl border bg-card p-4 sm:p-6" aria-label="Neue Frage">
            <h2 className="text-lg font-semibold">Neue Frage</h2><p className="text-sm text-muted-foreground">Deine Frage ist für die Kursteilnehmenden sichtbar.</p>{lessonContext && !list.canAskInScope && <p role="status" className="text-sm text-muted-foreground">{pendingCreate ? 'Du kannst den letzten Sendeversuch unverändert wiederholen.' : 'Der Lektionskontext ist derzeit nicht verfügbar.'}</p>}
            <div className="space-y-2"><Label htmlFor="qa-title">Titel</Label><Input ref={composerTitle} id="qa-title" value={title} onChange={event => { setTitle(event.target.value); pendingQuestion.current = null; setPendingCreate(false) }} required minLength={5} maxLength={140} disabled={busy} /></div>
            <div className="space-y-2"><Label htmlFor="qa-body">Frage</Label><Textarea id="qa-body" value={body} onChange={event => { setBody(event.target.value); pendingQuestion.current = null; setPendingCreate(false) }} required minLength={10} maxLength={4000} rows={5} disabled={busy} /></div>
            <div className="flex flex-wrap gap-2"><Button type="submit" className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]" disabled={busy || (!pendingCreate && (!list.canAskInScope || contextChecking)) || title.trim().length < 5 || body.trim().length < 10}>{busy ? 'Wird gesendet …' : pendingCreate ? 'Sendeversuch wiederholen' : 'Frage veröffentlichen'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={closeComposer}>Abbrechen</Button></div>
          </form>}
          {sessionStatus !== 'authenticated' ? <PageState kind="loading" title="Weiterleitung zur Anmeldung" /> : <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.6fr)] lg:gap-8">
            <section aria-label="Fragenliste" className={`min-w-0 ${showList ? '' : 'hidden lg:block'}`}>
              <form onSubmit={event => { event.preventDefault(); setQuery(searchInput.trim()) }} role="search" className="mb-3 flex min-w-0 gap-2"><Label htmlFor="qa-search" className="sr-only">Fragen suchen</Label><Input className="min-w-0" id="qa-search" type="search" maxLength={64} placeholder="Fragen suchen" value={searchInput} onChange={event => setSearchInput(event.target.value)} /><Button type="submit" variant="outline" size="icon" className="min-h-11 min-w-11 shrink-0" aria-label="Suche starten"><Search className="h-4 w-4" /></Button></form>
              <div role="group" aria-label="Fragen filtern" className="mb-3 flex flex-wrap gap-2">{(['all', 'open', 'answered', ...(list?.canModerate ? ['hidden'] as const : [])] as Filter[]).map(value => <Button key={value} type="button" variant={filter === value ? 'secondary' : 'ghost'} size="sm" className="min-h-11" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'Alle' : value === 'open' ? 'Offen' : value === 'answered' ? 'Beantwortet' : 'Ausgeblendet'}</Button>)}</div>
              {listError ? <PageState kind="error" title="Fragen konnten nicht geladen werden" description={listError} action={<RetryButton onClick={() => setListVersion(value => value + 1)} />} /> : listLoading ? <PageState kind="loading" title="Fragen werden geladen" /> : !list?.items.length ? <PageState title={query ? 'Keine Treffer' : filter === 'hidden' ? 'Keine ausgeblendeten Fragen' : 'Noch keine Fragen'} description={query ? 'Versuche einen anderen Suchbegriff.' : filter === 'hidden' ? undefined : list?.canAskInScope ? 'Stelle die erste Frage zu diesem Kurs.' : 'Hier erscheinen Fragen zum Kurs.'} action={query ? <Button variant="outline" onClick={() => { setSearchInput(''); setQuery('') }}>Suche zurücksetzen</Button> : undefined} /> : <><p className="mb-2 text-xs text-muted-foreground" role="status">{list.items.length} {list.nextCursor ? 'Fragen geladen' : list.items.length === 1 ? 'Frage' : 'Fragen'}</p><ul className="divide-y border-y">{list.items.map(question => <li key={question.id}><button type="button" onClick={() => { setSelectedId(question.id); setComposerOpen(false) }} aria-current={selectedId === question.id ? 'true' : undefined} className={`w-full min-w-0 rounded-sm px-3 py-4 text-left motion-safe:transition-colors hover:bg-secondary/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === question.id ? 'bg-accent text-accent-foreground' : ''}`}><span className="block break-words font-semibold [overflow-wrap:anywhere]">{question.title}</span><LessonContextLabel context={question.lessonContext} /><span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{question.author.name}</span><span aria-hidden="true">·</span><span>{formatDate(question.createdAt)}</span><span aria-hidden="true">·</span><span>{question.hidden ? 'Ausgeblendet' : question.acceptedAnswerId ? 'Beantwortet' : 'Offen'}</span>{typeof question.answerCount === 'number' && <><span aria-hidden="true">·</span><span>{question.answerCount} {question.answerCount === 1 ? 'Antwort' : 'Antworten'}</span></>}</span></button></li>)}</ul></>}
              {!listError && !listLoading && list?.nextCursor && <Button type="button" variant="outline" className="mt-4 w-full" disabled={moreBusy || contextChecking} onClick={() => void loadMore()}>{moreBusy ? 'Wird geladen …' : 'Weitere Fragen laden'}</Button>}
            </section>
            <section aria-label="Frage und Antworten" className={`min-w-0 ${showList ? 'hidden lg:block' : ''}`}>
              {!selectedId ? <div className="hidden min-h-56 items-center justify-center rounded-2xl border border-dashed px-6 text-center text-sm text-muted-foreground lg:flex">Wähle eine Frage aus der Liste.</div> : <>
                <Button type="button" variant="ghost" className="mb-4 -ml-3 lg:hidden" onClick={() => setSelectedId(null)}><ArrowLeft className="h-4 w-4" />Alle Fragen</Button>
                {detailLoading ? <PageState kind="loading" title="Frage wird geladen" /> : detailError ? <PageState kind="error" title="Frage konnte nicht geladen werden" description={detailError} action={<RetryButton onClick={() => setDetailVersion(value => value + 1)} />} /> : detail && detail.question.id === selectedId && <article className="min-w-0">
                  <div className="border-b pb-6"><div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{detail.question.hidden ? 'Ausgeblendet' : detail.question.acceptedAnswerId ? 'Beantwortet' : 'Offen'}</span><span aria-hidden="true">·</span><span>{detail.question.author.name}</span><span aria-hidden="true">·</span><time dateTime={detail.question.createdAt}>{formatDate(detail.question.createdAt)}</time></div><h2 className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{detail.question.title}</h2><div className="mt-3"><LessonContextLabel context={detail.question.lessonContext} link /></div><p className="mt-4 whitespace-pre-wrap break-words text-base leading-relaxed [overflow-wrap:anywhere]">{detail.question.body}</p>{detail.canModerate && <Button type="button" variant="ghost" size="sm" className={`mt-4 ${detail.question.hidden ? '' : 'text-destructive hover:text-destructive hover:bg-destructive/10'}`} disabled={busy} onClick={() => setHidden('question', !detail.question.hidden)}>{detail.question.hidden ? 'Frage wieder anzeigen' : 'Frage ausblenden'}</Button>}</div>
                  <div className="mt-7"><div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"><h3 className="text-lg font-semibold">Antworten <span className="text-sm font-normal text-muted-foreground">{detail.answers.length}</span></h3>{detail.canModerate && !detail.question.hidden && detail.question.acceptedAnswerId && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => selectSolution(null)}>Lösungsmarkierung entfernen</Button>}</div>
                    {!detail.answers.length ? <p className="py-8 text-sm text-muted-foreground">Noch keine Antworten.</p> : <ol className="divide-y">{detail.answers.map(item => <li key={item.id} className="py-5"><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{item.author.name}</span><span aria-hidden="true">·</span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>{item.hidden && <span>Ausgeblendet</span>}{detail.question.acceptedAnswerId === item.id && <span className="inline-flex min-w-0 max-w-full items-center gap-1 break-words rounded-full bg-secondary [overflow-wrap:anywhere] px-2 py-1 text-foreground"><Check className="h-3 w-3" aria-hidden="true" />{detail.question.lessonContext?.status === 'unavailable' ? 'Für diese frühere Frage ausgewählt' : 'Lösung'}</span>}</div>{detail.question.acceptedAnswerId === item.id && detail.question.lessonContext?.status === 'unavailable' && <p className="mt-2 text-sm text-muted-foreground">Die Auswahl bezieht sich auf diese Frage; sie bestätigt keine Lösung für die aktuelle Kursfassung.</p>}<p className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed [overflow-wrap:anywhere]">{item.body}</p>{detail.canModerate && <div className="mt-3 flex flex-wrap gap-2">{!detail.question.hidden && !item.hidden && detail.question.acceptedAnswerId !== item.id && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => selectSolution(item.id)}>Als Lösung markieren</Button>}<Button type="button" variant="ghost" size="sm" className={item.hidden ? '' : 'text-destructive hover:text-destructive hover:bg-destructive/10'} disabled={busy} onClick={() => setHidden('answer', !item.hidden, item.id)}>{item.hidden ? 'Antwort wieder anzeigen' : 'Antwort ausblenden'}</Button></div>}</li>)}</ol>}
                  </div>
                  {activeAccess?.canReply && !detail.question.hidden && <form onSubmit={answer} className="mt-5 space-y-3 border-t pt-6"><h3 className="text-lg font-semibold">Antwort schreiben</h3><Label htmlFor="qa-reply">Deine Antwort</Label><Textarea id="qa-reply" value={reply} onChange={event => { setReply(event.target.value); pendingReplyId.current = null }} rows={4} required minLength={2} maxLength={4000} disabled={busy} /><Button type="submit" disabled={busy || reply.trim().length < 2}>{busy ? 'Wird gesendet …' : 'Antwort veröffentlichen'}</Button></form>}
                </article>}
              </>}
            </section>
          </div>}
          </>}
        </div>
      </main>
    </div>
    <AlertDialog open={Boolean(hideTarget)} onOpenChange={open => { if (!open) setHideTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{hideTarget?.kind === 'question' ? 'Frage ausblenden?' : 'Antwort ausblenden?'}</AlertDialogTitle>
          <AlertDialogDescription>{hideTarget?.kind === 'question' ? 'Die Frage und ihre Antworten werden für Lernende ausgeblendet.' : 'Die Antwort wird für Lernende ausgeblendet.'}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (hideTarget) { const target = hideTarget; setHideTarget(null); applyHidden(target, true) } }}>Ausblenden</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>
}
