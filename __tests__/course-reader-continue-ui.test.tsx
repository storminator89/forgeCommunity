import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CourseContentsEditor } from '@/app/courses/[courseId]/contents/CourseContentsEditor'
import type { CourseContent, CourseProgressSnapshot } from '@/app/courses/[courseId]/contents/types'

const mockRouter = { push: jest.fn(), replace: jest.fn() }
let mockViewer = { status: 'authenticated', data: { user: { id: 'alice', role: 'USER' } } }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('next-auth/react', () => ({ useSession: () => mockViewer }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Theme</button> }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => <button>Konto</button> }))
jest.mock('@/app/courses/[courseId]/practice/learn/PracticeEntryLink', () => ({ PracticeEntryLink: () => null }))
jest.mock('@/app/courses/[courseId]/contents/CourseContentsSidebar', () => ({
  CourseContentsSidebar: ({ contents, onContentSelect, onCertificateIssued }: { contents: CourseContent[]; onContentSelect: (id: string) => void; onCertificateIssued?: () => void }) => {
    const rows = (items: CourseContent[]): React.ReactNode => items.map(item => <div key={item.id}><button onClick={() => onContentSelect(item.id)}>{item.title}</button>{rows(item.subContents || [])}</div>)
    return <nav aria-label="Kursinhalte">{rows(contents)}<button onClick={onCertificateIssued}>Zertifikat ausgestellt</button></nav>
  },
}))
jest.mock('@/app/courses/[courseId]/contents/ContentRenderer', () => ({
  ContentRenderer: ({ content, onQuizPassed, onReaderIssue }: { content: CourseContent; onQuizPassed?: () => void; onReaderIssue?: (status: number) => void }) => <div>
    <p>{String(content.content)}</p>
    <button onClick={() => onReaderIssue?.(403)}>Kindzugriff entzogen</button>
    <button onClick={() => onReaderIssue?.(412)}>Kindversion geändert</button>
    <button onClick={() => onReaderIssue?.(409)}>Kindkonflikt</button>
    {content.type === 'QUIZ' && <><button onClick={() => {}}>Quiz nicht bestanden</button><button onClick={() => { mockFinish(content.id); onQuizPassed?.() }}>Quiz bestanden</button></>}
    {content.type === 'ASSIGNMENT' && <><p>Bewertung ausstehend</p><button onClick={() => onQuizPassed?.()}>Abgabe gespeichert</button></>}
  </div>,
}))

const leaf = (id: string, order: number, extra: Partial<CourseContent> = {}): CourseContent => ({
  id, courseId: 'course', title: `Lektion ${id}`, order, parentId: null, type: 'TEXT', content: `<p>Inhalt ${id}</p>`,
  publicationId: 'pub', contentVersionToken: `token-${id}`, locked: false, ...extra,
})
const baseProgress = (): CourseProgressSnapshot => ({ publicationId: 'pub', completedContentIds: [], complete: false, canTrack: true, hasCertificate: false, completedAt: null })
let mockContents: CourseContent[]
let mockProgress: CourseProgressSnapshot
let mockCanEdit: boolean
let mockFailProgress: number | null
let mockRequest: jest.Mock
let mockDelayedProgress: ((response: Response) => void) | null
let mockDelayNextProgress: boolean
let mockReadFailures: Record<string, number>
let mockDelayNextContents: boolean
let mockDelayedContents: ((response: Response) => void) | null
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(body)) }) as Response

function mockFinish(id: string) {
  mockProgress = { ...mockProgress, completedContentIds: [...new Set([...mockProgress.completedContentIds, id])] }
  const flatten = (items: CourseContent[]): CourseContent[] => items.flatMap(item => item.subContents?.length ? flatten(item.subContents) : [item])
  mockProgress.complete = flatten(mockContents).every(item => mockProgress.completedContentIds.includes(item.id))
  mockContents = mockContents.map(item => ({ ...item, locked: false, missingPrerequisites: [] }))
}

