import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NewArticle from '@/app/knowledgebase/new-article/page'

const mockPush = jest.fn()
const mockToastError = jest.fn()

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Inhalt" value={content} onChange={event => onChange(event.target.value)} /> }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'author' } }, status: 'authenticated' }) }))
jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() } }))

const metadata = { categories: ['Werkstatt'], tags: ['Checkliste'] }

async function renderReadyArticle() {
  // Flush the resolved metadata fixture and its React updates before starting
  // the DOM-query retry window. Loading behavior is covered separately below.
  await act(async () => {
    render(<NewArticle />)
  })
}

beforeEach(() => {
  mockPush.mockClear()
  mockToastError.mockClear()
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => metadata } as Response))
})

it('keeps the composer loading until its category and tag metadata resolves', async () => {
  let finishMetadata!: (value: typeof metadata) => void
  const pendingMetadata = new Promise<typeof metadata>(resolve => { finishMetadata = resolve })
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: true, json: () => pendingMetadata } as Response)

  render(<NewArticle />)
  expect(global.fetch).toHaveBeenCalledWith('/api/articles/categories-and-tags', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(screen.getByRole('status')).toHaveTextContent('Editor wird geladen')
  expect(screen.queryByLabelText('Titel')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Kategorie')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Inhalt' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Als Entwurf speichern' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Veröffentlichen' })).not.toBeInTheDocument()

  await act(async () => {
    finishMetadata(metadata)
    await pendingMetadata
  })

  expect(screen.queryByText('Editor wird geladen')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Titel')).toBeRequired()
  expect(screen.getByLabelText('Kategorie')).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Werkstatt' })).toHaveValue('Werkstatt')
  expect(screen.getByRole('textbox', { name: 'Inhalt' })).toBeInTheDocument()
  for (const name of ['Als Entwurf speichern', 'Veröffentlichen']) {
    expect(screen.getAllByRole('button', { name })).toHaveLength(1)
    expect(screen.getByRole('button', { name })).toBeEnabled()
    expect(screen.getByRole('button', { name })).toHaveAttribute('type', 'button')
  }
})

it('has one early action pair, required title/category before content and optional image after it', async () => {
  await renderReadyArticle()
  const title = await screen.findByLabelText('Titel')
  const draft = screen.getByRole('button', { name: 'Als Entwurf speichern' })
  const publish = screen.getByRole('button', { name: 'Veröffentlichen' })
  const content = screen.getByRole('textbox', { name: 'Inhalt' })
  const category = screen.getByLabelText('Kategorie')
  const image = screen.getByRole('button', { name: 'Bild auswählen' })

  expect(screen.getAllByRole('button', { name: 'Als Entwurf speichern' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: 'Veröffentlichen' })).toHaveLength(1)
  expect(draft.closest('[role="group"]')).toBe(publish.closest('[role="group"]'))
  for (const action of [draft, publish]) {
    expect(action).toHaveAttribute('type', 'button')
    expect(action.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
  expect(title.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(category.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(content.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('Pflichtangaben: Titel, Inhalt und Kategorie.')).toBeInTheDocument()
  expect(title).toBeRequired()
  expect(screen.queryByRole('heading', { name: 'Aktionen' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Kategorie' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Tags (max. 5)')).toBeInTheDocument()
})

it.each([
  ['Als Entwurf speichern', 'Speichere...', 'false'],
  ['Veröffentlichen', 'Veröffentliche...', 'true'],
])('keeps %s explicit, pending and separate from the other action', async (action, pendingText, isPublished) => {
  let finish!: (response: Response) => void
  jest.mocked(global.fetch).mockImplementation(async (_input, options) => options?.method === 'POST'
    ? new Promise<Response>(resolve => { finish = resolve })
    : { ok: true, json: async () => metadata } as Response)
  await renderReadyArticle()
  fireEvent.change(await screen.findByLabelText('Titel'), { target: { value: 'Neue Anleitung' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Inhalt' }), { target: { value: 'Schritt für Schritt' } })
  fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: 'Werkstatt' } })
  fireEvent.change(screen.getByLabelText('Tags (max. 5)'), { target: { value: 'Checkliste' } })
  expect(jest.mocked(global.fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)

  const button = screen.getByRole('button', { name: action })
  button.focus()
  await userEvent.setup().keyboard('{Enter}')
  expect(await screen.findByRole('button', { name: pendingText })).toBeDisabled()
  const group = screen.getByRole('group', { name: 'Artikel speichern oder veröffentlichen' })
  expect(group.querySelectorAll('button:disabled')).toHaveLength(2)
  const call = jest.mocked(global.fetch).mock.calls.find(([, options]) => options?.method === 'POST')
  expect(call?.[0]).toBe('/api/articles')
  const body = call?.[1]?.body as FormData
  expect(body.get('title')).toBe('Neue Anleitung')
  expect(body.get('content')).toBe('Schritt für Schritt')
  expect(body.get('category')).toBe('Werkstatt')
  expect(body.get('tags')).toBe('Checkliste')
  expect(body.get('isPublished')).toBe(isPublished)

  await act(async () => finish({ ok: false, json: async () => ({ error: 'Synthetischer Speicherfehler' }) } as Response))
  expect(mockToastError).toHaveBeenCalledWith('Synthetischer Speicherfehler')
  expect(screen.getByRole('button', { name: action })).toBeEnabled()
  expect(screen.getByLabelText('Titel')).toHaveValue('Neue Anleitung')
  expect(mockPush).not.toHaveBeenCalled()
})

it.each(['Titel', 'Inhalt', 'Kategorie'])('keeps %s mandatory for both explicit actions', async missing => {
  await renderReadyArticle()
  const title = await screen.findByLabelText('Titel')
  if (missing !== 'Titel') fireEvent.change(title, { target: { value: 'Neue Anleitung' } })
  if (missing !== 'Inhalt') fireEvent.change(screen.getByRole('textbox', { name: 'Inhalt' }), { target: { value: 'Schritt für Schritt' } })
  if (missing !== 'Kategorie') fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: 'Werkstatt' } })
  for (const name of ['Als Entwurf speichern', 'Veröffentlichen']) {
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled())
  }
  expect(mockToastError).toHaveBeenCalledTimes(2)
  expect(jest.mocked(global.fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
})

it('retains optional image selection, preview and removal', async () => {
  const user = userEvent.setup()
  await renderReadyArticle()
  await screen.findByLabelText('Titel')
  const file = new File(['synthetic image'], 'fixture.png', { type: 'image/png' })
  const input = document.getElementById('featuredImage') as HTMLInputElement
  const picker = jest.spyOn(input, 'click')
  await user.click(screen.getByRole('button', { name: 'Bild auswählen' }))
  expect(picker).toHaveBeenCalledTimes(1)
  await user.upload(input, file)
  expect(await screen.findByAltText('Vorschau')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Beitragsbild entfernen' }))
  expect(screen.queryByAltText('Vorschau')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Beitragsbild entfernen' })).not.toBeInTheDocument()
  expect(jest.mocked(global.fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
})
