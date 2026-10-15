import React, { act, Suspense } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CourseQaPage from '@/app/courses/[courseId]/qa/page'

let mockSession: { user: { id: string; role: string } } | null = { user: { id: 'same-account', role: 'ADMIN' } }
const mockReplace = jest.fn()

jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession, status: mockSession ? 'authenticated' : 'unauthenticated' }) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }) }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
  <a href={href} {...props}>{children}</a> }))
jest.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))

const courseId = 'qa-private-course'
const params = Promise.resolve({ courseId })
const author = { id: 'student', name: 'Student' }
function question(id: string, title: string, hidden = false) {
  return { id, title, body: `Private body ${id}`, createdAt: '2026-10-15T18:00:00.000Z', author,
    answerCount: 0, acceptedAnswerId: null, revision: null, hidden }
}
function list(items: ReturnType<typeof question>[], nextCursor: string | null = null, canModerate = false) {
  return { items, nextCursor, canModerate, canAsk: !canModerate, canReply: true }
}
function response(value: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value } as Response
}
async function showPage() {
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(<Suspense fallback={<div>Loading route</div>}><CourseQaPage params={params} /></Suspense>) })
  return view
}
function mockFetch(handler: (url: URL) => Response | Promise<Response>,
  probe?: (ids: string[], filter: string) => Response | Promise<Response>) {
  ;(global.fetch as jest.Mock).mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname.endsWith('/revalidate')) {
      const payload = JSON.parse(String(init?.body)) as { ids: string[]; filter: string }
      return Promise.resolve(probe ? probe(payload.ids, payload.filter) : response({ visibleIds: payload.ids,
        canAsk: mockSession?.user.role !== 'ADMIN', canReply: true, canModerate: mockSession?.user.role === 'ADMIN' }))
    }
    return Promise.resolve(handler(url))
  })
}

beforeEach(() => {
  mockSession = { user: { id: 'same-account', role: 'ADMIN' } }
  mockReplace.mockReset()
  ;(global.fetch as jest.Mock).mockReset()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => { jest.restoreAllMocks() })

test('same-account role downgrade remounts and removes cached hidden questions', async () => {
  const secret = question('hidden-question', 'Hidden moderator-only question', true)
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    if (url.searchParams.get('filter') === 'hidden') return response(list([secret], null, true))
    return response(list([], null, mockSession?.user.role === 'ADMIN'))
  })
  const view = await showPage()
  await screen.findByRole('button', { name: 'Ausgeblendet' })
  fireEvent.click(screen.getByRole('button', { name: 'Ausgeblendet' }))
  expect(await screen.findByText(secret.title)).toBeInTheDocument()
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  await act(async () => { view.rerender(<Suspense fallback={<div>Loading route</div>}><CourseQaPage params={params} /></Suspense>) })
  expect(screen.queryByText(secret.title)).not.toBeInTheDocument()
  await screen.findByText('Noch keine Fragen')
  expect(screen.queryByRole('button', { name: 'Ausgeblendet' })).not.toBeInTheDocument()
})

test('withdrawal revalidation purges cached detail and rejects a delayed old page', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('first-question', 'Initially private question')
  const late = question('late-question', 'Late private question')
  let resolveMore!: (value: Response) => void
  const pendingMore = new Promise<Response>(resolve => { resolveMore = resolve })
  let withdrawn = false
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    if (url.searchParams.has('cursor')) return pendingMore
    if (withdrawn) return response({ error: 'Kein Zugriff' }, 403)
    if (url.pathname.endsWith('/first-question')) return response({ question: first, answers: [], canAsk: true, canReply: true, canModerate: false })
    return response(list([first], 'next-page'))
  }, ids => withdrawn ? response({ error: 'Kein Zugriff' }, 403) : response({ visibleIds: ids, canAsk: true, canReply: true, canModerate: false }))
  await showPage()
  await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(first.title) }))
  expect(await screen.findByRole('heading', { name: first.title })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Fragen laden' }))
  withdrawn = true
  act(() => { fireEvent.focus(window) })
  await screen.findByText('Kein Zugriff auf Kursfragen')
  expect(screen.queryByText(first.title)).not.toBeInTheDocument()
  expect(screen.queryByText(first.body)).not.toBeInTheDocument()
  await act(async () => { resolveMore(response(list([late]))); await pendingMore })
  expect(screen.queryByText(late.title)).not.toBeInTheDocument()
  expect(screen.queryByText(first.title)).not.toBeInTheDocument()
})

