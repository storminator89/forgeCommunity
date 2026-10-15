import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { CourseDraftWorkspace } from '@/app/courses/[courseId]/contents/CourseDraftWorkspace'
import type { AuthorState } from '@/app/courses/[courseId]/contents/authoring-api'
import type { CourseContent } from '@/app/courses/[courseId]/contents/types'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => <span>Kurse</span> }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/app/courses/[courseId]/contents/CoursePathOverview', () => ({
  getCoursePathEntries: jest.requireActual<typeof import('@/app/courses/[courseId]/contents/CoursePathOverview')>('@/app/courses/[courseId]/contents/CoursePathOverview').getCoursePathEntries,
  CoursePathOverview: () => <p>Lernpfad</p>,
}))
jest.mock('@/app/courses/[courseId]/contents/ContentRenderer', () => ({ ContentRenderer: () => null }))
jest.mock('@/app/courses/[courseId]/contents/CourseAuthoringOutline', () => ({
  CourseAuthoringOutline: ({ contents, onContentSelect, onRename, onReorder, onAddContent, onDelete }: {
    contents: CourseContent[]; onContentSelect: (id: string) => void; onRename: (id: string, title: string) => Promise<void>;
    onReorder: (id: string, direction: 'up' | 'down', parentId: string | null) => Promise<void>;
    onAddContent: (id: string | null) => void; onDelete: (node: CourseContent) => Promise<void>
  }) => <nav aria-label="Kursstruktur bearbeiten">{contents.map(node => <div key={node.id}>
    <button onClick={() => onContentSelect(node.id)}>{node.title}</button>
    <button onClick={() => void onRename(node.id, 'Umbenannt')}>Umbenennen {node.title}</button>
    <button onClick={() => void onReorder(node.id, 'down', node.parentId)}>Runter {node.title}</button>
    <button onClick={() => onDelete(node)}>Löschen {node.title}</button>
  </div>)}<button onClick={() => onAddContent(null)}>Neuer Inhalt</button></nav>,
}))
jest.mock('@/app/courses/[courseId]/contents/NewCourseContentDialog', () => ({
  NewCourseContentDialog: ({ open, onCreate }: { open: boolean; onCreate: (value: { title: string; type: 'TEXT' | 'QUIZ'; parentId: null }) => Promise<void> }) => open ? <><button onClick={() => void onCreate({ title: 'Neu', type: 'TEXT', parentId: null })}>Im Entwurf anlegen</button><button onClick={() => void onCreate({ title: 'Quiz', type: 'QUIZ', parentId: null })}>Quiz im Entwurf anlegen</button></> : null,
}))
jest.mock('@/app/courses/[courseId]/contents/InstructorCoursePreview', () => ({
  InstructorCoursePreview: ({ open, draft }: { open: boolean; draft?: CourseContent | null }) => open ? <section aria-label="Entwurfsvorschau">{draft?.title ?? 'Gespeicherter Entwurf'}</section> : null,
}))
jest.mock('@/app/courses/[courseId]/contents/EditContentForm', () => ({
  EditContentForm: ({ content, onContentChange, onSubmit }: { content: CourseContent; onContentChange: (value: Partial<CourseContent>) => void; onSubmit: (value: CourseContent) => Promise<void> }) => {
    const [title, setTitle] = useState(content.title)
    const [error, setError] = useState('')
    return <form aria-label="Inhalt bearbeiten" onSubmit={event => { event.preventDefault(); void onSubmit({ ...content, title }).catch(cause => setError(cause.message)) }}>
      <label htmlFor="edit-title">Inhaltstitel</label><input id="edit-title" value={title} onChange={event => { setTitle(event.target.value); onContentChange({ title: event.target.value }) }} />
      <button type="submit">Entwurf speichern</button>{error && <p role="alert">{error}</p>}
    </form>
  },
}))

