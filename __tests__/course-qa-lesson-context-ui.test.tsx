import React, { act, Suspense } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import CourseQaPage from '@/app/courses/[courseId]/qa/page'
import type { CourseQaLessonContext, CourseQaLessonContextPair } from '@/lib/course-qa-context-contract'

let mockSession = { user: { id: 'learner', role: 'USER' } }
const mockReplace = jest.fn()
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession, status: 'authenticated' }) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }))
jest.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, AppHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => <button>Konto</button> }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))

const courseId = 'context-course'
const params = Promise.resolve({ courseId })
const pairA = { publicationId: 'publication-a', contentId: 'lesson-a' }
const pairB = { publicationId: 'publication-b', contentId: 'lesson-b' }
const rights = { canAsk: true, canReply: true, canModerate: false }
const unavailable = { status: 'unavailable' as const }
const context = (pair = pairA, title = pair.publicationId === pairB.publicationId ? 'New lesson' : 'Private current lesson'): CourseQaLessonContext => ({ ...pair, title, status: 'current', href: `/courses/${courseId}/contents?content=${pair.contentId}` })
const question = (id: string, lessonContext: CourseQaLessonContext = context()) => ({ id, title: `Discussion ${id}`, body: `The authored discussion body for ${id}`, createdAt: '2026-10-16T21:00:00Z', author: { id: 'learner', name: 'Learner' }, acceptedAnswerId: null as string | null, revision: null, lessonContext })
const scope = (pair: CourseQaLessonContextPair | null, current = true) => pair ? { kind: 'lesson', lessonContext: current ? context(pair) : unavailable } : { kind: 'course' }
const list = (items: ReturnType<typeof question>[], pair: CourseQaLessonContextPair | null = pairA, current = true, nextCursor: string | null = null) => ({ ...rights, items, nextCursor, scope: scope(pair, current), canAskInScope: !pair || current })
const probe = (ids: string[], pair: CourseQaLessonContextPair | null, current = true) => ({ ...rights, visibleIds: ids, contexts: ids.map(id => ({ id, lessonContext: current ? context(pair ?? pairA) : unavailable })), scope: scope(pair, current), canAskInScope: !pair || current })
const response = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value }) as Response
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
type Search = { [key: string]: string | string[] | undefined }
const search = (pair: CourseQaLessonContextPair | null = pairA, ask?: string): Search => ({ ...(pair ?? {}), ...(ask ? { ask } : {}) })
const route = (query: Search) => <Suspense fallback={<div>Route loading</div>}><CourseQaPage params={params} searchParams={Promise.resolve(query)} /></Suspense>
async function show(query: Search = search()) { let view!: ReturnType<typeof render>; await act(async () => { view = render(route(query)) }); return view }
async function change(view: ReturnType<typeof render>, query: Search) { await act(async () => { view.rerender(route(query)) }) }
let handler: (url: URL, init?: RequestInit) => Response | Promise<Response>
beforeEach(() => {
  mockSession = { user: { id: 'learner', role: 'USER' } }
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  handler = (url, init) => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Course' })
    const pair = url.searchParams.get('publicationId') === pairB.publicationId ? pairB : pairA
    if (url.pathname.endsWith('/revalidate')) { const body = JSON.parse(String(init?.body)); return response(probe(body.ids, body.lessonContext)) }
    return response(list([], pair))
  }
  global.fetch = jest.fn((input, init) => Promise.resolve(handler(new URL(String(input), 'http://localhost'), init)))
})
afterEach(() => { jest.restoreAllMocks() })

