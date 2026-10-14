import { fireEvent, render, screen } from '@testing-library/react'
import Members from '@/app/members/page'

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [
    { id: 'ada', name: 'Ada Lovelace', image: null, role: 'USER', title: 'Entwicklerin', createdAt: '2026-01-10T10:00:00Z', followers: 2, skills: ['TypeScript'] },
    { id: 'bruno', name: 'Bruno Beispiel', image: null, role: 'USER', title: null, createdAt: '2026-02-10T10:00:00Z', followers: 0, skills: ['Design'] },
  ] })
})

it('uses real profile links and keeps search and view selection accessible', async () => {
  render(<Members />)
  const ada = await screen.findByRole('link', { name: 'Profil von Ada Lovelace öffnen' })
  expect(ada).toHaveAttribute('href', '/profile/ada')
  expect(ada.querySelector('button')).toBeNull()
  expect(screen.getByRole('link', { name: 'Profil von Bruno Beispiel öffnen' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Mitglieder suchen'), { target: { value: 'TypeScript' } })
  expect(screen.getByRole('link', { name: 'Profil von Ada Lovelace öffnen' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Profil von Bruno Beispiel öffnen' })).not.toBeInTheDocument()
  expect(screen.getByText('1 Ergebnis')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Listenansicht' }))
  expect(screen.getByRole('button', { name: 'Listenansicht' })).toHaveAttribute('aria-pressed', 'true')
})

it('offers a retry after the directory fails to load', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'))
  render(<Members />)
  expect(await screen.findByText('Mitglieder konnten nicht geladen werden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByRole('link', { name: 'Profil von Ada Lovelace öffnen' })).toBeInTheDocument()
  errorSpy.mockRestore()
})
