import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KnowledgeBase from '@/app/knowledgebase/page'
import ArticlePage from '@/app/knowledgebase/[id]/page'
import DraftsPage from '@/app/knowledgebase/drafts/page'
import { CategorySelect } from '@/components/CategorySelect'
import { TagSelect } from '@/components/TagSelect'

const mockPush = jest.fn()
let mockSession: { user: { id: string; name: string } } | null = { user: { id: 'author', name: 'Ada' } }

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'article-1' }), useRouter: () => ({ push: mockPush }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession, status: mockSession ? 'authenticated' : 'unauthenticated' }) }))

const article = {
  id: 'article-1', title: 'Gute Anleitung', content: '<p>Hilfreicher Inhalt</p><script>alert(1)</script>',
  category: 'Praxis', featuredImage: null, author: { id: 'author', name: 'Ada', email: 'ada@example.test' },
  createdAt: '2026-05-01T10:00:00.000Z', tags: [{ id: 'tag-1', name: 'Werkstatt' }],
}

beforeEach(() => {
  mockSession = { user: { id: 'author', name: 'Ada' } }
  mockPush.mockClear()
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [article] })
})

it('filters the article directory by category, tag, and search and restores results', async () => {
  render(<KnowledgeBase />)
  const link = await screen.findByRole('link', { name: /Gute Anleitung/ })
  expect(link).toHaveAttribute('href', '/knowledgebase/article-1')

  fireEvent.click(screen.getByRole('button', { name: /Praxis/ }))
  expect(screen.getByRole('button', { name: /Praxis/ })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: /Werkstatt/ }))
  expect(screen.getByRole('button', { name: /Werkstatt/ })).toHaveAttribute('aria-pressed', 'true')

  fireEvent.change(screen.getByLabelText('Artikel suchen'), { target: { value: 'unbekannt' } })
  expect(screen.getByText('Keine Artikel gefunden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }))
  expect(screen.getByRole('link', { name: /Gute Anleitung/ })).toBeInTheDocument()
  expect(screen.getByText('1 Artikel')).toBeInTheDocument()
})

it('shows a directory loading error instead of a false empty state', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response)
  render(<KnowledgeBase />)
  expect(await screen.findByText('Artikel konnten nicht geladen werden')).toBeInTheDocument()
  expect(screen.queryByText('Noch keine Artikel')).not.toBeInTheDocument()
  errorSpy.mockRestore()
})

it('renders a safe reading page with author edit action inside the application shell', async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: true, json: async () => article } as Response)
  render(<ArticlePage />)
  expect(await screen.findByRole('heading', { name: 'Gute Anleitung', level: 1 })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Bearbeiten' })).toHaveAttribute('href', '/knowledgebase/article-1/edit')
  expect(screen.getByRole('link', { name: 'Zur Artikelübersicht' })).toHaveAttribute('href', '/knowledgebase')
  expect(screen.getByText('Hilfreicher Inhalt')).toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute('href', '#page-content')
})

it('removes Alice’s unpublished article before Bob’s failed load and logout', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const privateArticle = { ...article, title: 'Alice private article', content: '<p>Alice secret body</p>' }
  jest.mocked(global.fetch)
    .mockResolvedValueOnce({ ok: true, json: async () => privateArticle } as Response)
    .mockResolvedValueOnce({ ok: false } as Response)
    .mockResolvedValueOnce({ ok: false } as Response)

  const view = render(<ArticlePage />)
  expect(await screen.findByRole('heading', { name: 'Alice private article' })).toBeInTheDocument()

  mockSession = { user: { id: 'bob', name: 'Bob' } }
  view.rerender(<ArticlePage />)
  expect(screen.queryByText('Alice secret body')).not.toBeInTheDocument()
  expect(await screen.findByText('Artikel nicht verfügbar')).toBeInTheDocument()

  mockSession = null
  view.rerender(<ArticlePage />)
  expect(screen.queryByText('Alice secret body')).not.toBeInTheDocument()
  errorSpy.mockRestore()
})

it('ignores Alice’s late unpublished article response after Bob signs in', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  let resolveAlice!: (value: Response) => void
  const aliceResponse = new Promise<Response>(resolve => { resolveAlice = resolve })
  jest.mocked(global.fetch).mockImplementationOnce(() => aliceResponse).mockResolvedValueOnce({ ok: false } as Response)

  const view = render(<ArticlePage />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
  mockSession = { user: { id: 'bob', name: 'Bob' } }
  view.rerender(<ArticlePage />)
  expect(await screen.findByText('Artikel nicht verfügbar')).toBeInTheDocument()

  await act(async () => {
    resolveAlice({ ok: true, json: async () => ({ ...article, title: 'Alice late draft', content: '<p>Alice late secret</p>' }) } as Response)
    await aliceResponse
  })
  expect(screen.queryByText('Alice late secret')).not.toBeInTheDocument()
  expect(screen.getByText('Artikel nicht verfügbar')).toBeInTheDocument()
  errorSpy.mockRestore()
})

