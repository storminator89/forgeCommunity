import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import NewArticle from '@/app/knowledgebase/new-article/page'

const mockPush = jest.fn()
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Inhalt" value={content} onChange={event => onChange(event.target.value)} /> }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'author' } }, status: 'authenticated' }) }))
jest.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light' }) }))

beforeEach(() => {
  mockPush.mockClear()
  global.fetch = jest.fn(async (_input, options) => options?.method === 'POST'
    ? { ok: false, json: async () => ({ error: 'Synthetischer Speicherfehler' }) } as Response
    : { ok: true, json: async () => ({ categories: ['Werkstatt'], tags: [] }) } as Response)
})

it('renders a required-field error through exactly one real Sonner host without submitting', async () => {
  render(<NewArticle />)
  await screen.findByLabelText('Titel')
  fireEvent.click(screen.getByRole('button', { name: 'Als Entwurf speichern' }))
  const main = screen.getByRole('main')
  expect(await within(main).findByText('Bitte füllen Sie alle erforderlichen Felder aus.')).toBeInTheDocument()
  expect(main.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1)
  expect(jest.mocked(global.fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  expect(mockPush).not.toHaveBeenCalled()
})

it.each(['Als Entwurf speichern', 'Veröffentlichen'])('shows a server error for %s, keeps values and does not repeat the request', async name => {
  const view = render(<NewArticle />)
  fireEvent.change(await screen.findByLabelText('Titel'), { target: { value: 'Neue Anleitung' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Inhalt' }), { target: { value: 'Schritt für Schritt' } })
  fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: 'Werkstatt' } })
  fireEvent.click(screen.getByRole('button', { name }))
  expect(await within(screen.getByRole('main')).findByText('Synthetischer Speicherfehler')).toBeInTheDocument()
  expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1)
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled())
  expect(screen.getByLabelText('Titel')).toHaveValue('Neue Anleitung')
  expect(screen.getByRole('textbox', { name: 'Inhalt' })).toHaveValue('Schritt für Schritt')
  expect(screen.getByLabelText('Kategorie')).toHaveValue('Werkstatt')
  view.rerender(<NewArticle />)
  await act(async () => { await Promise.resolve() })
  expect(jest.mocked(global.fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  expect(mockPush).not.toHaveBeenCalled()
})