test('background access revalidation preserves already loaded older pages', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('first-page', 'Newest question')
  const older = question('older-page', 'Older question')
  let listReads = 0
  let probeReads = 0
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    listReads += 1
    if (url.searchParams.has('cursor')) return response(list([older]))
    return response(list([first], 'next-page'))
  }, ids => { probeReads += 1; return response({ visibleIds: ids, canAsk: true, canReply: true, canModerate: false }) })
  await showPage()
  await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Fragen laden' }))
  expect(await screen.findByText(older.title)).toBeInTheDocument()
  expect(listReads).toBe(2)
  act(() => { fireEvent.focus(window) })
  await waitFor(() => expect(probeReads).toBe(1))
  expect(listReads).toBe(2)
  expect(screen.getByText(first.title)).toBeInTheDocument()
  expect(screen.getByText(older.title)).toBeInTheDocument()
})

test('revalidation removes a newly hidden item from a later retained page', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('first-page', 'Newest retained question')
  const hidden = question('older-hidden', 'Older question later hidden')
  const retained = question('older-retained', 'Older question still visible')
  let hiddenNow = false
  let listReads = 0
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    listReads += 1
    return url.searchParams.has('cursor') ? response(list([hidden, retained])) : response(list([first], 'next-page'))
  }, ids => response({ visibleIds: hiddenNow ? ids.filter(id => id !== hidden.id) : ids,
    canAsk: true, canReply: true, canModerate: false }))
  await showPage()
  await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Fragen laden' }))
  expect(await screen.findByText(hidden.title)).toBeInTheDocument()
  expect(screen.getByText(retained.title)).toBeInTheDocument()
  hiddenNow = true
  act(() => { fireEvent.focus(window) })
  await waitFor(() => expect(screen.queryByText(hidden.title)).not.toBeInTheDocument())
  expect(screen.getByText(first.title)).toBeInTheDocument()
  expect(screen.getByText(retained.title)).toBeInTheDocument()
  expect(listReads).toBe(2)
})

test('failed visibility check clears populated private content until retry', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('private-question', 'Question before network failure')
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    return response(list([first]))
  }, () => response({ error: 'Temporary failure' }, 500))
  await showPage()
  await screen.findByText(first.title)
  act(() => { fireEvent.focus(window) })
  await screen.findByText('Kursfragen vorübergehend nicht verfügbar')
  expect(screen.queryByText(first.title)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
})

test('one failed verification batch clears rows from every loaded batch', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const questions = Array.from({ length: 201 }, (_, index) => question(`question-${index}`, `Private question ${index}`))
  let batches = 0
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    return response(list(questions))
  }, ids => {
    batches += 1
    return ids.includes('question-200') ? response({ error: 'Database unavailable' }, 500) :
      response({ visibleIds: ids, canAsk: true, canReply: true, canModerate: false })
  })
  await showPage()
  await screen.findByText('Private question 200')
  act(() => { fireEvent.focus(window) })
  await screen.findByText('Kursfragen vorübergehend nicht verfügbar')
  expect(batches).toBe(2)
  expect(screen.queryByText('Private question 0')).not.toBeInTheDocument()
  expect(screen.queryByText('Private question 200')).not.toBeInTheDocument()
})

test('server-side moderator demotion while enrolled clears hidden cache despite a stale session role', async () => {
  const secret = question('hidden-question', 'Old moderator-only question', true)
  let demoted = false
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course', canEdit: !demoted })
    if (url.pathname.endsWith('/hidden-question')) return demoted ? response({ error: 'Hidden' }, 404) :
      response({ question: secret, answers: [], canAsk: false, canReply: true, canModerate: true })
    if (url.searchParams.get('filter') === 'hidden') return demoted ? response({ error: 'No access' }, 403) : response(list([secret], null, true))
    return response(list([], null, !demoted))
  }, ids => response({ visibleIds: ids, canAsk: demoted, canReply: true, canModerate: !demoted }))
  await showPage()
  await screen.findByRole('button', { name: 'Ausgeblendet' })
  fireEvent.click(screen.getByRole('button', { name: 'Ausgeblendet' }))
  expect(await screen.findByText(secret.title)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: new RegExp(secret.title) }))
  expect(await screen.findByRole('heading', { name: secret.title })).toBeInTheDocument()
  expect(screen.getByText(secret.body)).toBeInTheDocument()
  demoted = true
  act(() => { fireEvent.focus(window) })
  await screen.findByText('Noch keine Fragen')
  expect(screen.queryByText(secret.title)).not.toBeInTheDocument()
  expect(screen.queryByText(secret.body)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ausgeblendet' })).not.toBeInTheDocument()
  expect(screen.queryByText('Kein Zugriff auf Kursfragen')).not.toBeInTheDocument()
})

