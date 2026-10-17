import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CourseContentsEditor } from '@/app/courses/[courseId]/contents/CourseContentsEditor'
import { findContent } from '@/app/courses/[courseId]/contents/content-tree'
import type { CourseContent, CourseProgressSnapshot, QuizContent } from '@/app/courses/[courseId]/contents/types'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'author' } } }) }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => <a href="/members">Mitglieder</a> }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange, readOnly }: { content: string; onChange: (value: string) => void; readOnly?: boolean }) => <textarea aria-label="Lektionstext" value={content} disabled={readOnly} onChange={event => onChange(event.target.value)} /> }))
jest.mock('@/app/courses/[courseId]/contents/QuizEditor', () => ({ QuizEditor: ({ onChange }: { onChange?: (value: QuizContent) => void }) => <button type="button" onClick={() => onChange?.({ questions: [{ id: 'draft-question', type: 'SINGLE_CHOICE', question: 'Lokale Quizfrage?', options: ['Richtig', 'Andere'], correctAnswers: [0] }], passingScore: 70 })}>Quizentwurf ändern</button> }))

const lesson = (id: string, overrides: Partial<CourseContent> = {}): CourseContent => ({ id, courseId: 'course', parentId: null, title: id, type: 'TEXT', content: '<p>Gespeicherter Lerninhalt</p>', order: 1, updatedAt: '2026-10-15T08:00:00.000Z', publicationId: 'pub-1', contentVersionToken: `opaque-${id}`, ...overrides })
const quiz: QuizContent = { questions: [{ id: 'saved-question', type: 'SINGLE_CHOICE', question: 'Gespeicherte Quizfrage?', options: ['Richtig', 'Andere'], correctAnswers: [0] }], passingScore: 70 }
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response
let mockTree: CourseContent[]
let mockCanEdit: boolean
let mockProgress: CourseProgressSnapshot
let mockWrite: jest.Mock<Promise<Response>, [string, RequestInit]>

beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
beforeEach(() => {
  history.replaceState({}, '', '/courses/course/contents?content=lesson')
  window.localStorage.clear()
  mockPush.mockClear()
  mockCanEdit = true
  mockProgress = { publicationId: 'pub-1', completedContentIds: [], complete: false, canTrack: true, hasCertificate: true, completedAt: null }
  mockTree = [lesson('chapter', { title: 'Kapitel', content: '', subContents: [lesson('lesson', { title: 'Lektion', parentId: 'chapter' }), lesson('quiz', { title: 'Wissenstest', type: 'QUIZ', content: JSON.stringify(quiz), parentId: 'chapter', order: 2 })] }), lesson('empty', { title: 'Noch leer', content: '', order: 2 })]
  mockWrite = jest.fn(async (url, options) => {
    const body = options.body ? JSON.parse(String(options.body)) : {}
    if (url.endsWith('/progress')) { mockProgress = { ...mockProgress, completedContentIds: [body.contentId] }; return response(mockProgress) }
    if (url.endsWith('/attempts')) return response({ score: 100, passed: true })
    if (url.endsWith('/reorder')) return response({ contents: mockTree })
    if (url.endsWith('/move')) return response(mockTree)
    if (options.method === 'DELETE') return response({ deleted: true })
    if (options.method === 'POST') return response(lesson('created', { ...body, order: 3 }))
    const saved = findContent(mockTree, url.split('/').at(-1)!)!
    return response({ ...saved, ...body, subContents: undefined })
  })
  global.fetch = jest.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input)
    if (options?.method && options.method !== 'GET') return mockWrite(url, options)
    if (url.endsWith('/progress')) return response(mockProgress)
    if (url.endsWith('/contents')) return response(JSON.parse(JSON.stringify(mockTree)))
    return response({ id: 'course', name: 'Werkstattkurs', canEdit: mockCanEdit })
  })
})

async function openEditor() {
  render(<CourseContentsEditor courseId="course" />)
  await screen.findByRole('form', { name: 'Inhalt bearbeiten' })
  return userEvent.setup()
}

async function outlineAction(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole('button', { name: 'Aktionen für Lektion' }))
  await user.click(screen.getByRole('menuitem', { name: item }))
}

