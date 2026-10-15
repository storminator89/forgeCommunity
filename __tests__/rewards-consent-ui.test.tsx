import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { useSession } from 'next-auth/react'
import SettingsPage from '@/app/settings/page'
import { SettingsUrlContext } from '../test-utils/settings-url-context'

jest.mock('axios')
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/ImageUpload', () => ({ ImageUpload: () => null }))

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState(null, '', '/settings')
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  jest.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url === '/api/user/profile') return { data: { id: 'alice', name: 'Ada', email: 'ada@example.com', image: null, userSettings: { publicRankingOptIn: false, emailNotifications: true, pushNotifications: true } } }
    return { data: [] }
  })
  jest.mocked(axios.put).mockResolvedValue({ data: { id: 'alice', userSettings: { pushNotifications: true } } })
})

it('starts with public ranking consent off and saves explicit opt-in', async () => {
  const user = userEvent.setup()
  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await user.click(await screen.findByRole('tab', { name: 'Privatsphäre' }))
  const consent = await screen.findByRole('switch', { name: 'In der öffentlichen Rangliste erscheinen' })
  await waitFor(() => expect(consent).toBeEnabled())
  expect(consent).not.toBeChecked()
  expect(screen.getByText(/Deine Punkte und Meilensteine bleiben auch ohne Zustimmung/)).toBeInTheDocument()
  await user.click(consent)
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(axios.put).toHaveBeenCalledWith('/api/user/profile', expect.objectContaining({ publicRankingOptIn: true }), expect.objectContaining({ signal: expect.any(AbortSignal) })))
})

it('keeps all five settings tabs reachable in the mobile reflow', async () => {
  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  const tabs = await screen.findByRole('tablist')
  expect(tabs).toHaveClass('grid-cols-2', 'sm:grid-cols-3', 'lg:grid-cols-5')
  expect(screen.getAllByRole('tab')).toHaveLength(5)
  for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('min-h-11')
  expect(screen.getByRole('tab', { name: 'Privatsphäre' })).toBeInTheDocument()
})

it('explains that email and background push are unavailable while browser-open chat alerts are optional', async () => {
  const user = userEvent.setup()
  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await user.click(await screen.findByRole('tab', { name: 'Meldungen' }))
  expect(screen.getByText(/E-Mails und Hintergrund-Push werden derzeit nicht versendet/)).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'E-Mail-Wunsch für später (kein Versand)' })).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Desktop-Hinweise für Chatnachrichten' })).toBeInTheDocument()
})

it('shows a retryable error instead of editable defaults when profile loading fails', async () => {
  jest.mocked(axios.get).mockRejectedValueOnce(new Error('network'))
  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Einstellungen konnten nicht geladen werden')
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Erneut laden' })).toBeInTheDocument()
})