it('uses the exact pair whitelist, blank composer, deliberate repeatable opening, and return focus', async () => {
  await show({ ...search(pairA, '1'), injected: 'ignored' })
  const title = await screen.findByRole('textbox', { name: 'Titel' })
  expect(title).toHaveValue(''); expect(screen.getByRole('textbox', { name: /^Frage$/ })).toHaveValue('')
  expect(title).toHaveFocus()
  const reads = (global.fetch as jest.Mock).mock.calls.map(call => new URL(call[0], 'http://localhost')).filter(url => url.pathname.endsWith('/qa'))
  expect([...reads[0].searchParams.keys()].sort()).toEqual(['contentId', 'filter', 'publicationId'])
  expect(screen.getByRole('link', { name: 'Alle Kursfragen' })).toHaveAttribute('href', `/courses/${courseId}/qa`)
  for (let index = 0; index < 2; index++) {
    const close = screen.getByRole('button', { name: 'Abbrechen' }); close.focus(); fireEvent.click(close)
    const trigger = screen.getByRole('button', { name: 'Frage stellen' }); expect(trigger).toHaveFocus()
    fireEvent.click(trigger); expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveFocus()
  }
})

it('does not let a query grant access or a delayed proof steal external focus', async () => {
  const proof = deferred<Response>()
  handler = url => url.pathname.endsWith('/qa') ? proof.promise : response({ name: 'Course' })
  await show(search(pairA, '1'))
  expect(screen.queryByRole('textbox', { name: 'Titel' })).not.toBeInTheDocument()
  const account = screen.getByRole('button', { name: 'Konto' }); account.focus()
  await act(async () => { proof.resolve(response(list([]))); await proof.promise })
  expect(await screen.findByRole('textbox', { name: 'Titel' })).toHaveValue('')
  expect(account).toHaveFocus()
})

it.each([{ publicationId: ['a', 'b'], contentId: 'lesson' }, { publicationId: 'a' }, { publicationId: '', contentId: 'b' }])('rejects malformed or duplicated lesson scope without course fallback: %j', async query => {
  await show(query)
  expect(await screen.findByText('Lektionskontext ungültig')).toBeInTheDocument()
  expect(global.fetch).not.toHaveBeenCalled()
})

it('replaces every retained page context while retaining discussion, answers, and original chosen answer', async () => {
  const first = question('first'); const older = question('older', context(pairA, 'Secret older lesson title')); older.acceptedAnswerId = 'answer'
  const answer = { id: 'answer', body: 'Still authorized original answer', createdAt: first.createdAt, author: first.author }
  let current = true
  const pending = deferred<Response>()
  handler = (url, init) => {
    if (url.pathname.endsWith('/revalidate')) { const body = JSON.parse(String(init?.body)); expect(body).toMatchObject({ filter: 'all', q: '', lessonContext: pairA }); return pending.promise }
    if (url.pathname.endsWith('/older')) return response({ ...rights, question: { ...older, lessonContext: current ? older.lessonContext : unavailable }, answers: [answer] })
    if (url.pathname.endsWith('/qa')) return response(url.searchParams.has('cursor') ? list([older]) : list([first], pairA, true, 'next'))
    return response({ name: 'Course' })
  }
  await show(); await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Fragen laden' })); await screen.findByText(older.title)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(older.title) })); await screen.findByText(answer.body)
  current = false
  act(() => { fireEvent.focus(window) })
  // Metadata is suppressed while proof is outstanding, across list and detail.
  expect(document.body.innerHTML).not.toContain('Secret older lesson title')
  expect(screen.queryAllByRole('link', { name: 'Lektion öffnen' })).toHaveLength(0)
  await act(async () => { pending.resolve(response(probe([first.id, older.id], pairA, false))); await pending.promise })
  expect(screen.getByText(first.title)).toBeInTheDocument(); expect(screen.getByRole('heading', { name: older.title })).toBeInTheDocument()
  expect(screen.getByText(answer.body)).toBeInTheDocument()
  expect(screen.getByText('Für diese frühere Frage ausgewählt')).toBeInTheDocument()
  expect(screen.getByText('Die Auswahl bezieht sich auf diese Frage; sie bestätigt keine Lösung für die aktuelle Kursfassung.')).toBeInTheDocument()
  expect(document.body.innerHTML).not.toContain(pairA.contentId)
  expect(document.body.innerHTML).not.toContain(pairA.publicationId)
  expect(screen.getByRole('button', { name: 'Frage stellen' })).toBeDisabled()
})