const result = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response
const initial = (): AuthorState => ({
  draft: { revision: 2, digest: 'draft-2', payload: { schemaVersion: 1, title: 'Werkstattkurs', description: 'Praxis', startDate: null, endDate: null, imageUrl: null,
    contents: [{ id: 'a', parentId: null, title: 'Kapitel', type: 'TEXT', content: '<p>Alt</p>', order: 1 }, { id: 'b', parentId: null, title: 'Lektion', type: 'TEXT', content: '<p>Text</p>', order: 2 }] } },
  activePublication: { id: 'pub-1', sequence: 1, digest: 'live-1' },
})
let server: AuthorState
let mockFetch: jest.Mock
let failNextPatch: number | null
let reviewReady: boolean
const onLiveMode = jest.fn()

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: () => '11111111-1111-4111-8111-111111111111' })
})
beforeEach(() => {
  history.replaceState({}, '', '/courses/course/contents')
  server = initial(); failNextPatch = null; reviewReady = true; onLiveMode.mockClear()
  mockFetch = jest.fn(async (input: string, options: RequestInit = {}) => {
    if (input.endsWith('/authoring/assets')) return result({ id: 'asset-1', url: '/api/courses/course/assets/asset-1', mimeType: 'image/png', size: 3 }, 201)
    if (input.endsWith('/authoring/review?expectedRevision=2&expectedActivePublicationId=pub-1') || input.includes('/authoring/review?')) return result({ ready: reviewReady, blockers: reviewReady ? [] : ['Der Inhalt ist unvollständig.'], revision: server.draft.revision, digest: server.draft.digest, activePublicationId: server.activePublication?.id ?? null, impact: { added: [], removed: [], changed: ['a'], renamedOrReordered: [], enrolledLearners: 3, completionMayChange: true, rewardsMayChange: false, issuedCertificatesStayValid: true } })
    if (input.endsWith('/authoring/publish')) {
      server = { ...server, activePublication: { id: 'pub-2', sequence: 2, digest: server.draft.digest } }
      return result({ publication: server.activePublication, unchanged: false })
    }
    if (input.endsWith('/authoring/history')) return result({ publications: [{ id: 'pub-1', sequence: 1, digest: 'live-1', source: 'BASELINE', recordedAt: '2026-10-01T00:00:00.000Z' }] })
    if (input.endsWith('/authoring/restore')) { server = { ...server, draft: { ...server.draft, revision: server.draft.revision + 1, digest: 'restored' } }; return result(server) }
    if (input.endsWith('/authoring') && options.method === 'PATCH') {
      if (failNextPatch) { const status = failNextPatch; failNextPatch = null; return result({ error: 'stale' }, status) }
      const body = JSON.parse(String(options.body))
      const payload = JSON.parse(JSON.stringify(server.draft.payload))
      if (body.operation.kind === 'setMetadata') Object.assign(payload, body.operation.patch)
      if (body.operation.kind === 'updateNode') Object.assign(payload.contents.find((node: { id: string }) => node.id === body.operation.id), body.operation.patch)
      if (body.operation.kind === 'insertNode') payload.contents.push({ ...body.operation.node, parentId: body.operation.parentId, order: 3 })
      server = { ...server, draft: { revision: server.draft.revision + 1, digest: `draft-${server.draft.revision + 1}`, payload } }
      return result(server)
    }
    if (input.endsWith('/authoring') && options.method === 'DELETE') { server = { ...server, draft: { ...server.draft, revision: server.draft.revision + 1, digest: server.activePublication?.digest ?? 'empty', payload: server.activePublication ? server.draft.payload : { schemaVersion: 1, title: '', description: '', startDate: null, endDate: null, imageUrl: null, contents: [] } } }; return result(server) }
    return result(server)
  })
  global.fetch = mockFetch
})

