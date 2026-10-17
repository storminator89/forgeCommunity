import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

it('starts with search and truthful results without activity or location claims', async () => {
  render(<Members />)
  const search = screen.getByRole('searchbox', { name: 'Mitglieder suchen' })
  expect(search).toHaveAttribute('placeholder', 'Name, Rolle oder Skill')
  await screen.findByRole('link', { name: 'Profil von Ada Lovelace öffnen' })
  expect(screen.queryByText('Aktive Mitglieder')).not.toBeInTheDocument()
  expect(screen.queryByText('Neue diesen Monat')).not.toBeInTheDocument()
  expect(screen.queryByText('Alle Mitglieder')).not.toBeInTheDocument()
  expect(screen.queryByText('Menschen / Community')).not.toBeInTheDocument()
  expect(screen.getByText('2 Ergebnisse')).toBeInTheDocument()
  expect(within(screen.getByRole('link', { name: 'Profil von Ada Lovelace öffnen' }).closest('.fc-member-card') as HTMLElement).getByText('Mitglied')).toBeInTheDocument()
})

it('uses readable existing roles in search, filters and removable selections', async () => {
  const roles = ['USER', 'ADMIN', 'MODERATOR', 'INSTRUCTOR']
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: true, json: async () => roles.map((role, index) => ({
    id: role, name: `Person ${index}`, image: null, role, title: null,
    createdAt: '2026-01-10T10:00:00Z', followers: 0, skills: [],
  })) } as Response)
  render(<Members />)
  await screen.findByRole('link', { name: 'Profil von Person 0 öffnen' })
  for (const label of ['Mitglied', 'Administration', 'Moderation', 'Lehrperson']) expect(screen.getByText(label)).toBeInTheDocument()
  const search = screen.getByRole('searchbox', { name: 'Mitglieder suchen' })
  fireEvent.change(search, { target: { value: 'Lehrperson' } })
  expect(screen.getByRole('link', { name: 'Profil von Person 3 öffnen' })).toBeInTheDocument()
  expect(screen.getByText('1 Ergebnis')).toBeInTheDocument()
  fireEvent.change(search, { target: { value: '' } })
  await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Lehrperson' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Filter Lehrperson entfernen' })).toBeInTheDocument()
  expect(screen.getByText('1 Ergebnis')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Filter Lehrperson entfernen' }))
  expect(screen.getByText('4 Ergebnisse')).toBeInTheDocument()
})

it('does not claim an empty result before the request finishes', () => {
  jest.mocked(global.fetch).mockReturnValueOnce(new Promise(() => {}))
  render(<Members />)
  expect(screen.getByRole('status', { name: 'Mitglieder werden geladen' })).toBeInTheDocument()
  expect(screen.queryByText('0 Ergebnisse')).not.toBeInTheDocument()
})


it('opens only loaded member details and returns keyboard focus when the preview closes', async () => {
  render(<Members />)
  const trigger = await screen.findByRole('button', { name: 'Kurzprofil von Ada Lovelace' })
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  fireEvent.click(trigger)
  const preview = screen.getByRole('complementary', { name: 'Kurzprofil von Ada Lovelace' })
  expect(within(preview).getByText('2')).toBeInTheDocument()
  expect(within(preview).getByText('TypeScript')).toBeInTheDocument()
  expect(within(preview).getByRole('link', { name: 'Profil ansehen' })).toHaveAttribute('href', '/profile/ada')
  expect(within(preview).queryByText(/online|Nachricht senden/i)).not.toBeInTheDocument()
  fireEvent.click(within(preview).getByRole('button', { name: 'Kurzprofil schließen' }))
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  fireEvent.change(screen.getByLabelText('Mitglieder suchen'), { target: { value: 'Bruno' } })
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})