it('searches drafts and recovers from a failed request', async () => {
  const draft = { id: 'draft-1', title: 'Erster Entwurf', content: '<p>Notizen</p>', category: 'Praxis', featuredImage: null, createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-02T10:00:00.000Z' }
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: false } as Response).mockResolvedValueOnce({ ok: true, json: async () => [draft] } as Response)
  render(<DraftsPage />)
  expect(await screen.findByText('Entwürfe konnten nicht geladen werden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByRole('link', { name: 'Erster Entwurf' })).toHaveAttribute('href', '/knowledgebase/edit/draft-1')
  fireEvent.change(screen.getByLabelText('Entwürfe suchen'), { target: { value: 'ohne Treffer' } })
  expect(screen.getByText('Keine Ergebnisse gefunden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Suche zurücksetzen' }))
  expect(screen.getByRole('link', { name: 'Erster Entwurf' })).toBeInTheDocument()
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
})

it('discards loaded drafts immediately on account switch, failed load, and logout', async () => {
  const aliceDraft = { id: 'alice-draft', title: 'Privater Alice-Entwurf', content: '', category: 'Privat', featuredImage: null, createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-02T10:00:00.000Z' }
  const fetchMock = jest.mocked(global.fetch)
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [aliceDraft] } as Response)
    .mockResolvedValueOnce({ ok: false } as Response)
  const view = render(<DraftsPage />)
  expect(await screen.findByRole('link', { name: 'Privater Alice-Entwurf' })).toBeInTheDocument()

  mockSession = { user: { id: 'bob', name: 'Bob' } }
  view.rerender(<DraftsPage />)
  expect(screen.queryByRole('link', { name: 'Privater Alice-Entwurf' })).not.toBeInTheDocument()
  expect(await screen.findByText('Entwürfe konnten nicht geladen werden')).toBeInTheDocument()
  expect(screen.queryByText('Privater Alice-Entwurf')).not.toBeInTheDocument()

  mockSession = null
  view.rerender(<DraftsPage />)
  expect(screen.getByText('Anmeldung erforderlich')).toBeInTheDocument()
  expect(screen.queryByText('Privater Alice-Entwurf')).not.toBeInTheDocument()
})

it('ignores an Alice draft response that settles after Bob signs in', async () => {
  const aliceDraft = { id: 'alice-draft', title: 'Verspäteter Alice-Entwurf', content: '', category: 'Privat', featuredImage: null, createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-02T10:00:00.000Z' }
  let resolveAlice!: (response: Response) => void
  jest.mocked(global.fetch)
    .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveAlice = resolve }))
    .mockResolvedValueOnce({ ok: false } as Response)

  const view = render(<DraftsPage />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
  mockSession = { user: { id: 'bob', name: 'Bob' } }
  view.rerender(<DraftsPage />)
  expect(await screen.findByText('Entwürfe konnten nicht geladen werden')).toBeInTheDocument()

  await act(async () => resolveAlice({ ok: true, json: async () => [aliceDraft] } as Response))
  expect(screen.queryByText('Verspäteter Alice-Entwurf')).not.toBeInTheDocument()
  expect(screen.getByText('Entwürfe konnten nicht geladen werden')).toBeInTheDocument()
})

it('provides labeled, keyboard-usable category and tag creation and tag removal', () => {
  const onAddCategory = jest.fn()
  const onAddTag = jest.fn()
  const onTagRemove = jest.fn()
  const { rerender } = render(<CategorySelect categories={[]} selectedCategory="" setSelectedCategory={jest.fn()} onAddCategory={onAddCategory} />)
  fireEvent.click(screen.getByRole('button', { name: 'Neue Kategorie erstellen' }))
  const category = screen.getByLabelText('Kategorie')
  fireEvent.change(category, { target: { value: 'Wissen' } })
  fireEvent.keyDown(category, { key: 'Enter' })
  expect(onAddCategory).toHaveBeenCalledWith('Wissen')

  rerender(<TagSelect availableTags={[]} selectedTags={['Werkstatt']} onTagSelect={jest.fn()} onTagRemove={onTagRemove} onAddTag={onAddTag} />)
  fireEvent.click(screen.getByRole('button', { name: 'Tag Werkstatt entfernen' }))
  expect(onTagRemove).toHaveBeenCalledWith('Werkstatt')
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Tag erstellen' }))
  const tag = screen.getByLabelText('Tags (max. 5)')
  fireEvent.change(tag, { target: { value: 'Praxis' } })
  fireEvent.keyDown(tag, { key: 'Enter' })
  expect(onAddTag).toHaveBeenCalledWith('Praxis')
})