it('uses the URL selection in author mode and keeps real learner completion and issued certificates behind the explicit mode switch', async () => {
  const user = await openEditor()
  expect(screen.getByLabelText('Titel')).toHaveValue('Lektion')
  expect(screen.getByRole('button', { name: 'Bearbeiten' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'Als abgeschlossen markieren' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Zertifikat herunterladen' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Lernen' }))
  expect(screen.queryByRole('form', { name: 'Inhalt bearbeiten' })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Kursstruktur bearbeiten' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: /Inhalt bearbeiten|Vorschau|Aktionen für/ })).not.toBeInTheDocument()
  expect(mockWrite).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Als abgeschlossen markieren' }))
  await screen.findByRole('button', { name: 'Abschlussmarkierung entfernen' })
  expect(mockWrite).toHaveBeenCalledWith('/api/courses/course/progress', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ contentId: 'lesson', completed: true, publicationId: 'pub-1', contentVersionToken: 'opaque-lesson' }) }))
  await user.click(screen.getByRole('button', { name: 'Bearbeiten' }))
  expect(screen.getByLabelText('Titel')).toHaveValue('Lektion')
  expect(location.search).toBe('?content=lesson')
})

it('never renders author tools for learners and retains an issued certificate when the course is empty', async () => {
  mockCanEdit = false
  mockTree = []
  render(<CourseContentsEditor courseId="course" />)
  await screen.findByRole('heading', { name: 'Noch keine Kursinhalte' })
  expect(screen.queryByRole('group', { name: 'Kursansicht' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Vorschau|Inhalt hinzufügen|Kurs prüfen/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).toBeEnabled()
  expect(mockWrite).not.toHaveBeenCalled()
})

it('creates a typed nested entry only on confirmation, retains failed inputs and selects it only after success', async () => {
  const user = await openEditor()
  await outlineAction(user, 'Unterinhalt hinzufügen')
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Titel'), { target: { value: ' Neuer Wissenstest ' } })
  await user.click(dialog.getByRole('button', { name: 'Quiz' }))
  expect(mockWrite).not.toHaveBeenCalled()
  mockWrite.mockResolvedValueOnce(response({}, 500))
  await user.click(dialog.getByRole('button', { name: 'Anlegen' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('nicht angelegt')
  expect(dialog.getByLabelText('Titel')).toHaveValue(' Neuer Wissenstest ')
  expect(dialog.getByRole('button', { name: 'Quiz' })).toHaveAttribute('aria-pressed', 'true')
  expect(location.search).toBe('?content=lesson')
  let resolve!: (value: Response) => void
  mockWrite.mockImplementationOnce(() => new Promise(result => { resolve = result }))
  fireEvent.submit(dialog.getByRole('form', { name: 'Kursinhalt hinzufügen' }))
  fireEvent.submit(dialog.getByRole('form', { name: 'Kursinhalt hinzufügen' }))
  expect(mockWrite).toHaveBeenCalledTimes(2)
  expect(mockWrite).toHaveBeenLastCalledWith('/api/courses/course/contents', expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'Neuer Wissenstest', type: 'QUIZ', content: '', parentId: 'lesson' }) }))
  expect(location.search).toBe('?content=lesson')
  await act(async () => resolve(response(lesson('created', { title: 'Neuer Wissenstest', type: 'QUIZ', content: JSON.stringify({ questions: [] }), parentId: 'lesson' }), 201)))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Titel')).toHaveValue('Neuer Wissenstest')
  expect(screen.getByRole('button', { name: 'Quizentwurf ändern' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /1.1.1 Neuer Wissenstest Quiz/ })).toHaveAttribute('aria-current', 'page')
  expect(location.search).toBe('?content=created')
})

it('retains a failed draft, blocks repeat saves and retains edit mode using the canonical successful response', async () => {
  const user = await openEditor()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Lokaler Titel' } })
  fireEvent.change(screen.getByLabelText('Lektionstext'), { target: { value: '<p>Lokaler Text</p><script>unsafe()</script>' } })
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  let resolve!: (value: Response) => void
  mockWrite.mockImplementationOnce(() => new Promise(result => { resolve = result }))
  const form = screen.getByRole('form', { name: 'Inhalt bearbeiten' })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(mockWrite).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Lernen' })).toBeDisabled()
  expect(screen.getByRole('button', { name: /1.2 Wissenstest Quiz/ })).toBeDisabled()
  await act(async () => resolve(response({}, 500)))
  expect(await screen.findByRole('alert')).toHaveTextContent('Dein Entwurf bleibt erhalten')
  expect(screen.getByLabelText('Titel')).toHaveValue('Lokaler Titel')
  expect(screen.getByLabelText('Lektionstext')).toHaveValue('<p>Lokaler Text</p><script>unsafe()</script>')
  let finishSave!: (value: Response) => void
  mockWrite.mockImplementationOnce(() => new Promise(result => { finishSave = result }))
  const save = screen.getByRole('button', { name: 'Speichern' })
  save.focus()
  await user.click(save)
  // Browsers can move focus away when the submit control is disabled pending
  // the request. The replacement control must still receive focus on success.
  save.blur()
  await act(async () => finishSave(response(lesson('lesson', { parentId: 'chapter', title: 'Kanonischer Titel', content: '<p>Kanonischer Text</p>', updatedAt: '2026-10-15T09:00:00.000Z' }))))
  await waitFor(() => expect(screen.getByLabelText('Titel')).toHaveValue('Kanonischer Titel'))
  expect(screen.getByLabelText('Lektionstext')).toHaveValue('<p>Kanonischer Text</p>')
  expect(screen.getByRole('form', { name: 'Inhalt bearbeiten' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Speichern' })).toHaveFocus()
  expect(screen.getByText('Inhalt gespeichert. Gespeicherte Änderungen sind sofort für Teilnehmende sichtbar.')).toBeVisible()
  expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /2 Noch leer Text/ }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Titel')).toHaveValue('Noch leer')
})

it.each(['selection', 'mode', 'create', 'rename', 'move', 'delete', 'reorder'] as const)('gates %s through the same dirty decision without prematurely mutating or discarding', async action => {
  const user = await openEditor()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Mein Entwurf' } })
  if (action === 'selection') await user.click(screen.getByRole('button', { name: /2 Noch leer Text/ }))
  else if (action === 'mode') await user.click(screen.getByRole('button', { name: 'Lernen' }))
  else if (action === 'create') await user.click(screen.getByRole('button', { name: 'Inhalt hinzufügen' }))
  else await outlineAction(user, { rename: 'Umbenennen', move: 'Verschieben …', delete: 'Löschen …', reorder: 'Nach unten' }[action])
  const guard = within(screen.getByRole('alertdialog'))
  expect(guard.getByRole('heading', { name: 'Ungespeicherte Änderungen' })).toBeVisible()
  expect(mockWrite).not.toHaveBeenCalled()
  expect(location.search).toBe('?content=lesson')
  await user.click(guard.getByRole('button', { name: 'Weiter bearbeiten' }))
  expect(screen.getByLabelText('Titel')).toHaveValue('Mein Entwurf')
  expect(screen.getByRole('button', { name: 'Bearbeiten' })).toHaveAttribute('aria-pressed', 'true')
  expect(mockWrite).not.toHaveBeenCalled()
})

it('remounts the saved editor after discarding a draft through the already selected outline row', async () => {
  const user = await openEditor()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Nur lokal' } })
  await user.click(screen.getByRole('button', { name: /1.1 Lektion Text/ }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Ungespeicherte Änderungen')
  await user.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }))
  expect(screen.getByRole('form', { name: 'Inhalt bearbeiten' })).toBeInTheDocument()
  expect(screen.getByLabelText('Titel')).toHaveValue('Lektion')
  expect(screen.getByLabelText('Lektionstext')).toHaveValue('<p>Gespeicherter Lerninhalt</p>')
  expect(screen.getByRole('form', { name: 'Inhalt bearbeiten' })).toHaveTextContent('Gespeicherter Inhalt')
  expect(mockWrite).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Neuer lokaler Entwurf' } })
  await user.click(screen.getByRole('button', { name: /2 Noch leer Text/ }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Ungespeicherte Änderungen')
})

it('executes an accepted guarded reorder once and clears the discarded draft', async () => {
  const user = await openEditor()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Verwerfen' } })
  await outlineAction(user, 'Nach unten')
  await user.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }))
  await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
  expect(mockWrite).toHaveBeenCalledWith('/api/courses/course/contents/lesson/reorder', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ direction: 'down', mainContentId: 'chapter' }) }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Inhalt bearbeiten' })).toBeEnabled())
  expect(screen.queryByRole('form', { name: 'Inhalt bearbeiten' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /2 Noch leer Text/ }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('keeps review advisory and guards review navigation while previewing the unsaved sanitized text without writes', async () => {
  const user = await openEditor()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Entwurfsvorschau' } })
  fireEvent.change(screen.getByLabelText('Lektionstext'), { target: { value: '<p>Nur lokal</p><script>unsafe()</script>' } })
  await user.click(screen.getByRole('button', { name: 'Kurs prüfen' }))
  expect(screen.getByText(/Die Prüfung zeigt den gespeicherten Stand/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Thema öffnen: Noch leer' }))
  await user.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }))
  const preview = screen.getByRole('button', { name: 'Vorschau' })
  await user.click(preview)
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByRole('heading', { name: 'Entwurfsvorschau' })).toBeVisible()
  expect(dialog.getByText('Nur lokal')).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
  expect(dialog.getByText(/Ungespeicherter Entwurf/)).toBeVisible()
  expect(mockWrite).not.toHaveBeenCalled()
  expect(location.search).toBe('?content=lesson')
  await user.click(dialog.getByRole('button', { name: 'Schließen' }))
  expect(screen.getByLabelText('Titel')).toHaveValue('Entwurfsvorschau')
  expect(preview).toHaveFocus()
})

it('rehearses the current unsaved quiz locally for an enrolled owner; real attempts require the explicit learner mode', async () => {
  history.replaceState({}, '', '/courses/course/contents?content=quiz')
  const user = await openEditor()
  await user.click(screen.getByRole('button', { name: 'Quizentwurf ändern' }))
  await user.click(screen.getByRole('button', { name: 'Vorschau' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText(/Lokale Quizfrage\?/)).toBeVisible()
  await user.click(dialog.getByRole('radio', { name: 'Richtig' }))
  expect(dialog.getByText(/1 von 1 Vorschaufragen beantwortet/)).toBeVisible()
  expect(dialog.queryByRole('button', { name: 'Antwort prüfen' })).not.toBeInTheDocument()
  await user.click(dialog.getByRole('button', { name: 'Lösungen anzeigen' }))
  expect(dialog.getByText('Lösung')).toBeVisible()
  expect(mockWrite).not.toHaveBeenCalled()
  await user.click(dialog.getByRole('button', { name: 'Schließen' }))
  await user.click(screen.getByRole('button', { name: 'Lernen' }))
  await user.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }))
  expect(screen.getByText('1. Gespeicherte Quizfrage?')).toBeVisible()
  expect(screen.queryByText('Lokale Quizfrage?')).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'Richtig' }))
  await user.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1))
  expect(mockWrite).toHaveBeenCalledWith('/api/courses/course/contents/quiz/attempts', expect.objectContaining({ method: 'POST' }))
})