it.each(['missing', 'duplicate'])('purges the whole list on %s context entries', async kind => {
  const row = question('one')
  handler = (url, init) => url.pathname.endsWith('/revalidate') ? response({ ...probe([row.id], pairA), contexts: kind === 'missing' ? [] : [{ id: row.id, lessonContext: context() }, { id: row.id, lessonContext: unavailable }] }) : url.pathname.endsWith('/qa') ? response(list([row])) : response({ name: 'Course' })
  await show(); await screen.findByText(row.title)
  act(() => { fireEvent.focus(window) })
  await screen.findByText('Kursfragen vorübergehend nicht verfügbar')
  expect(document.body.innerHTML).not.toContain('Private current lesson'); expect(screen.queryByText(row.title)).not.toBeInTheDocument()
})

it('atomically purges all 201 retained rows when a later context batch fails', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => question(`row-${index}`))
  handler = (url, init) => {
    if (url.pathname.endsWith('/revalidate')) { const body = JSON.parse(String(init?.body)); return body.ids.includes('row-200') ? response({}, 500) : response(probe(body.ids, pairA)) }
    return url.pathname.endsWith('/qa') ? response(list(rows)) : response({ name: 'Course' })
  }
  await show(); await screen.findByText('Discussion row-200'); act(() => { fireEvent.focus(window) })
  await screen.findByText('Kursfragen vorübergehend nicht verfügbar')
  expect(screen.queryByText('Discussion row-0')).not.toBeInTheDocument(); expect(screen.queryByText('Discussion row-200')).not.toBeInTheDocument()
})

it('retries a lost POST with identical requestId, text, and pair after context becomes unavailable', async () => {
  const posts: string[] = []; let current = true
  const created = question('created', unavailable)
  handler = (url, init) => {
    if (init?.method === 'POST' && url.pathname.endsWith('/qa')) {
      posts.push(String(init.body)); current = false
      if (posts.length === 1) return Promise.reject(new Error('Response lost'))
      return response({ created: false, question: created })
    }
    if (url.pathname.endsWith('/created')) return response({ ...rights, question: created, answers: [] })
    return url.pathname.endsWith('/qa') ? response(list(current ? [] : [created], pairA, current)) : response({ name: 'Course' })
  }
  await show(search(pairA, '1'))
  fireEvent.change(await screen.findByRole('textbox', { name: 'Titel' }), { target: { value: 'A learner-authored title' } })
  fireEvent.change(screen.getByRole('textbox', { name: /^Frage$/ }), { target: { value: 'A learner-authored question body' } })
  fireEvent.click(screen.getByRole('button', { name: 'Frage veröffentlichen' }))
  const retry = await screen.findByRole('button', { name: 'Sendeversuch wiederholen' })
  await screen.findByText('Du kannst den letzten Sendeversuch unverändert wiederholen.')
  expect(posts).toHaveLength(1); expect(retry).toBeEnabled()
  fireEvent.click(retry); await screen.findByText('Deine Frage ist veröffentlicht.')
  expect(posts).toHaveLength(2); expect(posts[1]).toBe(posts[0]); expect(JSON.parse(posts[1])).toMatchObject({ lessonContext: pairA })
})

