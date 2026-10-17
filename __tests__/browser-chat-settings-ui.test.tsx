import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { useSession } from '@/lib/sites-auth/react'
import SettingsPage from '@/app/settings/page'
import { SettingsUrlContext } from '../test-utils/settings-url-context'
import { BROWSER_CHAT_ALERT_PREFERENCE_EVENT } from '@/lib/browser-chat-alerts'

jest.mock('axios')
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/ImageUpload', () => ({ ImageUpload: () => null }))

const originalNotification = Object.getOwnPropertyDescriptor(window, 'Notification')
let permission: NotificationPermission
let requestPermission: jest.Mock

function installBrowserNotifications(value: NotificationPermission) {
  permission = value
  requestPermission = jest.fn(async () => {
    permission = 'granted'
    return permission
  })
  const browserNotification = Object.defineProperties(jest.fn(), {
    permission: { configurable: true, get: () => permission },
    requestPermission: { configurable: true, value: requestPermission },
  })
  Object.defineProperty(window, 'Notification', { configurable: true, value: browserNotification })
}

function setViewer(id: string) {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
}

function mockProfile(enabled: boolean) {
  jest.mocked(axios.get).mockImplementation(async (url: string) => url === '/api/user/profile'
    ? { data: { id: 'alice', name: 'Alice', email: 'alice@example.test', userSettings: { pushNotifications: enabled, emailNotifications: true } } }
    : { data: [] })
}

async function openNotificationSettings() {
  await screen.findByDisplayValue('alice@example.test')
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Meldungen' }))
}

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState(null, '', '/settings')
  setViewer('alice')
  mockProfile(true)
  installBrowserNotifications('default')
})

afterEach(() => {
  if (originalNotification) Object.defineProperty(window, 'Notification', originalNotification)
  else Reflect.deleteProperty(window, 'Notification')
})

it('does not ask for permission until the user clicks, then reflects a grant', async () => {
  const user = userEvent.setup()
  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await openNotificationSettings()
  expect(requestPermission).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Browser-Hinweise erlauben' }))
  expect(requestPermission).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('Desktop-Hinweise sind im Browser erlaubt.')).toBeInTheDocument()
})

it('explains a permission denial after an explicit click without prompting again', async () => {
  requestPermission.mockImplementationOnce(async () => { permission = 'denied'; return permission })
  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await openNotificationSettings()
  fireEvent.click(screen.getByRole('button', { name: 'Browser-Hinweise erlauben' }))
  expect(requestPermission).toHaveBeenCalledTimes(1)
  expect(await screen.findByText(/Desktop-Hinweise sind im Browser blockiert/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Browser-Hinweise erlauben' })).not.toBeInTheDocument()
})

it.each(['denied', 'granted'] as const)('shows the existing %s permission without prompting', async (value) => {
  installBrowserNotifications(value)
  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await openNotificationSettings()
  expect(requestPermission).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Browser-Hinweise erlauben' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(value === 'denied' ? 'im Browser blockiert' : 'im Browser erlaubt')
})

it('explains when browser desktop notifications are unsupported', async () => {
  Reflect.deleteProperty(window, 'Notification')
  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await openNotificationSettings()
  expect(screen.getByText('Dieser Browser unterstützt keine Desktop-Hinweise.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Browser-Hinweise erlauben' })).not.toBeInTheDocument()
})

it('broadcasts only a saved preference and keeps in-app notices independent', async () => {
  const user = userEvent.setup()
  const onPreference = jest.fn()
  window.addEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreference)
  jest.mocked(axios.put).mockResolvedValue({ data: { id: 'alice', userSettings: { pushNotifications: false } } })

  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await openNotificationSettings()
  onPreference.mockClear()
  expect(screen.getByText(/Meldungen in der App sind von diesen Schaltern unabhängig/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch', { name: 'Desktop-Hinweise für Chatnachrichten' }))
  expect(onPreference).not.toHaveBeenCalled()
  await user.click(screen.getAllByRole('button', { name: 'Speichern' }).at(0)!)
  await waitFor(() => expect(onPreference).toHaveBeenCalledTimes(1))
  expect((onPreference.mock.calls[0][0] as CustomEvent).detail).toEqual({ userId: 'alice', enabled: false })
  window.removeEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreference)
})

it('does not broadcast a failed save', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const onPreference = jest.fn()
  window.addEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreference)
  jest.mocked(axios.put).mockRejectedValue(new Error('offline'))

  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await openNotificationSettings()
  onPreference.mockClear()
  fireEvent.click(screen.getByRole('switch', { name: 'Desktop-Hinweise für Chatnachrichten' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Speichern' })[0])
  await waitFor(() => expect(axios.put).toHaveBeenCalled())
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Speichern' })[0]).toBeEnabled())
  expect(onPreference).not.toHaveBeenCalled()
  window.removeEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreference)
  errorSpy.mockRestore()
})

it('does not hydrate or broadcast a profile returned for another account', async () => {
  jest.mocked(axios.get).mockImplementation(async (url: string) => url === '/api/user/profile'
    ? { data: { id: 'bob', email: 'bob@example.test', userSettings: { pushNotifications: true } } }
    : { data: [] })
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const onPreference = jest.fn()
  window.addEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreference)

  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Einstellungen konnten nicht geladen werden')
  expect(screen.queryByDisplayValue('bob@example.test')).not.toBeInTheDocument()
  expect(onPreference).not.toHaveBeenCalled()
  window.removeEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreference)
  errorSpy.mockRestore()
})

it('does not broadcast a save response returned for another account', async () => {
  const user = userEvent.setup()
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const onPreference = jest.fn()
  window.addEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreference)
  jest.mocked(axios.put).mockResolvedValue({ data: { id: 'bob', userSettings: { pushNotifications: false } } })

  render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await openNotificationSettings()
  onPreference.mockClear()
  await user.click(screen.getByRole('switch', { name: 'Desktop-Hinweise für Chatnachrichten' }))
  await user.click(screen.getAllByRole('button', { name: 'Speichern' })[0])
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Speichern' })[0]).toBeEnabled())
  expect(onPreference).not.toHaveBeenCalled()
  window.removeEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreference)
  errorSpy.mockRestore()
})
