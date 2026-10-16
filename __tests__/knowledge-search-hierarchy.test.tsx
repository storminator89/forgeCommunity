import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KnowledgeBase from '@/app/knowledgebase/page'

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))

// Rendering fixtures only. Real persistence and authorization remain covered by
// the existing real-HTTP article journeys.
const articles = [
  { id: 'repair', title: 'Reparaturen gemeinsam dokumentieren', content: '<p>Eine hilfreiche Anleitung.</p>', category: 'Werkstatt', featuredImage: null, author: { id: 'ada', name: 'Ada Winter', email: 'ada@example.test' }, createdAt: '2026-05-01T10:00:00.000Z', tags: [{ id: 'checklist', name: 'Checkliste' }] },
  { id: 'meeting', title: 'Ein offenes Lerntreffen planen', content: '<p>Raum für Austausch schaffen.</p>', category: 'Zusammenarbeit', featuredImage: null, author: { id: 'bea', name: 'Bea Sommer', email: 'bea@example.test' }, createdAt: '2026-05-02T10:00:00.000Z', tags: [] },
]

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => articles })
})

it('puts search before a single compact filter panel and the article list', async () => {
  render(<KnowledgeBase />)
  const article = await screen.findByRole('link', { name: /Reparaturen gemeinsam dokumentieren/ })
  const search = screen.getByRole('searchbox', { name: 'Artikel suchen' })
  const toggle = screen.getByRole('button', { name: 'Filter' })
  const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!

  expect(search.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(toggle.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(panel).toHaveClass('hidden', 'lg:block')
  expect(screen.getAllByRole('group', { name: 'Kategorie wählen' })).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Neuer Artikel' })).toHaveAttribute('href', '/knowledgebase/new-article')
  expect(screen.queryByText('Wissen / Entdecken')).not.toBeInTheDocument()
})

it('opens filters by keyboard and retains visible selected filters when collapsed', async () => {
  const user = userEvent.setup()
  render(<KnowledgeBase />)
  await screen.findByRole('link', { name: /Reparaturen gemeinsam dokumentieren/ })
  const toggle = screen.getByRole('button', { name: 'Filter' })
  toggle.focus()
  await user.keyboard('{Enter}')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const filters = screen.getByRole('complementary', { name: 'Artikelfilter' })
  await user.click(within(filters).getByRole('button', { name: /Werkstatt/ }))
  await user.click(within(filters).getByRole('button', { name: /Checkliste/ }))
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByText('Kategorie: Werkstatt')).toBeInTheDocument()
  expect(screen.getByText('Tag: Checkliste')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Ein offenes Lerntreffen planen/ })).not.toBeInTheDocument()

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ohne Treffer' } })
  expect(screen.getByRole('heading', { name: 'Keine Artikel gefunden' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Filter zurücksetzen' })).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }))
  expect(screen.getByRole('searchbox')).toHaveValue('')
  expect(screen.getByRole('link', { name: /Ein offenes Lerntreffen planen/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Alle Kategorien/ })).toHaveAttribute('aria-pressed', 'true')
})

it('does not turn unavailable or loading results into a zero count or a large empty tag block', async () => {
  let finish!: (response: Response) => void
  jest.mocked(global.fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  render(<KnowledgeBase />)
  expect(screen.getByRole('heading', { name: 'Artikel werden geladen' })).toBeInTheDocument()
  expect(screen.queryByText('0 Artikel')).not.toBeInTheDocument()
  expect(screen.queryByText('Noch keine Tags.')).not.toBeInTheDocument()

  await act(async () => finish({ ok: true, json: async () => [] } as unknown as Response))
  expect(screen.getByRole('heading', { name: 'Noch keine Artikel' })).toBeInTheDocument()
  expect(screen.getByText('0 Artikel')).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Tag wählen' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Alle Kategorien/ })).toBeInTheDocument()
})
