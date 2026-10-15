import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Community from '@/app/community/page'

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: () => <div role="textbox" aria-label="Text bearbeiten" /> }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'member', name: 'Ada Lovelace' } } }) }))

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] })
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
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/posts?page=1', expect.anything()))
})
