import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Community from '@/app/community/page'

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: () => <div role="textbox" aria-label="Text bearbeiten" /> }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'member', name: 'Ada Lovelace' } }, status: 'authenticated' }) }))

beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.startsWith('/api/posts?') ? { posts: [], nextCursor: null } : [] }))
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
