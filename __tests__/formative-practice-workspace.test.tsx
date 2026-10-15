import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PracticeAuthorWorkspace } from '@/app/courses/[courseId]/practice/PracticeAuthorWorkspace'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
const objective = { id: 'objective-1', title: 'Grundlagen anwenden', description: 'Begriffe erkennen', revision: 1 }
const item = { id: 'item-1', objectiveId: objective.id, latestRevision: 1, prompt: 'Welche Antwort stimmt?' }
const choice = { schemaVersion: 1, type: 'SINGLE_CHOICE', prompt: item.prompt, options: ['Richtig', 'Falsch'], correctIndex: 0, explanation: 'Richtig ist korrekt.' }
const ref = { objectiveId: objective.id, objectiveRevision: 1, itemId: item.id, itemRevision: 1 }
const state = { draft: { revision: 0, digest: 'empty-digest', payload: { schemaVersion: 1, items: [] } }, activeCoursePublicationId: 'course-publication-1', activeSnapshot: null }

beforeEach(() => { window.localStorage.clear() })

test('guards owner-only load failures without showing editing controls', async () => {
  global.fetch = jest.fn(async () => response({ error: 'Kein Zugriff auf den Kurs.' }, 403))
  render(<PracticeAuthorWorkspace courseId="course-1" sessionStatus="authenticated" />)
  expect(await screen.findByText('Kein Zugriff auf diesen Übungsentwurf')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Neue Frage' })).not.toBeInTheDocument()
  expect(screen.getByText(/Veröffentlichte Übungen können Mitglieder im Kurs freiwillig nutzen/)).toBeVisible()
})

test('pins exact owner revisions, previews from owner API, and publishes only after an explicit review', async () => {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = []
  let current: unknown = state
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    if (init?.method && init.method !== 'GET' && !url.endsWith('/preview')) writes.push({ url, body })
    if (url.endsWith('/practice/objectives')) return response({ objectives: [objective] })
    if (url.endsWith('/objective-1/items')) return response({ items: [item] })
    if (url.endsWith('/item-1/revisions/1')) return response({ itemId: item.id, revision: 1, choice })
    if (url.endsWith('/practice/authoring/preview')) return response({ items: [{ ...ref, objectiveTitle: objective.title, objectiveDescription: objective.description, ...choice }] })
    if (url.endsWith('/practice/authoring/publish')) return response({ snapshot: { id: 'practice-snapshot-1', coursePublicationId: 'course-publication-1', sequence: 1, digest: 'digest-1', itemCount: 1 }, unchanged: false, replay: false })
    if (url.endsWith('/practice/authoring')) {
      if (init?.method === 'PATCH') {
        current = { ...state, draft: { ...state.draft, revision: 1, payload: { schemaVersion: 1, items: [ref] } } }
        return response(current)
      }
      return response(current)
    }
    return response({ error: 'Unexpected URL' }, 404)
  })
  const user = userEvent.setup()
  render(<PracticeAuthorWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await user.click(await screen.findByRole('button', { name: /Welche Antwort stimmt/ }))
  expect(await screen.findByLabelText('Fragetext')).toHaveValue(item.prompt)
  await user.click(screen.getByRole('button', { name: 'Version anheften' }))
  expect(screen.getByText('Ungespeicherte Zusammenstellung')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Veröffentlichung prüfen' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Zusammenstellung speichern' }))
  await waitFor(() => expect(writes).toContainEqual({ url: '/api/courses/course-1/practice/authoring', body: { expectedRevision: 0, items: [ref] } }))
  expect(screen.getByRole('button', { name: 'Veröffentlichung prüfen' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Veröffentlichung prüfen' }))
  const review = await screen.findByRole('region', { name: 'Veröffentlichung prüfen' })
  expect(within(review).getByText(/Richtig ist korrekt/)).toBeVisible()
  expect(writes).toHaveLength(1)
  await user.click(within(review).getByRole('button', { name: 'Diese Übungsfassung veröffentlichen' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1].url).toBe('/api/courses/course-1/practice/authoring/publish')
  expect(writes[1].body).toEqual({ expectedRevision: 1, expectedActivePublicationId: 'course-publication-1', requestId: expect.any(String) })
  expect(await screen.findByText(/Veröffentlichungsbeleg · Version 1/)).toBeVisible()
  expect(screen.getByText(/Mitglieder können diese Fassung im Kurs freiwillig üben/)).toBeVisible()
})

test('retains local item text on 412 and explicitly rebases onto the current revision', async () => {
  let latest = 1
  const patched: Record<string, unknown>[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    if (url.endsWith('/practice/objectives')) return response({ objectives: [objective] })
    if (url.endsWith('/objective-1/items')) return response({ items: [{ ...item, latestRevision: latest }] })
    if (url.endsWith('/items/item-1') && !init?.method) return response({ ...item, latestRevision: latest, prompt: latest === 2 ? 'Änderung anderer Autor' : item.prompt })
    if (url.endsWith('/item-1/revisions/1')) return response({ itemId: item.id, revision: 1, choice })
    if (url.endsWith('/item-1/revisions/2')) return response({ itemId: item.id, revision: 2, choice: { ...choice, prompt: 'Änderung anderer Autor' } })
    if (url.endsWith('/practice/authoring')) return response(state)
    if (url.endsWith('/items/item-1') && init?.method === 'PATCH') {
      patched.push(body)
      if (patched.length === 1) { latest = 2; return response({ error: 'Übungsfrage wurde geändert.' }, 412) }
      return response({ id: item.id, objectiveId: objective.id, latestRevision: 3 })
    }
    return response({ error: 'Unexpected URL' }, 404)
  })
  const user = userEvent.setup()
  render(<PracticeAuthorWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await user.click(await screen.findByRole('button', { name: /Welche Antwort stimmt/ }))
  const prompt = await screen.findByLabelText('Fragetext')
  await user.clear(prompt); await user.type(prompt, 'Meine neue Frage')
  await user.click(screen.getByRole('button', { name: 'Neue Version speichern' }))
  expect(await screen.findByRole('region', { name: 'Versionskonflikt' })).toHaveTextContent('Änderung anderer Autor')
  expect(screen.getByLabelText('Fragetext')).toHaveValue('Meine neue Frage')
  await user.click(screen.getByRole('button', { name: 'Meine Eingaben als neue Revision speichern' }))
  await waitFor(() => expect(patched).toHaveLength(2))
  expect(patched[0]).toMatchObject({ expectedRevision: 1, choice: { prompt: 'Meine neue Frage' } })
  expect(patched[1]).toMatchObject({ expectedRevision: 2, choice: { prompt: 'Meine neue Frage' } })
  expect((patched[1].choice as Record<string, unknown>).schemaVersion).toBeUndefined()
})

test('creates a plain learning objective and single-choice question without publishing them', async () => {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    if (init?.method && init.method !== 'GET') writes.push({ url, body })
    if (url.endsWith('/practice/objectives')) return init?.method === 'POST'
      ? response(objective, 201) : response({ objectives: [] })
    if (url.endsWith('/objective-1/items')) return init?.method === 'POST'
      ? response({ id: item.id, objectiveId: objective.id, latestRevision: 1 }, 201) : response({ items: [] })
    if (url.endsWith('/practice/authoring')) return response(state)
    return response({ error: 'Unexpected URL' }, 404)
  })
  const user = userEvent.setup()
  render(<PracticeAuthorWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await screen.findByRole('form', { name: 'Neues Lernziel' })
  await user.type(screen.getByLabelText('Titel'), objective.title)
  await user.type(screen.getByLabelText('Beschreibung'), objective.description)
  await user.click(screen.getByRole('button', { name: 'Lernziel anlegen' }))
  expect(await screen.findByRole('button', { name: 'Neue Frage' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Neue Frage' }))
  await user.type(screen.getByLabelText('Fragetext'), item.prompt)
  await user.type(screen.getByLabelText('A'), 'Richtig')
  await user.type(screen.getByLabelText('B'), 'Falsch')
  await user.click(screen.getByRole('button', { name: 'Frage anlegen' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[0]).toEqual({ url: '/api/courses/practice/objectives', body: { title: objective.title, description: objective.description } })
  expect(writes[1]).toEqual({ url: '/api/courses/practice/objectives/objective-1/items', body: { choice: { type: 'SINGLE_CHOICE', prompt: item.prompt, options: ['Richtig', 'Falsch'], correctIndex: 0, explanation: '' } } })
  expect(writes.some(row => row.url.includes('/publish'))).toBe(false)
  expect(await screen.findByRole('button', { name: 'Version anheften' })).toBeVisible()
})

test('shows both pinned sets on draft 412 and rebases only when explicitly chosen', async () => {
  const remote = { ...state, draft: { ...state.draft, revision: 2, payload: { schemaVersion: 1, items: [] } } }
  let stateReads = 0
  const patches: Record<string, unknown>[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    if (url.endsWith('/practice/objectives')) return response({ objectives: [objective] })
    if (url.endsWith('/objective-1/items')) return response({ items: [item] })
    if (url.endsWith('/item-1/revisions/1')) return response({ itemId: item.id, revision: 1, choice })
    if (url.endsWith('/practice/authoring')) {
      if (init?.method === 'PATCH') {
        patches.push(body)
        return patches.length === 1 ? response({ error: 'Übungsentwurf wurde geändert.' }, 412)
          : response({ ...remote, draft: { ...remote.draft, revision: 3, payload: { schemaVersion: 1, items: [ref] } } })
      }
      stateReads++
      return response(stateReads === 1 ? state : remote)
    }
    return response({ error: 'Unexpected URL' }, 404)
  })
  const user = userEvent.setup()
  render(<PracticeAuthorWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await user.click(await screen.findByRole('button', { name: /Welche Antwort stimmt/ }))
  await screen.findByLabelText('Fragetext')
  await user.click(screen.getByRole('button', { name: 'Version anheften' }))
  await user.click(screen.getByRole('button', { name: 'Zusammenstellung speichern' }))
  const conflict = await screen.findByRole('region', { name: 'Versionskonflikt' })
  expect(within(conflict).getByText('Aktueller Entwurf · R2')).toBeVisible()
  expect(within(conflict).getByText('Deine Auswahl')).toBeVisible()
  expect(patches).toHaveLength(1)
  await user.click(within(conflict).getByRole('button', { name: 'Meine Eingaben als neue Revision speichern' }))
  await waitFor(() => expect(patches).toHaveLength(2))
  expect(patches[1]).toEqual({ expectedRevision: 2, items: [ref] })
  expect(screen.queryByRole('region', { name: 'Versionskonflikt' })).not.toBeInTheDocument()
})

test('older pool entries survive reload, preview/publish, and long preview tokens wrap on a narrow viewport', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
  const longTitle = 'L'.repeat(300)
  const longOption = 'O'.repeat(1000)
  const olderObjective = { id: 'objective-oldest', title: longTitle, description: '', revision: 1 }
  const olderItem = { id: 'item-oldest', objectiveId: olderObjective.id, latestRevision: 1, prompt: 'Archived question?' }
  const olderChoice = { schemaVersion: 1, type: 'SINGLE_CHOICE', prompt: olderItem.prompt,
    options: [longOption, 'Another answer'], correctIndex: 0, explanation: '' }
  const olderRef = { objectiveId: olderObjective.id, objectiveRevision: 1, itemId: olderItem.id, itemRevision: 1 }
  const firstObjectives = Array.from({ length: 100 }, (_, index) => ({ id: `objective-${index}`, title: `Objective ${index}`, description: '', revision: 1 }))
  const firstItems = Array.from({ length: 100 }, (_, index) => ({ id: `item-${index}`, objectiveId: olderObjective.id, latestRevision: 1, prompt: `Question ${index}` }))
  let current: unknown = state
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/practice/objectives?cursor=')) return response({ objectives: [olderObjective], nextCursor: null })
    if (url.endsWith('/practice/objectives')) return response({ objectives: firstObjectives, nextCursor: 'older-objectives' })
    if (url.includes('/objective-oldest/items?cursor=')) return response({ items: [olderItem], nextCursor: null })
    if (url.endsWith('/objective-oldest/items')) return response({ items: firstItems, nextCursor: 'older-items' })
    if (url.includes('/items?cursor=')) return response({ items: [], nextCursor: null })
    if (url.endsWith('/items')) return response({ items: [], nextCursor: null })
    if (url.endsWith('/item-oldest/revisions/1')) return response({ itemId: olderItem.id, revision: 1, choice: olderChoice })
    if (url.endsWith('/practice/authoring/preview')) return response({ items: [{ ...olderRef, objectiveTitle: longTitle, objectiveDescription: '', ...olderChoice }] })
    if (url.endsWith('/practice/authoring/publish')) return response({ snapshot: { id: 'paged-snapshot', coursePublicationId: 'course-publication-1', sequence: 1, digest: 'digest', itemCount: 1 }, unchanged: false, replay: false })
    if (url.includes('/practice/authoring/history?cursor=')) return response({ activeCoursePublicationId: 'course-publication-1', snapshots: [{ id: 'snap-1', coursePublicationId: 'course-publication-1', sequence: 1, digest: 'digest', itemCount: 1 }], nextCursor: null })
    if (url.endsWith('/practice/authoring/history')) return response({ activeCoursePublicationId: 'course-publication-1', snapshots: Array.from({ length: 100 }, (_, index) => ({ id: `snap-${index + 2}`, coursePublicationId: 'course-publication-1', sequence: index + 2, digest: 'digest', itemCount: 1 })), nextCursor: '2' })
    if (url.endsWith('/practice/authoring')) {
      if (init?.method === 'PATCH') {
        current = { ...state, draft: { ...state.draft, revision: 1, payload: { schemaVersion: 1 as const, items: [olderRef] } } }
      }
      return response(current)
    }
    return response({ error: 'Unexpected URL' }, 404)
  })
  const user = userEvent.setup()
  const view = render(<PracticeAuthorWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await user.click(await screen.findByRole('button', { name: 'Ältere Lernziele laden' }))
  await user.click(await screen.findByRole('button', { name: new RegExp(longTitle) }))
  await user.click(await screen.findByRole('button', { name: 'Ältere Fragen laden' }))
  await user.click(await screen.findByRole('button', { name: /Archived question/ }))
  expect(await screen.findByLabelText('Fragetext')).toHaveValue(olderItem.prompt)
  await user.click(screen.getByRole('button', { name: 'Version anheften' }))
  await user.click(screen.getByRole('button', { name: 'Zusammenstellung speichern' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Veröffentlichung prüfen' })).toBeEnabled())
  view.unmount()
  render(<PracticeAuthorWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await user.click(await screen.findByRole('button', { name: 'Veröffentlichung prüfen' }))
  const review = await screen.findByRole('region', { name: 'Veröffentlichung prüfen' })
  expect(within(review).getByText(/Archived question/)).toBeVisible()
  expect(review.querySelector('p.text-xs')).toHaveClass('break-words', '[overflow-wrap:anywhere]')
  expect(within(review).getByText(/Another answer/)).toHaveClass('break-words', '[overflow-wrap:anywhere]')
  expect(review.textContent).toContain(longOption)
  expect(review.querySelector('ol li')).toHaveClass('break-words', '[overflow-wrap:anywhere]')
  await user.click(within(review).getByRole('button', { name: 'Diese Übungsfassung veröffentlichen' }))
  expect(await screen.findByText(/Veröffentlichungsbeleg · Version 1/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Verlauf' }))
  await user.click(await screen.findByRole('button', { name: 'Ältere Versionen laden' }))
  expect(await screen.findByText('Version 1', { selector: 'strong' })).toBeVisible()
})

test('out-of-order preview cannot replace the reviewed saved draft before publish', async () => {
  const secondItem = { id: 'item-2', objectiveId: objective.id, latestRevision: 1, prompt: 'Another practice question?' }
  const secondChoice = { ...choice, prompt: secondItem.prompt }
  const secondRef = { objectiveId: objective.id, objectiveRevision: 1, itemId: secondItem.id, itemRevision: 1 }
  const firstState = { ...state, draft: { ...state.draft, revision: 1, payload: { schemaVersion: 1 as const, items: [ref] } } }
  const secondState = { ...state, draft: { ...state.draft, revision: 2, payload: { schemaVersion: 1 as const, items: [ref, secondRef] } } }
  let current = firstState
  let finishFirstPreview!: (value: Response) => void
  const firstPreview = new Promise<Response>(resolve => { finishFirstPreview = resolve })
  const published: Record<string, unknown>[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    if (url.endsWith('/practice/objectives')) return response({ objectives: [objective], nextCursor: null })
    if (url.endsWith('/objective-1/items')) return response({ items: [item, secondItem], nextCursor: null })
    if (url.endsWith('/item-2/revisions/1')) return response({ itemId: secondItem.id, revision: 1, choice: secondChoice })
    if (url.endsWith('/practice/authoring/preview')) {
      const refs = body.items as typeof ref[]
      return refs.length === 1 ? firstPreview : response({ items: [
        { ...ref, objectiveTitle: objective.title, objectiveDescription: objective.description, ...choice },
        { ...secondRef, objectiveTitle: objective.title, objectiveDescription: objective.description, ...secondChoice },
      ] })
    }
    if (url.endsWith('/practice/authoring/publish')) {
      published.push(body)
      return response({ snapshot: { id: 'second-snapshot', coursePublicationId: 'course-publication-1', sequence: 2, digest: 'digest', itemCount: 2 }, unchanged: false, replay: false })
    }
    if (url.endsWith('/practice/authoring')) {
      if (init?.method === 'PATCH') current = secondState
      return response(current)
    }
    return response({ error: 'Unexpected URL' }, 404)
  })
  const user = userEvent.setup()
  render(<PracticeAuthorWorkspace courseId="course-1" sessionStatus="authenticated" />)
  await user.click(await screen.findByRole('button', { name: 'Veröffentlichung prüfen' }))
  await user.click(await screen.findByRole('button', { name: /Another practice question/ }))
  await screen.findByLabelText('Fragetext')
  await user.click(screen.getByRole('button', { name: 'Version anheften' }))
  await user.click(screen.getByRole('button', { name: 'Zusammenstellung speichern' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Veröffentlichung prüfen' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Veröffentlichung prüfen' }))
  const review = await screen.findByRole('region', { name: 'Veröffentlichung prüfen' })
  expect(within(review).getByText(/Another practice question/)).toBeVisible()
  finishFirstPreview(response({ items: [{ ...ref, objectiveTitle: objective.title, objectiveDescription: objective.description, ...choice }] }))
  await waitFor(() => expect(within(review).getByText(/Another practice question/)).toBeVisible())
  expect(within(review).getAllByRole('heading', { level: 4 })).toHaveLength(2)
  await user.click(within(review).getByRole('button', { name: 'Diese Übungsfassung veröffentlichen' }))
  expect(published).toEqual([{ expectedRevision: 2, expectedActivePublicationId: 'course-publication-1', requestId: expect.any(String) }])
})
