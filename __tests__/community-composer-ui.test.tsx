import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from '@/lib/sites-auth/react'
import Community from '@/app/community/page'

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: () => <div role="textbox" aria-label="Text bearbeiten" /> }))
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))

beforeEach(() => {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'member', name: 'Ada Lovelace' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  global.fetch = jest.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.startsWith('/api/posts?') ? { posts: [], nextCursor: null } : [] }))
})

it('does not let a composer open and disappear while the signed-in session resolves', async () => {
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'loading', update: jest.fn() } as ReturnType<typeof useSession>)
  const view = render(<Community />)
  expect(screen.getByRole('heading', { name: 'Community' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('Community wird geladen')
  expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute('href', '#page-content')
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content')
  expect(screen.queryByRole('button', { name: 'Neuen Beitrag erstellen' })).not.toBeInTheDocument()

  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'member', name: 'Ada Lovelace' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  view.rerender(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: 'Neuen Beitrag erstellen' }))
  expect(await screen.findByRole('textbox', { name: 'Titel' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeVisible()
})

it('shows the public community after session resolution without leaving the loading state behind', async () => {
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'loading', update: jest.fn() } as ReturnType<typeof useSession>)
  const view = render(<Community />)
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() } as ReturnType<typeof useSession>)
  view.rerender(<Community />)
  expect(await screen.findByRole('button', { name: 'Neuen Beitrag erstellen' })).toBeVisible()
  expect(screen.queryByText('Community wird geladen')).not.toBeInTheDocument()
})

it('opens and cancels the community composer with one native button', async () => {
  render(<Community />)
  await screen.findByText('Keine Beiträge gefunden')
  const opener = screen.getByRole('button', { name: 'Neuen Beitrag erstellen' })
  expect(opener.tagName).toBe('BUTTON')
  expect(opener.querySelector('button')).toBeNull()

  fireEvent.click(opener)
  expect(await screen.findByRole('textbox', { name: 'Titel' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(await screen.findByRole('button', { name: 'Neuen Beitrag erstellen' })).toBeInTheDocument()
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/posts?feed=1', expect.anything()))
})

it('keeps a failed post load distinct from an empty feed and offers retry', async () => {
  let attempts = 0
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/posts?') && attempts++ === 0) {
      return { ok: false, json: async () => ({ message: 'Unavailable' }) }
    }
    return { ok: true, json: async () => url.startsWith('/api/posts?') ? { posts: [], nextCursor: null } : [] }
  })

  render(<Community />)
  expect((await screen.findByText('Beiträge konnten nicht geladen werden')).closest('[role="alert"]')).toBeInTheDocument()
  expect(screen.queryByText('Keine Beiträge gefunden')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByText('Keine Beiträge gefunden')).toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith('/api/posts?feed=1', expect.anything())
})