beforeEach(() => {
  history.replaceState({}, '', '/courses/course/contents')
  mockViewer = { status: 'authenticated', data: { user: { id: 'alice', role: 'USER' } } }
  mockContents = [leaf('eins', 1), leaf('zwei', 2, { locked: true, prerequisiteIds: ['eins'], missingPrerequisites: [{ id: 'eins', title: 'Lektion eins' }], contentVersionToken: null })]
  mockProgress = baseProgress()
  mockCanEdit = false
  mockFailProgress = null
  mockReadFailures = {}
  mockDelayNextContents = false
  mockDelayedContents = null
  mockRouter.replace.mockClear()
  mockDelayNextProgress = false
  mockDelayedProgress = null
  mockRequest = jest.fn(async (input: string, options?: RequestInit) => {
    const failure = Object.entries(mockReadFailures).find(([suffix]) => input.endsWith(suffix))?.[1]
    if (!options?.method && failure) return response({}, failure)
    if (input.endsWith('/progress')) {
      if (options?.method === 'PATCH') {
        if (mockFailProgress) return response({}, mockFailProgress)
        const body = JSON.parse(String(options.body))
        if (body.completed) {
          mockFinish(body.contentId)
          mockContents = mockContents.map(item => ({ ...item, contentVersionToken: `token-${item.id}` }))
        } else {
          mockProgress = { ...mockProgress, completedContentIds: mockProgress.completedContentIds.filter(id => id !== body.contentId), complete: false }
          mockContents = mockContents.map(item => ({ ...item, locked: Boolean(item.prerequisiteIds?.length), missingPrerequisites: item.prerequisiteIds?.map(id => ({ id, title: id })) ?? [] }))
        }
        return response(mockProgress)
      }
      if (mockDelayNextProgress) {
        mockDelayNextProgress = false
        return new Promise<Response>(resolve => { mockDelayedProgress = resolve })
      }
      return response(mockProgress)
    }
    if (input.endsWith('/contents')) {
      if (mockDelayNextContents) {
        mockDelayNextContents = false
        return new Promise<Response>(resolve => { mockDelayedContents = resolve })
      }
      return response(mockContents)
    }
    return response({ id: 'course', name: 'Testkurs', canEdit: mockCanEdit, activePublicationId: 'pub' })
  })
  global.fetch = mockRequest
})

const nextPanel = () => screen.getByLabelText('Nächster Lernschritt')
const writes = () => mockRequest.mock.calls.filter(call => call[1]?.method === 'PATCH')

it('offers the first ordered leaf explicitly without a query, read writes, auto-selection or last-viewed claims', async () => {
  mockContents = [leaf('zwei', 2), leaf('kapitel', 1, { subContents: [leaf('eins', 1)] })]
  render(<CourseContentsEditor courseId="course" forceLearner />)
  const start = await screen.findByRole('button', { name: 'Kurs starten' })
  expect(within(nextPanel()).getByText('Lektion eins')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { level: 2, name: 'Lektion eins' })).not.toBeInTheDocument()
  expect(location.search).toBe('')
  expect(writes()).toHaveLength(0)
  expect(screen.queryByText(/zuletzt|last viewed/i)).not.toBeInTheDocument()
  start.focus()
  fireEvent.click(start)
  const heading = screen.getByRole('heading', { level: 2, name: 'Lektion eins' })
  expect(heading).toHaveFocus()
  expect(location.search).toBe('?content=eins')
  expect(writes()).toHaveLength(0)
})

it('retains selection after completion, opens next only by a second action, and supports repeated explicit actions', async () => {
  mockContents = [leaf('eins', 1), leaf('zwei', 2), leaf('drei', 3)]
  render(<CourseContentsEditor courseId="course" forceLearner />)
  fireEvent.click(await screen.findByRole('button', { name: 'Kurs starten' }))
  fireEvent.click(screen.getByRole('button', { name: 'Als abgeschlossen markieren' }))
  const next = await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })
  expect(screen.getByRole('heading', { level: 2, name: 'Lektion eins' })).toBeInTheDocument()
  expect(location.search).toBe('?content=eins')
  next.focus(); fireEvent.click(next)
  expect(screen.getByRole('heading', { level: 2, name: 'Lektion zwei' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Als abgeschlossen markieren' }))
  const again = await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })
  again.focus(); fireEvent.click(again)
  expect(screen.getByRole('heading', { level: 2, name: 'Lektion drei' })).toHaveFocus()
  expect(writes()).toHaveLength(2)
})