test('keeps saved drafts private and publishes only after server review and explicit confirmation', async () => {
  render(<CourseDraftWorkspace courseId="course" initialState={server} onLiveMode={onLiveMode} />)
  expect(screen.getByText('Unveröffentlichte Änderungen')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Kurstitel'), { target: { value: 'Neuer Kurstitel' } })
  expect(screen.getAllByText('Ungespeicherte Änderungen').length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: 'Änderungen veröffentlichen' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }))
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/courses/course/authoring', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ expectedRevision: 2, operation: { kind: 'setMetadata', patch: { title: 'Neuer Kurstitel' } } }) })))
  expect(await screen.findByText(/Für Lernende noch nicht sichtbar/)).toBeInTheDocument()
  expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/contents/'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen veröffentlichen' }))
  const review = within(await screen.findByRole('dialog'))
  expect(await review.findByText('3 eingeschriebene Lernende folgen nach Veröffentlichung der neuesten Fassung.')).toBeInTheDocument()
  expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith('/publish'))).toBe(false)
  fireEvent.click(review.getByRole('button', { name: 'Änderungen veröffentlichen' }))
  expect(await screen.findByText('Veröffentlicht · Version 2.')).toBeInTheDocument()
  expect(mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/publish'))).toHaveLength(1)
})

test('keeps local text on 412 and compares current draft without an automatic overwrite', async () => {
  history.replaceState({}, '', '/courses/course/contents?content=a')
  render(<CourseDraftWorkspace courseId="course" initialState={server} onLiveMode={onLiveMode} />)
  fireEvent.change(screen.getByLabelText('Inhaltstitel'), { target: { value: 'Nur lokal' } })
  failNextPatch = 412
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }))
  expect(await screen.findByText('Der Entwurf wurde an anderer Stelle geändert')).toBeInTheDocument()
  expect(screen.getByLabelText('Inhaltstitel')).toHaveValue('Nur lokal')
  server = { ...server, draft: { ...server.draft, revision: 7 } }
  fireEvent.click(screen.getByRole('button', { name: 'Aktuellen Entwurf vergleichen' }))
  expect(await screen.findByText(/Aktueller Entwurf: Revision 7/)).toBeInTheDocument()
  expect(screen.getByLabelText('Inhaltstitel')).toHaveValue('Nur lokal')
  expect(mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/publish'))).toHaveLength(0)
})

test('preview reads local changes without learner mutation and server blockers stop publication', async () => {
  history.replaceState({}, '', '/courses/course/contents?content=a')
  render(<CourseDraftWorkspace courseId="course" initialState={server} onLiveMode={onLiveMode} />)
  fireEvent.change(screen.getByLabelText('Inhaltstitel'), { target: { value: 'Nur Vorschau' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  expect(screen.getByLabelText('Entwurfsvorschau')).toHaveTextContent('Nur Vorschau')
  expect(mockFetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }))
  expect(mockFetch.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([['/api/courses/course/authoring', 'PATCH']])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Änderungen veröffentlichen' })).toBeEnabled())
  reviewReady = false
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen veröffentlichen' }))
  const dialog = within(await screen.findByRole('dialog'))
  expect(await dialog.findByText('Der Inhalt ist unvollständig.')).toBeInTheDocument()
  expect(dialog.getByRole('button', { name: 'Änderungen veröffentlichen' })).toBeDisabled()
})

test('restoring history creates a new draft and does not publish', async () => {
  render(<CourseDraftWorkspace courseId="course" initialState={server} onLiveMode={onLiveMode} />)
  fireEvent.click(screen.getByRole('button', { name: 'Versionen' }))
  const dialog = within(await screen.findByRole('dialog'))
  fireEvent.click(await dialog.findByRole('button', { name: 'Als Entwurf wiederherstellen' }))
  fireEvent.click(screen.getByRole('button', { name: 'Als Entwurf wiederherstellen' }))
  await screen.findByText('Version als neuen privaten Entwurf wiederhergestellt. Prüfe sie vor der Veröffentlichung.')
  expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith('/publish'))).toBe(false)
  const restore = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/restore'))
  expect(JSON.parse(String(restore?.[1]?.body))).toEqual({ publicationId: 'pub-1', expectedRevision: 2 })
})

