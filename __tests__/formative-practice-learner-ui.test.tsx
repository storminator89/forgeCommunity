import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PracticeLearnerWorkspace } from '@/app/courses/[courseId]/practice/learn/PracticeLearnerWorkspace'
import { PracticeLearnerView } from '@/app/courses/[courseId]/practice/learn/PracticeLearnerView'
import { PracticeEntryLink } from '@/app/courses/[courseId]/practice/learn/PracticeEntryLink'

const replace = jest.fn()
const mockRouter = { replace }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
const base = '/api/courses/course-1/practice/learner'
const pending = { reservationId: 'reserve-1', ordinal: 1, item: { itemId: 'item-1', itemRevision: 1,
  objectiveTitle: 'Kursbegriffe', prompt: 'Welche Aussage stimmt?', options: ['Erste Aussage', 'Zweite Aussage'] } }
const current = { status: 'active', dueCount: 1, publicationId: 'publication-1', snapshotId: 'snapshot-1',
  session: { id: 'session-1', answeredCount: 0, pending } }

beforeEach(() => { replace.mockClear(); Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'submission-1' }) })

test('GET remains read-only; opt-in, first reservation, answer and next each need a deliberate action', async () => {
  let state: unknown = { status: 'available', dueCount: 1, publicationId: 'publication-1', snapshotId: 'snapshot-1' }
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (!init?.method || init.method === 'GET') return response(state)
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    writes.push({ path, body })
    if (path.endsWith('/opt-in')) state = { status: 'ready', dueCount: 1 }
    if (path.endsWith('/start')) state = current
    if (path.endsWith('/answer')) return response({ correct: false, correctIndex: 1, explanation: 'Die zweite Aussage passt zum Kurs.', canContinue: true, answeredCount: 1 })
    if (path.endsWith('/next')) state = { ...current, dueCount: 0, session: { id: 'session-1', answeredCount: 1,
      pending: { ...pending, reservationId: 'reserve-2', ordinal: 2 } } }
    return response({})
  })
  const user = userEvent.setup()
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  expect(await screen.findByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(screen.getByText('Standardmäßig ausgeschaltet. Du öffnest jede Frage selbst.')).toBeVisible()
  expect(writes).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Privates Üben einschalten' }))
  expect(await screen.findByRole('button', { name: 'Erste Frage öffnen' })).toBeVisible()
  expect(writes.map(write => write.path)).toEqual([`${base}/opt-in`])
  await user.click(screen.getByRole('button', { name: 'Erste Frage öffnen' }))
  expect(await screen.findByRole('group', { name: 'Welche Aussage stimmt?' })).toBeVisible()
  expect(screen.getByText('Welche Aussage stimmt?')).toHaveFocus()
  expect(screen.getByRole('group', { name: 'Wie sicher bist du dir?' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Antwort prüfen' })).toBeDisabled()
  expect(screen.queryByText(/Die zweite Aussage passt zum Kurs/)).not.toBeInTheDocument()
  expect(writes.map(write => write.path)).toEqual([`${base}/opt-in`, `${base}/start`])
  await user.click(screen.getByRole('radio', { name: 'Erste Aussage' }))
  await user.click(screen.getByRole('radio', { name: 'Unsicher' }))
  await user.click(screen.getByRole('button', { name: 'Antwort prüfen' }))
  expect(await screen.findByRole('heading', { name: 'Eine andere Antwort war vorgesehen.' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Eine andere Antwort war vorgesehen.' })).toHaveFocus()
  expect(screen.getByText('Vorgesehene Antwort: Zweite Aussage')).toBeVisible()
  expect(writes[2]).toEqual({ path: `${base}/answer`, body: { sessionId: 'session-1', reservationId: 'reserve-1',
    submissionId: 'submission-1', optionIndex: 0, confidence: 'UNSURE' } })
  expect(writes).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: 'Weitere Frage öffnen' }))
  await waitFor(() => expect(writes[3]).toEqual({ path: `${base}/next`, body: { sessionId: 'session-1' } }))
  expect(await screen.findByRole('group', { name: 'Welche Aussage stimmt?' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Antwort prüfen' })).toBeDisabled()
})

test.each([
  ['available', 'Privates Üben einschalten'],
  ['paused', 'Üben wieder einschalten'],
] as const)('%s shows the private storage and qualification facts before enabling', (stage, actionName) => {
  render(<PracticeLearnerView courseId="course-1" stage={stage} />)
  const action = screen.getByRole('button', { name: actionName })
  const notice = screen.getByRole('complementary', { name: 'Privat und freiwillig' })
  expect(notice).toBeVisible()
  expect(screen.getAllByRole('complementary', { name: 'Privat und freiwillig' })).toHaveLength(1)
  expect(document.querySelectorAll('#practice-private-heading')).toHaveLength(1)
  expect(within(notice).getByText(/Deine Antworten und deine optionale Sicherheitseinschätzung werden für deine private Übung gespeichert/)).toBeVisible()
  expect(within(notice).getByText(/Kein Einfluss auf Kursabschluss, Prüfungen, Zertifikate oder Belohnungen/)).toBeVisible()
  expect(within(notice).getByText(/Keine persönliche Übungsauswertung für Lehrende/)).toBeVisible()
  expect(notice.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const disclosure = within(notice).getByText('Speicherung und Löschen')
  expect(disclosure).toBeVisible()
  expect(disclosure.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})

test.each(['available', 'paused'] as const)('%s disclosure opens without enabling, reserving or writing practice data', async status => {
  global.fetch = jest.fn(async () => response({ status, dueCount: 1 }))
  const user = userEvent.setup()
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await screen.findByRole('button', { name: status === 'available' ? 'Privates Üben einschalten' : 'Üben wieder einschalten' })
  const disclosure = screen.getByText('Speicherung und Löschen')
  const details = disclosure.closest('details')!
  expect(details).not.toHaveAttribute('open')
  screen.getByRole('link', { name: 'Zum Kursinhalt' }).focus()
  await user.tab()
  expect(disclosure).toHaveFocus()
  await user.click(disclosure)
  expect(details).toHaveAttribute('open')
  expect(screen.getByText(/Bei Störungen oder Rückstand kann sich die Löschung verzögern/)).toBeVisible()
  await user.click(disclosure)
  expect(details).not.toHaveAttribute('open')
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  expect(screen.queryByRole('button', { name: /Erste Frage öffnen|Antwort prüfen/ })).not.toBeInTheDocument()
})

test('pause preserves practice; reset needs typed confirmation and the one-use token', async () => {
  let state: unknown = current
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (!init?.method || init.method === 'GET') return response(state)
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    writes.push({ path, body })
    if (path.endsWith('/pause')) state = { status: 'paused', dueCount: 1, session: { id: 'session-1', answeredCount: 0 } }
    if (path.endsWith('/reset/prepare')) return response({ token: 'short-token' })
    if (path.endsWith('/reset')) state = { status: 'available', dueCount: 1 }
    return response({})
  })
  const user = userEvent.setup()
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await screen.findByRole('group', { name: 'Welche Aussage stimmt?' })
  await user.click(screen.getByText('Übung verwalten'))
  await user.click(screen.getByRole('button', { name: 'Üben pausieren' }))
  const pause = screen.getByRole('alertdialog', { name: 'Privates Üben pausieren?' })
  expect(writes).toHaveLength(0)
  await user.click(within(pause).getByRole('button', { name: 'Üben pausieren' }))
  expect(await screen.findByRole('heading', { name: 'Privates Üben ist pausiert' })).toBeVisible()
  expect(writes.map(write => write.path)).toEqual([`${base}/pause`])
  await user.click(screen.getByRole('button', { name: 'Übungsdaten zurücksetzen' }))
  const reset = screen.getByRole('alertdialog', { name: 'Übungsdaten endgültig löschen?' })
  const deleteButton = within(reset).getByRole('button', { name: 'Übungsdaten endgültig löschen' })
  expect(deleteButton).toBeDisabled()
  expect(writes).toHaveLength(1)
  await user.type(within(reset).getByRole('textbox', { name: 'Zur Bestätigung RESET eingeben' }), 'RESET')
  expect(deleteButton).toBeEnabled()
  await user.click(deleteButton)
  await waitFor(() => expect(writes.map(write => write.path)).toEqual([`${base}/pause`, `${base}/reset/prepare`, `${base}/reset`]))
  expect(writes[2].body).toEqual({ token: 'short-token', confirmation: 'RESET_MY_PRACTICE' })
  expect(await screen.findByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
})

test('explicit opt-out revokes new practice without triggering reset or claiming immediate deletion', async () => {
  let state: unknown = { status: 'paused', dueCount: 0, session: { id: 'session-1', answeredCount: 1 } }
  const writes: string[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (!init?.method || init.method === 'GET') return response(state)
    writes.push(path)
    if (path.endsWith('/opt-out')) state = { status: 'available', dueCount: 0 }
    return response({})
  })
  const user = userEvent.setup()
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await screen.findByRole('heading', { name: 'Privates Üben ist pausiert' })
  await user.click(screen.getByText('Übung verwalten'))
  expect(screen.getByText(/Bisherige Übungsdaten bleiben bis zum Zurücksetzen oder Ablauf der Aufbewahrungsfrist gespeichert/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Privates Üben ausschalten' }))
  const confirmation = screen.getByRole('alertdialog', { name: 'Privates Üben ausschalten?' })
  expect(writes).toHaveLength(0)
  await user.click(within(confirmation).getByRole('button', { name: 'Privates Üben ausschalten' }))
  await waitFor(() => expect(writes).toEqual([`${base}/opt-out`]))
  expect(await screen.findByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
})

test('a resumed exhausted session exposes an accessible close action before the next due session', async () => {
  let state: unknown = { status: 'active', dueCount: 0, session: { id: 'session-1', answeredCount: 1 } }
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (!init?.method || init.method === 'GET') return response(state)
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    writes.push({ path, body })
    if (path.endsWith('/close')) state = { status: 'ready', dueCount: 1 }
    return response({ complete: true })
  })
  const user = userEvent.setup()
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  const close = await screen.findByRole('button', { name: 'Sitzung abschließen' })
  expect(screen.getByRole('heading', { name: 'Gerade keine weitere Frage fällig' })).toBeVisible()
  expect(writes).toHaveLength(0)
  await user.click(close)
  await waitFor(() => expect(writes).toEqual([{ path: `${base}/close`, body: { sessionId: 'session-1' } }]))
  expect(await screen.findByRole('button', { name: 'Erste Frage öffnen' })).toBeVisible()
})

test('forbidden learner state offers no practice actions', async () => {
  global.fetch = jest.fn(async () => response({ error: 'Enrollment required' }, 403))
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  expect(await screen.findByRole('heading', { name: 'Kein Zugang zu dieser Übung' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /Frage öffnen|Üben einschalten|zurücksetzen/i })).not.toBeInTheDocument()
})

test('unpublished, missing-pool and archived states are distinct and reserve nothing', () => {
  const view = render(<PracticeLearnerView courseId="course-1" stage="unpublished" />)
  expect(screen.getByRole('heading', { name: 'Kurs noch nicht veröffentlicht' })).toBeVisible()
  view.rerender(<PracticeLearnerView courseId="course-1" stage="off" />)
  expect(screen.getByRole('heading', { name: 'Noch keine Übung veröffentlicht' })).toBeVisible()
  view.rerender(<PracticeLearnerView courseId="course-1" stage="archived" />)
  expect(screen.getByRole('heading', { name: 'Bisheriger Übungspool archiviert' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /Frage öffnen|Üben einschalten/ })).not.toBeInTheDocument()
})

test('confidence can be skipped without blocking an answer', async () => {
  const onAnswer = jest.fn()
  const user = userEvent.setup()
  render(<PracticeLearnerView courseId="course-1" stage="question" question={{ reservationId: 'reservation-1',
    prompt: 'Welche Aussage stimmt?', options: ['Erste Aussage', 'Zweite Aussage'] }} onAnswer={onAnswer} />)
  await user.click(screen.getByRole('radio', { name: 'Zweite Aussage' }))
  expect(screen.getByRole('radio', { name: 'Überspringen' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Antwort prüfen' }))
  expect(onAnswer).toHaveBeenCalledWith(1, null)
})

test('retention and reset copy describe eligibility, possible delays, and answer receipts', async () => {
  const user = userEvent.setup()
  render(<PracticeLearnerView courseId="course-1" stage="available" />)
  await user.click(screen.getByText('Speicherung und Löschen'))
  expect(screen.getByText(/Private Übungsdaten werden nach 12 Kalendermonaten ohne Übungsaktivität zur automatischen Löschung fällig/)).toBeVisible()
  expect(screen.getByText(/Bei Störungen oder Rückstand kann sich die Löschung verzögern/)).toBeVisible()
  expect(screen.getByText(/technische Belege zur Antwortübermittlung nach 90 Tagen/)).toBeVisible()
  await user.click(screen.getByText('Übung verwalten'))
  await user.click(screen.getByRole('button', { name: 'Übungsdaten zurücksetzen' }))
  const reset = screen.getByRole('alertdialog', { name: 'Übungsdaten endgültig löschen?' })
  expect(within(reset).getByText(/Auch die technischen Belege zur Antwortübermittlung werden gelöscht/)).toBeVisible()
  expect(within(reset).queryByText(/Löschungsnachweis|Einwilligungsnachweis/)).not.toBeInTheDocument()
})

test('course-reader entry hides unpublished pools and appears only for eligible published practice', async () => {
  let status = 'off'
  global.fetch = jest.fn(async () => response({ status, dueCount: 0 }))
  const view = render(<PracticeEntryLink courseId="course-1" />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  expect(screen.queryByRole('link', { name: 'Privat üben' })).not.toBeInTheDocument()
  status = 'available'
  view.rerender(<PracticeEntryLink courseId="course-2" />)
  expect(await screen.findByRole('link', { name: 'Privat üben' })).toHaveAttribute('href', '/courses/course-2/practice/learn')
})

test('last answer displays fresh effective return time; finish and refresh never reserve or reuse a completed session', async () => {
  const effective = '2026-10-17T12:00:00.001Z'
  let state: unknown = { ...current, availability: 'resume', nextAvailableAt: null }
  const writes: string[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (!init?.method) return response(state)
    writes.push(path)
    if (path.endsWith('/answer')) {
      state = { status: 'complete', availability: 'waiting', dueCount: 0, nextAvailableAt: effective,
        publicationId: 'publication-1', snapshotId: 'snapshot-1' }
      return response({ correct: false, correctIndex: 1, canContinue: false, answeredCount: 1,
        nextDueAt: '2026-10-16T12:05:00Z' })
    }
    if (path.endsWith('/start')) state = { ...current, session: { ...current.session, id: 'session-2' } }
    return response({})
  })
  const user = userEvent.setup()
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await screen.findByRole('group', { name: 'Welche Aussage stimmt?' })
  await user.click(screen.getByRole('radio', { name: 'Erste Aussage' }))
  await user.click(screen.getByRole('button', { name: 'Antwort prüfen' }))
  expect(await screen.findByText(/Voraussichtlich wieder ab/)).toBeVisible()
  expect(document.querySelector('time')).toHaveAttribute('dateTime', effective)
  expect(screen.queryByText(/12:05/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Für jetzt beenden' }))
  const refresh = await screen.findByRole('button', { name: 'Stand aktualisieren' })
  await user.click(refresh)
  expect(writes).toEqual([`${base}/answer`])
  state = { status: 'ready', availability: 'ready', dueCount: 1, nextAvailableAt: null,
    publicationId: 'publication-1', snapshotId: 'snapshot-1' }
  await user.click(refresh)
  expect(await screen.findByRole('button', { name: 'Erste Frage öffnen' })).toBeVisible()
  expect(screen.queryByText(/Voraussichtlich wieder ab/)).not.toBeInTheDocument()
  expect(writes).toEqual([`${base}/answer`])
  await user.click(screen.getByRole('button', { name: 'Erste Frage öffnen' }))
  await screen.findByRole('group', { name: 'Welche Aussage stimmt?' })
  expect(writes).toEqual([`${base}/answer`, `${base}/start`])
})

test.each(['archived', 'unavailable'] as const)('live %s after answering purges question and feedback instead of showing stale return data', async status => {
  let state: unknown = current
  global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method) return response(state)
    state = { status, availability: 'unavailable', dueCount: 0, nextAvailableAt: null }
    return response({ correct: true, correctIndex: 1, explanation: 'Private stale explanation', canContinue: false, answeredCount: 1 })
  })
  const user = userEvent.setup()
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await screen.findByRole('group', { name: 'Welche Aussage stimmt?' })
  await user.click(screen.getByRole('radio', { name: 'Erste Aussage' }))
  await user.click(screen.getByRole('button', { name: 'Antwort prüfen' }))
  expect(await screen.findByRole('heading', { name: status === 'archived' ? 'Bisheriger Übungspool archiviert' : 'Privates Üben gerade nicht verfügbar' })).toBeVisible()
  expect(screen.queryByText('Private stale explanation')).not.toBeInTheDocument()
  expect(screen.queryByText('Welche Aussage stimmt?')).not.toBeInTheDocument()
  expect(document.querySelector('time')).toBeNull()
})

test('waiting refresh failure clears stale availability; retry can recover without writes', async () => {
  let fail = false
  global.fetch = jest.fn(async () => response(fail ? { error: 'Stand nicht erreichbar' } : {
    status: 'complete', availability: 'waiting', dueCount: 0, nextAvailableAt: '2026-10-17T12:00:00Z',
  }, fail ? 503 : 200))
  const user = userEvent.setup()
  render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  const refresh = await screen.findByRole('button', { name: 'Stand aktualisieren' })
  fail = true
  await user.click(refresh)
  expect(await screen.findByRole('heading', { name: 'Übung konnte nicht geladen werden' })).toBeVisible()
  expect(document.querySelector('time')).toBeNull()
  expect(jest.mocked(global.fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true)
})

test('a late private read is aborted and cannot restore a previous account after unmount', async () => {
  let finish!: (value: Response) => void
  let signal: AbortSignal | undefined
  global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal as AbortSignal
    return new Promise<Response>(resolve => { finish = resolve })
  })
  const view = render(<PracticeLearnerWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  view.unmount()
  expect(signal?.aborted).toBe(true)
  finish(response(current))
  await Promise.resolve()
  expect(screen.queryByText('Welche Aussage stimmt?')).not.toBeInTheDocument()
})

test('course entry differentiates resume, pause and effective waiting; refresh is read-only', async () => {
  let state: unknown = { status: 'active', availability: 'resume', dueCount: 0, session: current.session, nextAvailableAt: null }
  global.fetch = jest.fn(async () => response(state))
  const view = render(<PracticeEntryLink courseId="course-1" />)
  expect(await screen.findByRole('link', { name: 'Übung fortsetzen' })).toBeVisible()
  state = { status: 'complete', availability: 'waiting', dueCount: 0, nextAvailableAt: '2026-10-17T12:00:00Z' }
  view.rerender(<PracticeEntryLink courseId="course-2" />)
  const refresh = await screen.findByRole('button', { name: 'Stand aktualisieren' })
  expect(document.querySelector('time')).toHaveAttribute('dateTime', '2026-10-17T12:00:00Z')
  const user = userEvent.setup()
  state = { status: 'ready', availability: 'ready', dueCount: 2, nextAvailableAt: null }
  await user.click(refresh)
  expect(await screen.findByText('2 Fragen sind jetzt verfügbar.')).toBeVisible()
  expect(document.querySelector('time')).toBeNull()
  expect(jest.mocked(global.fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true)
})


test.each(['done', 'unavailable'] as const)('new %s controls have natural height and bounded wrapping at enlarged text', stage => {
  render(<PracticeLearnerView courseId="course-1" stage={stage} canCloseSession={stage === 'done'} />)
  const controls = [screen.getByRole('button', { name: 'Stand aktualisieren' }),
    ...(stage === 'done' ? [screen.getByRole('button', { name: 'Sitzung abschließen' })] : [])]
  for (const control of controls) {
    expect(control).toHaveClass('h-auto', 'min-h-11', 'min-w-0', 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]')
    expect(control).not.toHaveClass('h-11', 'whitespace-nowrap')
  }
})

test('course-entry refresh uses the same bounded enlarged-text control treatment', async () => {
  global.fetch = jest.fn(async () => response({ status: 'complete', availability: 'waiting', dueCount: 0, nextAvailableAt: '2026-10-17T12:00:00Z' }))
  render(<PracticeEntryLink courseId="course-1" />)
  const refresh = await screen.findByRole('button', { name: 'Stand aktualisieren' })
  expect(refresh).toHaveClass('h-auto', 'min-w-0', 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]')
  expect(refresh).not.toHaveClass('h-11', 'whitespace-nowrap')
})