it.each(['list', 'more', 'detail', 'probe', 'mutation'])('ignores a late %s success after lesson A to B', async source => {
  const pending = deferred<Response>(); const row = question('old'); const fresh = question('new', context(pairB, 'New lesson'))
  handler = (url, init) => {
    if (url.pathname.endsWith('/revalidate')) return pending.promise
    if (source === 'mutation' && init?.method === 'POST') return pending.promise
    if (url.pathname.endsWith('/old')) return source === 'detail' ? pending.promise : response({ ...rights, question: row, answers: [] })
    if (url.pathname.endsWith('/qa')) {
      if (url.searchParams.get('publicationId') === pairB.publicationId) return response(list([fresh], pairB))
      if (source === 'list' || url.searchParams.has('cursor')) return pending.promise
      return response(list([row], pairA, true, 'more'))
    }
    return response({ name: 'Course' })
  }
  const view = await show(search(pairA, source === 'mutation' ? '1' : undefined))
  if (source !== 'list') await screen.findByText(row.title)
  if (source === 'more') fireEvent.click(screen.getByRole('button', { name: 'Weitere Fragen laden' }))
  if (source === 'detail') fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) }))
  if (source === 'probe') act(() => { fireEvent.focus(window) })
  if (source === 'mutation') {
    fireEvent.change(screen.getByRole('textbox', { name: 'Titel' }), { target: { value: 'Old authored title' } }); fireEvent.change(screen.getByRole('textbox', { name: /^Frage$/ }), { target: { value: 'Old authored question body' } }); fireEvent.click(screen.getByRole('button', { name: 'Frage veröffentlichen' }))
  }
  await change(view, search(pairB)); await screen.findByText(fresh.title)
  await act(async () => { pending.resolve(response(source === 'probe' ? probe([row.id], pairA) : source === 'detail' ? { ...rights, question: row, answers: [] } : source === 'mutation' ? { question: row } : list([row]))); await pending.promise })
  expect(screen.queryByText(row.title)).not.toBeInTheDocument(); expect(screen.getByText(fresh.title)).toBeInTheDocument()
  expect(document.body.innerHTML).not.toContain('Private current lesson'); expect(screen.queryByText('Deine Frage ist veröffentlicht.')).not.toBeInTheDocument()
})

it('honors a late old-lesson whole-course denial after a pair remount', async () => {
  const pending = deferred<Response>(); const fresh = question('new', context(pairB))
  handler = url => url.pathname.endsWith('/qa') ? url.searchParams.get('publicationId') === pairA.publicationId ? pending.promise : response(list([fresh], pairB)) : response({ name: 'Course' })
  const view = await show(); await change(view, search(pairB)); await screen.findByText(fresh.title)
  await act(async () => { pending.resolve(response({}, 403)); await pending.promise })
  await screen.findByText('Kein Zugriff auf Kursfragen'); expect(screen.queryByText(fresh.title)).not.toBeInTheDocument()
})

it.each([200, 403])('drops late old-account response %s without contaminating the new account', async status => {
  const pending = deferred<Response>(); const fresh = question('new-account', null)
  handler = url => url.pathname.endsWith('/qa') ? mockSession.user.id === 'learner' ? pending.promise : response(list([fresh], null)) : response({ name: 'Course' })
  const view = await show(); mockSession = { user: { id: 'different-account', role: 'USER' } }; await change(view, search(null)); await screen.findByText(fresh.title)
  await act(async () => { pending.resolve(response(status === 200 ? list([question('old-account')]) : {}, status)); await pending.promise })
  expect(screen.getByText(fresh.title)).toBeInTheDocument(); expect(screen.queryByText('Kein Zugriff auf Kursfragen')).not.toBeInTheDocument()
})

it('keeps an initial unavailable lesson scope disabled and never silently creates a course question', async () => {
  handler = url => url.pathname.endsWith('/qa') ? response(list([question('historical', unavailable)], pairA, false)) : response({ name: 'Course' })
  await show(search(pairA, '1'))
  fireEvent.change(await screen.findByRole('textbox', { name: 'Titel' }), { target: { value: 'An original title' } })
  fireEvent.change(screen.getByRole('textbox', { name: /^Frage$/ }), { target: { value: 'An original authored body' } })
  const submit = screen.getByRole('button', { name: 'Frage veröffentlichen' })
  expect(submit).toBeDisabled(); fireEvent.click(submit)
  expect((global.fetch as jest.Mock).mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0)
  expect(screen.getByText('Discussion historical')).toBeInTheDocument()
  const cancel = screen.getByRole('button', { name: 'Abbrechen' }); cancel.focus(); fireEvent.click(cancel)
  expect(screen.getByRole('link', { name: 'Alle Kursfragen' })).toHaveFocus()
  expect(document.body.innerHTML).not.toContain(pairA.publicationId); expect(document.body.innerHTML).not.toContain(pairA.contentId)
})