it('waits for the refreshed server lock pair before offering the unlocked next lesson', async () => {
  render(<CourseContentsEditor courseId="course" forceLearner />)
  fireEvent.click(await screen.findByRole('button', { name: 'Kurs starten' }))
  mockDelayNextProgress = true
  fireEvent.click(screen.getByRole('button', { name: 'Als abgeschlossen markieren' }))
  await waitFor(() => expect(mockDelayedProgress).not.toBeNull())
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
  const account = screen.getByRole('button', { name: 'Konto' })
  account.focus()
  await act(async () => { mockDelayedProgress!(response(mockProgress)) })
  expect(await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  expect(account).toHaveFocus()
  expect(screen.getByRole('heading', { level: 2, name: 'Lektion eins' })).toBeInTheDocument()
})

it('does not steal external focus during an explicit navigation commit', async () => {
  render(<CourseContentsEditor courseId="course" forceLearner />)
  const start = await screen.findByRole('button', { name: 'Kurs starten' })
  const account = screen.getByRole('button', { name: 'Konto' })
  start.focus()
  act(() => { fireEvent.click(start); account.focus() })
  expect(screen.getByRole('heading', { level: 2, name: 'Lektion eins' })).toBeInTheDocument()
  expect(account).toHaveFocus()
})

it('preserves a completed explicit deep link and never focuses it on load', async () => {
  history.replaceState({}, '', '/courses/course/contents?content=eins&source=test')
  mockFinish('eins')
  mockContents[1].contentVersionToken = 'token-zwei'
  render(<CourseContentsEditor courseId="course" forceLearner />)
  const account = screen.getByRole('button', { name: 'Konto' })
  account.focus()
  const heading = await screen.findByRole('heading', { level: 2, name: 'Lektion eins' })
  expect(account).toHaveFocus()
  expect(heading).not.toHaveFocus()
  expect(screen.getByRole('button', { name: 'Abschlussmarkierung entfernen' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  expect(location.search).toBe('?content=eins&source=test')
  expect(writes()).toHaveLength(0)
})

it('offers Weiterlernen from current progress rather than a historical enrollment date', async () => {
  mockFinish('eins'); mockContents[1].contentVersionToken = 'token-zwei'
  render(<CourseContentsEditor courseId="course" forceLearner />)
  expect(await screen.findByRole('button', { name: 'Weiterlernen' })).toBeEnabled()
  expect(within(nextPanel()).getByText('Lektion zwei')).toBeInTheDocument()
})

it('does not advance on quiz failure; a pass refreshes actual completion before offering next', async () => {
  mockContents = [leaf('quiz', 1, { type: 'QUIZ' }), leaf('zwei', 2)]
  history.replaceState({}, '', '/courses/course/contents?content=quiz')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  fireEvent.click(await screen.findByRole('button', { name: 'Quiz nicht bestanden' }))
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Als abgeschlossen markieren' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Quiz bestanden' }))
  expect(await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  expect(screen.getByRole('heading', { level: 2, name: 'Lektion quiz' })).toBeInTheDocument()
  expect(writes()).toHaveLength(0)
})

it('keeps a waiting assignment incomplete and makes a current passing grade available on explicit refresh', async () => {
  mockContents = [leaf('aufgabe', 1, { type: 'ASSIGNMENT' }), leaf('zwei', 2)]
  history.replaceState({}, '', '/courses/course/contents?content=aufgabe')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abgabe gespeichert' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' })).toBeEnabled())
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
  mockFinish('aufgabe')
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  expect(await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  expect(screen.getByRole('heading', { level: 2, name: 'Lektion aufgabe' })).toBeInTheDocument()
  expect(writes()).toHaveLength(0)
})