test('a missing selected question clears its private detail and rechecks the course list', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('removed-question', 'Question hidden in another tab')
  let removed = false
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    if (url.pathname.endsWith('/removed-question')) { removed = true; return response({ error: 'Gone' }, 404) }
    return response(list(removed ? [] : [first]))
  })
  await showPage()
  await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(first.title) }))
  expect(await screen.findByText('Diese Frage ist nicht mehr verfügbar.')).toBeInTheDocument()
  await screen.findByText('Noch keine Fragen')
  expect(screen.queryByText(first.title)).not.toBeInTheDocument()
  expect(screen.queryByText('Kein Zugriff auf Kursfragen')).not.toBeInTheDocument()
})

test('moderation in another tab removes a hidden question and answer on revalidation', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('moderated-question', 'Question awaiting moderation')
  const reply = { id: 'moderated-answer', body: 'Answer hidden in another tab', createdAt: first.createdAt, author }
  let answerHidden = false
  let questionHidden = false
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    if (url.pathname.endsWith('/moderated-question')) return questionHidden ? response({ error: 'Hidden' }, 404) :
      response({ question: first, answers: answerHidden ? [] : [reply], canAsk: true, canReply: true, canModerate: false })
    return response(list(questionHidden ? [] : [first]))
  }, ids => response({ visibleIds: questionHidden ? [] : ids, canAsk: true, canReply: true, canModerate: false }))
  await showPage()
  await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(first.title) }))
  expect(await screen.findByText(reply.body)).toBeInTheDocument()
  const now = jest.spyOn(Date, 'now').mockReturnValue(10_000)
  answerHidden = true
  act(() => { fireEvent.focus(window) })
  await waitFor(() => expect(screen.queryByText(reply.body)).not.toBeInTheDocument())
  expect(screen.getByRole('heading', { name: first.title })).toBeInTheDocument()
  questionHidden = true
  now.mockReturnValue(11_001)
  act(() => { fireEvent.focus(window) })
  await screen.findByText('Noch keine Fragen')
  expect(screen.queryByText(first.title)).not.toBeInTheDocument()
})

test('failed detail revalidation clears an already rendered private answer', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('detail-failure-question', 'Question with an old answer')
  const reply = { id: 'private-answer', body: 'Private answer before failure', createdAt: first.createdAt, author }
  let detailFails = false
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    if (url.pathname.endsWith('/detail-failure-question')) return detailFails ? response({ error: 'Temporary failure' }, 500) :
      response({ question: first, answers: [reply], canAsk: true, canReply: true, canModerate: false })
    return response(list([first]))
  })
  await showPage()
  await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(first.title) }))
  expect(await screen.findByText(reply.body)).toBeInTheDocument()
  detailFails = true
  act(() => { fireEvent.focus(window) })
  await screen.findByText('Frage konnte nicht geladen werden')
  expect(screen.queryByText(reply.body)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: new RegExp(first.title) })).toBeInTheDocument()
})

test('late load-more response cannot mix an old filter into the new view', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('first-question', 'First all-filter question')
  const late = question('late-answered', 'Old answered question')
  const open = question('open-question', 'Current open question')
  let resolveMore!: (value: Response) => void
  const pendingMore = new Promise<Response>(resolve => { resolveMore = resolve })
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    if (url.searchParams.has('cursor')) return pendingMore
    if (url.searchParams.get('filter') === 'open') return response(list([open]))
    return response(list([first], 'next-page'))
  })
  await showPage()
  await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Fragen laden' }))
  fireEvent.click(screen.getByRole('button', { name: 'Offen' }))
  await waitFor(() => expect(screen.getByText(open.title)).toBeInTheDocument())
  await act(async () => { resolveMore(response(list([late]))); await pendingMore })
  expect(screen.queryByText(late.title)).not.toBeInTheDocument()
  expect(screen.getByText(open.title)).toBeInTheDocument()
})

test('an old-filter access denial still purges the current view', async () => {
  mockSession = { user: { id: 'same-account', role: 'USER' } }
  const first = question('first-question', 'Initially visible question')
  const open = question('open-question', 'Current filter question')
  let resolveMore!: (value: Response) => void
  const pendingMore = new Promise<Response>(resolve => { resolveMore = resolve })
  mockFetch(url => {
    if (url.pathname === `/api/courses/${courseId}`) return response({ name: 'Private course' })
    if (url.searchParams.has('cursor')) return pendingMore
    if (url.searchParams.get('filter') === 'open') return response(list([open]))
    return response(list([first], 'next-page'))
  })
  await showPage()
  await screen.findByText(first.title)
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Fragen laden' }))
  fireEvent.click(screen.getByRole('button', { name: 'Offen' }))
  await screen.findByText(open.title)
  await act(async () => { resolveMore(response({ error: 'Access revoked' }, 403)); await pendingMore })
  await screen.findByText('Kein Zugriff auf Kursfragen')
  expect(screen.queryByText(first.title)).not.toBeInTheDocument()
  expect(screen.queryByText(open.title)).not.toBeInTheDocument()
})