it.each(['detail-first', 'probe-first'])('makes the atomic probe verdict authoritative over stale detail: %s', async order => {
  const row = question('race'); row.acceptedAnswerId = 'chosen'
  const answer = { id: 'chosen', body: 'Authorized answer survives the metadata race', createdAt: row.createdAt, author: row.author }
  const oldDetail = deferred<Response>(); const verdict = deferred<Response>(); let detailReads = 0
  handler = url => {
    if (url.pathname.endsWith('/revalidate')) return verdict.promise
    if (url.pathname.endsWith('/race')) { detailReads += 1; return detailReads === 2 ? oldDetail.promise : response({ ...rights, question: row, answers: [answer] }) }
    return url.pathname.endsWith('/qa') ? response(list([row])) : response({ name: 'Course' })
  }
  await show(); await screen.findByText(row.title); fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) })); await screen.findByText(answer.body)
  const account = screen.getByRole('button', { name: 'Konto' }); account.focus(); act(() => { fireEvent.focus(window) })
  const noMetadata = () => { expect(document.body.innerHTML).not.toContain('Private current lesson'); expect(screen.queryAllByRole('link', { name: 'Lektion öffnen' })).toHaveLength(0); expect(document.body.innerHTML).not.toContain(pairA.contentId) }
  noMetadata()
  const finishDetail = async () => { await act(async () => { oldDetail.resolve(response({ ...rights, question: row, answers: [answer] })); await oldDetail.promise }) }
  const finishProbe = async () => { await act(async () => { verdict.resolve(response(probe([row.id], pairA, false))); await verdict.promise }) }
  if (order === 'detail-first') { await finishDetail(); noMetadata(); await finishProbe() } else { await finishProbe(); noMetadata(); await finishDetail() }
  noMetadata(); expect(screen.getByText(answer.body)).toBeInTheDocument(); expect(screen.getByText('Für diese frühere Frage ausgewählt')).toBeInTheDocument(); expect(account).toHaveFocus()
  // Closing/reopening cannot grant the same-generation stale DTO fresh authority.
  fireEvent.click(screen.getByRole('button', { name: 'Alle Fragen' })); fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) })); await screen.findByRole('heading', { name: row.title }); noMetadata()
})

it.each(['pending', 'unavailable'])('keeps mutation-triggered list/detail refreshes neutral after the probe becomes %s', async phase => {
  const row = question('mutation-race'); const answerWrite = deferred<Response>(); const verdict = deferred<Response>()
  handler = (url, init) => {
    if (url.pathname.endsWith('/revalidate')) return verdict.promise
    if (url.pathname.endsWith('/answers') && init?.method === 'POST') return answerWrite.promise
    if (url.pathname.endsWith('/mutation-race')) return response({ ...rights, question: row, answers: [] })
    return url.pathname.endsWith('/qa') ? response(list([row])) : response({ name: 'Course' })
  }
  await show(); await screen.findByText(row.title); fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) })); await screen.findByRole('heading', { name: row.title })
  fireEvent.change(screen.getByRole('textbox', { name: 'Deine Antwort' }), { target: { value: 'A normal authorized reply' } }); fireEvent.click(screen.getByRole('button', { name: 'Antwort veröffentlichen' }))
  act(() => { fireEvent.focus(window) })
  if (phase === 'unavailable') await act(async () => { verdict.resolve(response(probe([row.id], pairA, false))); await verdict.promise })
  await act(async () => { answerWrite.resolve(response({ created: true })); await answerWrite.promise })
  await screen.findByText('Deine Antwort ist veröffentlicht.')
  expect(document.body.innerHTML).not.toContain('Private current lesson'); expect(screen.queryAllByRole('link', { name: 'Lektion öffnen' })).toHaveLength(0)
  if (phase === 'pending') await act(async () => { verdict.resolve(response(probe([row.id], pairA, false))); await verdict.promise })
  expect(document.body.innerHTML).not.toContain('Private current lesson'); expect(screen.getByRole('button', { name: 'Frage stellen' })).toBeDisabled()
})

