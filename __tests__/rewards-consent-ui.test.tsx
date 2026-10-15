import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import SettingsPage from '@/app/settings/page'

jest.mock('axios')
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/ImageUpload', () => ({ ImageUpload: () => null }))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url === '/api/user/profile') return { data: { name: 'Ada', email: 'ada@example.com', image: null, userSettings: { publicRankingOptIn: false, emailNotifications: true, pushNotifications: true } } }
    return { data: [] }
  })
  jest.mocked(axios.put).mockResolvedValue({ data: {} })
})

it('starts with public ranking consent off and saves explicit opt-in', async () => {
  const user = userEvent.setup()
  render(<SettingsPage />)
  await user.click(screen.getByRole('tab', { name: 'Privatsphäre' }))
  const consent = await screen.findByRole('switch', { name: 'In der öffentlichen Rangliste erscheinen' })
  await waitFor(() => expect(consent).toBeEnabled())
  expect(consent).not.toBeChecked()
  expect(screen.getByText(/Deine Punkte und Meilensteine bleiben auch ohne Zustimmung/)).toBeInTheDocument()
  await user.click(consent)
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(axios.put).toHaveBeenCalledWith('/api/user/profile', expect.objectContaining({ publicRankingOptIn: true })))
})