it('removes the next recommendation when self-completion is removed', async () => {
  mockFinish('eins'); mockContents[1].contentVersionToken = 'token-zwei'
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abschlussmarkierung entfernen' }))
  expect(await screen.findByRole('button', { name: 'Als abgeschlossen markieren' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
  expect(location.search).toBe('?content=eins')
})

it.each([412, 423])('does not advance after a rejected completion (%s)', async status => {
  mockFailProgress = status
  render(<CourseContentsEditor courseId="course" forceLearner />)
  fireEvent.click(await screen.findByRole('button', { name: 'Kurs starten' }))
  fireEvent.click(screen.getByRole('button', { name: 'Als abgeschlossen markieren' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
  expect(mockProgress.completedContentIds).toEqual([])
})

it.each(['empty', 'locked', 'complete'] as const)('has a distinct honest %s state', async state => {
  mockContents = state === 'empty' ? [] : [leaf('eins', 1, { locked: state === 'locked' })]
  if (state === 'complete') mockProgress = { ...mockProgress, completedContentIds: ['eins'], complete: true, hasCertificate: true, canIssueCertificate: false }
  render(<CourseContentsEditor courseId="course" forceLearner />)
  const title = state === 'empty' ? 'Noch keine Kursinhalte' : state === 'locked' ? 'Weitere Inhalte sind noch gesperrt' : 'Aktuelle Inhalte abgeschlossen'
  expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Kurs starten|Weiterlernen|Nächste Lektion öffnen/ })).not.toBeInTheDocument()
  expect(within(nextPanel()).queryByText(/Zertifikat/)).not.toBeInTheDocument()
})

it('fails closed for a republish mismatch then reopens the current incomplete revision after refresh', async () => {
  mockProgress.publicationId = 'new'
  render(<CourseContentsEditor courseId="course" forceLearner />)
  expect(await screen.findByRole('heading', { name: 'Lernfortschritt neu laden' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Kurs starten' })).not.toBeInTheDocument()
  mockContents = [leaf('eins', 1, { publicationId: 'new', contentVersionToken: 'new-token' })]
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  expect(await screen.findByRole('button', { name: 'Kurs starten' })).toBeEnabled()
  expect(writes()).toHaveLength(0)
})

it('fails closed on refresh errors and allows an explicit retry', async () => {
  render(<CourseContentsEditor courseId="course" forceLearner />)
  await screen.findByRole('button', { name: 'Kurs starten' })
  mockDelayNextProgress = true
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  await waitFor(() => expect(mockDelayedProgress).not.toBeNull())
  // Selecting while a read is pending never creates completion evidence.
  fireEvent.click(screen.getByRole('button', { name: 'Lektion eins' }))
  await act(async () => { mockDelayedProgress!(response({}, 503)) })
  expect(await screen.findByRole('heading', { name: 'Lernfortschritt neu laden' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Lernfortschritt neu laden' })).not.toBeInTheDocument())
})

it('ignores an older delayed progress read after a newer quiz refresh succeeds', async () => {
  mockContents = [leaf('quiz', 1, { type: 'QUIZ' }), leaf('zwei', 2)]
  history.replaceState({}, '', '/courses/course/contents?content=quiz')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  await screen.findByRole('button', { name: 'Quiz bestanden' })
  mockDelayNextProgress = true
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  await waitFor(() => expect(mockDelayedProgress).not.toBeNull())
  const resolveOld = mockDelayedProgress!
  fireEvent.click(screen.getByRole('button', { name: 'Quiz bestanden' }))
  expect(await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  await act(async () => { resolveOld(response(baseProgress())) })
  expect(screen.getByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  expect(within(nextPanel()).getByText('Lektion zwei')).toBeInTheDocument()
})

it('aborts an initial delayed snapshot before a different account can see its entry', async () => {
  mockDelayNextProgress = true
  const view = render(<CourseContentsEditor courseId="course" forceLearner />)
  await waitFor(() => expect(mockDelayedProgress).not.toBeNull())
  const resolveOld = mockDelayedProgress!
  mockViewer = { status: 'authenticated', data: { user: { id: 'bob', role: 'USER' } } }
  mockContents = [leaf('bob', 1)]
  view.rerender(<CourseContentsEditor courseId="course" forceLearner />)
  expect(await screen.findByRole('button', { name: 'Kurs starten' })).toBeEnabled()
  await act(async () => { resolveOld(response(baseProgress())) })
  expect(within(nextPanel()).getByText('Lektion bob')).toBeInTheDocument()
  expect(screen.queryByText('Lektion eins')).not.toBeInTheDocument()
})

it.each(['account', 'role'] as const)('purges selection and ignores a delayed read across an %s boundary', async boundary => {
  const view = render(<CourseContentsEditor courseId="course" forceLearner />)
  await screen.findByRole('button', { name: 'Kurs starten' })
  mockDelayNextProgress = true
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  await waitFor(() => expect(mockDelayedProgress).not.toBeNull())
  const resolveOld = mockDelayedProgress!
  mockContents = [leaf('bob', 1)]
  mockProgress = baseProgress()
  mockViewer = { status: 'authenticated', data: { user: { id: boundary === 'account' ? 'bob' : 'alice', role: boundary === 'role' ? 'INSTRUCTOR' : 'USER' } } }
  view.rerender(<CourseContentsEditor courseId="course" forceLearner />)
  expect(screen.queryByRole('button', { name: 'Kurs starten' })).not.toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Kurs starten' })).toBeEnabled()
  expect(within(nextPanel()).getByText('Lektion bob')).toBeInTheDocument()
  await act(async () => { resolveOld(response({ ...baseProgress(), completedContentIds: ['eins'], complete: false })) })
  expect(within(nextPanel()).getByText('Lektion bob')).toBeInTheDocument()
  expect(screen.queryByText('Lektion eins')).not.toBeInTheDocument()
})

it.each([401, 403, 404].flatMap(status => (['TEXT', 'QUIZ', 'ASSIGNMENT'] as const).map(type => [status, type] as const)))('purges a selected private %s/%s reader on live access loss', async (status, type) => {
  mockContents = [leaf('private', 1, { type, content: 'Private body for Alice' })]
  history.replaceState({}, '', '/courses/course/contents?content=private')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  expect(await screen.findByText('Private body for Alice')).toBeInTheDocument()
  mockReadFailures = { '/progress': status }
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  expect(await screen.findByRole('heading', { name: 'Kurs konnte nicht geladen werden' })).toBeInTheDocument()
  expect(screen.queryByText('Private body for Alice')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Lektion private' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^(Kurs starten|Weiterlernen|Nächste Lektion öffnen|Als abgeschlossen markieren|Quiz bestanden|Abgabe gespeichert)$/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Kursinhalte' })).not.toBeInTheDocument()
  expect(writes()).toHaveLength(0)
  if (status === 401) expect(mockRouter.replace).toHaveBeenCalledWith('/login?callbackUrl=%2Fcourses%2Fcourse%2Fcontents')
})

it('cannot restore a revoked private body from a delayed sibling response and reauthorizes only on retry', async () => {
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  await screen.findByRole('heading', { name: 'Lektion eins' })
  mockDelayNextProgress = true
  mockReadFailures = { '/contents': 403 }
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  expect(await screen.findByRole('heading', { name: 'Kurs konnte nicht geladen werden' })).toBeInTheDocument()
  await act(async () => { mockDelayedProgress!(response(baseProgress())) })
  expect(screen.queryByRole('heading', { name: 'Lektion eins' })).not.toBeInTheDocument()
  expect(location.search).toBe('?content=eins')
  mockReadFailures = {}
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByRole('heading', { name: 'Lektion eins' })).toBeInTheDocument()
  expect(writes()).toHaveLength(0)
})

it.each(['contents-first', 'progress-first'] as const)('prioritizes a late authority denial over an earlier transient sibling failure: %s', async order => {
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  await screen.findByRole('heading', { name: 'Lektion eins' })
  if (order === 'contents-first') { mockReadFailures = { '/contents': 503 }; mockDelayNextProgress = true }
  else { mockReadFailures = { '/progress': 503 }; mockDelayNextContents = true }
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  expect(await screen.findByRole('heading', { name: 'Lernfortschritt neu laden' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Lektion eins' })).toBeInTheDocument()
  await act(async () => { (order === 'contents-first' ? mockDelayedProgress! : mockDelayedContents!)(response({}, 403)) })
  expect(await screen.findByRole('heading', { name: 'Kurs konnte nicht geladen werden' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Lektion eins' })).not.toBeInTheDocument()
  expect(screen.queryByText('<p>Inhalt eins</p>')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Als abgeschlossen markieren' })).not.toBeInTheDocument()
})

it.each([409, 412, 423])('invalidates an existing Next recommendation when undo detects a changed gate/publication (%s)', async status => {
  mockFinish('eins'); mockContents[1].contentVersionToken = 'token-zwei'
  mockFailProgress = status
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  expect(await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Abschlussmarkierung entfernen' }))
  expect(await screen.findByRole('heading', { name: 'Lernfortschritt neu laden' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Lektion eins' })).toBeInTheDocument()
  mockFailProgress = null
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  expect(await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
})

it('also purges the private selection when a completion detects revoked enrollment', async () => {
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  mockFailProgress = 403
  render(<CourseContentsEditor courseId="course" forceLearner />)
  fireEvent.click(await screen.findByRole('button', { name: 'Als abgeschlossen markieren' }))
  expect(await screen.findByRole('heading', { name: 'Kurs konnte nicht geladen werden' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Lektion eins' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Als abgeschlossen markieren' })).not.toBeInTheDocument()
})

it.each(['QUIZ', 'ASSIGNMENT'] as const)('purges private %s content after an active child reports denied access', async type => {
  mockContents = [leaf('eins', 1, { type }), leaf('zwei', 2)]
  mockFinish('eins')
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  expect(await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Kindzugriff entzogen' }))
  expect(await screen.findByRole('heading', { name: 'Kurs konnte nicht geladen werden' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Lektion eins' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
})

it.each(['Kindversion geändert', 'Kindkonflikt'])('invalidates Next on %s without treating a conflict as lost access or trusting an older read', async name => {
  mockContents = [leaf('eins', 1, { type: 'QUIZ' }), leaf('zwei', 2)]
  mockFinish('eins')
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  expect(await screen.findByRole('button', { name: 'Nächste Lektion öffnen' })).toBeEnabled()
  mockDelayNextProgress = true
  fireEvent.click(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' }))
  await waitFor(() => expect(mockDelayedProgress).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name }))
  expect(screen.getByRole('heading', { name: 'Lernfortschritt neu laden' })).toBeInTheDocument()
  await act(async () => { mockDelayedProgress!(response(mockProgress)) })
  expect(screen.queryByRole('button', { name: 'Nächste Lektion öffnen' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Lektion eins' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Kurs konnte nicht geladen werden' })).not.toBeInTheDocument()
})

it('uses the guarded content/progress pair after a certificate callback, including live access loss', async () => {
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  await screen.findByRole('heading', { name: 'Lektion eins' })
  const contentReads = () => mockRequest.mock.calls.filter(call => call[0].endsWith('/contents')).length
  expect(contentReads()).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Zertifikat ausgestellt' }))
  await waitFor(() => expect(contentReads()).toBe(2))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' })).toBeEnabled())
  mockReadFailures = { '/progress': 403 }
  fireEvent.click(screen.getByRole('button', { name: 'Zertifikat ausgestellt' }))
  expect(await screen.findByRole('heading', { name: 'Kurs konnte nicht geladen werden' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Lektion eins' })).not.toBeInTheDocument()
})

it('keeps author preview separate from learner continue controls', async () => {
  mockCanEdit = true
  mockContents = [leaf('eins', 1, { locked: undefined })]
  render(<CourseContentsEditor courseId="course" forceLearner />)
  expect(await screen.findByRole('heading', { name: 'Wähle ein Thema' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Kurs starten' })).not.toBeInTheDocument()
})


const flexibleLearnerAction = ['h-auto', 'min-h-11', 'min-w-0', 'max-w-full', 'whitespace-normal', 'px-[min(1rem,16px)]', 'py-[min(.5rem,8px)]', '[overflow-wrap:anywhere]']

it('keeps completion mark, busy and remove controls flexible without changing their mutation', async () => {
  render(<CourseContentsEditor courseId="course" forceLearner />)
  fireEvent.click(await screen.findByRole('button', { name: 'Kurs starten' }))
  const mark = screen.getByRole('button', { name: 'Als abgeschlossen markieren' })
  expect(mark).toHaveClass(...flexibleLearnerAction)
  expect(mark).not.toHaveClass('h-11', 'whitespace-nowrap')
  expect(mark.closest('.max-w-4xl')).toHaveClass('px-[min(1rem,16px)]', 'sm:px-[min(1.5rem,24px)]', 'lg:px-[min(2rem,32px)]')
  mockDelayNextProgress = true
  fireEvent.click(mark)
  await waitFor(() => expect(mockDelayedProgress).not.toBeNull())
  const busy = screen.getByRole('button', { name: 'Wird gespeichert …' })
  expect(busy).toHaveClass(...flexibleLearnerAction)
  expect(busy).toBeDisabled()
  await act(async () => { mockDelayedProgress!(response(mockProgress)) })
  const remove = await screen.findByRole('button', { name: 'Abschlussmarkierung entfernen' })
  await waitFor(() => expect(remove).toBeEnabled())
  expect(remove).toHaveClass(...flexibleLearnerAction)
  expect(writes()).toHaveLength(1)
  expect(mockProgress.completedContentIds).toEqual(['eins'])
})

it('keeps the selected release-lock recheck flexible and read-only', async () => {
  mockContents = [leaf('eins', 1, { locked: true, releaseLocked: true, releaseOn: '2099-11-01', contentVersionToken: null })]
  history.replaceState({}, '', '/courses/course/contents?content=eins')
  render(<CourseContentsEditor courseId="course" forceLearner />)
  const recheck = await screen.findByRole('button', { name: 'Zugriff neu prüfen' })
  expect(recheck).toHaveClass(...flexibleLearnerAction)
  expect(recheck).not.toHaveClass('h-11', 'whitespace-nowrap')
  fireEvent.click(recheck)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lernfortschritt aktualisieren' })).toBeEnabled())
  expect(writes()).toHaveLength(0)
  expect(location.search).toBe('?content=eins')
})