it('a failed atomic probe purges both views and a later old detail cannot restore either', async () => {
  const row = question('failed-race'); const oldDetail = deferred<Response>(); const verdict = deferred<Response>(); let reads = 0
  handler = url => url.pathname.endsWith('/revalidate') ? verdict.promise : url.pathname.endsWith('/failed-race') ? ++reads === 1 ? response({ ...rights, question: row, answers: [] }) : oldDetail.promise : url.pathname.endsWith('/qa') ? response(list([row])) : response({ name: 'Course' })
  await show(); await screen.findByText(row.title); fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) })); await screen.findByRole('heading', { name: row.title })
  act(() => { fireEvent.focus(window) }); await act(async () => { verdict.resolve(response({}, 500)); await verdict.promise })
  await screen.findByText('Kursfragen vorübergehend nicht verfügbar')
  await act(async () => { oldDetail.resolve(response({ ...rights, question: row, answers: [] })); await oldDetail.promise })
  expect(document.body.innerHTML).not.toContain('Private current lesson'); expect(screen.queryByText(row.title)).not.toBeInTheDocument()
})

it('a superseded probe and old detail stay suppressed until the newer cycle verifies them', async () => {
  const row = question('abort-race'); const oldDetail = deferred<Response>(); const older = deferred<Response>(); const newer = deferred<Response>(); let probes = 0; let reads = 0
  handler = url => url.pathname.endsWith('/revalidate') ? ++probes === 1 ? older.promise : newer.promise : url.pathname.endsWith('/abort-race') ? ++reads === 1 ? response({ ...rights, question: row, answers: [] }) : oldDetail.promise : url.pathname.endsWith('/qa') ? response(list([row])) : response({ name: 'Course' })
  await show(); await screen.findByText(row.title); fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) })); await screen.findByRole('heading', { name: row.title })
  const now = jest.spyOn(Date, 'now').mockReturnValue(10_000); act(() => { fireEvent.focus(window) })
  now.mockReturnValue(11_001); act(() => { fireEvent.focus(window) })
  await act(async () => { older.resolve(response(probe([row.id], pairA))); oldDetail.resolve(response({ ...rights, question: row, answers: [] })); await Promise.all([older.promise, oldDetail.promise]) })
  expect(document.body.innerHTML).not.toContain('Private current lesson'); expect(screen.queryAllByRole('link', { name: 'Lektion öffnen' })).toHaveLength(0)
  await act(async () => { newer.resolve(response(probe([row.id], pairA, false))); await newer.promise })
  expect(document.body.innerHTML).not.toContain('Private current lesson')
})

it('keeps a real delayed whole-course denial authoritative after a neutral context verdict', async () => {
  const row = question('denial-race'); const oldDetail = deferred<Response>(); let reads = 0
  handler = url => url.pathname.endsWith('/revalidate') ? response(probe([row.id], pairA, false)) : url.pathname.endsWith('/denial-race') ? ++reads === 1 ? response({ ...rights, question: row, answers: [] }) : oldDetail.promise : url.pathname.endsWith('/qa') ? response(list([row])) : response({ name: 'Course' })
  await show(); await screen.findByText(row.title); fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) })); await screen.findByRole('heading', { name: row.title })
  act(() => { fireEvent.focus(window) }); await screen.findByText('Hier sind keine neuen Lektionsfragen möglich. Die bisherigen Gespräche bleiben verfügbar.')
  await act(async () => { oldDetail.resolve(response({}, 403)); await oldDetail.promise })
  await screen.findByText('Kein Zugriff auf Kursfragen'); expect(screen.queryByText(row.title)).not.toBeInTheDocument()
})