test('new nodes and sibling reordering use typed private operations with stable positions', async () => {
  render(<CourseDraftWorkspace courseId="course" initialState={server} onLiveMode={onLiveMode} />)
  fireEvent.click(screen.getByRole('button', { name: 'Neuer Inhalt' }))
  fireEvent.click(screen.getByRole('button', { name: 'Im Entwurf anlegen' }))
  await waitFor(() => expect(mockFetch.mock.calls.some(([url, options]) => String(url).endsWith('/authoring') && JSON.parse(String(options?.body)).operation.kind === 'insertNode')).toBe(true))
  const inserted = mockFetch.mock.calls.find(([url, options]) => String(url).endsWith('/authoring') && JSON.parse(String(options?.body)).operation.kind === 'insertNode')
  expect(JSON.parse(String(inserted?.[1]?.body)).operation).toMatchObject({ kind: 'insertNode', parentId: null, afterId: 'b', node: { title: 'Neu', type: 'TEXT', content: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Runter Kapitel' }))
  await waitFor(() => expect(mockFetch.mock.calls.some(([url, options]) => String(url).endsWith('/authoring') && JSON.parse(String(options?.body)).operation.kind === 'moveNode')).toBe(true))
  const moved = mockFetch.mock.calls.find(([url, options]) => String(url).endsWith('/authoring') && JSON.parse(String(options?.body)).operation.kind === 'moveNode')
  expect(JSON.parse(String(moved?.[1]?.body)).operation).toMatchObject({ kind: 'moveNode', id: 'a', parentId: null, afterId: 'b' })
})

test('a new quiz is seeded with editable quiz JSON rather than malformed empty content', async () => {
  render(<CourseDraftWorkspace courseId="course" initialState={server} onLiveMode={onLiveMode} />)
  fireEvent.click(screen.getByRole('button', { name: 'Neuer Inhalt' }))
  fireEvent.click(screen.getByRole('button', { name: 'Quiz im Entwurf anlegen' }))
  await waitFor(() => expect(mockFetch.mock.calls.some(([url, options]) => String(url).endsWith('/authoring') && JSON.parse(String(options?.body)).operation.kind === 'insertNode')).toBe(true))
  const created = mockFetch.mock.calls.find(([url, options]) => String(url).endsWith('/authoring') && JSON.parse(String(options?.body)).operation.kind === 'insertNode')
  const node = JSON.parse(String(created?.[1]?.body)).operation.node
  expect(node.type).toBe('QUIZ')
  expect(JSON.parse(node.content)).toEqual({ questions: [], shuffleQuestions: false, passingScore: 70 })
})

test('a new cover upload is separate from saving the private draft', async () => {
  render(<CourseDraftWorkspace courseId="course" initialState={server} onLiveMode={onLiveMode} />)
  const input = screen.getByLabelText('Neues privates Bild hochladen')
  fireEvent.change(input, { target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] } })
  await waitFor(() => expect(screen.getByLabelText('Titelbild-URL')).toHaveValue('/api/courses/course/assets/asset-1'))
  expect(mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/authoring'))).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }))
  await waitFor(() => expect(mockFetch.mock.calls.some(([url, options]) => String(url).endsWith('/authoring') && JSON.parse(String(options?.body)).operation.kind === 'setMetadata')).toBe(true))
  const patch = mockFetch.mock.calls.find(([url, options]) => String(url).endsWith('/authoring') && JSON.parse(String(options?.body)).operation.kind === 'setMetadata')
  expect(JSON.parse(String(patch?.[1]?.body)).operation.patch).toEqual({ imageUrl: '/api/courses/course/assets/asset-1' })
})

test('warns that discarding a never-published draft clears its metadata and contents', async () => {
  server = { ...server, activePublication: null }
  render(<CourseDraftWorkspace courseId="course" initialState={server} onLiveMode={onLiveMode} />)
  fireEvent.click(screen.getByRole('button', { name: 'Entwurf verwerfen' }))
  expect(await screen.findByText(/samt Kursdaten und Inhalten wird geleert/)).toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Entwurf verwerfen' }))
  expect(await screen.findByText('Privaten Entwurf geleert. Der Kurs wurde nicht gelöscht.')).toBeInTheDocument()
  expect(screen.getByLabelText('Kurstitel')).toHaveValue('')
})