it('mounts the current nested path only in author review and guards its selection before opening the requested editor', async () => {
  const user = await openEditor()
  await user.click(screen.getByRole('button', { name: 'Kurs prüfen' }))
  const path = within(screen.getByRole('region', { name: 'Lernpfad im Kurs' }))
  expect(path.getByText('1 Kapitel · 3 Inhalte ohne Unterthemen · davon 1 Quiz')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Lokaler Titel' } })
  await user.click(path.getByRole('button', { name: 'Noch leer öffnen' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Ungespeicherte Änderungen')
  expect(mockWrite).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }))
  expect(screen.getByLabelText('Titel')).toHaveValue('Noch leer')
  expect(location.search).toBe('?content=empty')
  expect(screen.queryByRole('region', { name: 'Lernpfad im Kurs' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Lernen' }))
  expect(screen.queryByRole('region', { name: 'Lernpfad im Kurs' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Kurs prüfen' })).not.toBeInTheDocument()
})


it('explains retained credit while blocking access and first-certificate issuance during a date lock', async () => {
  mockCanEdit = false
  mockTree = [lesson('lesson', { title: 'Lektion', locked: true, releaseLocked: true, releaseOn: '2099-11-01', content: '', contentVersionToken: null })]
  mockProgress = { completedContentIds: ['lesson'], complete: true, canIssueCertificate: false, canTrack: true, hasCertificate: false, completedAt: '2026-10-15T08:00:00Z' }
  render(<CourseContentsEditor courseId="course" />)
  expect(await screen.findByText('Bereits abgeschlossen. Dein Abschluss zählt weiter; der Zugriff wartet auf die Kapitelfreigabe.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).toBeDisabled()
  expect(screen.getByText('Dein Abschluss zählt weiter. Ein neues Zertifikat ist nach der Kapitelfreigabe verfügbar.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Lektion Abgeschlossen · Zugriff ab 01.11.2099/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Als abgeschlossen markieren' })).not.toBeInTheDocument()
  expect(mockWrite).not.toHaveBeenCalled()
})

it('keeps an existing certificate available while its completed lesson is date-locked', async () => {
  mockCanEdit = false
  mockTree = [lesson('lesson', { title: 'Lektion', locked: true, releaseLocked: true, releaseOn: '2099-11-01', content: '', contentVersionToken: null })]
  mockProgress = { completedContentIds: ['lesson'], complete: true, canIssueCertificate: false, canTrack: true, hasCertificate: true, completedAt: '2026-10-15T08:00:00Z' }
  render(<CourseContentsEditor courseId="course" />)
  await screen.findByText('Bereits abgeschlossen. Dein Abschluss zählt weiter; der Zugriff wartet auf die Kapitelfreigabe.')
  expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).toBeEnabled()
  expect(mockWrite).not.toHaveBeenCalled()
})