it('preserves an explicit null context verdict over a conflicting same-cycle detail', async () => {
  const row = question('legacy', null); const oldDetail = deferred<Response>(); let reads = 0
  handler = url => url.pathname.endsWith('/revalidate') ? response({ ...probe([row.id], null), contexts: [{ id: row.id, lessonContext: null }] }) : url.pathname.endsWith('/legacy') ? ++reads === 1 ? response({ ...rights, question: row, answers: [] }) : oldDetail.promise : url.pathname.endsWith('/qa') ? response(list([row], null)) : response({ name: 'Course' })
  await show(search(null)); await screen.findByText(row.title); fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) })); await screen.findByRole('heading', { name: row.title })
  act(() => { fireEvent.focus(window) }); await act(async () => { oldDetail.resolve(response({ ...rights, question: { ...row, lessonContext: context() }, answers: [] })); await oldDetail.promise })
  expect(document.body.innerHTML).not.toContain('Private current lesson'); expect(screen.queryByText('Früherer oder nicht verfügbarer Lektionskontext')).not.toBeInTheDocument()
})

it('a later complete verification generation can restore current labels in both surfaces', async () => {
  const row = question('restore'); let current = false
  handler = url => url.pathname.endsWith('/revalidate') ? response(probe([row.id], pairA, current)) : url.pathname.endsWith('/restore') ? response({ ...rights, question: row, answers: [] }) : url.pathname.endsWith('/qa') ? response(list([row])) : response({ name: 'Course' })
  await show(); await screen.findByText(row.title); fireEvent.click(screen.getByRole('button', { name: new RegExp(row.title) })); await screen.findByRole('heading', { name: row.title })
  const now = jest.spyOn(Date, 'now').mockReturnValue(10_000); act(() => { fireEvent.focus(window) })
  await screen.findByText('Hier sind keine neuen Lektionsfragen möglich. Die bisherigen Gespräche bleiben verfügbar.'); expect(document.body.innerHTML).not.toContain('Private current lesson')
  current = true; now.mockReturnValue(11_001); act(() => { fireEvent.focus(window) })
  await screen.findAllByText('Zu dieser Lektion: Private current lesson'); expect(screen.getAllByRole('link', { name: 'Lektion öffnen' })).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Frage stellen' })).toBeEnabled()
})

it('independently verifies a selected question outside the retained filter only after the atomic proof settles', async () => {
  const retained = question('retained', null); const created = question('outside-filter'); const pendingOldDetail = deferred<Response>(); const verdict = deferred<Response>(); let detailReads = 0
  handler = (url, init) => {
    if (url.pathname.endsWith('/revalidate')) return verdict.promise
    if (url.pathname.endsWith('/qa') && init?.method === 'POST') return response({ question: created })
    if (url.pathname.endsWith('/outside-filter')) { detailReads += 1; return detailReads === 2 ? pendingOldDetail.promise : response({ ...rights, question: created, answers: [] }) }
    return url.pathname.endsWith('/qa') ? response(list([retained], null)) : response({ name: 'Course' })
  }
  await show(search(null, '1')); fireEvent.change(await screen.findByRole('textbox', { name: 'Titel' }), { target: { value: 'Question outside current filter' } }); fireEvent.change(screen.getByRole('textbox', { name: /^Frage$/ }), { target: { value: 'Learner-authored question outside current filter' } }); fireEvent.click(screen.getByRole('button', { name: 'Frage veröffentlichen' }))
  await screen.findByRole('heading', { name: created.title }); act(() => { fireEvent.focus(window) })
  expect(document.body.innerHTML).not.toContain('Private current lesson')
  await act(async () => { pendingOldDetail.resolve(response({ ...rights, question: { ...created, lessonContext: context(pairA, 'Unverified pending-cycle label') }, answers: [] })); await pendingOldDetail.promise })
  expect(document.body.innerHTML).not.toContain('Unverified pending-cycle label')
  await act(async () => { verdict.resolve(response({ ...probe([retained.id], null), contexts: [{ id: retained.id, lessonContext: null }] })); await verdict.promise })
  await screen.findByText('Zu dieser Lektion: Private current lesson'); expect(detailReads).toBe(3)
  expect(screen.getByRole('heading', { name: created.title })).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Lektion öffnen' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Fragenliste' })).not.toHaveTextContent(created.title)
})
