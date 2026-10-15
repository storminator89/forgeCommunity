import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function setUser(id: string | null) {
  jest.mocked(useSession).mockReturnValue({
    data: id ? { user: { id }, expires: '2099-01-01' } : null,
    status: id ? 'authenticated' : 'unauthenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
}

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState(null, '', '/settings')
})

it('clears private profile and certificates immediately on switch and logout', async () => {
  const user = userEvent.setup()
  let account = 'alice'
  setUser(account)
  jest.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url === '/api/user/profile') return { data: { id: account, name: account, email: `${account}@example.test`, userSettings: {} } }
    if (url === '/api/user/certificates') return { data: [{ id: account, courseId: 'course', courseName: `${account} private certificate`, issuedAt: '2026-01-01' }] }
    return { data: [] }
  })
  const view = render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  expect(await screen.findByDisplayValue('alice@example.test')).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Zertifikate' }))
  expect(screen.getByText('alice private certificate')).toBeInTheDocument()

  account = 'bob'
  setUser(account)
  view.rerender(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  expect(screen.queryByText('alice private certificate')).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('alice@example.test')).not.toBeInTheDocument()
  expect(await screen.findByText('bob private certificate')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Zertifikate' })).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('tab', { name: 'Konto' }))
  expect(screen.getByDisplayValue('bob@example.test')).toBeInTheDocument()

  setUser(null)
  view.rerender(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  expect(screen.queryByDisplayValue('bob@example.test')).not.toBeInTheDocument()
  expect(screen.getByText('Anmeldung erforderlich')).toBeInTheDocument()
})

it('ignores a previous account response that resolves after a switch', async () => {
  setUser('alice')
  let finishAlice!: (value: { data: unknown }) => void
  jest.mocked(axios.get).mockImplementation((url: string) => {
    if (url === '/api/user/profile' && !finishAlice) {
      return new Promise(resolve => { finishAlice = resolve })
    }
    if (url === '/api/user/profile') return Promise.resolve({ data: { id: 'bob', name: 'Bob', email: 'bob@example.test', userSettings: {} } })
    return Promise.resolve({ data: [] })
  })
  const view = render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  await waitFor(() => expect(finishAlice).toBeDefined())
  const aliceSignal = jest.mocked(axios.get).mock.calls.find(([url]) => url === '/api/user/profile')?.[1]?.signal
  setUser('bob')
  view.rerender(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  expect(aliceSignal?.aborted).toBe(true)
  expect(await screen.findByDisplayValue('bob@example.test')).toBeInTheDocument()
  await act(async () => { finishAlice({ data: { id: 'alice', name: 'Alice', email: 'alice@example.test', userSettings: {} } }) })
  expect(screen.getByDisplayValue('bob@example.test')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('alice@example.test')).not.toBeInTheDocument()
})

it('drops an unsaved edit and ignores a late save response on account switch', async () => {
  let account = 'alice'
  setUser(account)
  jest.mocked(axios.get).mockImplementation(async (url: string) =>
    url === '/api/user/profile'
      ? { data: { id: account, name: account, email: `${account}@example.test`, userSettings: {} } }
      : { data: [] })
  let finishSave!: (value: { data: unknown }) => void
  jest.mocked(axios.put).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve }))
  const view = render(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  expect(await screen.findByDisplayValue('alice@example.test')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'alice-draft@example.test' } })
  expect(screen.getByDisplayValue('alice-draft@example.test')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(finishSave).toBeDefined())
  const saveSignal = jest.mocked(axios.put).mock.calls[0][2]?.signal

  account = 'bob'
  setUser(account)
  view.rerender(<SettingsUrlContext><SettingsPage /></SettingsUrlContext>)
  expect(saveSignal?.aborted).toBe(true)
  expect(screen.queryByDisplayValue('alice-draft@example.test')).not.toBeInTheDocument()
  expect(await screen.findByDisplayValue('bob@example.test')).toBeInTheDocument()
  await act(async () => { finishSave({ data: {} }) })
  expect(screen.getByDisplayValue('bob@example.test')).toBeInTheDocument()
})
